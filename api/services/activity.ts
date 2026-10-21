/**
 * Activity collection (4e, D35) — the data behind the admin's per-user info
 * summary ("who, what, when"). Events: login/signup (server-side in auth) and
 * page views (client tracker in AppLayout, deduped 60 s per path). Small by
 * construction; the admin UI reads recent rows, not aggregates in hot paths.
 */
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { activityEvents } from "@db/schema";

/** Client IP behind the platform proxy (first x-forwarded-for hop). */
export function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

export type ActivityType = "login" | "signup" | "page";

/** Append one activity event. Never throws into the caller's flow by design
 *  (activity is telemetry, not correctness) — callers still await it so the
 *  write lands before the response. */
export async function recordEvent(
  userId: number,
  type: ActivityType,
  opts: { path?: string; ip?: string; meta?: string } = {}
): Promise<void> {
  await getDb()
    .insert(activityEvents)
    .values({
      userId,
      type,
      path: opts.path ?? null,
      ip: opts.ip ?? null,
      meta: opts.meta?.slice(0, 500) ?? null,
    });
}

/** Admin per-user summary (D35): counters + recency markers. */
export async function activitySummary(userId: number): Promise<{
  totalEvents: number;
  logins7d: number;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  pages24h: number;
}> {
  const db = getDb();
  const res: any = await db.execute(sql`
    SELECT
      COUNT(*) AS totalEvents,
      SUM(CASE WHEN type IN ('login','signup') AND createdAt > NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS logins7d,
      MAX(CASE WHEN type IN ('login','signup') THEN createdAt END) AS lastLoginAt,
      MAX(createdAt) AS lastSeenAt,
      SUM(CASE WHEN type='page' AND createdAt > NOW() - INTERVAL 1 DAY THEN 1 ELSE 0 END) AS pages24h
    FROM activity_events WHERE userId = ${userId}`);
  const r = res[0][0] ?? {};
  return {
    totalEvents: Number(r.totalEvents ?? 0),
    logins7d: Number(r.logins7d ?? 0),
    lastLoginAt: r.lastLoginAt ?? null,
    lastSeenAt: r.lastSeenAt ?? null,
    pages24h: Number(r.pages24h ?? 0),
  };
}

/** Latest events of a user, newest first (the admin's activity log view). */
export async function recentActivity(userId: number, limit = 100) {
  return getDb()
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.userId, userId))
    .orderBy(desc(activityEvents.id))
    .limit(limit);
}
