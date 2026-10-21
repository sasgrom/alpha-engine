/**
 * One-shot applier for db/ddl/010_local_auth.sql + account seeding (D33).
 * Idempotent. Run: npx tsx apply-ddl-010.mts
 *
 * Owner directives encoded here:
 *  - admin login: username "admin", password "9999" — attached to the
 *    EXISTING owner row (role='admin', lowest id) so the owner's universe,
 *    memberships and job history survive the auth switch;
 *  - every OTHER Kimi account is deleted (with their memberships and
 *    message threads — per-user artifacts only, shared data untouched);
 *  - one demo account: username "user", password "1111", role "user".
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
import { hashPassword } from "./api/services/passwords";

const db = getDb();

// 1. columns (information_schema guard)
for (const col of ["username", "passwordHash"] as const) {
  const chk: any = await db.execute(
    sql`SELECT COUNT(*) n FROM information_schema.columns WHERE table_name='users' AND column_name=${col} AND table_schema = DATABASE()`
  );
  if (Number(chk[0][0].n) === 0) {
    await db.execute(
      sql.raw(
        col === "username"
          ? "ALTER TABLE `users` ADD COLUMN `username` varchar(64) NULL AFTER `unionId`"
          : "ALTER TABLE `users` ADD COLUMN `passwordHash` varchar(255) NULL AFTER `username`"
      )
    );
    console.log(`users.${col}: added`);
  } else {
    console.log(`users.${col}: already present`);
  }
}
// unique key on username
const uk: any = await db.execute(
  sql`SELECT COUNT(*) n FROM information_schema.statistics WHERE table_name='users' AND index_name='uq_users_username' AND table_schema = DATABASE()`
);
if (Number(uk[0][0].n) === 0) {
  await db.execute(sql.raw("ALTER TABLE `users` ADD UNIQUE KEY `uq_users_username` (`username`)"));
  console.log("users.uq_users_username: added");
} else {
  console.log("users.uq_users_username: already present");
}

// 2. owner row = the lowest-id admin (created first, role='admin')
const adminRows: any = await db.execute(sql`SELECT id, name, username FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
if (adminRows[0].length === 0) throw new Error("no admin user found to attach the admin login to");
const owner = adminRows[0][0];
if (!owner.username) {
  await db.execute(
    sql`UPDATE users SET username='admin', passwordHash=${await hashPassword("9999")} WHERE id=${owner.id}`
  );
  console.log(`admin login attached to user id=${owner.id} (${owner.name ?? "?"}) — username "admin"`);
} else {
  console.log(`owner row id=${owner.id} already has username "${owner.username}" — left as-is`);
}

// 3. demo user account (unionId namespace local:<username>)
const demoHash = await hashPassword("1111");
await db.execute(
  sql`INSERT INTO users (unionId, username, passwordHash, name, role, lastSignInAt)
      VALUES ('local:user', 'user', ${demoHash}, 'Demo User', 'user', NOW())
      ON DUPLICATE KEY UPDATE passwordHash = VALUES(passwordHash)`
);
console.log('demo account "user" ensured');

// 4. delete every other account (Kimi-era rows) + their per-user artifacts
const doomed: any = await db.execute(
  sql`SELECT id FROM users WHERE id <> ${owner.id} AND (username IS NULL OR username <> 'user')`
);
const ids = (doomed[0] as any[]).map((r) => Number(r.id));
if (ids.length > 0) {
  const list = ids.join(",");
  await db.execute(sql.raw(`DELETE FROM user_universe WHERE userId IN (${list})`));
  await db.execute(sql.raw(`DELETE FROM messages WHERE threadUserId IN (${list}) OR authorId IN (${list})`));
  await db.execute(sql.raw(`DELETE FROM users WHERE id IN (${list})`));
}
console.log(`deleted ${ids.length} legacy account(s): [${ids.join(", ")}]`);

const left: any = await db.execute(sql`SELECT id, username, name, role FROM users ORDER BY id`);
for (const r of left[0] as any[]) console.log(`  user id=${r.id} username=${r.username} role=${r.role} (${r.name})`);
process.exit(0);
