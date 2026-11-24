/**
 * Removes an account's second factor and ends all its sessions. For a lost phone when the recovery codes are lost
 * too. Run on the home machine only: whoever can run this already has the database.
 *
 *   npx tsx scripts/reset-second-factor.mts <username> [--yes]
 *
 * Without --yes it only says what it would do. The account then signs in with its password alone and can set the
 * second factor up again on the Security page.
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";

const username = process.argv[2];
if (!username || username.startsWith("--")) throw new Error("usage: reset-second-factor.mts <username> [--yes]");
const confirmed = process.argv.includes("--yes");
const client = getDb().$client.promise();
try {
  const [users] = await client.query("SELECT id, username, role FROM users WHERE username = ?", [username]) as [Array<{ id: number; username: string; role: string }>, unknown];
  if (users.length !== 1) throw new Error(`No single account is named ${username}`);
  const user = users[0];
  const [[factor]] = await client.query("SELECT COUNT(*) AS n FROM user_second_factor WHERE userId = ?", [user.id]) as [Array<{ n: number }>, unknown];
  const [[open]] = await client.query("SELECT COUNT(*) AS n FROM user_sessions WHERE userId = ? AND revokedAt IS NULL", [user.id]) as [Array<{ n: number }>, unknown];
  if (!confirmed) {
    console.log(`[reset-second-factor] would remove ${factor.n} second-factor row and end ${open.n} open sessions of ${user.username} (${user.role}). Add --yes to do it.`);
  } else {
    await client.query("DELETE FROM user_second_factor WHERE userId = ?", [user.id]);
    await client.query("UPDATE user_sessions SET revokedAt = NOW() WHERE userId = ? AND revokedAt IS NULL", [user.id]);
    console.log(`[reset-second-factor] removed the second factor of ${user.username} and ended ${open.n} sessions. Restart the web server to drop its 30-second session cache.`);
  }
} finally { await client.end(); }
process.exit(0);
