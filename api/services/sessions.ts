/**
 * Signed-in sessions (DDL 034). The session cookie is a signed token that is valid on its own for a year (the shared
 * sign-in library, which this project does not modify). This layer makes a sign-in something that can be ended:
 * every token issued at sign-in is recorded by its SHA-256, and a request is accepted only while its row exists, is
 * not revoked and is not past its 30 days. A token that was never recorded (issued before this layer, or forged with
 * a stolen key but no row) is refused.
 *
 * The check is cached for a short time per token so that a page's dozen requests cost one lookup; ending a session
 * clears the cache, so it takes effect at once on this server.
 */
import { createHash } from "node:crypto";
import * as cookie from "cookie";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { Session } from "@contracts/constants";
import { userSessions } from "@db/schema";
import { authenticateRequest } from "../kimi/auth";
import { getDb } from "../queries/connection";

export const SESSION_DAYS = 30;
const CACHE_MS = 30_000;
const TOUCH_MS = 5 * 60_000;
const cache = new Map<string, { at: number; active: boolean; touchedAt: number }>();

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function sessionToken(headers: Headers): string | null {
  return cookie.parse(headers.get("cookie") || "")[Session.cookieName] || null;
}

/** Whether a stored row still admits requests at `now`. */
export function sessionRowActive(row: { revokedAt: Date | null; expiresAt: Date } | undefined, now: number): boolean {
  return Boolean(row && row.revokedAt === null && row.expiresAt.getTime() > now);
}

export async function registerSession(input: { userId: number; token: string; ip: string; userAgent: string | null }, now: Date = new Date()): Promise<void> {
  await getDb().insert(userSessions).values({
    userId: input.userId, tokenHash: tokenHash(input.token), expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000),
    ip: input.ip.slice(0, 64), userAgent: input.userAgent?.slice(0, 255) ?? null,
  });
}

async function isActive(hash: string, now: number): Promise<boolean> {
  const hit = cache.get(hash);
  if (hit && now - hit.at < CACHE_MS) return hit.active;
  const [row] = await getDb().select().from(userSessions).where(eq(userSessions.tokenHash, hash)).limit(1);
  const active = sessionRowActive(row, now);
  const touchedAt = hit?.touchedAt ?? 0;
  cache.set(hash, { at: now, active, touchedAt });
  if (active && now - Math.max(touchedAt, row!.lastSeenAt.getTime()) > TOUCH_MS) {
    cache.get(hash)!.touchedAt = now;
    await getDb().update(userSessions).set({ lastSeenAt: new Date(now) }).where(eq(userSessions.tokenHash, hash));
  }
  if (cache.size > 2000) for (const [key, value] of cache) if (now - value.at > CACHE_MS) cache.delete(key);
  return active;
}

/** The user of a request: the token must verify (shared library) AND its session must still be open. Throws otherwise. */
export async function authenticateSession(headers: Headers) {
  const user = await authenticateRequest(headers);
  const token = sessionToken(headers);
  if (!token || !(await isActive(tokenHash(token), Date.now()))) throw new Error("This session has ended. Please sign in again.");
  return user;
}

export interface SessionView { id: number; createdAt: Date; lastSeenAt: Date; ip: string | null; userAgent: string | null; current: boolean }

/** A user's open sessions, newest activity first; `current` marks the one making the request. */
export async function listSessions(userId: number, currentHash: string | null, now: Date = new Date()): Promise<SessionView[]> {
  const rows = await getDb().select().from(userSessions)
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now)))
    .orderBy(desc(userSessions.lastSeenAt)).limit(50);
  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, ip: row.ip, userAgent: row.userAgent, current: row.tokenHash === currentHash }));
}

/** Ends one of the user's own sessions. Returns whether a row changed. */
export async function revokeSession(userId: number, sessionId: number): Promise<boolean> {
  const [result] = await getDb().update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
  cache.clear();
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** Ends every session of a user, except (when given) the one making the request. Returns how many ended. */
export async function revokeAllSessions(userId: number, exceptHash: string | null = null): Promise<number> {
  const open = and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt));
  const [result] = await getDb().update(userSessions).set({ revokedAt: new Date() }).where(exceptHash ? and(open, ne(userSessions.tokenHash, exceptHash)) : open);
  cache.clear();
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/** Ends the session of this token (sign-out). */
export async function revokeToken(token: string): Promise<void> {
  await getDb().update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.tokenHash, tokenHash(token)), isNull(userSessions.revokedAt)));
  cache.clear();
}
