import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCohortEntries, readCohortResult, writeCohortEntryAtomic, writeCohortResultSnapshot } from "../worker/lib/cohort-checkpoint";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const qaPath = arg("--qa");
if (!qaPath) throw new Error("--qa <cohort-qa-report.json> is required");
const report = JSON.parse(readFileSync(qaPath, "utf8")) as { cik: number; ticker: string; issues: { type: string; sourceId: string; containerId: string }[] };
const issues = report.issues.filter((issue) => issue.type === "found_without_statements");
const cacheDir = path.resolve("worker/cache/edgar", String(report.cik));
const result = readCohortResult(cacheDir);
if (!result) throw new Error(`${report.ticker}: cohort result is missing`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.resolve("worker/.runs/cohort-qa-remediation", `${report.ticker}-${stamp}`);
mkdirSync(backupDir, { recursive: true });
let updated = 0;
for (const issue of issues) {
  const entry = result.entries.find((candidate) => candidate.sourceId === issue.sourceId && candidate.containerId === issue.containerId);
  if (!entry) throw new Error(`Missing checkpoint ${issue.containerId}/${issue.sourceId}`);
  if (entry.guidanceStatus !== "found" || entry.statements.length > 0) continue;
  if (entry.rejectedEvidence <= 0) throw new Error(`Cannot remediate ${issue.sourceId}: no rejected evidence was recorded`);
  const backupFile = path.join(backupDir, `${entry.sourceId.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
  writeFileSync(backupFile, `${JSON.stringify(entry, null, 2)}\n`);
  const next = {
    ...entry,
    guidanceStatus: "not_found" as const,
    extractionWarnings: [...new Set([...entry.extractionWarnings, "statements_rejected_evidence"])],
    updatedAt: new Date().toISOString(),
  };
  writeCohortEntryAtomic(cacheDir, next);
  updated++;
}
writeCohortResultSnapshot(cacheDir, { ...result, entries: readCohortEntries(cacheDir) });
console.log(JSON.stringify({ ticker: report.ticker, qa: qaPath, foundWithoutStatements: issues.length, updated, backupDir }, null, 2));
