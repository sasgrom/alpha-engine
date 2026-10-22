// Broken IPv6 egress (Boot Camp / some ISPs) hangs Node's fetch — force IPv4 first.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
/**
 * EDGAR tone scorer (5b, stage 2 of 2 — local LLM, no network except ingest).
 * Run: npx tsx worker/edgar-tone.mts [--only TICKER]
 *
 * Reads the edgar-fetch cache, extracts the scorable section (MD&A for
 * 10-K/10-Q, body for 8-K), scores up to 3 windows with the local Ollama
 * model, averages into one tone row per filing and POSTs to INGEST_URL
 * (default prod; set INGEST_URL=http://127.0.0.1:3000/api/worker/ingest for
 * the local-first dev loop).
 *
 * Honesty rules: provenance rides in payloadKey = llm:<model>:edgar:<cik>:<accn>
 * (a different model re-scores into a DIFFERENT key, never overwriting);
 * unparseable replies SKIP the row — no guesses stored; scored filings are
 * marked in the manifest so reruns are incremental and free.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { derivePlaintext, extractScorableText, loadEdgarUniverse, mdaWindows } from "./lib/edgar";
import { extractScore, generate, LLM_MODEL, status, tonePrompt } from "./lib/ollama";
import { postSignals, type SignalRow } from "./lib/ingest";
import type { ManifestEntry } from "./edgar-fetch.mts";

const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;

// --- preflight: daemon + model present (same contract as llm-test) ----------
const st = await status();
if (!st.ok) { console.error("[edgar-tone] Ollama daemon not reachable at 127.0.0.1:11434"); process.exit(1); }
if (!st.models.some((m) => m === LLM_MODEL || m.startsWith(`${LLM_MODEL.split(":")[0]}:`))) {
  console.error(`[edgar-tone] model "${LLM_MODEL}" not pulled. Models present: ${st.models.join(", ") || "(none)"}`);
  process.exit(1);
}
console.log(`[edgar-tone] model: ${LLM_MODEL}`);

const universe = loadEdgarUniverse().filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[edgar-tone] unknown ticker ${only}`); process.exit(1); }

for (const co of universe) {
  const mPath = path.join(cacheDir(co.cik), "manifest.json");
  let manifest: ManifestEntry[];
  try { manifest = JSON.parse(readFileSync(mPath, "utf8")); }
  catch { console.log(`[edgar-tone] ${co.ticker}: no manifest (run edgar-fetch first)`); continue; }

  const pending = manifest.filter((m) => m.fetched && !m.scored);
  console.log(`[edgar-tone] ${co.ticker}: ${pending.length} filings to score (${manifest.length} total)`);
  const rows: SignalRow[] = [];
  let skipped = 0, done = 0;
  for (const m of pending) {
    const file = path.join(cacheDir(co.cik), `${m.accessionNo.replace(/-/g, "")}.htm`);
    let plain: string;
    try { plain = derivePlaintext(readFileSync(file, "utf8")); }
    catch { m.error = "cache file unreadable"; skipped++; continue; }
    const scorable = extractScorableText(plain, m.form);
    const windows = mdaWindows(scorable);
    const scores: number[] = [];
    for (const w of windows) {
      try {
        const r = await generate(tonePrompt(w));
        const s = extractScore(r.text);
        if (s != null) scores.push(s);
      } catch (err) {
        console.warn(`[edgar-tone] ${co.ticker} ${m.accessionNo}: LLM error ${String(err).slice(0, 120)}`);
      }
    }
    if (scores.length === 0) { skipped++; m.error = "no parseable score"; continue; } // honesty: skip, never guess
    const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000;
    rows.push({
      cik: co.cik,
      source: "edgar",
      signalType: "tone",
      eventTs: m.eventTs,
      score: avg,
      magnitude: scores.length, // windows actually scored (1..3)
      payloadKey: `llm:${LLM_MODEL}:edgar:${co.cik}:${m.accessionNo}`,
      src: "backfill",
    });
    m.scored = true;
    delete m.error;
    done++;
    if (done % 20 === 0) {
      writeFileSync(mPath, JSON.stringify(manifest, null, 1));
      console.log(`[edgar-tone] ${co.ticker}: ${done}/${pending.length} scored, ${skipped} skipped`);
    }
  }
  writeFileSync(mPath, JSON.stringify(manifest, null, 1));
  if (rows.length > 0) {
    const rep = await postSignals(rows);
    console.log(`[edgar-tone] ${co.ticker}: ingested: ${rep.accepted} new, ${rep.skippedDupes} dupes (${rep.batches} batches)`);
  } else {
    console.log(`[edgar-tone] ${co.ticker}: nothing to ingest (${skipped} skipped)`);
  }
}
console.log("[edgar-tone] all done");
