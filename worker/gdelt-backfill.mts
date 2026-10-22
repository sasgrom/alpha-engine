// Broken IPv6 egress (Boot Camp / some ISPs) hangs Node's fetch — force IPv4 first.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
/**
 * GDELT historical backfill (home worker, one-off / on-demand).
 * Run:  npx tsx worker/gdelt-backfill.mts --from 2024-01-01 --to 2026-10-21
 * Defaults: from = 2 years ago, to = yesterday (UTC).
 *
 * Per company per UTC day: ONE ToneChart call (startdatetime/enddatetime)
 * yields both signals — weighted average tone AND the exact article count
 * (sum of histogram bins, no 250-cap). Rows go with src:"backfill" and
 * day-bucket payloadKeys → reruns of the same range dedupe for free.
 *
 * Pacing: 6s between calls (GDELT fair-use) → ~10 company-days/minute;
 * a year of history for 5 companies ≈ 3 h. Overnight run, resumable by
 * construction: just rerun the same --from/--to, dupes are skipped.
 */
import "dotenv/config";
import { fetchJson } from "./lib/http";
import { postSignals, type SignalRow } from "./lib/ingest";
import { buildGdeltRows, dayBucket } from "./lib/gdelt";
import { loadUniverse } from "./lib/universe";

const BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const UA = { "user-agent": "alpha-engine-research/1.0 (contact: owner@alphadelta-2.kimi.pro)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function argDate(name: string, fallback: Date): Date {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) {
    const d = new Date(process.argv[i + 1] + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) throw new Error(`bad --${name}: ${process.argv[i + 1]} (want YYYY-MM-DD)`);
    return d;
  }
  return fallback;
}

const today = new Date();
const utcYesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
const twoYearsAgo = new Date(Date.UTC(today.getUTCFullYear() - 2, today.getUTCMonth(), today.getUTCDate()));
const from = argDate("from", twoYearsAgo);
const to = argDate("to", utcYesterday);
if (from > to) throw new Error("--from must be <= --to");

const days: Date[] = [];
for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) days.push(new Date(d));
console.log(`[gdelt-backfill] ${days.length} day(s): ${days[0].toISOString().slice(0, 10)} → ${days[days.length - 1].toISOString().slice(0, 10)}`);

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");
const onlyIdx = process.argv.indexOf("--only"); // diagnostics: --only MSFT
const universe = loadUniverse().filter((c) => onlyIdx < 0 || c.ticker === process.argv[onlyIdx + 1]?.toUpperCase());
if (universe.length === 0) throw new Error("--only: no such ticker in universe.json");
let totalAccepted = 0, totalDupes = 0, failures = 0;

for (const day of days) {
  const bucket = dayBucket(day);
  const rows: SignalRow[] = [];
  for (const co of universe) {
    try {
      const q = encodeURIComponent(co.gdeltQuery);
      const url = `${BASE}?query=${q}&mode=ToneChart&format=json&startdatetime=${ymd(day)}000000&enddatetime=${ymd(day)}235959`;
      const tonechart = await fetchJson(url, { headers: UA, retries: 4 });
      rows.push(...buildGdeltRows(co.cik, bucket, (tonechart as any)?.tonechart ?? [], null, "backfill"));
    } catch (e: any) {
      failures++;
      console.warn(`[gdelt-backfill] ${co.ticker} ${bucket.key}: FAILED — ${e?.message ?? e}`);
    }
    await sleep(12000);
  }
  if (rows.length > 0) {
    const res = await postSignals(rows);
    totalAccepted += res.accepted;
    totalDupes += res.skippedDupes;
    console.log(`[gdelt-backfill] ${bucket.key}: ${res.accepted} new, ${res.skippedDupes} dupes`);
  }
}
console.log(`[gdelt-backfill] DONE: ${totalAccepted} accepted, ${totalDupes} dupes, ${failures} failed calls`);
