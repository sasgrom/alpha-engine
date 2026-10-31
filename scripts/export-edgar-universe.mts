/**
 * Regenerate worker/edgar-universe.json from the S&P 500 GICS snapshot (D14).
 * The worker never imports api/ (standalone rule), so the universe travels
 * as a committed JSON file. Name is cosmetic (worker logs) — the RAW block
 * carries no company names, so the ticker doubles as the name.
 * Run: npx tsx scripts/export-edgar-universe.mts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { GICS_SP500 } from "../api/services/gics-snapshot";

// The six core companies lead the list: an interrupted run (the pipeline is
// resumable per manifest) then covers OUR universe first, not alphabet soup.
const PRIORITY = ["AAPL", "NVDA", "PLD", "META", "IBM", "LMT"];
const rows = [...GICS_SP500]
  .map((e) => ({ cik: e.cik, ticker: e.ticker, name: e.ticker }))
  .sort((a, b) => {
    const pa = PRIORITY.indexOf(a.ticker), pb = PRIORITY.indexOf(b.ticker);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
    return a.ticker.localeCompare(b.ticker);
  });

const file = path.resolve(import.meta.dirname, "..", "worker", "edgar-universe.json");
writeFileSync(file, JSON.stringify(rows, null, 1) + "\n");
console.log(`edgar-universe.json: ${rows.length} S&P 500 constituents written`);
process.exit(0);
