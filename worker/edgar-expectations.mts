// Local-only management-expectations extraction. Never posts to production.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { derivePlaintext, isEightKForm, loadEdgarUniverse } from "./lib/edgar";
import {
  buildExpectationPrompt,
  EXPECTATION_JSON_SCHEMA,
  EXPECTATIONS_PROMPT_VERSION,
  EXPECTATIONS_SCHEMA_VERSION,
  parseExpectationResponse,
  rejectUnsupportedStatements,
  selectExpectationText,
  type ExpectationResponse,
} from "./lib/expectations";
import { generate, LLM_MODEL, status } from "./lib/ollama";
import { exhibitCacheName } from "./lib/exhibits";
import { selectLatestFilings } from "./lib/filing-selection";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";
import type { ManifestEntry } from "./edgar-fetch.mts";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const from = arg("--from");
const fromTicker = arg("--from-ticker")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "edgar-universe.json";
const dryRun = process.argv.includes("--dry-run");
const benchmarkOnly = process.argv.includes("--benchmark");
const latestOnly = process.argv.includes("--latest");
const benchmarkAccessions = benchmarkOnly
  ? new Set((JSON.parse(readFileSync(path.resolve("research/expectations-benchmark-v1.json"), "utf8")) as { documents: { accessionNo: string }[] }).documents.map((doc) => doc.accessionNo))
  : null;
const rescore = process.argv.includes("--rescore");
const limitValue = Number(arg("--limit") ?? 0);
if (!Number.isInteger(limitValue) || limitValue < 0) throw new Error("--limit must be a non-negative integer");
const limit = limitValue || null;
const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));
const resultPath = (cik: number) => path.join(cacheDir(cik), "expectations-v2.json");
const supportedForm = (form: string) => /^(?:10-K|10-Q|8-K)(?:\/A)?$/.test(form);

interface Usage { promptTokens: number; evalCount: number; promptMs: number; evalMs: number; totalMs: number }
interface ResultEntry {
  cik: number;
  ticker: string;
  accessionNo: string;
  form: string;
  filingDate: string;
  eventTs: string;
  sourceFile: string;
  inputSha256: string;
  model: string;
  promptVersion: string;
  status: "extracted" | "empty" | "no_candidate_text" | "unparsed" | "request_failed";
  guidanceStatus: ExpectationResponse["guidanceStatus"] | null;
  statements: ExpectationResponse["statements"];
  extractionWarnings: string[];
  rejectedEvidence: number;
  rawResponse: string | null;
  usage: Usage | null;
  updatedAt: string;
}
interface ResultFile { schemaVersion: number; entries: ResultEntry[] }

function readResults(cik: number): ResultFile {
  if (rescore) return { schemaVersion: EXPECTATIONS_SCHEMA_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(resultPath(cik), "utf8")) as ResultFile;
    return parsed.schemaVersion === EXPECTATIONS_SCHEMA_VERSION && Array.isArray(parsed.entries) ? parsed : { schemaVersion: EXPECTATIONS_SCHEMA_VERSION, entries: [] };
  } catch {
    return { schemaVersion: EXPECTATIONS_SCHEMA_VERSION, entries: [] };
  }
}
function sourcesFor(cik: number, entry: ManifestEntry): string[] {
  const base = entry.accessionNo.replace(/-/g, "");
  if (isEightKForm(entry.form)) {
    if (entry.exhibitFiles?.length) {
      return entry.exhibitFiles.map((file) => path.join(cacheDir(cik), exhibitCacheName(entry.accessionNo, file.name))).filter((file) => existsSync(file));
    }
    const legacy = path.join(cacheDir(cik), `${base}.ex.htm`);
    if (entry.exFile && existsSync(legacy)) return [legacy];
  }
  return [path.join(cacheDir(cik), `${base}.htm`)];
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

if (!dryRun) {
  const st = await status();
  if (!st.ok) throw new Error("Ollama daemon not reachable at 127.0.0.1:11434");
  if (!st.models.some((model) => model === LLM_MODEL || model.startsWith(`${LLM_MODEL.split(":")[0]}:`))) throw new Error(`Model ${LLM_MODEL} is not pulled`);
}
const prog = startProgress("edgar-expectations", `${EXPECTATIONS_PROMPT_VERSION} · local shadow only · ${dryRun ? "dry-run" : `model ${LLM_MODEL}`}`);
const universeAll = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universeAll.length) throw new Error(`Unknown ticker ${only}`);
const startIndex = fromTicker ? universeAll.findIndex((company) => company.ticker === fromTicker) : 0;
if (fromTicker && startIndex < 0) throw new Error(`Unknown --from-ticker ${fromTicker}`);
const universe = universeAll.slice(Math.max(0, startIndex));
const totals = { extracted: 0, empty: 0, noCandidate: 0, unparsed: 0, failed: 0, resumed: 0, promptTokens: 0, evalCount: 0, rejectedEvidence: 0 };

for (const company of universe) {
  let manifest: ManifestEntry[];
  try { manifest = JSON.parse(readFileSync(path.join(cacheDir(company.cik), "manifest.json"), "utf8")); }
  catch { prog.log(`${company.ticker}: no manifest`); continue; }
  const eligible = manifest.filter((entry) => entry.fetched && supportedForm(entry.form) && (!from || entry.filingDate >= from) && (!benchmarkAccessions || benchmarkAccessions.has(entry.accessionNo)));
  const candidates = (latestOnly ? selectLatestFilings(eligible) : eligible).slice(0, limit ?? undefined);
  const tasks = candidates.flatMap((filing) => sourcesFor(company.cik, filing).map((sourceFile) => ({ filing, sourceFile })));
  const result = readResults(company.cik);
  let consecutiveFailures = 0;
  for (const { filing, sourceFile } of tasks) {
    let plain: string;
    try { plain = derivePlaintext(readFileSync(sourceFile, "utf8")); }
    catch {
      prog.log(`${company.ticker} ${filing.accessionNo}: cache unreadable`);
      continue;
    }
    const selected = selectExpectationText(plain, filing.form);
    const inputSha256 = sha256(`${filing.form}\n${filing.filingDate}\n${selected.text}`);
    const prior = result.entries.find((entry) => entry.accessionNo === filing.accessionNo && entry.sourceFile === sourceFile && entry.inputSha256 === inputSha256 && entry.model === LLM_MODEL && entry.promptVersion === EXPECTATIONS_PROMPT_VERSION);
    if (prior && prior.status !== "request_failed" && prior.status !== "unparsed") {
      totals.resumed++;
      continue;
    }
    const base: ResultEntry = {
      cik: company.cik, ticker: company.ticker, accessionNo: filing.accessionNo, form: filing.form,
      filingDate: filing.filingDate, eventTs: filing.eventTs, sourceFile, inputSha256,
      model: LLM_MODEL, promptVersion: EXPECTATIONS_PROMPT_VERSION,
      status: "empty", guidanceStatus: null, statements: [], extractionWarnings: [], rejectedEvidence: 0,
      rawResponse: null, usage: null, updatedAt: new Date().toISOString(),
    };
    if (selected.status === "no_candidate_text") {
      base.status = "no_candidate_text";
      result.entries = [...result.entries.filter((entry) => !(entry.accessionNo === filing.accessionNo && entry.sourceFile === sourceFile)), base];
      if (!dryRun) writeJsonAtomic(resultPath(company.cik), result, true);
      totals.noCandidate++;
      continue;
    }
    if (dryRun) {
      totals.extracted++;
      prog.log(`${company.ticker} ${filing.form} ${filing.filingDate}: ${selected.blocks} block(s), ${selected.text.length} chars`);
      continue;
    }
    try {
      const generated = await generate(buildExpectationPrompt(selected.text, {
        ticker: company.ticker, form: filing.form, filingDate: filing.filingDate, accessionNo: filing.accessionNo,
      }), { jsonSchema: EXPECTATION_JSON_SCHEMA, numPredict: 4096, timeoutMs: 180_000 });
      const usage = { promptTokens: generated.promptEvalCount, evalCount: generated.evalCount, promptMs: generated.promptEvalMs, evalMs: generated.evalMs, totalMs: generated.totalMs };
      totals.promptTokens += usage.promptTokens;
      totals.evalCount += usage.evalCount;
      base.usage = usage;
      base.rawResponse = generated.text;
      const parsed = parseExpectationResponse(generated.text);
      if (!parsed) {
        base.status = "unparsed";
        totals.unparsed++;
        consecutiveFailures++;
      } else {
        const checked = rejectUnsupportedStatements(parsed, selected.text);
        base.status = checked.response.statements.length || checked.response.guidanceStatus !== "found" ? "extracted" : "empty";
        base.guidanceStatus = checked.response.guidanceStatus;
        base.statements = checked.response.statements;
        base.extractionWarnings = [...checked.response.extractionWarnings, ...(checked.rejected ? [`Rejected ${checked.rejected} statement(s) without verbatim source evidence`] : [])];
        base.rejectedEvidence = checked.rejected;
        totals.rejectedEvidence += checked.rejected;
        if (base.status === "extracted") totals.extracted++; else totals.empty++;
        consecutiveFailures = 0;
      }
    } catch (error) {
      base.status = "request_failed";
      base.extractionWarnings = [String(error).slice(0, 500)];
      totals.failed++;
      consecutiveFailures++;
    }
    result.entries = [...result.entries.filter((entry) => !(entry.accessionNo === filing.accessionNo && entry.sourceFile === sourceFile)), base];
    writeJsonAtomic(resultPath(company.cik), result, true);
    if (consecutiveFailures >= 2) {
      prog.log(`${company.ticker}: two consecutive LLM failures; state checkpointed, aborting`);
      prog.done(`aborted · ${JSON.stringify(totals)}`);
      process.exit(2);
    }
  }
  if (!dryRun) writeJsonAtomic(resultPath(company.cik), result, true);
  prog.stageDone(`${company.ticker}: sources ${tasks.length} · resumed ${totals.resumed} · extracted ${totals.extracted} · no-candidate ${totals.noCandidate}`);
}
prog.done(`all done · extracted ${totals.extracted} · empty ${totals.empty} · no-candidate ${totals.noCandidate} · unparsed ${totals.unparsed} · failed ${totals.failed} · resumed ${totals.resumed} · rejected evidence ${totals.rejectedEvidence} · prompt ${totals.promptTokens} tok · generated ${totals.evalCount} tok`);
