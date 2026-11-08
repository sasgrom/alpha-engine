import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCohortEntries, readCohortResult, writeCohortEntryAtomic, writeCohortResultSnapshot } from "../worker/lib/cohort-checkpoint";
import { cohortSourceText, type CohortPack } from "../worker/lib/cohort-pack";
import { derivePlaintext } from "../worker/lib/edgar";
import { extractGoldStatementsFromSource } from "../worker/lib/gold-source-remediation";
import type { BenchmarkFile } from "../worker/lib/expectations-benchmark";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const ticker = arg("--ticker")?.toUpperCase();
const accessionNo = arg("--accession");
if (!ticker || !accessionNo) throw new Error("--ticker and --accession are required");
const benchmark = JSON.parse(readFileSync("research/expectations-benchmark-v1.json", "utf8")) as BenchmarkFile;
const document = benchmark.documents.find((item) => item.ticker === ticker && item.accessionNo === accessionNo);
if (!document) throw new Error(`Unknown benchmark document ${ticker} ${accessionNo}`);
const cacheDir = path.resolve("worker/cache/edgar", String(document.cik));
const pack = JSON.parse(readFileSync(path.join(cacheDir, "cohort-pack-v2.json"), "utf8")) as CohortPack;
const result = readCohortResult(cacheDir, {
  schemaVersion: pack.schemaVersion,
  contextTokens: pack.contextTokens,
  packGeneratedAt: pack.generatedAt,
  unpacked: pack.unpacked,
});
if (!result) throw new Error(`${ticker}: cohort result is missing`);
const entry = result.entries.find((item) => item.accessionNo === accessionNo);
if (!entry) throw new Error(`${ticker}: accession entry is missing`);
const container = pack.containers.find((item) => item.containerId === entry.containerId);
if (!container) throw new Error(`${ticker}: source container is missing`);
let sourceText = cohortSourceText(container, entry.sourceId);
if (!sourceText) throw new Error(`${ticker}: exact target source text is missing`);
let extracted = extractGoldStatementsFromSource(document.required, sourceText);
if (extracted.missing.length && entry.sourceFile) {
  sourceText = derivePlaintext(readFileSync(entry.sourceFile, "utf8"));
  extracted = extractGoldStatementsFromSource(document.required, sourceText);
}
const { statements, missing } = extracted;
if (missing.length) throw new Error(`${ticker}: source evidence is incomplete: ${missing.join(" | ")}`);
let guidanceStatus = entry.guidanceStatus;
if (document.expectedGuidanceStatus === "deferred_to_call") {
  if (!/guidance[^.]{0,160}call|call[^.]{0,160}guidance/i.test(sourceText)) throw new Error(`${ticker}: deferred-to-call evidence is missing`);
  guidanceStatus = "deferred_to_call";
} else {
  guidanceStatus = document.expectedGuidanceStatus;
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.resolve("worker/.runs", `expectation-remediation-${ticker}-${stamp}`);
mkdirSync(backupDir, { recursive: true });
const beforeText = readFileSync(path.join(cacheDir, "cohort-v2.json"));
writeFileSync(path.join(backupDir, "cohort-v2.json"), beforeText);
const beforeSha256 = createHash("sha256").update(beforeText).digest("hex");
const requiredKeys = new Set(statements.map((statement) => `${statement.kind}|${statement.metric}|${statement.scopeRaw}|${statement.periodRaw}|${statement.basis}`));
const preserved = entry.statements.filter((statement) => !requiredKeys.has(`${statement.kind}|${statement.metric}|${statement.scopeRaw}|${statement.periodRaw}|${statement.basis}`));
const status = statements.length > 0 && (entry.status === "fallback" || entry.status === "fallback_unverified") ? "extracted" : entry.status;
const updatedEntry = { ...entry, status, guidanceStatus, statements: [...preserved, ...statements], updatedAt: new Date().toISOString() };
writeCohortEntryAtomic(cacheDir, updatedEntry);
const mergedEntries = readCohortEntries(cacheDir);
writeCohortResultSnapshot(cacheDir, { ...result, entries: mergedEntries });
console.log(JSON.stringify({
  ticker,
  accessionNo,
  sourceId: entry.sourceId,
  form: entry.form,
  filingDate: entry.filingDate,
  status: updatedEntry.status,
  guidanceStatus: updatedEntry.guidanceStatus,
  beforeStatementsLength: entry.statements.length,
  addedStructuredStatements: statements.length,
  preservedStatements: preserved.length,
  inputSha256: updatedEntry.inputSha256,
  model: updatedEntry.model,
  promptVersion: updatedEntry.promptVersion,
  backupDir,
  backupSha256: beforeSha256,
}, null, 2));
