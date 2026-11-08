// Local expectations model A/B harness: same cached cohort source, explicit model list,
// strict structured output, source-evidence validation and benchmark comparison.
// Read-only for production: no DB/API writes, no manifest mutation, no result promotion.
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildCohortExpectationPrompt,
  cohortSourceText,
  type CohortContainer,
  type CohortContainerSource,
  type CohortPack,
} from "./lib/cohort-pack";
import { readCohortEntries, type CohortResultEntry } from "./lib/cohort-checkpoint";
import {
  EXPECTATIONS_PROMPT_VERSION,
  buildExpectationPrompt,
  parseExpectationResponseDetailed,
  rejectUnsupportedStatements,
  type ExpectationResponse,
  type ExpectationStatement,
} from "./lib/expectations";
import {
  chooseExpectationAbCases,
  EXPECTATION_STRICT_JSON_SCHEMA,
  parseExpectationModelSpecs,
  subsetBenchmark,
  summarizeExpectationAbRuns,
  type ExpectationAbCandidate,
  type ExpectationAbRunSummaryInput,
  type ExpectationModelSpec,
} from "./lib/expectations-ab";
import {
  evaluateExpectationBenchmark,
  type BenchmarkFile,
  type ExtractionForBenchmark,
} from "./lib/expectations-benchmark";
import { mergeGuidanceStatus } from "./lib/exhibits";
import { writeJsonAtomic } from "./lib/json-file";
import { generate, NUM_CTX, status as ollamaStatus, type GenerateResult } from "./lib/ollama";
import { generateStrata, strataStatus, type StrataGenerateResult } from "./lib/strata";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const args = (name: string) => process.argv.flatMap((value, index) => value === name ? [process.argv[index + 1]] : []);

const benchmarkPath = path.resolve(arg("--benchmark") ?? "research/expectations-benchmark-v1.json");
const cacheRoot = path.resolve(arg("--cache") ?? path.join(import.meta.dirname, "cache", "edgar"));
const models = parseExpectationModelSpecs(arg("--models") ?? `ollama:${process.env.OLLAMA_MODEL ?? "qwen3.5:9b"}`);
const promptMode = arg("--prompt-mode") ?? "cohort";
if (promptMode !== "cohort" && promptMode !== "target") throw new Error("--prompt-mode must be cohort or target");
const dryRun = process.argv.includes("--dry-run");
const skipWarmup = process.argv.includes("--skip-warmup");
const allowContextOverflow = process.argv.includes("--allow-context-overflow");
const includeRawResponse = process.argv.includes("--include-raw-response");
const timeoutMs = Number(arg("--timeout-ms") ?? 600_000);
const numPredict = Number(arg("--num-predict") ?? 4096);
const limit = Number(arg("--limit") ?? 2);
if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("--timeout-ms must be at least 1000");
if (!Number.isInteger(numPredict) || numPredict < 128) throw new Error("--num-predict must be at least 128");
const defaultOut = path.resolve(
  import.meta.dirname,
  ".runs",
  `expectations-model-ab-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const outPath = path.resolve(arg("--out") ?? defaultOut);

interface SourceTask {
  container: CohortContainer;
  source: CohortContainerSource;
  targetText: string;
  inputSha256: string;
}
interface CaseSelection {
  ticker: string;
  cik: number;
  accessionNo: string;
  form: string;
  expectedGuidanceStatus: BenchmarkFile["documents"][number]["expectedGuidanceStatus"];
  requiredStatements: number;
  baselineStatus: ExpectationAbCandidate["baselineStatus"];
  baselineStatements: number;
  tasks: SourceTask[];
}
interface StatementAudit extends ExpectationStatement {
  evidenceSha256: string;
  evidenceChars: number;
}
interface AbRunRow {
  caseId: string;
  ticker: string;
  cik: number;
  accessionNo: string;
  sourceId: string;
  containerId: string;
  cohortId: string;
  engine: ExpectationModelSpec["engine"];
  model: string;
  promptMode: "cohort" | "target";
  promptVersion: string;
  schemaEnforced: boolean;
  contextWindow: number | null;
  promptChars: number;
  promptSha256: string;
  inputSha256: string;
  startedAt: string;
  wallMs: number;
  totalMs: number;
  loadMs: number;
  promptTokens: number;
  promptMs: number;
  generatedTokens: number;
  evalMs: number;
  evalPerSec: number;
  finishReason: string | null;
  hasEngineTimings: boolean;
  schemaValid: boolean;
  status: "extracted" | "empty" | "unparsed" | "request_failed";
  guidanceStatus: ExpectationResponse["guidanceStatus"] | null;
  statements: ExpectationStatement[];
  statementAudit: StatementAudit[];
  evidenceRejected: number;
  validationIssues: string[];
  normalizations: string[];
  rawResponseSha256: string | null;
  rawResponseChars: number;
  rawResponse?: string;
  error: string | null;
}
interface AbReport {
  generatedAt: string;
  runId: string;
  benchmarkPath: string;
  cacheRoot: string;
  promptMode: "cohort" | "target";
  promptVersion: string;
  timeoutMs: number;
  numPredict: number;
  models: ExpectationModelSpec[];
  cases: Omit<CaseSelection, "tasks">[];
  runs: AbRunRow[];
  baselineBenchmark: unknown;
  modelResults: Record<string, { summary: unknown; benchmark: unknown }>;
}

function caseId(ticker: string, accessionNo: string) {
  return `${ticker}:${accessionNo}`;
}
function parseCaseSpec(value: string) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) throw new Error(`Invalid --case "${value}". Expected TICKER:ACCESSION`);
  return { ticker: value.slice(0, separator).toUpperCase(), accessionNo: value.slice(separator + 1).trim() };
}
function loadPack(cik: number): CohortPack {
  const file = path.join(cacheRoot, String(cik), "cohort-pack-v2.json");
  if (!existsSync(file)) throw new Error(`cohort-pack-v2.json missing for CIK ${cik}`);
  return JSON.parse(readFileSync(file, "utf8")) as CohortPack;
}
function packSources(pack: CohortPack, accessionNo: string): SourceTask[] {
  return pack.containers.flatMap((container) => container.sources
    .filter((source) => source.accessionNo === accessionNo)
    .flatMap((source) => {
      const targetText = cohortSourceText(container, source.sourceId);
      return targetText ? [{ container, source, targetText, inputSha256: sha256(`${source.sourceId}\n${container.inputSha256}`) }] : [];
    }));
}
function baselineFor(cik: number, accessionNo: string): Pick<ExpectationAbCandidate, "baselineStatus" | "baselineStatements"> {
  let entries: CohortResultEntry[] = [];
  try { entries = readCohortEntries<CohortResultEntry>(path.join(cacheRoot, String(cik))); } catch { /* missing result stays explicit */ }
  const rows = entries.filter((entry) => entry.accessionNo === accessionNo);
  if (!rows.length) return { baselineStatus: "missing_result", baselineStatements: 0 };
  const priority: ExpectationAbCandidate["baselineStatus"][] = [
    "fallback_unverified", "fallback", "unparsed", "request_failed", "empty", "extracted",
  ];
  return {
    baselineStatus: priority.find((status) => rows.some((row) => row.status === status)) ?? "missing_result",
    baselineStatements: rows.reduce((sum, row) => sum + row.statements.length, 0),
  };
}

const benchmark = JSON.parse(readFileSync(benchmarkPath, "utf8")) as BenchmarkFile;
const explicitCases = args("--case").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean).map(parseCaseSpec);
let selected: CaseSelection[];
if (explicitCases.length) {
  selected = explicitCases.map((requested) => {
    const doc = benchmark.documents.find((doc) => doc.ticker === requested.ticker && doc.accessionNo === requested.accessionNo)
      ?? benchmark.documents.find((doc) => doc.accessionNo === requested.accessionNo);
    if (!doc) throw new Error(`${requested.ticker}:${requested.accessionNo} is not in ${benchmarkPath}; this harness compares against independent gold`);
    const pack = loadPack(doc.cik);
    const tasks = packSources(pack, doc.accessionNo);
    if (!tasks.length) throw new Error(`${doc.ticker} ${doc.accessionNo}: no source text found in cohort-pack-v2.json`);
    return {
      ticker: doc.ticker,
      cik: doc.cik,
      accessionNo: doc.accessionNo,
      form: doc.form,
      expectedGuidanceStatus: doc.expectedGuidanceStatus,
      requiredStatements: doc.required.length,
      ...baselineFor(doc.cik, doc.accessionNo),
      tasks,
    };
  });
} else {
  const candidates = benchmark.documents.map((doc) => {
    let hasPack = false;
    try { hasPack = packSources(loadPack(doc.cik), doc.accessionNo).length > 0; } catch { /* explicit false */ }
    return {
      ticker: doc.ticker,
      cik: doc.cik,
      accessionNo: doc.accessionNo,
      form: doc.form,
      expectedGuidanceStatus: doc.expectedGuidanceStatus,
      requiredStatements: doc.required.length,
      ...baselineFor(doc.cik, doc.accessionNo),
      hasPack,
    } satisfies ExpectationAbCandidate;
  });
  const chosen = chooseExpectationAbCases(candidates, limit);
  selected = chosen.map((candidate) => {
    const tasks = packSources(loadPack(candidate.cik), candidate.accessionNo);
    return { ...candidate, tasks };
  });
}
if (!selected.length) throw new Error("No benchmark cases with cohort source text selected");

const subset = subsetBenchmark(benchmark, selected.map((item) => item.accessionNo));
const sourceTexts = new Map<string, string>();
for (const item of selected) {
  sourceTexts.set(item.accessionNo, item.tasks.map((task) => task.targetText).join("\n\n--- SOURCE ---\n\n"));
}
const baselineExtractions = new Map<string, ExtractionForBenchmark>();
for (const item of selected) {
  let entries: CohortResultEntry[] = [];
  try { entries = readCohortEntries<CohortResultEntry>(path.join(cacheRoot, String(item.cik))); } catch { /* no baseline */ }
  const rows = entries.filter((entry) => entry.accessionNo === item.accessionNo);
  if (rows.length) {
    baselineExtractions.set(item.accessionNo, {
      accessionNo: item.accessionNo,
      guidanceStatus: mergeGuidanceStatus(rows.map((row) => row.guidanceStatus)),
      statements: rows.flatMap((row) => row.statements),
    });
  }
}
const baselineBenchmark = evaluateExpectationBenchmark(subset, baselineExtractions, sourceTexts);

const runId = arg("--run-id") ?? path.basename(outPath, ".json");
let report: AbReport;
if (existsSync(outPath)) {
  report = JSON.parse(readFileSync(outPath, "utf8")) as AbReport;
  const sameCases = JSON.stringify(report.cases.map((item) => caseId(item.ticker, item.accessionNo)).sort())
    === JSON.stringify(selected.map((item) => caseId(item.ticker, item.accessionNo)).sort());
  const sameModels = JSON.stringify(report.models.map((item) => item.label).sort()) === JSON.stringify(models.map((item) => item.label).sort());
  if (!sameCases || !sameModels || report.promptMode !== promptMode || report.promptVersion !== EXPECTATIONS_PROMPT_VERSION) {
    throw new Error(`Existing --out has different cases/models/prompt settings; use a new file: ${outPath}`);
  }
  report.generatedAt = new Date().toISOString();
  report.benchmarkPath = benchmarkPath;
  report.cacheRoot = cacheRoot;
  report.timeoutMs = timeoutMs;
  report.numPredict = numPredict;
  report.baselineBenchmark = baselineBenchmark;
} else {
  report = {
    generatedAt: new Date().toISOString(),
    runId,
    benchmarkPath,
    cacheRoot,
    promptMode: promptMode as "cohort" | "target",
    promptVersion: EXPECTATIONS_PROMPT_VERSION,
    timeoutMs,
    numPredict,
    models,
    cases: selected.map(({ tasks: _tasks, ...item }) => item),
    runs: [],
    baselineBenchmark,
    modelResults: {},
  };
}

function summarizeStatement(statement: ExpectationStatement): StatementAudit {
  return { ...statement, evidenceSha256: sha256(statement.evidence), evidenceChars: statement.evidence.length };
}
function buildReport() {
  const summaries = Object.fromEntries(models.map((spec) => {
    const rows = report.runs.filter((row) => row.engine === spec.engine && row.model === spec.model);
    const extractions = new Map<string, ExtractionForBenchmark>();
    for (const item of selected) {
      const mine = rows.filter((row) => row.accessionNo === item.accessionNo && !row.error);
      if (mine.length) {
        extractions.set(item.accessionNo, {
          accessionNo: item.accessionNo,
          guidanceStatus: mergeGuidanceStatus(mine.map((row) => row.guidanceStatus)),
          statements: mine.flatMap((row) => row.statements),
        });
      }
    }
    const summaryInput: ExpectationAbRunSummaryInput[] = rows.map((row) => ({
      engine: row.engine,
      model: row.model,
      schemaValid: row.schemaValid,
      evidenceRejected: row.evidenceRejected,
      statements: row.statements,
      wallMs: row.wallMs,
      totalMs: row.totalMs,
      promptTokens: row.promptTokens,
      generatedTokens: row.generatedTokens,
      error: row.error,
    }));
    return [spec.label, {
      summary: summarizeExpectationAbRuns(summaryInput, spec),
      benchmark: evaluateExpectationBenchmark(subset, extractions, sourceTexts),
    }];
  }));
  report.generatedAt = new Date().toISOString();
  report.baselineBenchmark = baselineBenchmark;
  report.modelResults = summaries;
}
function saveReport() {
  buildReport();
  writeJsonAtomic(outPath, report, true);
}

async function ensureModels() {
  const ollamaModels = models.filter((spec) => spec.engine === "ollama");
  if (ollamaModels.length) {
    const status = await ollamaStatus();
    if (!status.ok) throw new Error("Ollama daemon not reachable at OLLAMA_URL/127.0.0.1:11434");
    for (const spec of ollamaModels) {
      if (!status.models.includes(spec.model)) throw new Error(`Ollama model ${spec.model} is not pulled. Available: ${status.models.join(", ")}`);
    }
  }
  const strataModels = models.filter((spec) => spec.engine === "strata");
  if (strataModels.length) {
    const status = await strataStatus();
    if (!status.ok) throw new Error("Strata daemon not reachable at STRATA_URL/127.0.0.1:8080");
    for (const spec of strataModels) {
      if (!status.models.includes(spec.model)) throw new Error(`Strata model ${spec.model} is not loaded. Available: ${status.models.join(", ")}`);
    }
  }
}
async function generateFor(spec: ExpectationModelSpec, prompt: string, options: { numPredict: number; timeoutMs: number; strictSchema: boolean }) {
  return spec.engine === "ollama"
    ? await generate(prompt, {
      model: spec.model,
      jsonSchema: options.strictSchema ? EXPECTATION_STRICT_JSON_SCHEMA : undefined,
      numPredict: options.numPredict,
      timeoutMs: options.timeoutMs,
      keepAlive: "10m",
    })
    : await generateStrata(prompt, { model: spec.model, numPredict: options.numPredict, timeoutMs: options.timeoutMs });
}
async function warmup(spec: ExpectationModelSpec) {
  const prompt = 'Return ONLY this JSON object: {"guidanceStatus":"not_found","statements":[],"extractionWarnings":[]}';
  await generateFor(spec, prompt, { numPredict: 128, timeoutMs, strictSchema: spec.engine === "ollama" });
}
function contextWindowFor(spec: ExpectationModelSpec): number | null {
  if (spec.engine === "ollama") return NUM_CTX;
  const value = Number(process.env.STRATA_NUM_CTX ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}
function assertContextBudget(spec: ExpectationModelSpec, prompt: string, outputTokens: number) {
  const contextWindow = contextWindowFor(spec);
  if (!contextWindow || allowContextOverflow) return;
  // Qwen tokenization is prompt-dependent; 3.2 chars/token is a conservative
  // fail-fast estimate so a slow 27B model is not loaded into an invalid run.
  const estimatedPromptTokens = Math.ceil(prompt.length / 3.2);
  const requiredTokens = estimatedPromptTokens + outputTokens;
  if (requiredTokens > contextWindow) {
    throw new Error(`${spec.label}: estimated context requirement ${requiredTokens} tokens (${estimatedPromptTokens} prompt + ${outputTokens} output) exceeds ${contextWindow}. Use --prompt-mode target, raise OLLAMA_NUM_CTX/STRATA_NUM_CTX, lower --num-predict, or pass --allow-context-overflow only for diagnostics.`);
  }
}

if (dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    outPath,
    promptMode,
    promptVersion: EXPECTATIONS_PROMPT_VERSION,
    contextWindows: Object.fromEntries(models.map((spec) => [spec.label, contextWindowFor(spec)])),
    numPredict,
    allowContextOverflow,
    models,
    baselineBenchmark,
    cases: selected.map((item) => ({
      ticker: item.ticker,
      accessionNo: item.accessionNo,
      form: item.form,
      baselineStatus: item.baselineStatus,
      baselineStatements: item.baselineStatements,
      requiredStatements: item.requiredStatements,
      sources: item.tasks.map((task) => {
        const prompt = promptMode === "cohort"
          ? buildCohortExpectationPrompt(task.container, task.source.sourceId, {
            ticker: item.ticker,
            form: task.source.form,
            filingDate: task.source.filingDate,
            accessionNo: item.accessionNo,
          })
          : buildExpectationPrompt(task.targetText, {
            ticker: item.ticker,
            form: task.source.form,
            filingDate: task.source.filingDate,
            accessionNo: item.accessionNo,
          });
        const estimatedPromptTokens = Math.ceil(prompt.length / 3.2);
        return {
          sourceId: task.source.sourceId,
          sourceFile: task.source.sourceFile,
          role: task.source.role,
          chars: task.targetText.length,
          estimatedSourceTokens: Math.ceil(task.targetText.length / 4),
          promptChars: prompt.length,
          estimatedPromptTokens,
          estimatedContextRequirement: estimatedPromptTokens + numPredict,
          fitsContextByModel: Object.fromEntries(models.map((spec) => {
            const contextWindow = contextWindowFor(spec);
            return [spec.label, contextWindow === null ? null : estimatedPromptTokens + numPredict <= contextWindow];
          })),
          inputSha256: task.inputSha256,
        };
      }),
    })),
  }, null, 2));
  process.exit(0);
}

await ensureModels();
console.log(`[expectations-ab] ${selected.length} cases · ${models.length} models · sequential concurrency 1 · out ${outPath}`);
for (const spec of models) {
  if (!skipWarmup) {
    console.log(`[expectations-ab] ${spec.label}: warmup (excluded)`);
    await warmup(spec);
  }
  for (const item of selected) {
    for (const task of item.tasks) {
      const key = `${item.accessionNo}|${task.source.sourceId}|${spec.label}`;
      const already = report.runs.some((row) => !row.error && `${row.accessionNo}|${row.sourceId}|${row.engine}:${row.model}` === key);
      if (already) continue;
      const context = {
        ticker: item.ticker,
        form: task.source.form,
        filingDate: task.source.filingDate,
        accessionNo: item.accessionNo,
      };
      const prompt = promptMode === "cohort"
        ? buildCohortExpectationPrompt(task.container, task.source.sourceId, context)
        : buildExpectationPrompt(task.targetText, context);
      assertContextBudget(spec, prompt, numPredict);
      const contextWindow = contextWindowFor(spec);
      const startedAt = new Date().toISOString();
      const wallStarted = Date.now();
      let row: AbRunRow;
      try {
        const generated: GenerateResult | StrataGenerateResult = await generateFor(spec, prompt, {
          numPredict,
          timeoutMs,
          strictSchema: spec.engine === "ollama",
        });
        const parsed = parseExpectationResponseDetailed(generated.text);
        const checked = parsed.response ? rejectUnsupportedStatements(parsed.response, task.targetText) : null;
        const status = parsed.response
          ? (checked!.response.statements.length || checked!.response.guidanceStatus !== "found" ? "extracted" : "empty")
          : "unparsed";
        row = {
          caseId: caseId(item.ticker, item.accessionNo),
          ticker: item.ticker,
          cik: item.cik,
          accessionNo: item.accessionNo,
          sourceId: task.source.sourceId,
          containerId: task.container.containerId,
          cohortId: task.container.cohortId,
          engine: spec.engine,
          model: generated.model,
          promptMode: promptMode as "cohort" | "target",
          promptVersion: EXPECTATIONS_PROMPT_VERSION,
          schemaEnforced: spec.engine === "ollama",
          contextWindow,
          promptChars: prompt.length,
          promptSha256: sha256(prompt),
          inputSha256: task.inputSha256,
          startedAt,
          wallMs: Date.now() - wallStarted,
          totalMs: generated.totalMs,
          loadMs: generated.loadMs,
          promptTokens: generated.promptEvalCount,
          promptMs: generated.promptEvalMs,
          generatedTokens: generated.evalCount,
          evalMs: generated.evalMs,
          evalPerSec: generated.evalPerSec,
          finishReason: spec.engine === "strata" ? (generated as StrataGenerateResult).finishReason : null,
          hasEngineTimings: spec.engine === "strata" ? (generated as StrataGenerateResult).hasEngineTimings : true,
          schemaValid: parsed.response !== null,
          status,
          guidanceStatus: checked?.response.guidanceStatus ?? null,
          statements: checked?.response.statements ?? [],
          statementAudit: (checked?.response.statements ?? []).map(summarizeStatement),
          evidenceRejected: checked?.rejected ?? 0,
          validationIssues: parsed.issues.slice(0, 20),
          normalizations: parsed.normalizations.slice(0, 20),
          rawResponseSha256: sha256(generated.text),
          rawResponseChars: generated.text.length,
          ...(includeRawResponse ? { rawResponse: generated.text } : {}),
          error: null,
        };
      } catch (error) {
        row = {
          caseId: caseId(item.ticker, item.accessionNo),
          ticker: item.ticker,
          cik: item.cik,
          accessionNo: item.accessionNo,
          sourceId: task.source.sourceId,
          containerId: task.container.containerId,
          cohortId: task.container.cohortId,
          engine: spec.engine,
          model: spec.model,
          promptMode: promptMode as "cohort" | "target",
          promptVersion: EXPECTATIONS_PROMPT_VERSION,
          schemaEnforced: spec.engine === "ollama",
          contextWindow,
          promptChars: prompt.length,
          promptSha256: sha256(prompt),
          inputSha256: task.inputSha256,
          startedAt,
          wallMs: Date.now() - wallStarted,
          totalMs: 0,
          loadMs: 0,
          promptTokens: 0,
          promptMs: 0,
          generatedTokens: 0,
          evalMs: 0,
          evalPerSec: 0,
          finishReason: null,
          hasEngineTimings: spec.engine !== "strata",
          schemaValid: false,
          status: "request_failed",
          guidanceStatus: null,
          statements: [],
          statementAudit: [],
          evidenceRejected: 0,
          validationIssues: [],
          normalizations: [],
          rawResponseSha256: null,
          rawResponseChars: 0,
          error: String(error instanceof Error ? error.message : error).slice(0, 500),
        };
      }
      report.runs.push(row);
      saveReport();
      console.log(`[expectations-ab] ${spec.label} ${item.ticker} ${item.accessionNo}: ${row.status} · statements ${row.statements.length} · rejected ${row.evidenceRejected} · ${Math.round(row.wallMs / 1000)}s`);
    }
  }
}
saveReport();
const results = Object.fromEntries(Object.entries(report.modelResults).map(([label, value]) => [label, {
  schemaPassRate: (value.summary as { schemaPassRate: number | null }).schemaPassRate,
  statements: (value.summary as { statements: number }).statements,
  benchmarkPass: (value.benchmark as { pass: boolean }).pass,
  recall: (value.benchmark as { recall: number | null }).recall,
  issues: (value.benchmark as { issues: unknown[] }).issues.length,
}]));
console.log(JSON.stringify({ outPath, baseline: baselineBenchmark, models: results }, null, 2));
