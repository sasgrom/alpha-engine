/** Compare fact and factor coverage without modifying data. */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";
import { loadEdgarUniverse } from "../worker/lib/edgar";

const universeFile = process.argv.includes("--universe") ? process.argv[process.argv.indexOf("--universe") + 1] : "research-universe-50.json";
const universe = loadEdgarUniverse(universeFile);
const byCik = new Map(universe.map((company) => [company.cik, company.ticker]));
const db = getDb();
const [factRows] = await db.execute(sql`SELECT DISTINCT cik FROM facts`);
const [missingRows] = await db.execute(sql`SELECT DISTINCT f.cik FROM facts f LEFT JOIN factor_points p ON f.cik = p.cik WHERE p.cik IS NULL ORDER BY f.cik`);
const missing = missingRows.map((row) => {
  const cik = Number(row.cik);
  return { cik, ticker: byCik.get(cik) ?? null, inCurrentUniverse: byCik.has(cik) };
});
const report = {
  universeFile,
  universeCompanies: universe.length,
  factCompanies: factRows.length,
  factorCompanies: factRows.length - missing.length,
  missing,
  interpretation: missing.every((row) => !row.inCurrentUniverse)
    ? "All missing CIKs are outside the current universe; factor coverage matches the current universe."
    : "Some current-universe CIKs need factor materialization.",
};
console.log(JSON.stringify(report, null, 2));
process.exit(missing.some((row) => row.inCurrentUniverse) ? 1 : 0);
