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
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { derivePlaintext, extractScorableText, isThinContent, loadEdgarUniverse, mdaWindows, shouldScoreManifestEntry } from "./lib/edgar";
import { extractVerdict, generate, LLM_MODEL, status, tonePrompt } from "./lib/ollama";
import { postSignals, type SignalRow } from "./lib/ingest";
import { startProgress } from "./lib/progress";
import type { ManifestEntry } from "./edgar-fetch.mts";

const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
// --rescore: clear the scored flags and re-do the LLM pass (e.g. after a run
// crashed before delivery, or to score again with another OLLAMA_MODEL — a
// different model writes a different payloadKey, so nothing is overwritten).
const rescore = process.argv.includes("--rescore");
// --from YYYY-MM-DD: only filings filed on/after the date (owner: "rescore
// the skipped for the last 10 years, not the whole history").
const fromIdx = process.argv.indexOf("--from");
const from = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
// --include-skipped: retry entries previously skipped as thin/boilerplate.
// DEFAULT is to NOT retry them — re-spending LLM tokens on known boilerplate
// on every incremental run is pure waste (owner caught this).
const includeSkipped = process.argv.includes("--include-skipped");
const universeIdx = process.argv.indexOf("--universe");
const universeFile = universeIdx > -1 ? process.argv[universeIdx + 1] : "edgar-universe.json";

// --- preflight: daemon + model present (same contract as llm-test) ----------
const st = await status();
if (!st.ok) { console.error("[edgar-tone] Ollama daemon not reachable at 127.0.0.1:11434"); process.exit(1); }
if (!st.models.some((m) => m === LLM_MODEL || m.startsWith(`${LLM_MODEL.split(":")[0]}:`))) {
  console.error(`[edgar-tone] model "${LLM_MODEL}" not pulled. Models present: ${st.models.join(", ") || "(none)"}`);
  process.exit(1);
}
const prog = startProgress("edgar-tone", `model ${LLM_MODEL}`);

const universe = loadEdgarUniverse(universeFile).filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[edgar-tone] unknown ticker ${only}`); process.exit(1); }

for (const co of universe) {
  const mPath = path.join(cacheDir(co.cik), "manifest.json");
  let manifest: ManifestEntry[];
  try { manifest = JSON.parse(readFileSync(mPath, "utf8")); }
  catch { prog.log(`${co.ticker}: no manifest (run edgar-fetch first)`); continue; }

  if (rescore) for (const m of manifest) if (m.fetched) { m.scored = false; delete m.error; delete m.llmErrorCount; delete m.llmErrorModel; }
  // Outbox: scored rows land on disk BEFORE delivery. If ingest fails (server
  // down etc.), the next run delivers the outbox first — GPU work is never
  // redone, and `scored` is set ONLY after the server confirms receipt.
  const outboxPath = path.join(cacheDir(co.cik), "outbox.json");
  interface Outbox { accessions: string[]; rows: SignalRow[] }
  const deliver = async (box: Outbox): Promise<boolean> => {
    if (box.rows.length === 0) return true;
    const rep = await postSignals(box.rows); // throws on transport failure
    prog.log(`ingested: ${rep.accepted} new, ${rep.skippedDupes} dupes (${rep.batches} batches)`);
    const done = new Set(box.accessions);
    for (const m of manifest) if (done.has(m.accessionNo)) { m.scored = true; delete m.error; delete m.llmErrorCount; delete m.llmErrorModel; }
    writeFileSync(mPath, JSON.stringify(manifest, null, 1));
    rmSync(outboxPath, { force: true });
    return true;
  };

  // 1) deliver a leftover outbox from a crashed run, if any
  try {
    const leftover = JSON.parse(readFileSync(outboxPath, "utf8")) as Outbox;
    if (leftover.rows?.length) {
      prog.log(`delivering leftover outbox (${leftover.rows.length} rows from a previous run)`);
      await deliver(leftover);
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err; // delivery error surfaces, outbox kept
  }

  // 2) score what's still pending — recompute AFTER the leftover delivery,
  //    its accessions are now scored=true and must not be re-scored
  const stillPending = manifest.filter((m) => shouldScoreManifestEntry(m, from, includeSkipped, LLM_MODEL));
  prog.stage(`${co.ticker}: ${stillPending.length} filings to score (${manifest.length} total)`);
  const box: Outbox = { accessions: [], rows: [] };
  let skipped = 0, done = 0, processed = 0;
  const skipReasons = new Map<string, number>();
  const skip = (m: ManifestEntry, reason: string) => {
    skipped++;
    m.error = reason;
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
  };
  const llm = { calls: 0, promptTokens: 0, promptMs: 0, evalMs: 0, loadMs: 0, chars: 0 };
  const llmSummary = () => `llm ${llm.calls} calls · ${(llm.chars / 1e6).toFixed(1)}M chars · ${(llm.promptTokens / 1000).toFixed(1)}k prompt tok · prefill ${(llm.promptMs / 1000).toFixed(1)}s · decode ${(llm.evalMs / 1000).toFixed(1)}s · load ${(llm.loadMs / 1000).toFixed(1)}s`;
  const skipSummary = () => [...skipReasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${reason}: ${n}`).join(" · ");
  const failureLog = path.resolve(import.meta.dirname, ".runs", "llm-failures.jsonl");
  const recordLlmFailure = (m: ManifestEntry, w: string, r: { text: string; totalMs: number; evalCount: number }) => {
    mkdirSync(path.dirname(failureLog), { recursive: true });
    appendFileSync(failureLog, JSON.stringify({
      ts: new Date().toISOString(), accessionNo: m.accessionNo, model: LLM_MODEL,
      promptChars: w.length, responseChars: r.text.length, totalMs: r.totalMs,
      evalCount: r.evalCount, reason: "no parseable score", response: r.text.slice(0, 1000),
    }) + "\n");
  };
  for (const m of stillPending) {
    processed++;
    const base = m.accessionNo.replace(/-/g, "");
    // 5c: for 8-K the substance usually sits in the EX-99.x exhibit, not the cover-like primary doc
    const exPath = path.join(cacheDir(co.cik), `${base}.ex.htm`);
    const file = m.form === "8-K" && m.exFile && existsSync(exPath) ? exPath : path.join(cacheDir(co.cik), `${base}.htm`);
    let plain: string;
    try { plain = derivePlaintext(readFileSync(file, "utf8")); }
    catch { skip(m, "cache file unreadable"); continue; }
    const scorable = extractScorableText(plain, m.form);
    if (isThinContent(scorable)) { skip(m, "thin content (cover/TOC/XBRL header)"); continue; }
    const windows = mdaWindows(scorable);
    const scores: number[] = [];
    const whys: string[] = [];
    // The model sometimes SCORES boilerplate (−1.0 for "only a table of
    // contents") instead of declaring no substance — the why leaks the truth.
    // Such a window is noise: drop its score, keep the filing if others survive.
    // Widened after prod QA (5d): the model phrases "nothing here" in many
    // dialects ("zero substantive information", "empty procedural document"),
    // and routine SOX sworn statements were misread as investigations.
    // Dialects of "empty doc" keep appearing (prod QA rounds): the doc merely
    // REFERENCES other documents ("references an attached press release…
    // rather than substantive operational data… cannot assess") — that is the
    // same vacuum, not negative content.
    const BOILER = /no substantive|zero substantive|procedural|sworn statements?|under oath|sarbanes|compliance (filing|certification)|only (a )?(table of contents|administrative|xbrl|cover)|cover page|boilerplate|no financial (data|results)|no operational (updates?|data)|empty (procedural )?document|cannot assess|can't assess|without (including|containing) (the )?(actual|key|financial)|rather than substantive|standard legal disclaimers|does not (include|contain) (the )?(actual|key|financial)/i;
    let parsed = 0, droppedBoiler = 0;
    for (const w of windows) {
      try {
        const r = await generate(tonePrompt(w), { jsonMode: true, numPredict: 256 });
        llm.calls++;
        llm.promptTokens += r.promptEvalCount;
        llm.promptMs += r.promptEvalMs;
        llm.evalMs += r.evalMs;
        llm.loadMs += r.loadMs;
        llm.chars += w.length;
        const v = extractVerdict(r.text);
        if (v == null) recordLlmFailure(m, w, r);
        if (v != null) {
          parsed++;
          if (v.why && BOILER.test(v.why)) { droppedBoiler++; continue; } // window was boilerplate — no tone to score
          scores.push(v.score);
          if (v.why) whys.push(v.why);
        }
      } catch (err) {
        prog.log(`! ${m.accessionNo}: LLM error ${String(err).slice(0, 120)}`);
      }
    }
    // honest skip reasons, kept distinct for the manifest-error telemetry:
    // "boilerplate-only" = model parsed fine but saw no content worth a score
    // "no parseable score" = reply garbage / LLM errors — a REAL quality signal
    if (scores.length === 0) {
      if (parsed === 0) {
        if (m.llmErrorModel !== LLM_MODEL) { m.llmErrorModel = LLM_MODEL; m.llmErrorCount = 1; }
        else m.llmErrorCount = (m.llmErrorCount ?? 0) + 1;
      }
      skip(m, parsed > 0 ? "boilerplate-only content" : "no parseable score");
      continue;
    }
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
      note: whys.length ? whys.join(" | ").slice(0, 500) : null, // per-window rationales, human-facing
    });
    box.accessions.push(m.accessionNo);
    done++;
    if (processed % 20 === 0) {
      mkdirSync(cacheDir(co.cik), { recursive: true });
      writeFileSync(outboxPath, JSON.stringify(box)); // persist GPU work as we go
      prog.item(processed, stillPending.length, `${skipped} skipped`);
    }
  }
  const countCheck = processed === stillPending.length ? "counts ok" : `COUNT MISMATCH ${processed}/${stillPending.length}`;
  if (box.rows.length > 0) {
    writeFileSync(outboxPath, JSON.stringify(box));
    await deliver(box); // marks scored + removes the outbox on success
    prog.stageDone(`${co.ticker}: ${done} scored, ${skipped} skipped, delivered · ${countCheck} · ${llmSummary()} · ${skipSummary()}`);
  } else {
    prog.stageDone(`${co.ticker}: nothing to ingest (${skipped} skipped) · ${countCheck} · ${llmSummary()} · ${skipSummary()}`);
  }
}
prog.done("all done");
