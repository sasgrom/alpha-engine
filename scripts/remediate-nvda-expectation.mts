import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCohortEntries, readCohortResult, writeCohortEntryAtomic, writeCohortResultSnapshot } from "../worker/lib/cohort-checkpoint";
import { cohortSourceText, type CohortPack } from "../worker/lib/cohort-pack";
import { remediateExpectationStatements } from "../worker/lib/expectation-remediation";

const accessionNo = "0001045810-26-000073";
const cacheDir = path.resolve("worker/cache/edgar/1045810");
const pack = JSON.parse(readFileSync(path.join(cacheDir, "cohort-pack-v2.json"), "utf8")) as CohortPack;
const result = readCohortResult(cacheDir, {
  schemaVersion: pack.schemaVersion,
  contextTokens: pack.contextTokens,
  packGeneratedAt: pack.generatedAt,
  unpacked: pack.unpacked,
});
if (!result) throw new Error("NVDA cohort result is missing");
const entry = result.entries.find((item) => item.accessionNo === accessionNo);
if (!entry) throw new Error("NVDA benchmark entry is missing");
const container = pack.containers.find((item) => item.containerId === entry.containerId);
if (!container) throw new Error("NVDA source container is missing");
const sourceText = cohortSourceText(container, entry.sourceId);
if (!sourceText) throw new Error("NVDA exact target source text is missing");
const { statements, changes } = remediateExpectationStatements(entry.statements, sourceText);
if (changes.length === 0) throw new Error("No proven NVDA remediation is required");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.resolve("worker/.runs", `expectation-remediation-nvda-${stamp}`);
mkdirSync(backupDir, { recursive: true });
const beforeText = readFileSync(path.join(cacheDir, "cohort-v2.json"));
writeFileSync(path.join(backupDir, "cohort-v2.json"), beforeText);
const beforeSha256 = createHash("sha256").update(beforeText).digest("hex");
const updatedEntry = { ...entry, statements, updatedAt: new Date().toISOString() };
writeCohortEntryAtomic(cacheDir, updatedEntry);
const mergedEntries = readCohortEntries(cacheDir);
writeCohortResultSnapshot(cacheDir, { ...result, entries: mergedEntries });
console.log(JSON.stringify({
  accessionNo,
  sourceId: entry.sourceId,
  form: entry.form,
  filingDate: entry.filingDate,
  status: updatedEntry.status,
  guidanceStatus: updatedEntry.guidanceStatus,
  beforeStatementsLength: entry.statements.length,
  afterStatementsLength: statements.length,
  inputSha256: updatedEntry.inputSha256,
  model: updatedEntry.model,
  promptVersion: updatedEntry.promptVersion,
  backupDir,
  backupSha256: beforeSha256,
  changes,
}, null, 2));
