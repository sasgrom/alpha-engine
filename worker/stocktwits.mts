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
import { postSignals, PROD_INGEST_URL, type SignalRow } from "./lib/ingest";
import { aggregateStream, buildCrowdRow, buildStocktwitsRows, crowdPrompt } from "./lib/stocktwits";
import { loadUniverse } from "./lib/universe";
import { extractVerdict, generate, LLM_MODEL, status as ollamaStatus } from "./lib/ollama";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 5d: LLM crowd read is OPTIONAL — the GPU is never a point of failure for
// the deterministic rows. Daemon down/model missing → crowd rows skipped.
const llm = await ollamaStatus();
const llmReady = llm.ok && llm.models.some((m) => m === LLM_MODEL || m.startsWith(`${LLM_MODEL.split(":")[0]}:`));
console.log(`[stocktwits] LLM crowd read: ${llmReady ? LLM_MODEL : "OFF (daemon/model unavailable — deterministic rows only)"}`);

const universe = loadUniverse();
const rows: SignalRow[] = [];
for (const co of universe) {
  try {
    const data = await fetchJson<{ messages?: any[] }>(
      `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(co.ticker)}.json`,
      { headers: { "user-agent": "alpha-engine-worker/1.0" } }
    );
    const messages = data.messages ?? [];
    const agg = aggregateStream(messages);
    const r = buildStocktwitsRows(co.cik, agg);
    rows.push(...r);
    let crowd = "";
    if (llmReady && agg.newestId) {
      try {
        const v = extractVerdict((await generate(crowdPrompt(co.ticker, messages))).text);
        if (v) {
          const row = buildCrowdRow(co.cik, agg, LLM_MODEL, v.score, v.why);
          if (row) { rows.push(row); crowd = ` +crowd ${v.score >= 0 ? "+" : ""}${v.score.toFixed(2)}`; }
        }
      } catch (e: any) {
        console.warn(`[stocktwits] ${co.ticker}: LLM crowd read failed — ${String(e?.message ?? e).slice(0, 120)}`);
      }
    }
    console.log(`[stocktwits] ${co.ticker}: +${r.length} rows${crowd}`);
  } catch (e: any) {
    console.warn(`[stocktwits] ${co.ticker}: FAILED — ${e?.message ?? e}`);
  }
  await sleep(2000);
}
if (rows.length === 0) {
  console.log("[stocktwits] nothing collected, exiting");
  process.exit(0);
}
// 5d doctrine: deterministic rows (buzz/label — proven in 4o) go STRAIGHT to
// prod even in dev mode; LLM-generated crowd rows (llm: keys) follow the
// local-first probation switch (INGEST_URL) until their quality is eyeballed.
const det = rows.filter((r) => !r.payloadKey?.startsWith("llm:"));
const llmRows = rows.filter((r) => r.payloadKey?.startsWith("llm:"));
if (det.length > 0) {
  const res = await postSignals(det, { url: PROD_INGEST_URL });
  console.log(`[stocktwits] deterministic → prod: ${res.accepted} new, ${res.skippedDupes} dupes (${res.batches} batch(es))`);
}
if (llmRows.length > 0) {
  const res = await postSignals(llmRows);
  console.log(`[stocktwits] llm crowd → ${process.env.INGEST_URL ? "local (probation)" : "prod"}: ${res.accepted} new, ${res.skippedDupes} dupes`);
}
