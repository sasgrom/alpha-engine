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
import { bindReviewerIp } from "./services/reviewer-access";

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
      loginSucceeded(ip, input.username);
      await bindReviewerIp(user.id, ip);
      await touchSignIn(user.id);
      await recordEvent(user.id, "login", { ip }); // D35: activity collection
      const token = await signSessionToken({ unionId: user.unionId, clientId: env.appId });
      return { ...sessionCookie(ctx, user.unionId, token), role: user.role, name: user.name };
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
      const token = await signSessionToken({ unionId: user.unionId, clientId: env.appId });
      return { ...sessionCookie(ctx, user.unionId, token), role: user.role, name: user.name };
    }),
});
