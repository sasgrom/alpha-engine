/** Reviewed one-row registry repair for XOM_PRE. Dry-run by default. */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const db = getDb();
const apply = process.argv.includes("--apply");
const [before]: any = await db.execute(sql`SELECT cik, ticker, name FROM companies WHERE cik=34088 LIMIT 1`);
if (before.length) {
  console.log(JSON.stringify({ applied: false, reason: "already registered", row: before[0] }, null, 2));
  process.exit(0);
}
const row = {
  cik: 34088, ticker: "XOM_PRE", name: "EXXON MOBIL CORP (predecessor)",
  sic: "2911", sicDescription: "Petroleum Refining", exchange: "NYSE", fiscalYearEnd: "1231",
};
console.log(JSON.stringify({ applied: apply, plannedRow: row }, null, 2));
if (apply) {
  await db.execute(sql`INSERT IGNORE INTO companies (cik, ticker, name, sic, sicDescription, exchange, fiscalYearEnd, inUniverse, updatedAt)
    VALUES (${row.cik}, ${row.ticker}, ${row.name}, ${row.sic}, ${row.sicDescription}, ${row.exchange}, ${row.fiscalYearEnd}, true, NOW())`);
  const [after]: any = await db.execute(sql`SELECT cik, ticker, name, sic, exchange FROM companies WHERE cik=34088 LIMIT 1`);
  console.log(JSON.stringify({ registered: after[0] ?? null }, null, 2));
}
process.exit(0);
