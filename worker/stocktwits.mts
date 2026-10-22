// Broken IPv6 egress (Boot Camp / some ISPs) hangs Node's fetch — force IPv4 first.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
/**
 * Stocktwits collector (home worker, Variant C). Run: npx tsx worker/stocktwits.mts
 *
 * Public per-symbol stream (30 latest messages) → aggregate buzz + sentiment
 * label per company → cloud ingest. payloadKey = newest message id + count,
 * so reruns without new messages dedupe to zero. Anonymous API is rate-limited
 * per IP (~200 req/h): we serialize with a 2s pause, 5 tickers stay far below.
 */
import "dotenv/config";
import { fetchJson } from "./lib/http";
import { postSignals, type SignalRow } from "./lib/ingest";
import { aggregateStream, buildStocktwitsRows } from "./lib/stocktwits";
import { loadUniverse } from "./lib/universe";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const universe = loadUniverse();
const rows: SignalRow[] = [];
for (const co of universe) {
  try {
    const data = await fetchJson<{ messages?: any[] }>(
      `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(co.ticker)}.json`,
      { headers: { "user-agent": "alpha-engine-worker/1.0" } }
    );
    const r = buildStocktwitsRows(co.cik, aggregateStream(data.messages ?? []));
    rows.push(...r);
    console.log(`[stocktwits] ${co.ticker}: +${r.length} rows`);
  } catch (e: any) {
    console.warn(`[stocktwits] ${co.ticker}: FAILED — ${e?.message ?? e}`);
  }
  await sleep(2000);
}
if (rows.length === 0) {
  console.log("[stocktwits] nothing collected, exiting");
  process.exit(0);
}
const res = await postSignals(rows);
console.log(`[stocktwits] ingested: ${res.accepted} new, ${res.skippedDupes} dupes (${res.batches} batch(es))`);
