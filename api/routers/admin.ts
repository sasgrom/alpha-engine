/**
 * Admin router — the platform owner's service section (iteration 3b/3c).
 *
 * PURPOSE: manuals (ALPHA_ENGINE_MANUAL RU/EN, LLM_CONTEXT) and full job logs
 * must be readable in the browser but invisible to role="user" accounts.
 * Every procedure sits behind adminQuery (users.role="admin" guard in
 * middleware.ts): a non-admin gets FORBIDDEN even on a direct API call,
 * and the frontend additionally hides the menu item (see AppLayout).
 *
 * MANUAL SOURCES: fresh docs/*.md from disk when available, otherwise the
 * bundled snapshot in api/services/manuals-content.ts. The fallback exists
 * because the production runtime's cwd is /code, not /app — fs reads of
 * docs/ failed there with ENOENT. esbuild inlines the bundled module into
 * dist/boot.js, so manuals are present in every runtime by construction.
 *
 * LOGS: job_logs is the full machine trail of the pipeline (harvest steps,
 * scoring, LLM errors). The Jobs page shows only a tail for compactness;
 * here the owner gets the complete log of any selected job.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery } from "../middleware";
import { crossSectionFactorIc } from "../services/factor-ic";
import { getDb } from "../queries/connection";
import { jobs, jobLogs, users } from "@db/schema";
import { sql } from "drizzle-orm";
import { MANUALS_BUNDLED, MANUALS_BUNDLED_AT } from "../services/manuals-content";
import { activitySummary, recentActivity } from "../services/activity";
import { hashPassword, usernamePolicyError } from "../services/passwords";
import {
  createLocalUser,
  deleteUserCascade,
  findUserByUsername,
  listUsersWithStats,
  setUserPassword,
  setUserRole,
} from "../queries/users";

/**
 * Candidate docs directories, tried in order. Dev (vite/tsx) resolves via
 * process.cwd(); production images may keep docs at /app/docs (Dockerfile
 * COPY) while the process runs from /code — hence both absolute candidates.
 */
const DOCS_DIR_CANDIDATES = [
  path.join(process.cwd(), "docs"),
  "/code/docs",
  "/app/docs",
];

/** Manual registry: id (whitelist — never an arbitrary path), title, on-disk file. */
const MANUAL_FILES = [
  { id: "engine-manual-en", title: "Engine Manual (EN)", file: "ALPHA_ENGINE_MANUAL_EN.md" },
  { id: "engine-manual-ru", title: "Engine Manual (RU)", file: "ALPHA_ENGINE_MANUAL.md" },
  { id: "llm-context", title: "LLM Context", file: "LLM_CONTEXT.md" },
  // 4i: the factor/value/signals design memo (D41–D43) reads here too
  { id: "design-value-signals", title: "Design: Value & Signals", file: "DESIGN_VALUE_SIGNALS.md" },
] as const;

type ManualId = (typeof MANUAL_FILES)[number]["id"];

/** Read a manual from the first docs dir that has it; null if nowhere on disk. */
async function readManualFromDisk(file: string): Promise<{ content: string; updatedAt: string } | null> {
  for (const dir of DOCS_DIR_CANDIDATES) {
    try {
      const p = path.join(dir, file);
      const [content, st] = await Promise.all([readFile(p, "utf8"), stat(p)]);
      return { content, updatedAt: st.mtime.toISOString() };
    } catch {
      // candidate miss — try the next one
    }
  }
  return null;
}

export const adminRouter = createRouter({
  /** 6a: cross-sectional factor IC by quarter (owner's factor monitor). */
  factorIc: adminQuery.query(async () => crossSectionFactorIc()),

  /**
   * Manual list with metadata. `source` tells the UI whether the text came
   * from live disk or from the bundled snapshot (honesty about staleness).
   */
  manuals: adminQuery.query(async () => {
    return MANUAL_FILES.map((m) => ({
      id: m.id as ManualId,
      title: m.title,
      bundledAt: MANUALS_BUNDLED_AT,
    }));
  }),

  /**
   * Full manual text by whitelisted id. Disk first (always fresh in dev),
   * bundled snapshot as the fallback that keeps prod working.
   */
  manualContent: adminQuery
    .input(z.object({ id: z.enum(["engine-manual-en", "engine-manual-ru", "llm-context", "design-value-signals"]) }))
    .query(async ({ input }) => {
      const m = MANUAL_FILES.find((x) => x.id === input.id);
      if (!m) throw new Error(`unknown manual: ${input.id}`);
      const disk = await readManualFromDisk(m.file);
      if (disk) return { id: m.id, title: m.title, content: disk.content, source: "disk" as const, updatedAt: disk.updatedAt };
      const bundled = MANUALS_BUNDLED[m.id];
      if (!bundled) throw new Error(`manual not available: ${input.id}`);
      return { id: m.id, title: m.title, content: bundled.content, source: "bundled" as const, updatedAt: MANUALS_BUNDLED_AT };
    }),

  /**
   * Recent jobs with creator identity (joined from users). Admin sees all
   * jobs across users — the per-user scoping for role="user" lives in the
   * regular jobs.list endpoint (see routers/engine.ts).
   */
  recentJobs: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: jobs.id,
        // schema.ts names the column `type` (enum bootstrap/.../score), not jobType
        type: jobs.type,
        status: jobs.status,
        params: jobs.params,
        message: jobs.message,
        createdAt: jobs.createdAt,
        finishedAt: jobs.finishedAt,
        startedBy: jobs.startedBy,
        startedByName: users.name,
      })
      .from(jobs)
      .leftJoin(users, eq(jobs.startedBy, users.id))
      .orderBy(desc(jobs.id))
      .limit(50);
    return rows;
  }),

  /**
   * Full log of one job (all lines, chronological). The 2000-line cap guards
   * against unloading megabytes into the browser; truncation is flagged so
   * the UI can say so.
   */
  jobLog: adminQuery
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => {
      const LIMIT = 2000;
      const rows = await getDb()
        .select()
        .from(jobLogs)
        .where(eq(jobLogs.jobId, input.jobId))
        .orderBy(jobLogs.id)
        .limit(LIMIT + 1);
      const truncated = rows.length > LIMIT;
      return { lines: rows.slice(0, LIMIT), truncated };
    }),

  // -------------------------------------------------------------------------
  // User management (4d, D33) — admin-only by router construction.
  // Passwords are hashed (scrypt) before they ever reach the DB; the list
  // never returns hashes. Admin cannot delete/demote HIMSELF (lockout
  // prevention); deleting a user cascades only their per-user artifacts.
  // -------------------------------------------------------------------------

  /** All accounts with universe sizes (no hashes, no secrets). */
  usersList: adminQuery.query(() => listUsersWithStats()),

  /** Create a local account. Admin-chosen passwords skip the public policy. */
  createUser: adminQuery
    .input(
      z.object({
        username: z.string().min(3).max(32),
        password: z.string().min(1).max(200),
        name: z.string().max(255).optional(),
        role: z.enum(["user", "admin"]).default("user"),
      })
    )
    .mutation(async ({ input }) => {
      const uErr = usernamePolicyError(input.username);
      if (uErr) throw new TRPCError({ code: "BAD_REQUEST", message: uErr });
      const existing = await findUserByUsername(input.username);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "username is taken" });
      const user = await createLocalUser({
        username: input.username,
        passwordHash: await hashPassword(input.password),
        name: input.name?.trim() || input.username,
        role: input.role,
      });
      return { ok: true, id: user?.id };
    }),

  /** Delete a user (+ their memberships and message threads). Not yourself. */
  deleteUser: adminQuery
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "you cannot delete your own account" });
      }
      await deleteUserCascade(input.userId);
      return { ok: true };
    }),

  /** Reset a user's password (admin-chosen, no policy — owner's prerogative). */
  resetPassword: adminQuery
    .input(z.object({ userId: z.number(), password: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => {
      await setUserPassword(input.userId, await hashPassword(input.password));
      return { ok: true };
    }),

  /** Promote/demote. Not yourself (an admin cannot lock themselves out). */
  setUserRole: adminQuery
    .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "you cannot change your own role" });
      }
      await setUserRole(input.userId, input.role);
      return { ok: true };
    }),

  /**
   * Per-user info summary (4e, D35): account + universe size + message count
   * + activity markers (last login, last seen, logins 7d, page views 24h).
   * Feeds the admin's contact info panel and the Users tab.
   */
  userSummary: adminQuery.input(z.object({ userId: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const [u] = await db
      .select({ id: users.id, username: users.username, name: users.name, role: users.role, createdAt: users.createdAt, lastSignInAt: users.lastSignInAt })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
    const res: any = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM user_universe WHERE userId = ${input.userId}) AS universeSize,
        (SELECT COUNT(*) FROM user_universe WHERE userId = ${input.userId} AND active = 1) AS universeActive,
        (SELECT COUNT(*) FROM messages WHERE authorId = ${input.userId}) AS messagesSent,
        (SELECT COUNT(*) FROM jobs WHERE startedBy = ${input.userId}) AS jobsLaunched`);
    const activity = await activitySummary(input.userId);
    const r = res[0][0] ?? {};
    return {
      user: u,
      universeSize: Number(r.universeSize ?? 0),
      universeActive: Number(r.universeActive ?? 0),
      messagesSent: Number(r.messagesSent ?? 0),
      jobsLaunched: Number(r.jobsLaunched ?? 0),
      activity,
    };
  }),

  /** The admin's activity log view of a user (latest events, newest first). */
  userActivity: adminQuery
    .input(z.object({ userId: z.number(), limit: z.number().min(1).max(500).default(100) }))
    .query(({ input }) => recentActivity(input.userId, input.limit)),
});
