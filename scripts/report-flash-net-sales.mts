import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { findNetSalesIdentity } from "../worker/lib/flash-net-sales";
import type { ProcessReleaseResult, ValueRecord } from "../worker/lib/flash-pipeline";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/engine/flash-r1000");
const extract = path.resolve(arg("--extract") ?? path.join(root, "flash-quarter-r1000.jsonl"));
const output = path.resolve(arg("--output") ?? "D:/research/alpha-engine/engine/checks/k28-net-sales.json");
if (!/^d:/i.test(realpathSync(root)) || !/^d:/i.test(path.parse(output).root)) throw new Error("Flash input and report must stay on D:");
if (!existsSync(extract)) throw new Error(`Flash extract is missing: ${extract}`);
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const rows: any[] = [];
for (const line of readFileSync(extract, "utf8").split(/\r?\n/).filter(Boolean)) {
  const quarter = JSON.parse(line);
  if (typeof quarter.revenue !== "number" || !quarter.revenueEvidence?.source) continue;
  const cacheFile = path.join(root, "releases", String(quarter.cik), `${quarter.accession}.json`);
  const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as { result: ProcessReleaseResult };
  const source = quarter.revenueEvidence.source;
  const gross = cached.result.values.find(value => value.source.file === source.file && value.source.tableIndex === source.tableIndex && value.source.rowIndex === source.rowIndex && value.source.columnIndex === source.columnIndex);
  if (!gross) throw new Error(`Selected revenue value is missing from ${cacheFile}`);
  const identity = findNetSalesIdentity(cached.result.values, gross);
  if (!identity) continue;
  const grade = cached.result.grades.find(row => row.valueId === gross.valueId);
  rows.push({
    cik: quarter.cik,
    ticker: quarter.ticker,
    accession: quarter.accession,
    periodEnd: quarter.periodEnd,
    selectedGrade: quarter.revenueGrade,
    gross: gross.value,
    excise: identity.excise.value,
    net: identity.net.value,
    factValue: grade?.factValue ?? null,
    statementTitle: cached.result.statements.find(row => row.statement === gross.statement)?.title ?? null,
    labels: { gross: gross.rowLabel, excise: identity.excise.rowLabel, net: identity.net.rowLabel },
    source: gross.source,
    valueIds: { gross: gross.valueId, excise: identity.excise.valueId, net: identity.net.valueId },
  });
}
const watched = ["TAP", "STZ", "BF", "BF.A", "BF.B", "MO", "PM"];
const byCompany = Object.fromEntries([...new Set(rows.map(row => row.ticker))].sort().map(ticker => {
  const company = rows.filter(row => row.ticker === ticker);
  return [ticker, { identities: company.length, selectedMismatches: company.filter(row => row.selectedGrade === "mismatch").length, selectedMatches: company.filter(row => row.selectedGrade === "match").length }];
}));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rule: "Selected current non-instant Sales and same-table/current/period Net sales and excise-tax rows; Sales - abs(excise) = Net sales exactly",
  inputs: [extract, path.join(root, "manifest.json")].map(file => ({ file, bytes: statSync(file).size, sha256: hash(file) })),
  releases: readFileSync(extract, "utf8").split(/\r?\n/).filter(Boolean).length,
  identities: rows.length,
  selectedMismatches: rows.filter(row => row.selectedGrade === "mismatch").length,
  selectedMatches: rows.filter(row => row.selectedGrade === "match").length,
  otherGrades: rows.filter(row => row.selectedGrade !== "mismatch" && row.selectedGrade !== "match").length,
  watchedTickers: watched,
  watchedIdentities: rows.filter(row => watched.includes(row.ticker)).length,
  byCompany,
  rows,
};
writeJsonAtomic(output, report, true);
console.log(JSON.stringify({ output, releases: report.releases, identities: report.identities, selectedMismatches: report.selectedMismatches, watchedIdentities: report.watchedIdentities, byCompany }, null, 1));
