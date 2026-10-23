/**
 * One-shot applier for db/ddl/022_fund_holdings.sql. Idempotent (IF NOT EXISTS).
 * Run: npx tsx apply-ddl-022.mts  (local first, prod after review)
 */
import { readFileSync } from "node:fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const ddl = readFileSync(new URL("./db/ddl/022_fund_holdings.sql", import.meta.url), "utf8");
const statements = ddl
  .split(/;\s*\n/)
  .map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
  .filter((s) => s.length > 10);
for (const stmt of statements) {
  await getDb().execute(sql.raw(stmt));
}
console.log("fund_holdings + cusip_map: created (or present)");
process.exit(0);
