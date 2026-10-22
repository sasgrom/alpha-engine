/**
 * GDELT collector (home worker, Variant C). Run: npx tsx worker/gdelt.mts
 *
 * For each universe company: one ArtList call (volume) + one ToneChart call
 * (average tone) over the last hour, normalized to signal rows and POSTed to
 * the cloud ingest endpoint. Hourly bucket payloadKeys make reruns idempotent.
 * GDELT asks for ≤1 req/5s from one IP — we serialize with a 6s pause.
 */
import "dotenv/config";
import { fetchJson } from "./lib/http";
import { postSignals, type SignalRow } from "./lib/ingest";
import { buildGdeltRows, hourBucket } from "./lib/gdelt";
import { loadUniverse } from "./lib/universe";

const BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const UA = { "user-agent": "alpha-engine-research/1.0 (contact: owner@alphadelta-2.kimi.pro)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collectOne(cik: number, query: string, bucket: { eventTs: string; key: string }): Promise<SignalRow[]> {
  const q = encodeURIComponent(query);
  const artlist = await fetchJson(`${BASE}?query=${q}&mode=ArtList&maxrecords=250&format=json&timespan=1h`, { headers: UA, retries: 4 });
  await sleep(12000); // GDELT fair-use pacing
  const tonechart = await fetchJson(`${BASE}?query=${q}&mode=ToneChart&format=json&timespan=1h`, { headers: UA, retries: 4 });
  const bins = (tonechart as any)?.tonechart ?? [];
  return buildGdeltRows(cik, bucket, bins, artlist);
}

const universe = loadUniverse();
const bucket = hourBucket();
const rows: SignalRow[] = [];
for (const co of universe) {
  try {
    const r = await collectOne(co.cik, co.gdeltQuery, bucket);
    rows.push(...r);
    console.log(`[gdelt] ${co.ticker}: +${r.length} rows`);
  } catch (e: any) {
    console.warn(`[gdelt] ${co.ticker}: FAILED — ${e?.message ?? e}`); // one company down must not kill the batch
  }
  await sleep(12000);
}
if (rows.length === 0) {
  console.log("[gdelt] nothing collected, exiting");
  process.exit(0);
}
const res = await postSignals(rows);
console.log(`[gdelt] ingested: ${res.accepted} new, ${res.skippedDupes} dupes (${res.batches} batch(es))`);
