// A/B benchmark: identical cached filings/prompts, sequential single-request engines.
// Read-only for production: no ingest, manifest mutation, outbox or score promotion.
import "dotenv/config";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEdgarUniverse } from "./lib/edgar";
import { extractVerdict, generate, isBoilerplateRationale, LLM_MODEL, status as ollamaStatus, tonePrompt, tonePromptV2, tonePromptV3, tonePromptV4 } from "./lib/ollama";
import { generateStrata, strataStatus, type StrataGenerateResult } from "./lib/strata";
import { prepareToneFiling, THIN_SKIP } from "./lib/tone-prep";
import { compareScores, evenSample, REPORT_ENGINES, type AbPlanItem } from "./lib/tone-ab";
import { tokensPerSecond } from "./lib/tone-metrics";
import { writeJsonAtomic } from "./lib/json-file";
import type { GenerateResult } from "./lib/ollama";
import type { ManifestEntry } from "./edgar-fetch.mts";

type Engine = "ollama" | "strata";
interface Normalized {
  model: string; wallMs: number; totalMs: number; inputTokens: number; cachedTokens: number;
  readTokens: number; generatedTokens: number; engineDecodeTokens: number; promptMs: number;
  evalMs: number; loadMs: number; response: string; score: number | null; why: string | null;
  parseOk: boolean; boilerplate: boolean; finishReason: string | null; hasEngineTimings: boolean;
  error: string | null;
}
interface WindowResult extends Normalized {
  runId: string; engine: Engine; ticker: string; accessionNo: string; form: string;
  windowIndex: number; promptChars: number; promptSha256: string; ts: string;
  promptVersion?: "v1" | "v2" | "v3" | "v4";
}
interface EngineSession { engine: Engine; model: string; startedAt: string; wallMs: number; stopped: boolean }

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const ticker = arg("--only")?.toUpperCase();
if (!ticker) { console.error("[tone-ab] --only TICKER is required"); process.exit(1); }
const limit = Number(arg("--limit") ?? 100);
if (!Number.isInteger(limit) || limit < 1 || limit > 500) { console.error("[tone-ab] --limit must be 1..500"); process.exit(1); }
const from = arg("--from");
const runId = arg("--run-id") ?? `${ticker.toLowerCase()}-${limit}-v1`;
if (!/^[\w.-]+$/.test(runId)) { console.error("[tone-ab] unsafe --run-id"); process.exit(1); }
const promptVersion = (() => {
  const v = arg("--prompt-version");
  if (v === "v2" || v === "v3" || v === "v4") return v;
  return "v1" as const;
})();
const engines = (arg("--engines") ?? "ollama,strata").split(",").map((x) => x.trim()) as Engine[];
if (!engines.length || engines.some((x) => x !== "ollama" && x !== "strata")) {
  console.error("[tone-ab] --engines must be ollama,strata, ollama, or strata"); process.exit(1);
}

const company = loadEdgarUniverse().find((c) => c.ticker === ticker);
if (!company) { console.error(`[tone-ab] unknown ticker ${ticker}`); process.exit(1); }
const companyDir = path.resolve(import.meta.dirname, "cache", "edgar", String(company.cik));
const manifestPath = path.join(companyDir, "manifest.json");
if (!existsSync(manifestPath)) { console.error(`[tone-ab] no manifest for ${ticker}; run edgar-fetch first`); process.exit(1); }
const base = path.resolve(import.meta.dirname, ".runs", `edgar-tone-ab-${runId}`);
const planPath = `${base}.plan.json`, resultsPath = `${base}.results.jsonl`, sessionsPath = `${base}.sessions.jsonl`;
const summaryPath = `${base}.summary.json`, reportPath = `${base}.report.md`;

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* tolerate a crash-truncated final line */ }
  }
  return out;
}
let plan: { ticker: string; limit: number; from: string | null; items: AbPlanItem[] };
if (existsSync(planPath)) {
  plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (plan.ticker !== ticker || plan.limit !== limit || plan.from !== from) {
    console.error("[tone-ab] plan parameters differ; use a new --run-id"); process.exit(1);
  }
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestEntry[];
  const candidates = manifest.filter((m) => m.fetched && (!from || m.filingDate >= from))
    .sort((a, b) => a.filingDate.localeCompare(b.filingDate) || a.accessionNo.localeCompare(b.accessionNo));
  const ready: AbPlanItem[] = [];
  let thin = 0, unreadable = 0;
  for (const m of candidates) {
    const prep = prepareToneFiling(companyDir, m);
    if (!prep.ok) {
      if (prep.reason === THIN_SKIP) thin++; else unreadable++;
      continue;
    }
    ready.push({
      ticker, cik: company.cik, accessionNo: m.accessionNo, form: m.form,
      filingDate: m.filingDate, eventTs: m.eventTs, windows: prep.windows, chars: prep.chars,
    });
  }
  const items = evenSample(ready, limit);
  if (items.length < limit) {
    console.error(`[tone-ab] only ${items.length} scorable documents available, ${limit} requested`); process.exit(1);
  }
  plan = { ticker, limit, from, items };
  writeJsonAtomic(planPath, plan);
  console.log(`[tone-ab] plan: ${items.length} evenly sampled documents · ${ready.length} ready · ${thin} thin · ${unreadable} unreadable`);
}

const results = readJsonl<WindowResult>(resultsPath);
const sessions = readJsonl<EngineSession>(sessionsPath);
const completed = new Set(results.filter((r) => !r.error).map((r) => `${r.engine}|${r.accessionNo}|${r.windowIndex}`));
const modelByEngine: Record<Engine, string> = { ollama: LLM_MODEL, strata: "" };

if (process.argv.includes("--report-only")) {
  writeReports();
  console.log(`[tone-ab] report-only: regenerated from saved results without model calls`);
  process.exit(0);
}

if (engines.includes("ollama")) {
  const st = await ollamaStatus();
  if (!st.ok || !st.models.some((m) => m === LLM_MODEL || m.startsWith(`${LLM_MODEL.split(":")[0]}:`))) {
    console.error(`[tone-ab] Ollama/model ${LLM_MODEL} unavailable: ${st.models.join(", ")}`); process.exit(1);
  }
}
if (engines.includes("strata")) {
  const st = await strataStatus();
  if (!st.ok || st.models.length === 0) { console.error("[tone-ab] Strata has no loaded model at STRATA_URL"); process.exit(1); }
  if (!process.env.STRATA_MODEL && st.models.length > 1) {
    console.error(`[tone-ab] multiple Strata models: ${st.models.join(", ")}; set STRATA_MODEL explicitly`); process.exit(1);
  }
  modelByEngine.strata = process.env.STRATA_MODEL ?? st.models[0];
}
console.log(`[tone-ab] ${runId} · ${plan.items.length} documents · engines ${engines.join(",")} · sequential concurrency 1`);

async function request(engine: Engine, prompt: string, numPredict = 256): Promise<Normalized> {
  const t0 = Date.now();
  try {
    const r: GenerateResult | StrataGenerateResult = engine === "ollama"
      ? await generate(prompt, { jsonMode: true, numPredict })
      : await generateStrata(prompt, { model: modelByEngine.strata, numPredict });
    const v = extractVerdict(r.text);
    const strata = engine === "strata" ? r as StrataGenerateResult : null;
    return {
      model: r.model, wallMs: Date.now() - t0, totalMs: r.totalMs,
      inputTokens: strata?.inputTokens ?? r.promptEvalCount,
      cachedTokens: strata?.cachedTokens ?? 0,
      readTokens: strata?.readTokens ?? r.promptEvalCount,
      generatedTokens: r.evalCount,
      engineDecodeTokens: strata?.engineDecodeTokens ?? r.evalCount,
      promptMs: r.promptEvalMs, evalMs: r.evalMs, loadMs: r.loadMs,
      response: r.text, score: v?.score ?? null, why: v?.why ?? null,
      parseOk: v !== null, boilerplate: Boolean(v?.why && isBoilerplateRationale(v.why)),
      finishReason: strata?.finishReason ?? null, hasEngineTimings: strata?.hasEngineTimings ?? true,
      error: null,
    };
  } catch (e: any) {
    return {
      model: modelByEngine[engine], wallMs: Date.now() - t0, totalMs: 0,
      inputTokens: 0, cachedTokens: 0, readTokens: 0, generatedTokens: 0,
      engineDecodeTokens: 0, promptMs: 0, evalMs: 0, loadMs: 0,
      response: "", score: null, why: null, parseOk: false, boilerplate: false,
      finishReason: null, hasEngineTimings: false, error: String(e?.message ?? e).slice(0, 500),
    };
  }
}

async function warmup(engine: Engine) {
  console.log(`[tone-ab] ${engine}: warmup (excluded)`);
  const r = await request(engine, 'Return ONLY this JSON object: {"score":0,"why":"warmup"}', 64);
  if (r.error) throw new Error(`${engine} warmup failed: ${r.error}`);
}

for (const engine of engines) {
  await warmup(engine);
  const model = modelByEngine[engine];
  const t0 = Date.now();
  let streak = 0, stopped = false;
  for (const item of plan.items) {
    for (let windowIndex = 0; windowIndex < item.windows.length; windowIndex++) {
      const key = `${engine}|${item.accessionNo}|${windowIndex}`;
      if (completed.has(key)) continue;
      const w = item.windows[windowIndex];
      const prompt = promptVersion === "v4" ? tonePromptV4(w, { ticker, form: item.form }) : promptVersion === "v3" ? tonePromptV3(w, { ticker, form: item.form }) : promptVersion === "v2" ? tonePromptV2(w, { ticker, form: item.form }) : tonePrompt(w);
      const r = await request(engine, prompt);
      const row: WindowResult = {
        runId, engine, ticker, accessionNo: item.accessionNo, form: item.form,
        windowIndex, promptChars: w.length,
        promptSha256: createHash("sha256").update(w).digest("hex"),
        ts: new Date().toISOString(), promptVersion, ...r,
      };
      appendFileSync(resultsPath, JSON.stringify(row) + "\n");
      results.push(row);
      if (r.error) {
        streak++;
        console.error(`[tone-ab] ${engine}: ${r.error}`);
        if (streak >= 2) { stopped = true; break; }
      } else {
        streak = 0;
      }
    }
    if (stopped) break;
    const done = plan.items.indexOf(item) + 1;
    if (done % 10 === 0 || done === plan.items.length) console.log(`[tone-ab] ${engine}: ${done}/${plan.items.length} documents`);
  }
  const session: EngineSession = { engine, model, startedAt: new Date(t0).toISOString(), wallMs: Date.now() - t0, stopped };
  appendFileSync(sessionsPath, JSON.stringify(session) + "\n");
  sessions.push(session);
  writeReports();
  if (stopped) { console.error(`[tone-ab] ${engine}: stopped after two consecutive request errors; rerun to resume`); break; }
}

function outcome(engine: Engine, item: AbPlanItem, promptVersion?: "v1" | "v2") {
  const rows = results.filter((r) => r.engine === engine && r.accessionNo === item.accessionNo && (!promptVersion || (r.promptVersion ?? "v1") === promptVersion))
    .sort((a, b) => a.windowIndex - b.windowIndex);
  const valid = rows.filter((r) => !r.error && r.parseOk && !r.boilerplate && r.score !== null);
  const parsed = rows.filter((r) => !r.error && r.parseOk);
  const score = valid.length ? valid.reduce((s, r) => s + Number(r.score), 0) / valid.length : null;
  return {
    rows, score, why: valid.map((r) => r.why).filter(Boolean).join(" | ") || null,
    status: score !== null ? "scored" : rows.some((r) => r.error) ? "error" : parsed.length ? "boilerplate" : rows.length ? "no parseable score" : "pending",
  };
}

function engineSummary(engine: Engine) {
  const rows = results.filter((r) => r.engine === engine);
  const model = sessions.filter((s) => s.engine === engine).at(-1)?.model ?? rows.at(-1)?.model ?? modelByEngine[engine];
  const outcomes = plan.items.map((item) => outcome(engine, item));
  const sessionWallMs = sessions.filter((s) => s.engine === engine).reduce((n, s) => n + s.wallMs, 0);
  const wallMs = sessionWallMs > 0 ? sessionWallMs : rows.reduce((n, r) => n + r.wallMs, 0);
  const inputTokens = rows.reduce((n, r) => n + r.inputTokens, 0);
  const cachedTokens = rows.reduce((n, r) => n + r.cachedTokens, 0);
  const readTokens = rows.reduce((n, r) => n + r.readTokens, 0);
  const generatedTokens = rows.reduce((n, r) => n + r.generatedTokens, 0);
  const promptMs = rows.reduce((n, r) => n + r.promptMs, 0);
  const evalMs = rows.reduce((n, r) => n + r.evalMs, 0);
  const answered = rows.filter((r) => !r.error);
  const docsWithResults = outcomes.filter((o) => o.rows.length > 0).length;
  return {
    model, documents: docsWithResults, windows: rows.length,
    wallMs, inputTokens, cachedTokens, readTokens, generatedTokens,
    engineDecodeTokens: rows.reduce((n, r) => n + r.engineDecodeTokens, 0),
    promptMs, evalMs, loadMs: rows.reduce((n, r) => n + r.loadMs, 0),
    prefillTokSec: tokensPerSecond(readTokens, promptMs),
    decodeTokSec: tokensPerSecond(generatedTokens, evalMs),
    effectiveDecodeTokSec: tokensPerSecond(generatedTokens, wallMs),
    docsPerMinute: wallMs > 0 ? docsWithResults / (wallMs / 60000) : 0,
    cacheRatio: inputTokens > 0 ? cachedTokens / inputTokens : 0,
    parseRate: answered.length > 0 ? answered.filter((r) => r.parseOk).length / answered.length : 0,
    missingEngineTimings: answered.filter((r) => !r.hasEngineTimings).length,
    scoredDocs: outcomes.filter((o) => o.status === "scored").length,
    boilerplateDocs: outcomes.filter((o) => o.status === "boilerplate").length,
    unparseableDocs: outcomes.filter((o) => o.status === "no parseable score").length,
    errorDocs: outcomes.filter((o) => o.status === "error").length,
    requestErrors: rows.filter((r) => r.error).length,
  };
}

function comparisonData() {
  const promptCompare = process.argv.includes("--compare-prompts");
  const baseVersion = ["v1", "v2", "v3"].includes(arg("--base-version") ?? "") ? arg("--base-version") as "v1" | "v2" | "v3" : "v1";
  const candidateVersion = ["v2", "v3", "v4"].includes(arg("--candidate-version") ?? "") ? arg("--candidate-version") as "v2" | "v3" | "v4" : "v2";
  const pairs: { a: number; b: number }[] = [];
  const divergences: any[] = [];
  for (const item of plan.items) {
    const a = promptCompare ? outcome("ollama", item, baseVersion) : outcome("ollama", item);
    const b = promptCompare ? outcome("ollama", item, candidateVersion) : outcome("strata", item);
    if (a.score === null || b.score === null) continue;
    pairs.push({ a: a.score, b: b.score });
    divergences.push({
      accessionNo: item.accessionNo, form: item.form, filingDate: item.filingDate,
      ollama: a.score, strata: b.score, absDelta: Math.abs(b.score - a.score),
      ollamaWhy: a.why, strataWhy: b.why,
      secUrl: `https://www.sec.gov/Archives/edgar/data/${item.cik}/${item.accessionNo.replace(/-/g, "")}/`,
    });
  }
  divergences.sort((x, y) => y.absDelta - x.absDelta);
  return { scores: compareScores(pairs), divergences: divergences.slice(0, 20), promptCompare, labelA: promptCompare ? `Ollama ${baseVersion}` : "Ollama", labelB: promptCompare ? `Ollama ${candidateVersion}` : "Strata" };
}

function writeReports() {
  const summary = {
    runId, ticker, documents: plan.items.length, forms: Object.fromEntries(
      [...plan.items.reduce((m, x) => m.set(x.form, (m.get(x.form) ?? 0) + 1), new Map<string, number>()).entries()].sort(),
    ),
    engines: Object.fromEntries(REPORT_ENGINES.map((e) => [e, engineSummary(e)])),
    comparison: comparisonData(),
    notes: [
      "Sequential single-request runs; warmups excluded; production manifests and signals are untouched.",
      "Score agreement is descriptive, not absolute correctness. Review the largest divergences against SEC sources.",
      "Cached prompt tokens are reported separately; a high cache ratio can inflate prefill throughput on repeated runs.",
    ],
  };
  writeJsonAtomic(summaryPath, summary);
  const fmt = (x: number | null, d = 2) => x === null || !Number.isFinite(x) ? "—" : x.toFixed(d);
  const int = (x: number) => Math.round(x).toLocaleString("en-US");
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const a = summary.engines.ollama, b = summary.engines.strata;
  const { labelA, labelB } = summary.comparison;
  const ratio = (x?: number, y?: number) => x && y ? `${(y / x).toFixed(2)}×` : "—";
  const lines = [
    `# EDGAR tone A/B — ${ticker} (${plan.items.length} documents)${summary.comparison.promptCompare ? " — prompt v1 vs v2" : ""}`, "",
    "Identical prepared windows and prompts; sequential single-request engines. No production writes.", "",
    `| Metric | ${labelA} | ${labelB} | ${labelB} / ${labelA} |`, "|---|---:|---:|---:|",
    `| Model | ${a?.model ?? "—"} | ${b?.model ?? "—"} | — |`,
    `| Documents / windows | ${a?.documents ?? 0} / ${a?.windows ?? 0} | ${b?.documents ?? 0} / ${b?.windows ?? 0} | — |`,
    `| Wall time, min | ${fmt((a?.wallMs ?? 0) / 60000, 1)} | ${fmt((b?.wallMs ?? 0) / 60000, 1)} | ${ratio(a?.wallMs, b?.wallMs)} |`,
    `| Prompt input tokens | ${int(a?.inputTokens ?? 0)} | ${int(b?.inputTokens ?? 0)} | — |`,
    `| Cached tokens | ${int(a?.cachedTokens ?? 0)} | ${int(b?.cachedTokens ?? 0)} | — |`,
    `| Freshly read prompt tokens | ${int(a?.readTokens ?? 0)} | ${int(b?.readTokens ?? 0)} | — |`,
    `| Generated tokens | ${int(a?.generatedTokens ?? 0)} | ${int(b?.generatedTokens ?? 0)} | — |`,
    `| Prefill tok/s | ${fmt(a?.prefillTokSec ?? null)} | ${fmt(b?.prefillTokSec ?? null)} | ${ratio(a?.prefillTokSec, b?.prefillTokSec)} |`,
    `| Decode tok/s | ${fmt(a?.decodeTokSec ?? null)} | ${fmt(b?.decodeTokSec ?? null)} | ${ratio(a?.decodeTokSec, b?.decodeTokSec)} |`,
    `| Effective decode tok/s (wall) | ${fmt(a?.effectiveDecodeTokSec ?? null)} | ${fmt(b?.effectiveDecodeTokSec ?? null)} | ${ratio(a?.effectiveDecodeTokSec, b?.effectiveDecodeTokSec)} |`,
    `| Documents/min | ${fmt(a?.docsPerMinute ?? null)} | ${fmt(b?.docsPerMinute ?? null)} | ${ratio(a?.docsPerMinute, b?.docsPerMinute)} |`,
    `| JSON parse rate | ${pct(a?.parseRate ?? 0)} | ${pct(b?.parseRate ?? 0)} | — |`,
    `| Scored / boilerplate / unparseable / error docs | ${a ? `${a.scoredDocs} / ${a.boilerplateDocs} / ${a.unparseableDocs} / ${a.errorDocs}` : "—"} | ${b ? `${b.scoredDocs} / ${b.boilerplateDocs} / ${b.unparseableDocs} / ${b.errorDocs}` : "—"} | — |`,
    `| Request errors | ${a?.requestErrors ?? 0} | ${b?.requestErrors ?? 0} | — |`,
    `| Cache reuse ratio | ${pct(a?.cacheRatio ?? 0)} | ${pct(b?.cacheRatio ?? 0)} | — |`, "",
    "## Score agreement (not absolute correctness)", "",
  ];
  const q = summary.comparison.scores;
  lines.push(`Matched documents: **${q.n}**.`, "");
  lines.push("| Metric | Value |", "|---|---:|");
  lines.push(`| Mean score, Ollama / Strata | ${fmt(q.meanA, 3)} / ${fmt(q.meanB, 3)} |`);
  lines.push(`| Mean delta, Strata − Ollama | ${fmt(q.meanDelta, 3)} |`);
  lines.push(`| MAE / RMSE | ${fmt(q.mae, 3)} / ${fmt(q.rmse, 3)} |`);
  lines.push(`| Pearson | ${fmt(q.pearson, 3)} |`);
  lines.push(`| Direction agreement, neutral band ±0.1 | ${q.signAgreement === null ? "—" : pct(q.signAgreement)} |`);
  lines.push(`| Within 0.1 / 0.2 | ${q.within01 === null ? "—" : pct(q.within01)} / ${q.within02 === null ? "—" : pct(q.within02)} |`, "", "## Largest divergences for human review", "");
  for (const d of summary.comparison.divergences) {
    lines.push(`### ${d.accessionNo} · ${d.form} · ${d.filingDate}`);
    lines.push(`Scores: Ollama **${d.ollama.toFixed(3)}**, Strata **${d.strata.toFixed(3)}**, |Δ| **${d.absDelta.toFixed(3)}**. [SEC source](${d.secUrl})`, "");
    lines.push(`- ${labelA}: ${d.ollamaWhy ?? "—"}`);
    lines.push(`- ${labelB}: ${d.strataWhy ?? "—"}`, "");
  }
  lines.push("## Limits", "", ...summary.notes.map((n) => `- ${n}`), "");
  writeFileSync(reportPath, lines.join("\n"));
  console.log(`[tone-ab] reports: ${reportPath} · ${summaryPath}`);
}
