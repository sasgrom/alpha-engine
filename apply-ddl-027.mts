/** One-shot applier for db/ddl/027_fund_quarters_filing_date.sql. Idempotent.
 * Run: npx tsx apply-ddl-027.mts (LOCAL first, prod only after review). */
import { readFileSync } from "node:fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const [rows]: any = await db.execute(sql`
  SELECT COUNT(*) n FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fund_quarters' AND COLUMN_NAME='filingDate'`);
if (Number(rows[0].n) === 0) {
  const ddl = readFileSync(new URL("./db/ddl/027_fund_quarters_filing_date.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(ddl));
  console.log("fund_quarters.filingDate: added");
} else {
  console.log("fund_quarters.filingDate: present, skipped");
}
process.exit(0);
