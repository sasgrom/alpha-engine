import { randomUUID } from "node:crypto";
import * as cookie from "cookie";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { env } from "./lib/env";
import { signSessionToken } from "./kimi/session";
import { createLocalUser, findUserByUsername, touchSignIn } from "./queries/users";
import { hashPassword, passwordPolicyError, usernamePolicyError, verifyPassword } from "./services/passwords";
import { issueCaptcha, verifyCaptcha } from "./services/captcha";
import { loginFailed, loginGate, loginSucceeded, signupAllowed, signupOpen } from "./services/login-guard";
import { recordEvent } from "./services/activity";
import { recordSecurityEvent, trustedClientIp } from "./services/perimeter";
import { listSessions, registerSession, revokeAllSessions, revokeSession, revokeToken, sessionToken, tokenHash } from "./services/sessions";
import { beginSecondFactor, checkSecondFactor, enableSecondFactor, removeSecondFactor, secondFactorEnabled, secondFactorStatus } from "./services/second-factor";
import { bindReviewerIp } from "./services/reviewer-access";

/**
 * A session token for one sign-in. The shared signer writes whatever claims it is given; `sid` is a random id of this
 * sign-in, so two sign-ins of one account in the same second are still two different tokens (and two sessions that
 * can be ended separately). The verifier reads only unionId and clientId.
 */
function newSessionToken(unionId: string): Promise<string> {
  return signSessionToken({ unionId, clientId: env.appId, sid: randomUUID() } as Parameters<typeof signSessionToken>[0]);
}

/** How long the browser keeps the session cookie. */
const SESSION_COOKIE_DAYS = 30;
/** A wrong password costs this long, so guesses cannot be made faster than the counters fill. */
const FAILURE_DELAY_MS = 600;

/** Serialize the session cookie (the same signed token the OAuth callback issues, with stricter cookie attributes). */
function sessionCookie(ctx: { req: Request; resHeaders: Headers }, unionId: string, token: string) {
  const opts = getSessionCookieOptions(ctx.req.headers);
  ctx.resHeaders.append(
    "set-cookie",
    // SameSite=Lax: the browser does not send the session on a request another site makes (the shared default for a
    // host that is not localhost is None, which would). The browser keeps it for 30 days.
    cookie.serialize(Session.cookieName, token, {
      httpOnly: true,
      path: opts.path,
      sameSite: "lax",
      secure: opts.secure,
      maxAge: SESSION_COOKIE_DAYS * 86_400,
    }),
  );
  return { ok: true as const, unionId };
}

export const authRouter = createRouter({
  // 4g security fix: never serialize credential material — passwordHash and
  // unionId are server-side identity, the UI needs profile fields only
  me: authedQuery.query((opts) => {
    const u = opts.ctx.user;
    const { passwordHash: _ph, unionId: _ui, ...safe } = u;
    return safe;
  }),
  logout: authedQuery.mutation(async ({ ctx }) => {
    const current = sessionToken(ctx.req.headers);
    if (current) await revokeToken(current);
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: true,
        path: opts.path,
        sameSite: "lax",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),

  /**
   * Issue an SVG math captcha (4d, D33). Required always on signup; on login
   * only after ≥3 failures for the ip+username pair (the server says when —
   * the client then shows the captcha block).
   */
  captcha: publicQuery.query(() => issueCaptcha()),

  /** Whether the sign-in page may offer "create an account" (closed unless the owner opened it). */
  signupOpen: publicQuery.query(() => ({ open: signupOpen() })),

  /**
   * Local username/password login (4d, D33) — replaces Kimi OAuth as the
   * production sign-in path. The session token is the SAME HS256 cookie the
   * OAuth callback issues (api/kimi is read-only, we reuse its signer), so
   * authedQuery/adminQuery and the whole frontend auth stack are unchanged.
   * Security: generic errors (no user-existence oracle), scrypt verify,
   * in-process rate limit + lockout + captcha escalation (login-guard).
   */
  login: publicQuery
    .input(
      z.object({
        username: z.string().min(1).max(64),
        password: z.string().min(1).max(200),
        captchaId: z.string().optional(),
        captchaAnswer: z.string().optional(),
        /** The second factor: a 6-digit code from the authenticator app, or a recovery code. Asked for only when the account has one. */
        code: z.string().max(40).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ip = trustedClientIp(ctx.req.headers);
      const gate = loginGate(ip, input.username);
      if (gate.locked) {
        recordSecurityEvent({ kind: "login_locked", ip, detail: `retry in ${gate.retryAfterSec}s` });
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many failed attempts — retry in ${gate.retryAfterSec}s`,
        });
      }
      if (gate.captchaRequired && !verifyCaptcha(input.captchaId, input.captchaAnswer)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "captcha required or invalid" });
      }
      const user = await findUserByUsername(input.username);
      const ok = user?.passwordHash ? await verifyPassword(input.password, user.passwordHash) : false;
      if (!ok || !user) {
        loginFailed(ip, input.username);
        recordSecurityEvent({ kind: "login_failed", ip, detail: `name of ${input.username.length} characters` });
        await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid username or password" });
      }
      // the second factor, only after the password is right: an attacker without the password learns nothing about it
      if (await secondFactorEnabled(user.id)) {
        if (!input.code?.trim()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "second factor required" });
        const passed = await checkSecondFactor(user.id, input.code);
        if (!passed) {
          loginFailed(ip, input.username);
          recordSecurityEvent({ kind: "second_factor_failed", ip, detail: `user ${user.id}` });
          await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid code" });
        }
        if (passed === "recovery") recordSecurityEvent({ kind: "recovery_code_used", ip, detail: `user ${user.id}` });
      }
      loginSucceeded(ip, input.username);
      await bindReviewerIp(user.id, ip);
      await touchSignIn(user.id);
      await recordEvent(user.id, "login", { ip }); // D35: activity collection
      const token = await newSessionToken(user.unionId);
      await registerSession({ userId: user.id, token, ip, userAgent: ctx.req.headers.get("user-agent") });
      recordSecurityEvent({ kind: "login", ip, detail: `user ${user.id}` });
      return { ...sessionCookie(ctx, user.unionId, token), role: user.role, name: user.name };
    }),

  /** The viewer's own security state: the second factor and the open sessions. */
  security: authedQuery.query(async ({ ctx }) => {
    const current = sessionToken(ctx.req.headers);
    return { secondFactor: await secondFactorStatus(ctx.user.id), sessions: await listSessions(ctx.user.id, current ? tokenHash(current) : null) };
  }),

  /** Starts setting up the second factor: the password again, then a secret for the authenticator app. */
  secondFactorBegin: authedQuery.input(z.object({ password: z.string().min(1).max(200) })).mutation(async ({ input, ctx }) => {
    if (ctx.viewAsUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "read-only view-as mode" });
    if (!(await verifyPassword(input.password, ctx.user.passwordHash))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Wrong password" });
    try { return await beginSecondFactor(ctx.user.id, ctx.user.username ?? ctx.user.name ?? String(ctx.user.id)); }
    catch (error) { throw new TRPCError({ code: "CONFLICT", message: error instanceof Error ? error.message : "second factor is already on" }); }
  }),

  /** Confirms the set-up with a code from the app. Returns the recovery codes: shown this once, never again. */
  secondFactorEnable: authedQuery.input(z.object({ code: z.string().min(6).max(12) })).mutation(async ({ input, ctx }) => {
    const codes = await enableSecondFactor(ctx.user.id, input.code);
    if (!codes) throw new TRPCError({ code: "BAD_REQUEST", message: "That code is not right. Check the app's clock and try the next code." });
    // every other sign-in was made with the password alone: they end
    const current = sessionToken(ctx.req.headers);
    await revokeAllSessions(ctx.user.id, current ? tokenHash(current) : null);
    recordSecurityEvent({ kind: "second_factor_on", ip: trustedClientIp(ctx.req.headers), detail: `user ${ctx.user.id}` });
    return { recoveryCodes: codes };
  }),

  /** Turns the second factor off: the password and a current code (or a recovery code). */
  secondFactorDisable: authedQuery.input(z.object({ password: z.string().min(1).max(200), code: z.string().min(6).max(40) })).mutation(async ({ input, ctx }) => {
    if (ctx.viewAsUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "read-only view-as mode" });
    if (!(await verifyPassword(input.password, ctx.user.passwordHash)) || !(await checkSecondFactor(ctx.user.id, input.code))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Wrong password or code" });
    await removeSecondFactor(ctx.user.id);
    recordSecurityEvent({ kind: "second_factor_off", ip: trustedClientIp(ctx.req.headers), detail: `user ${ctx.user.id}` });
    return { ok: true };
  }),

  /** Ends one of the viewer's own sessions. */
  revokeSession: authedQuery.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => ({ ok: await revokeSession(ctx.user.id, input.id) })),

  /** Ends every other session of the viewer ("sign out everywhere else"). */
  revokeOtherSessions: authedQuery.mutation(async ({ ctx }) => {
    const current = sessionToken(ctx.req.headers);
    return { ended: await revokeAllSessions(ctx.user.id, current ? tokenHash(current) : null) };
  }),

  /**
   * Public signup (4d, D33) — creates a role="user" account only (no
   * privilege escalation path by construction). Always captcha'd, throttled
   * per IP, policy-checked username/password; new users start with an EMPTY
   * personal universe (D30).
   */
  signup: publicQuery
    .input(
      z.object({
        username: z.string().min(3).max(32),
        password: z.string().min(1).max(200),
        captchaId: z.string(),
        captchaAnswer: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ip = trustedClientIp(ctx.req.headers);
      if (!signupOpen()) {
        recordSecurityEvent({ kind: "signup_refused", ip, detail: "sign-up is closed" });
        throw new TRPCError({ code: "FORBIDDEN", message: "Accounts are created by the owner" });
      }
      if (!signupAllowed(ip)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many signups from this address — try later" });
      }
      if (!verifyCaptcha(input.captchaId, input.captchaAnswer)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "captcha invalid or expired — solve a fresh one" });
      }
      const uErr = usernamePolicyError(input.username);
      if (uErr) throw new TRPCError({ code: "BAD_REQUEST", message: uErr });
      const pErr = passwordPolicyError(input.password, input.username);
      if (pErr) throw new TRPCError({ code: "BAD_REQUEST", message: pErr });
      const existing = await findUserByUsername(input.username);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "username is taken" });
      const user = await createLocalUser({
        username: input.username,
        passwordHash: await hashPassword(input.password),
        name: input.username,
        role: "user",
      });
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "signup failed" });
      await recordEvent(user.id, "signup", { ip }); // D35
      const token = await newSessionToken(user.unionId);
      await registerSession({ userId: user.id, token, ip, userAgent: ctx.req.headers.get("user-agent") });
      return { ...sessionCookie(ctx, user.unionId, token), role: user.role, name: user.name };
    }),
});
