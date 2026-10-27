// Broken IPv6 egress (Boot Camp / some ISPs) hangs Node's fetch — force IPv4 first.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
/**
 * EDGAR tone scorer — local Ollama, cached filings only, idempotent outbox.
 * Run: npx tsx worker/edgar-tone.mts [--only TICKER] [--concurrency 1|2]
 *
 * NUM_CTX and the 16K-char window size guard are unchanged. Two bounded lanes keep
 * one request queued while the other lane prepares its next filing; Ollama may
 * batch or serialize them. Transport failures are not parse-quality skips:
 * one failure ends that filing, two consecutive failures checkpoint and abort.
 */
import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { loadEdgarUniverse, shouldScoreManifestEntry } from "./lib/edgar";
import { extractVerdict, generate, isBoilerplateRationale, LLM_MODEL, NUM_CTX, status, tonePrompt } from "./lib/ollama";
import { postSignals, type SignalRow } from "./lib/ingest";
import { startProgress } from "./lib/progress";
import { prepareToneFiling } from "./lib/tone-prep";
import { writeJsonAtomic } from "./lib/json-file";
import { unionDurationMs, type RequestInterval } from "./lib/tone-metrics";
import type { ManifestEntry } from "./edgar-fetch.mts";

const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const rescore = process.argv.includes("--rescore");
const fromIdx = process.argv.indexOf("--from");
const from = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
const includeSkipped = process.argv.includes("--include-skipped");
const universeIdx = process.argv.indexOf("--universe");
const universeFile = universeIdx > -1 ? process.argv[universeIdx + 1] : "edgar-universe.json";
const concurrencyIdx = process.argv.indexOf("--concurrency");
const concurrency = Number(concurrencyIdx > -1 ? process.argv[concurrencyIdx + 1] : process.env.EDGAR_LLM_CONCURRENCY ?? 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
  console.error("[edgar-tone] --concurrency must be 1 or 2 (16GB-safe bound)");
  process.exit(1);
}

const st = await status();
if (!st.ok) { console.error("[edgar-tone] Ollama daemon not reachable at 127.0.0.1:11434"); process.exit(1); }
if (!st.models.some((m) => m === LLM_MODEL || m.startsWith(`${LLM_MODEL.split(":")[0]}:`))) {
  console.error(`[edgar-tone] model "${LLM_MODEL}" not pulled. Models present: ${st.models.join(", ") || "(none)"}`);
  process.exit(1);
}
const prog = startProgress("edgar-tone", `model ${LLM_MODEL} · ctx ${NUM_CTX} · concurrency ${concurrency} · no LLM retries`);
const universe = loadEdgarUniverse(universeFile).filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[edgar-tone] unknown ticker ${only}`); process.exit(1); }

const auditLog = path.resolve(import.meta.dirname, ".runs", "edgar-tone-audit.jsonl");
const failureLog = path.resolve(import.meta.dirname, ".runs", "llm-failures.jsonl");
mkdirSync(path.dirname(auditLog), { recursive: true });
const run = {
  companies: 0, scored: 0, skipped: 0, requests: 0, calls: 0, errors: 0,
  promptTokens: 0, evalCount: 0, chars: 0, wallMs: 0, busyMs: 0,
  skipReasons: new Map<string, number>(),
};
const bump = (map: Map<string, number>, key: string, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
const seconds = (ms: number) => (ms / 1000).toFixed(1);

interface Outbox { accessions: string[]; rows: SignalRow[] }
interface Telemetry {
  wallMs: number;
  plainChars?: number;
  scorableChars?: number;
  windows: number;
  calls: number;
  requestErrors: number;
  unparsed: number;
  boilerWindows: number;
}
type Outcome = { kind: "score"; row: SignalRow } | { kind: "skip"; reason: string };

for (const co of universe) {
  const mPath = path.join(cacheDir(co.cik), "manifest.json");
  let manifest: ManifestEntry[];
  try { manifest = JSON.parse(readFileSync(mPath, "utf8")); }
  catch { prog.log(`${co.ticker}: no manifest (run edgar-fetch first)`); continue; }

  if (rescore) for (const m of manifest) if (m.fetched) {
    m.scored = false;
    delete m.error;
    delete m.llmErrorCount;
    delete m.llmErrorModel;
  }
  const outboxPath = path.join(cacheDir(co.cik), "outbox.json");
  const deliver = async (box: Outbox): Promise<void> => {
    if (box.rows.length === 0) return;
    const rep = await postSignals(box.rows);
    prog.log(`ingested: ${rep.accepted} new, ${rep.skippedDupes} dupes (${rep.batches} batches)`);
    const delivered = new Set(box.accessions);
    for (const m of manifest) if (delivered.has(m.accessionNo)) {
      m.scored = true;
      delete m.error;
      delete m.llmErrorCount;
      delete m.llmErrorModel;
    }
    writeJsonAtomic(mPath, manifest, true);
    rmSync(outboxPath, { force: true });
  };

  try {
    const leftover = JSON.parse(readFileSync(outboxPath, "utf8")) as Outbox;
    if (leftover.rows?.length) {
      prog.log(`delivering leftover outbox (${leftover.rows.length} rows from a previous run)`);
      await deliver(leftover);
    } else {
      rmSync(outboxPath, { force: true });
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }

  const stillPending = manifest.filter((m) => shouldScoreManifestEntry(m, from, includeSkipped, LLM_MODEL));
  prog.stage(`${co.ticker}: ${stillPending.length} filings to score (${manifest.length} total)`);
  const box: Outbox = { accessions: [], rows: [] };
  const llm = { requests: 0, calls: 0, errors: 0, promptTokens: 0, evalCount: 0, promptMs: 0, evalMs: 0, loadMs: 0, totalMs: 0, chars: 0 };
  const intervals: RequestInterval[] = [];
  const skipReasons = new Map<string, number>();
  const forms = new Map<string, { scored: number; skipped: number }>();
  let skipped = 0, done = 0, processed = 0, cursor = 0;
  let requestErrorStreak = 0;
  let fatal: Error | null = null;
  const scoringT0 = Date.now();

  const checkpoint = () => {
    if (box.rows.length > 0) writeJsonAtomic(outboxPath, box);
    writeJsonAtomic(mPath, manifest, true);
  };
  const audit = (m: ManifestEntry, outcome: string, reason: string | null, t: Telemetry) => {
    appendFileSync(auditLog, JSON.stringify({
      ts: new Date().toISOString(), ticker: co.ticker, cik: co.cik,
      accessionNo: m.accessionNo, form: m.form, filingDate: m.filingDate,
      outcome, reason, ...t,
    }) + "\n");
  };
  const record = (m: ManifestEntry, outcome: Outcome, t: Telemetry) => {
    processed++;
    const form = forms.get(m.form) ?? { scored: 0, skipped: 0 };
    forms.set(m.form, form);
    if (outcome.kind === "score") {
      box.rows.push(outcome.row);
      box.accessions.push(m.accessionNo);
      done++;
      form.scored++;
      audit(m, "scored", null, t);
    } else {
      m.error = outcome.reason;
      skipped++;
      form.skipped++;
      bump(skipReasons, outcome.reason);
      audit(m, "skipped", outcome.reason, t);
    }
    if (processed % 20 === 0) {
      checkpoint();
      prog.item(processed, stillPending.length, `${skipped} skipped · ${llm.requests} req`);
    }
  };
  const emptyTelemetry = (): Telemetry => ({ wallMs: 0, windows: 0, calls: 0, requestErrors: 0, unparsed: 0, boilerWindows: 0 });
  const recordLlmFailure = (m: ManifestEntry, w: string, r: { text: string; totalMs: number; evalCount: number }) => {
    appendFileSync(failureLog, JSON.stringify({
      ts: new Date().toISOString(), ticker: co.ticker, accessionNo: m.accessionNo, form: m.form,
      model: LLM_MODEL, promptChars: w.length, responseChars: r.text.length,
      totalMs: r.totalMs, evalCount: r.evalCount, reason: "no parseable score",
      response: r.text.slice(0, 1000),
    }) + "\n");
  };

  const lane = async (laneId: number) => {
    while (!fatal) {
      const index = cursor++;
      if (index >= stillPending.length) return;
      const m = stillPending[index];
      const filingT0 = Date.now();
      const prep = prepareToneFiling(cacheDir(co.cik), m);
      if (!prep.ok) {
        record(m, { kind: "skip", reason: prep.reason }, { ...emptyTelemetry(), wallMs: Date.now() - filingT0 });
        continue;
      }
      const scores: number[] = [], whys: string[] = [];
      let parsed = 0, boilerWindows = 0, requestErrors = 0, unparsed = 0, calls = 0;
      for (const w of prep.windows) {
        if (fatal) break;
        const requestT0 = Date.now();
        llm.requests++;
        try {
          const r = await generate(tonePrompt(w), { jsonMode: true, numPredict: 256 });
          requestErrorStreak = 0;
          llm.calls++;
          llm.promptTokens += r.promptEvalCount;
          llm.evalCount += r.evalCount;
          llm.promptMs += r.promptEvalMs;
          llm.evalMs += r.evalMs;
          llm.loadMs += r.loadMs;
          llm.totalMs += r.totalMs;
          llm.chars += w.length;
          calls++;
          const v = extractVerdict(r.text);
          if (v == null) {
            unparsed++;
            recordLlmFailure(m, w, r);
          } else {
            parsed++;
            if (v.why && isBoilerplateRationale(v.why)) {
              boilerWindows++;
              continue;
            }
            scores.push(v.score);
            if (v.why) whys.push(v.why);
          }
        } catch (err) {
          llm.errors++;
          requestErrors++;
          requestErrorStreak++;
          prog.log(`! ${m.accessionNo} lane ${laneId}: LLM request failed (${requestErrorStreak} consecutive) — ${String(err).slice(0, 160)}`);
          if (requestErrorStreak >= 2) fatal = new Error("two consecutive Ollama request failures; checkpoint saved, fix the daemon and rerun");
          break; // never wait through every window of a failing filing
        } finally {
          intervals.push({ start: requestT0, end: Date.now() });
        }
      }
      const telemetry: Telemetry = {
        wallMs: Date.now() - filingT0, plainChars: prep.plainChars,
        scorableChars: prep.scorableChars, windows: prep.windows.length,
        calls, requestErrors, unparsed, boilerWindows,
      };
      if (telemetry.wallMs >= 60_000) {
        prog.log(`slow ${m.accessionNo} ${m.form}: ${seconds(telemetry.wallMs)}s · ${calls}/${prep.windows.length} calls ok · ${requestErrors} request errors`);
      }
      if (scores.length > 0) {
        const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000;
        record(m, { kind: "score", row: {
          cik: co.cik, source: "edgar", signalType: "tone", eventTs: m.eventTs,
          score: avg, magnitude: scores.length,
          payloadKey: `llm:${LLM_MODEL}:edgar:${co.cik}:${m.accessionNo}`,
          src: "backfill", note: whys.length ? whys.join(" | ").slice(0, 500) : null,
        } }, telemetry);
      } else if (fatal) {
        audit(m, "aborted", "LLM request failed", telemetry);
      } else if (requestErrors > 0) {
        record(m, { kind: "skip", reason: "LLM request failed" }, telemetry);
      } else {
        if (parsed === 0) {
          if (m.llmErrorModel !== LLM_MODEL) { m.llmErrorModel = LLM_MODEL; m.llmErrorCount = 1; }
          else m.llmErrorCount = (m.llmErrorCount ?? 0) + 1;
        }
        record(m, { kind: "skip", reason: parsed > 0 ? "boilerplate-only content" : "no parseable score" }, telemetry);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, stillPending.length) }, (_, i) => lane(i + 1)));
  checkpoint();
  const wallMs = Date.now() - scoringT0;
  const busyMs = unionDurationMs(intervals);
  const gapMs = Math.max(0, wallMs - busyMs);
  if (fatal) {
    prog.log(`${co.ticker}: ABORTED after ${processed}/${stillPending.length} completed · outbox and manifest checkpointed`);
    throw fatal;
  }
  const countCheck = processed === stillPending.length ? "counts ok" : `COUNT MISMATCH ${processed}/${stillPending.length}`;
  if (box.rows.length > 0) await deliver(box);
  const skipSummary = [...skipReasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${reason}: ${n}`).join(" · ") || "none";
  const formSummary = [...forms.entries()].sort().map(([form, x]) => `${form} ${x.scored}/${x.skipped}`).join(" · ") || "none";
  const decodeRate = llm.evalMs > 0 ? (llm.evalCount / (llm.evalMs / 1000)).toFixed(1) : "0.0";
  const llmSummary = `llm ${llm.calls}/${llm.requests} ok · ${llm.errors} req errors · ${(llm.chars / 1e6).toFixed(1)}M chars · ${(llm.promptTokens / 1000).toFixed(1)}k prompt tok · ${(llm.evalCount / 1000).toFixed(1)}k decode tok · decode ${decodeRate} tok/s · prefill ${seconds(llm.promptMs)}s · load ${seconds(llm.loadMs)}s · wall ${seconds(wallMs)}s · request-covered ${seconds(busyMs)}s · gaps ${seconds(gapMs)}s`;
  prog.stageDone(`${co.ticker}: ${done} scored, ${skipped} skipped · ${countCheck} · forms scored/skipped ${formSummary} · ${llmSummary} · skips ${skipSummary}`);

  run.companies++;
  run.scored += done;
  run.skipped += skipped;
  run.requests += llm.requests;
  run.calls += llm.calls;
  run.errors += llm.errors;
  run.promptTokens += llm.promptTokens;
  run.evalCount += llm.evalCount;
  run.chars += llm.chars;
  run.wallMs += wallMs;
  run.busyMs += busyMs;
  for (const [reason, n] of skipReasons) bump(run.skipReasons, reason, n);
}
const runSkips = [...run.skipReasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${reason}: ${n}`).join(" · ") || "none";
prog.done(`all done · ${run.scored} scored · ${run.skipped} skipped · ${run.calls}/${run.requests} LLM ok · ${run.errors} request errors · request gaps ${seconds(Math.max(0, run.wallMs - run.busyMs))}s · skips ${runSkips}`);
