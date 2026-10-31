/**
 * Regenerate worker/universe.json from the prod companies table.
 * Run in the cloud (DB access): npx tsx scripts/export-worker-universe.mts
 * Then commit + push — the home worker pulls it. gdeltQuery is hand-tuned
 * per company (short, unambiguous name); review the diff before pushing.
 */
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

/** Hand-tuned GDELT query names; new companies fall back to a cleaned name. */
const QUERY_OVERRIDES: Record<string, string> = {
  AAPL: '"Apple Inc" OR "Apple" sourcecountry:US',
  T: '"AT&T"',
  MSFT: '"Microsoft"',
  PLD: '"Prologis"',
  NVDA: '"NVIDIA"',
};
const cleaned = (name: string) =>
  `"${name.replace(/[,.]?\s*(Inc\.?|Corp\.?|Corporation|Ltd\.?|PLC|\/ DE)$/i, "").trim()}"`;

const db = getDb();
const [rows]: any = await db.execute(
  sql`SELECT cik, ticker, name FROM companies WHERE inUniverse = 1 AND removedAt IS NULL ORDER BY ticker`
);
const universe = rows.map((r: any) => ({
  cik: r.cik,
  ticker: r.ticker,
  name: r.name,
  gdeltQuery: QUERY_OVERRIDES[r.ticker] ?? cleaned(r.name),
}));
writeFileSync("worker/universe.json", JSON.stringify(universe, null, 2) + "\n");
console.log(`worker/universe.json: ${universe.length} companies`);
process.exit(0);
