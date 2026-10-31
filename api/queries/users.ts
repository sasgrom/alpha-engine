import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  const updateSet: Partial<InsertUser> = {
    lastSignInAt: new Date(),
    ...data,
  };

  if (
    values.role === undefined &&
    values.unionId &&
    values.unionId === env.ownerUnionId
  ) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  await getDb()
    .insert(schema.users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

// ---------------------------------------------------------------------------
// 4d (D33): local username/password auth. The Kimi unionId stays the identity
// key (api/kimi is read-only); local accounts use unionId = 'local:<username>'.
// ---------------------------------------------------------------------------

export async function findUserByUsername(username: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username.toLowerCase()))
    .limit(1);
  return rows.at(0);
}

/** Create a local account (role is NEVER taken from the caller's input). */
export async function createLocalUser(data: {
  username: string;
  passwordHash: string;
  name?: string;
  role: "user" | "admin";
}) {
  await getDb().insert(schema.users).values({
    unionId: `local:${data.username}`,
    username: data.username.toLowerCase(),
    passwordHash: data.passwordHash,
    name: data.name ?? data.username,
    role: data.role,
    lastSignInAt: new Date(),
  });
  return findUserByUsername(data.username);
}

export async function touchSignIn(userId: number) {
  await getDb()
    .update(schema.users)
    .set({ lastSignInAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/** Admin user management (D33). */
export async function listUsersWithStats() {
  const res: any = await getDb().execute(sql`
    SELECT u.id, u.username, u.name, u.role, u.createdAt, u.lastSignInAt,
           (SELECT COUNT(*) FROM user_universe uu WHERE uu.userId = u.id) AS universeSize
    FROM users u ORDER BY u.id`);
  return (res[0] as any[]).map((r) => ({
    id: Number(r.id),
    username: r.username as string | null,
    name: r.name as string | null,
    role: r.role as "user" | "admin",
    createdAt: r.createdAt as string,
    lastSignInAt: r.lastSignInAt as string,
    universeSize: Number(r.universeSize ?? 0),
  }));
}

export async function setUserPassword(userId: number, passwordHash: string) {
  await getDb().update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
}

export async function setUserRole(userId: number, role: "user" | "admin") {
  await getDb().update(schema.users).set({ role }).where(eq(schema.users.id, userId));
}

/**
 * Delete a user plus their per-user artifacts (universe memberships, message
 * threads). Shared domain data (companies/facts/prices/…) is NEVER touched;
 * their past jobs stay as audit rows (startedBy becomes a dangling id —
 * the UI already renders those as "user <id>").
 */
export async function deleteUserCascade(userId: number) {
  const db = getDb();
  await db.execute(sql`DELETE FROM user_universe WHERE userId = ${userId}`);
  await db.execute(sql`DELETE FROM messages WHERE recipientId = ${userId} OR authorId = ${userId} OR threadUserId = ${userId}`);
  await db.execute(sql`DELETE FROM activity_events WHERE userId = ${userId}`);
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}
