/**
 * Local dev seed (home machine): create the two known local accounts on an
 * EMPTY database — admin/9999 (role admin) and user/1111 (role user).
 * The prod seeding path (apply-ddl-010.mts) attaches logins to existing
 * Kimi-OAuth rows; a fresh local DB has none, hence this script.
 * Idempotent: skips usernames that already exist.
 * Run: npx tsx scripts/seed-local-users.mts
 */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";
import { hashPassword } from "../api/services/passwords";

const db = getDb();
async function ensure(username: string, password: string, role: "admin" | "user") {
  const [rows]: any = await db.execute(sql`SELECT id FROM users WHERE username=${username} LIMIT 1`);
  if (rows.length > 0) { console.log(`${username}: exists, skipped`); return; }
  const hash = await hashPassword(password);
  await db.execute(
    sql`INSERT INTO users (unionId, username, passwordHash, name, role, createdAt, updatedAt)
        VALUES (${"local:" + username}, ${username}, ${hash}, ${username}, ${role}, NOW(), NOW())`
  );
  console.log(`${username}: created (${role})`);
}
await ensure("admin", "9999", "admin");
await ensure("user", "1111", "user");
process.exit(0);