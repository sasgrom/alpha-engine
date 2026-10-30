// Extract per-source statements from bounded cohort packs and merge deterministically.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadEdgarUniverse } from "./lib/edgar";
import { dedupeExpectationUniverse } from "./lib/universe";
import { buildCohortExpectationPrompt, cohortSourceText, type CohortPack } from "./lib/cohort-pack";
import {
  EXPECTATION_JSON_SCHEMA,
  EXPECTATIONS_PROMPT_VERSION,
  EXPECTATIONS_SCHEMA_VERSION,
  parseExpectationResponseDetailed,
  rejectUnsupportedStatements,
  type ExpectationResponse,
} from "./lib/expectations";
import { generate, LLM_MODEL, status } from "./lib/ollama";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";
import { nextLlmFailureStreak, shouldAbortLlmBatch } from "./lib/llm-run-policy";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const from = arg("--from");
const fromTicker = arg("--from-ticker")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "research-universe-53.json";
const dryRun = process.argv.includes("--dry-run");
const rescore = process.argv.includes("--rescore");
const benchmarkOnly = process.argv.includes("--benchmark");
const limitValue = Number(arg("--limit") ?? 0);
if (!Number.isInteger(limitValue) || limitValue < 0) throw new Error("--limit must be a non-negative integer");
const limit = limitValue || null;
const benchmarkAccessions = benchmarkOnly
  ? new Set((JSON.parse(readFileSync(path.resolve("research/expectations-benchmark-v1.json"), "utf8")) as { documents: { accessionNo: string }[] }).documents.map((doc) => doc.accessionNo))
  : null;
const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));
const outputPath = (cik: number) => path.join(cacheDir(cik), "cohort-v2.json");
const failureLog = path.resolve(import.meta.dirname, ".runs", "cohort-extraction-failures.jsonl");
mkdirSync(path.dirname(failureLog), { recursive: true });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

interface Usage { promptTokens: number; evalCount: number; promptMs: number; evalMs: number; totalMs: number }
interface CohortResultEntry {
  cik: number;
  ticker: string;
  cohortId: string;
  containerId: string;
  sourceId: string;
  accessionNo: string;
  form: string;
  filingDate: string;
  eventTs: string;
  reportDate: string;
  sourceFile: string;
  inputSha256: string;
  model: string;
  promptVersion: string;
  status: "extracted" | "empty" | "unparsed" | "request_failed";
  guidanceStatus: ExpectationResponse["guidanceStatus"] | null;
  statements: ExpectationResponse["statements"];
  extractionWarnings: string[];
  rejectedEvidence: number;
  rawResponse: string | null;
  usage: Usage | null;
  updatedAt: string;
}
interface CohortResultFile {
  schemaVersion: number;
  contextTokens: number;
  packGeneratedAt: string;
  unpacked: CohortPack["unpacked"];
  entries: CohortResultEntry[];
}

if (!dryRun) {
  const st = await status();
  if (!st.ok) throw new Error("Ollama daemon not reachable at 127.0.0.1:11434");
  if (!st.models.some((model) => model === LLM_MODEL || model.startsWith(`${LLM_MODEL.split(":")[0]}:`))) throw new Error(`Model ${LLM_MODEL} is not pulled`);
}
const universeAll = dedupeExpectationUniverse(loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only));
if (only && !universeAll.length) throw new Error(`Unknown ticker ${only}`);
const start = fromTicker ? universeAll.findIndex((company) => company.ticker === fromTicker) : 0;
if (fromTicker && start < 0) throw new Error(`Unknown --from-ticker ${fromTicker}`);
const universe = universeAll.slice(Math.max(0, start));
const prog = startProgress("edgar-cohort-extract", `${EXPECTATIONS_PROMPT_VERSION} · per-source extraction · target-only evidence`);
const totals = { containers: 0, sources: 0, planned: 0, extracted: 0, empty: 0, unparsed: 0, failed: 0, resumed: 0, rejectedEvidence: 0, promptTokens: 0, evalCount: 0, missingPacks: 0 };
for (const company of universe) {
  let pack: CohortPack;
  try { pack = JSON.parse(readFileSync(path.join(cacheDir(company.cik), "cohort-pack-v2.json"), "utf8")) as CohortPack; }
  catch {
    if (only) throw new Error(`${company.ticker}: cohort-pack-v2.json missing. Run npx tsx worker/edgar-cohorts.mts --universe ${universeFile} --only ${only} first`);
    totals.missingPacks++;
    prog.log(`${company.ticker}: cohort-pack-v2.json missing; skipped`);
    continue;
  }
  const result: CohortResultFile = rescore
    ? { schemaVersion: EXPECTATIONS_SCHEMA_VERSION, contextTokens: pack.contextTokens, packGeneratedAt: pack.generatedAt, unpacked: pack.unpacked, entries: [] }
    : (() => { try { return JSON.parse(readFileSync(outputPath(company.cik), "utf8")) as CohortResultFile; } catch { return { schemaVersion: EXPECTATIONS_SCHEMA_VERSION, contextTokens: pack.contextTokens, packGeneratedAt: pack.generatedAt, unpacked: pack.unpacked, entries: [] }; } })();
  if (result.schemaVersion !== EXPECTATIONS_SCHEMA_VERSION || result.packGeneratedAt !== pack.generatedAt || result.contextTokens !== pack.contextTokens) {
    result.schemaVersion = EXPECTATIONS_SCHEMA_VERSION;
    result.contextTokens = pack.contextTokens;
    result.packGeneratedAt = pack.generatedAt;
    result.unpacked = pack.unpacked;
    result.entries = [];
  }
  const tasks = pack.containers.flatMap((container) => container.sources
    .filter((source) => (!from || source.filingDate >= from) && (!benchmarkAccessions || benchmarkAccessions.has(source.accessionNo)))
    .map((source) => ({ container, source })));
  let consecutiveFailures = 0;
  for (const { container, source } of tasks.slice(0, limit ?? undefined)) {
    totals.sources++;
    const targetText = cohortSourceText(container, source.sourceId);
    if (!targetText) continue;
    const inputSha256 = sha256(`${source.sourceId}\n${container.inputSha256}`);
    const prior = result.entries.find((entry) => entry.sourceId === source.sourceId && entry.containerId === container.containerId && entry.inputSha256 === inputSha256 && entry.model === LLM_MODEL && entry.promptVersion === EXPECTATIONS_PROMPT_VERSION);
    if (prior && prior.status !== "request_failed" && prior.status !== "unparsed") { totals.resumed++; continue; }
    const base: CohortResultEntry = {
      cik: company.cik,
      ticker: company.ticker,
      cohortId: container.cohortId,
      containerId: container.containerId,
      sourceId: source.sourceId,
      accessionNo: source.accessionNo,
      form: source.form,
      filingDate: source.filingDate,
      eventTs: source.eventTs,
      reportDate: source.reportDate,
      sourceFile: source.sourceFile,
      inputSha256,
      model: LLM_MODEL,
      promptVersion: EXPECTATIONS_PROMPT_VERSION,
      status: "empty",
      guidanceStatus: null,
      statements: [],
      extractionWarnings: [],
      rejectedEvidence: 0,
      rawResponse: null,
      usage: null,
      updatedAt: new Date().toISOString(),
    };
    if (dryRun) {
      totals.planned++;
      prog.log(`${company.ticker} ${container.containerId} ${source.sourceId}: ${(Buffer.byteLength(targetText) / 1024).toFixed(1)} KiB target · ${container.estimatedTokens.toLocaleString("en-US")} tok container`);
      continue;
    }
    try {
      const generated = await generate(buildCohortExpectationPrompt(container, source.sourceId, {
        ticker: company.ticker,
        form: source.form,
        filingDate: source.filingDate,
        accessionNo: source.accessionNo,
      }), { jsonSchema: EXPECTATION_JSON_SCHEMA, numPredict: pack.outputTokens, timeoutMs: 180_000 });
      base.usage = { promptTokens: generated.promptEvalCount, evalCount: generated.evalCount, promptMs: generated.promptEvalMs, evalMs: generated.evalMs, totalMs: generated.totalMs };
      base.rawResponse = generated.text;
      totals.promptTokens += generated.promptEvalCount;
      totals.evalCount += generated.evalCount;
      const parsed = parseExpectationResponseDetailed(generated.text);
      if (!parsed.response) {
        base.status = "unparsed";
        totals.unparsed++;
        consecutiveFailures = nextLlmFailureStreak("unparsed", consecutiveFailures);
        appendFileSync(failureLog, JSON.stringify({
          ts: new Date().toISOString(), cik: company.cik, ticker: company.ticker,
          cohortId: container.cohortId, containerId: container.containerId, sourceId: source.sourceId,
          reason: "response_does_not_match_expectations_v2_schema",
          validationErrors: parsed.issues,
          response: generated.text.slice(0, 8000),
        }) + "\n");
        prog.log(`${company.ticker} ${source.sourceId}: unparsed (${parsed.issues[0] ?? "unknown schema error"}); continuing`);
      } else {
        const checked = rejectUnsupportedStatements(parsed.response, targetText);
        base.status = checked.response.statements.length || checked.response.guidanceStatus !== "found" ? "extracted" : "empty";
        base.guidanceStatus = checked.response.guidanceStatus;
        base.statements = checked.response.statements;
        base.extractionWarnings = [...checked.response.extractionWarnings, ...(checked.rejected ? [`Rejected ${checked.rejected} statement(s) without target-source evidence`] : [])];
        base.rejectedEvidence = checked.rejected;
        totals.rejectedEvidence += checked.rejected;
        if (base.status === "extracted") totals.extracted++; else totals.empty++;
        consecutiveFailures = nextLlmFailureStreak("extracted", consecutiveFailures);
      }
    } catch (error) {
      base.status = "request_failed";
      base.extractionWarnings = [String(error).slice(0, 500)];
      totals.failed++;
      consecutiveFailures = nextLlmFailureStreak("request_failed", consecutiveFailures);
    }
    result.entries = [...result.entries.filter((entry) => !(entry.sourceId === source.sourceId && entry.containerId === container.containerId)), base];
    writeJsonAtomic(outputPath(company.cik), result, true);
    if (shouldAbortLlmBatch(consecutiveFailures)) {
      prog.done(`aborted after two LLM failures · state saved · ${JSON.stringify(totals)}`);
      process.exit(2);
    }
  }
  totals.containers += tasks.length;
  writeJsonAtomic(outputPath(company.cik), result, true);
  prog.stageDone(`${company.ticker}: sources ${tasks.length} · ${dryRun ? `planned ${totals.planned}` : `extracted ${totals.extracted}`} · resumed ${totals.resumed} · rejected ${totals.rejectedEvidence}`);
}
prog.done(`all done · sources ${totals.sources} · ${dryRun ? `planned ${totals.planned}` : `extracted ${totals.extracted}`} · empty ${totals.empty} · unparsed ${totals.unparsed} · failed ${totals.failed} · resumed ${totals.resumed} · rejected evidence ${totals.rejectedEvidence} · missing packs ${totals.missingPacks} · prompt ${totals.promptTokens} tok · generated ${totals.evalCount} tok`);
