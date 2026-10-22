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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { derivePlaintext, extractScorableText, loadEdgarUniverse, mdaWindows } from "./lib/edgar";
import { extractScore, generate, LLM_MODEL, status, tonePrompt } from "./lib/ollama";
import { postSignals, type SignalRow } from "./lib/ingest";
import type { ManifestEntry } from "./edgar-fetch.mts";

const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
// --rescore: clear the scored flags and re-do the LLM pass (e.g. after a run
// crashed before delivery, or to score again with another OLLAMA_MODEL — a
// different model writes a different payloadKey, so nothing is overwritten).
const rescore = process.argv.includes("--rescore");

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

  if (rescore) for (const m of manifest) if (m.fetched) { m.scored = false; delete m.error; }
  const pending = manifest.filter((m) => m.fetched && !m.scored);
  // Outbox: scored rows land on disk BEFORE delivery. If ingest fails (server
  // down etc.), the next run delivers the outbox first — GPU work is never
  // redone, and `scored` is set ONLY after the server confirms receipt.
  const outboxPath = path.join(cacheDir(co.cik), "outbox.json");
  interface Outbox { accessions: string[]; rows: SignalRow[] }
  const deliver = async (box: Outbox): Promise<boolean> => {
    if (box.rows.length === 0) return true;
    const rep = await postSignals(box.rows); // throws on transport failure
    console.log(`[edgar-tone] ${co.ticker}: ingested: ${rep.accepted} new, ${rep.skippedDupes} dupes (${rep.batches} batches)`);
    const done = new Set(box.accessions);
    for (const m of manifest) if (done.has(m.accessionNo)) { m.scored = true; delete m.error; }
    writeFileSync(mPath, JSON.stringify(manifest, null, 1));
    rmSync(outboxPath, { force: true });
    return true;
  };

  // 1) deliver a leftover outbox from a crashed run, if any
  try {
    const leftover = JSON.parse(readFileSync(outboxPath, "utf8")) as Outbox;
    if (leftover.rows?.length) {
      console.log(`[edgar-tone] ${co.ticker}: delivering leftover outbox (${leftover.rows.length} rows from a previous run)`);
      await deliver(leftover);
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err; // delivery error surfaces, outbox kept
  }

  // 2) score what's still pending — recompute AFTER the leftover delivery,
  //    its accessions are now scored=true and must not be re-scored
  const stillPending = manifest.filter((m) => m.fetched && !m.scored);
  console.log(`[edgar-tone] ${co.ticker}: ${stillPending.length} filings to score (${manifest.length} total)`);
  const box: Outbox = { accessions: [], rows: [] };
  let skipped = 0, done = 0;
  for (const m of stillPending) {
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
    box.rows.push({
      cik: co.cik,
      source: "edgar",
      signalType: "tone",
      eventTs: m.eventTs,
      score: avg,
      magnitude: scores.length, // windows actually scored (1..3)
      payloadKey: `llm:${LLM_MODEL}:edgar:${co.cik}:${m.accessionNo}`,
      src: "backfill",
    });
    box.accessions.push(m.accessionNo);
    done++;
    if (done % 20 === 0) {
      mkdirSync(cacheDir(co.cik), { recursive: true });
      writeFileSync(outboxPath, JSON.stringify(box)); // persist GPU work as we go
      console.log(`[edgar-tone] ${co.ticker}: ${done}/${stillPending.length} scored, ${skipped} skipped`);
    }
  }
  if (box.rows.length > 0) {
    writeFileSync(outboxPath, JSON.stringify(box));
    await deliver(box); // marks scored + removes the outbox on success
  } else {
    console.log(`[edgar-tone] ${co.ticker}: nothing to ingest (${skipped} skipped)`);
  }
}
console.log("[edgar-tone] all done");
