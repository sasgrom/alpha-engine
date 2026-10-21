/**
 * QA for iteration 4d (D33): local auth against the live DB.
 * Proves the full chain a browser will exercise: users rows (admin/user) →
 * scrypt verify → session JWT signed by the REUSED kimi signer →
 * authenticateRequest (the real production guard) accepts the cookie →
 * admin user-management round-trip (create/reset/role/delete cascade).
 * Creates and removes one QA account; no shared data touched.
 * Run: npx tsx t_4d_auth.mts
 */
import { getDb } from "./api/queries/connection";
import { env } from "./api/lib/env";
import { verifyPassword } from "./api/services/passwords";
import { signSessionToken, verifySessionToken } from "./api/kimi/session";
import { authenticateRequest } from "./api/kimi/auth";
import {
  createLocalUser,
  deleteUserCascade,
  findUserByUsername,
  listUsersWithStats,
  setUserPassword,
  setUserRole,
} from "./api/queries/users";
import { hashPassword } from "./api/services/passwords";
import { sql } from "drizzle-orm";

const fail = (msg: string): never => {
  console.error("FAIL:", msg);
  process.exit(1);
};

// --- seeded accounts verify ---------------------------------------------------
const admin = await findUserByUsername("admin");
if (!admin || admin.role !== "admin") fail("admin account missing/wrong role");
if (!(await verifyPassword("9999", admin.passwordHash))) fail("admin password 9999 does not verify");
if (await verifyPassword("9998", admin.passwordHash)) fail("wrong admin password accepted!");
const demo = await findUserByUsername("user");
if (!demo || demo.role !== "user") fail("demo user missing/wrong role");
if (!(await verifyPassword("1111", demo.passwordHash))) fail("demo password 1111 does not verify");
console.log(`accounts: admin(id=${admin.id}) + user(id=${demo.id}) verify ok`);

// --- the session chain: local account → JWT → production guard ----------------
const token = await signSessionToken({ unionId: admin.unionId, clientId: env.appId });
const claim = await verifySessionToken(token);
if (!claim || claim.unionId !== admin.unionId) fail("session token round-trip broken");
const { Session } = await import("@contracts/constants");
const headers = new Headers({ cookie: `${Session.cookieName}=${token}` });
const authed = await authenticateRequest(headers);
if (!authed || authed.id !== admin.id) fail("authenticateRequest rejected the local session");
console.log(`session chain ok: cookie "${Session.cookieName}" → authenticateRequest → user id=${authed.id}`);

// --- admin user-management round-trip ------------------------------------------
const qaName = `qa_${Math.random().toString(36).slice(2, 8)}`;
const created = await createLocalUser({ username: qaName, passwordHash: await hashPassword("qa-pass-9"), name: "QA", role: "user" });
if (!created?.id) fail("createLocalUser failed");
await setUserPassword(created.id, await hashPassword("qa-pass-10"));
const reRead = await findUserByUsername(qaName);
if (!(await verifyPassword("qa-pass-10", reRead?.passwordHash))) fail("reset password did not stick");
await setUserRole(created.id, "admin");
const promoted = await findUserByUsername(qaName);
if (promoted?.role !== "admin") fail("setUserRole failed");
await deleteUserCascade(created.id);
if (await findUserByUsername(qaName)) fail("deleteUserCascade left the user behind");
console.log("user management round-trip ok (create → reset → promote → delete)");

// --- final account inventory ----------------------------------------------------
const list = await listUsersWithStats();
console.log("accounts now:", list.map((u) => `${u.username}(${u.role}, universe=${u.universeSize})`).join(" · "));
if (list.length !== 2) fail(`expected exactly 2 accounts, got ${list.length}`);

console.log("PASS: 4d local auth (scrypt + session reuse + guard acceptance + admin CRUD)");
process.exit(0);
