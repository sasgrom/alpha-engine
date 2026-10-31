/**
 * Seed the S&P 500 registry into `companies` (5c prep for EDGAR signals push).
 * Rows: cik/ticker from the GICS snapshot (D14), name/exchange from the SEC
 * company_tickers directory, sector/industry from GICS. INSERT IGNORE —
 * existing rows (with real metadata from bootstrap) are never touched.
 * inUniverse is the deprecated global flag (unused since 4c/D30 — membership
 * is per-user in user_universe); left at default for schema compat.
 * Run: npx tsx scripts/seed-sp500-companies.mts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { GICS_SP500 } from "../api/services/gics-snapshot";

const UA = { "User-Agent": "alpha-engine-research/1.0 (contact: owner@alphadelta-2.kimi.pro)" };
const dir = (await (await fetch("https://www.sec.gov/files/company_tickers_exchange.json", { headers: UA })).json()) as any;
// columns: cik, name, ticker, exchange
const byCik = new Map<number, { name: string; ticker: string; exchange: string }>();
for (const row of dir.data ?? []) byCik.set(Number(row[0]), { name: String(row[1]), ticker: String(row[2]), exchange: String(row[3]) });

const db = getDb();
let inserted = 0, skipped = 0, noDir = 0;
for (const e of GICS_SP500) {
  const d = byCik.get(e.cik);
  if (!d) { noDir++; continue; } // snapshot CIK absent from SEC directory — never guess
  const [res]: any = await db.execute(
    sql`INSERT IGNORE INTO companies (cik, ticker, name, exchange, sector, industry, inUniverse, updatedAt)
        VALUES (${e.cik}, ${d.ticker}, ${d.name}, ${d.exchange}, ${e.sector}, ${e.industry}, 1, NOW())`
  );
  if (Number(res?.affectedRows ?? 0) > 0) inserted++; else skipped++;
}
console.log(`companies: ${inserted} inserted, ${skipped} already present, ${noDir} without SEC directory entry`);
process.exit(0);
