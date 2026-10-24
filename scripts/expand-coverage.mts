/**
 * Coverage expansion for the factor IC monitor (6a): queue ONE bootstrap job
 * for a curated set of large caps (no cloud-LLM steps involved — facts,
 * series, documents, prices only), wait for it, then materialize factor_points
 * for the same set. Run: npx tsx scripts/expand-coverage.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { createJob } from "../api/services/runner";
import { getDb } from "../api/queries/connection";
import { materializeFactorPoints } from "../api/services/factor-ic";

// Curated for IC breadth across GICS sectors (not just more of the same tech).
const TICKERS = "MSFT,GOOGL,AMZN,META,IBM,LMT,JPM,LLY,V,XOM,JNJ,WMT,PG,MA,HD,CVX,AVGO,UNH,COST";

const jobId = await createJob("bootstrap", { tickers: TICKERS, withFacts: true }, 1);
console.log(`bootstrap queued: job ${jobId}, ${TICKERS.split(",").length} tickers`);

// wait for the drain chain to finish this job (status done/error/cancelled)
const t0 = Date.now();
for (;;) {
  const [r]: any = await getDb().execute(sql`SELECT status, processed, total FROM jobs WHERE id=${jobId} LIMIT 1`);
  const st = r[0]?.status;
  if (st !== "running" && st !== "queued") { console.log(`job ${jobId} finished with status ${st}`); break; }
  if (Date.now() - t0 > 6 * 3600_000) { console.log("timeout waiting for bootstrap — materializing anyway"); break; }
  await new Promise((r) => setTimeout(r, 60_000);
}

// materialize only companies that actually got factor data
const [ciks]: any = await getDb().execute(sql`SELECT cik FROM companies WHERE ticker IN (${TICKERS.split(",").map((t) => `'${t}'`).join(",")})`);
for (const { cik } of ciks as { cik: number }[]) {
  try {
    const n = await materializeFactorPoints(cik);
    console.log(`factor_points ${cik}: ${n}`);
  } catch (err) {
    console.log(`factor_points ${cik}: skipped (${String(err).slice(0, 100)})`);
  }
}
process.exit(0);
