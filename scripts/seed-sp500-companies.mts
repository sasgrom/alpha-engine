/**
 * Seed the S&P 500 registry into `companies` (5c prep for EDGAR signals push).
 * Rows: cik and ticker from the GICS snapshot (D14), name from the SEC directory, exchange from the
 * directory row of that exact share, sector/industry from GICS. INSERT IGNORE —
 * existing rows (with real metadata from bootstrap) are never touched.
 * inUniverse is the deprecated global flag (unused since 4c/D30 — membership
 * is per-user in user_universe); left at default for schema compat.
 * Run: npx tsx scripts/seed-sp500-companies.mts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { GICS_SP500 } from "../api/services/gics-snapshot";
import { exactSecDirectoryEntry, type SecDirectoryCompany } from "../api/services/canonical-ticker";

const UA = { "User-Agent": "alpha-engine-research/1.0 (contact: owner@alphadelta-2.kimi.pro)" };
const dir = (await (await fetch("https://www.sec.gov/files/company_tickers_exchange.json", { headers: UA })).json()) as any;
// columns: cik, name, ticker, exchange
// One CIK has a directory row per security (common, preferred, warrants): never take "the row of the CIK".
const entries: SecDirectoryCompany[] = (dir.data ?? []).map((row: unknown[]) => ({
  cik: Number(row[0]), name: String(row[1]), ticker: String(row[2]), exchange: String(row[3]),
}));

const db = getDb();
let inserted = 0, skipped = 0, noDir = 0;
for (const e of GICS_SP500) {
  // ticker from the GICS snapshot (the common share); the exchange only from the directory row of that exact share
  const exact = exactSecDirectoryEntry(entries, e.cik, e.ticker);
  const filer = exact ?? entries.find((entry) => entry.cik === e.cik);
  if (!filer) { noDir++; continue; } // snapshot CIK absent from SEC directory — never guess
  const [res]: any = await db.execute(
    sql`INSERT IGNORE INTO companies (cik, ticker, name, exchange, sector, industry, inUniverse, updatedAt)
        VALUES (${e.cik}, ${e.ticker}, ${filer.name}, ${exact?.exchange ?? null}, ${e.sector}, ${e.industry}, 1, NOW())`
  );
  if (Number(res?.affectedRows ?? 0) > 0) inserted++; else skipped++;
}
console.log(`companies: ${inserted} inserted, ${skipped} already present, ${noDir} without SEC directory entry`);
process.exit(0);
