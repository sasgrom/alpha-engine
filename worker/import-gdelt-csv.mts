/**
 * GDELT manual-export importer (plan B). Run from repo root:
 *   npx tsx worker/import-gdelt-csv.mts --file C:\dev\gdelt\AAPL-2024H1.csv --ticker AAPL
 *
 * How to get the files (browser, human pace — no rate-limit risk):
 *   ArtList (buzz), one file per company per ≤3-month window:
 *     https://api.gdeltproject.org/api/v2/doc/doc?query=%22Microsoft%22&mode=ArtList&maxrecords=250&format=csv&startdatetime=20241001000000&enddatetime=20241231235959
 *   TimelineTone (tone), same windows:
 *     ...&mode=TimelineTone&format=csv&...
 * Save the downloads anywhere, then import each with the matching --ticker.
 * Auto-detection: ArtList → per-day buzz; Timeline → per-day tone.
 * payloadKeys are gdeltcsv:* day buckets — reimporting the same file is free.
 */
import "dotenv/config";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import { readFileSync } from "node:fs";
import { postSignals } from "./lib/ingest";
import { splitCsv, detectKind, artlistToBuzz, timelineToTone } from "./lib/gdelt-csv";
import { loadUniverse } from "./lib/universe";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const file = arg("file");
const ticker = arg("ticker")?.toUpperCase();
if (!file || !ticker) {
  console.error("usage: npx tsx worker/import-gdelt-csv.mts --file <path> --ticker <TICKER>");
  process.exit(1);
}
const co = loadUniverse().find((c) => c.ticker === ticker);
if (!co) throw new Error(`ticker ${ticker} not in worker/universe.json`);

const rows = splitCsv(readFileSync(file, "utf8"));
const kind = detectKind(rows);
console.log(`[gdelt-csv] ${file}: detected ${kind}, ${rows.length} csv rows`);
if (kind === "unknown") {
  console.error("[gdelt-csv] unrecognized export shape — want ArtList (seendate) or Timeline (datetime,value)");
  process.exit(1);
}
const signals = kind === "artlist" ? artlistToBuzz(co.cik, rows) : timelineToTone(co.cik, rows);
console.log(`[gdelt-csv] ${ticker}: ${signals.length} day rows (${signals[0]?.eventTs.slice(0, 10)} → ${signals[signals.length - 1]?.eventTs.slice(0, 10)})`);
if (signals.length === 0) {
  console.log("[gdelt-csv] nothing to import");
  process.exit(0);
}
const res = await postSignals(signals);
console.log(`[gdelt-csv] ingested: ${res.accepted} new, ${res.skippedDupes} dupes (${res.batches} batch(es))`);
