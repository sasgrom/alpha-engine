/** One-shot applier for db/ddl/024_fund_quarters.sql. Idempotent.
 *  Run: npx tsx apply-ddl-024.mts  (local first, prod after review) */
import { readFileSync } from "node:fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const ddl = readFileSync(new URL("./db/ddl/024_fund_quarters.sql", import.meta.url), "utf8");
for (const stmt of ddl.split(/;\s*\n/).map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim()).filter((s) => s.length > 10)) {
  await getDb().execute(sql.raw(stmt));
}
console.log("fund_quarters: created (or present)");
process.exit(0);
