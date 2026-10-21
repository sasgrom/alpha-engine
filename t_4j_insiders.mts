/**
 * 4j (D42): Form 4 insider-trades ETL for AAPL/NVDA/PLD — thin runner over
 * api/services/insiders.ts (the worker runs the same module on a schedule).
 * Idempotent via the UQ key. Run: npx tsx t_4j_insiders.mts
 */
import { etlCompanyInsiders } from "./api/services/insiders";

const TARGETS: [number, string][] = [[320193, "AAPL"], [1045810, "NVDA"], [1045609, "PLD"]];
for (const [cik, ticker] of TARGETS) {
  const r = await etlCompanyInsiders(cik, 60);
  console.log(`${ticker}: ${r.filings} Form 4 filings, ${r.txs} transactions kept`);
}
console.log("PASS: insiders ETL (via services/insiders.ts)");
process.exit(0);
