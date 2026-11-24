/**
 * Applies db/ddl/034_sessions_and_second_factor.sql to the local app database (owner's decision of 2026-11-24).
 * Only CREATE TABLE IF NOT EXISTS statements are accepted; anything else in the file stops the run before the first
 * statement. Idempotent: a second run changes nothing. Prints the tables' columns afterwards.
 *
 *   npx tsx scripts/apply-ddl-034.mts [--dry-run]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { getDb } from "../api/queries/connection";

const statements = readFileSync("db/ddl/034_sessions_and_second_factor.sql", "utf8")
  .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").split(";").map((statement) => statement.trim()).filter(Boolean);
for (const statement of statements) if (!/^CREATE TABLE IF NOT EXISTS `(user_sessions|user_second_factor)` \(/.test(statement)) throw new Error(`Unexpected statement, nothing was run: ${statement.slice(0, 80)}`);
const client = getDb().$client.promise();
try {
  if (!process.argv.includes("--dry-run")) for (const statement of statements) await client.query(statement);
  const [rows] = await client.query("SELECT table_name AS t, GROUP_CONCAT(column_name ORDER BY ordinal_position) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN ('user_sessions','user_second_factor') GROUP BY table_name") as [Array<{ t: string; c: string }>, unknown];
  console.log(`[ddl-034] ${process.argv.includes("--dry-run") ? "dry run · " : ""}${statements.length} statements · tables present: ${rows.map((row) => `${row.t} (${row.c})`).join(" | ") || "none"}`);
} finally { await client.end(); }
process.exit(0);
