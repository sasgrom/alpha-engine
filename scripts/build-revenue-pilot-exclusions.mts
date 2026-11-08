/** Build a draft exclusion map and methodology protocol without evaluating any model. */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { buildRevenueExclusionMap } from "../api/services/revenue-pilot-exclusions";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const sourcePath = path.resolve(arg("--source") ?? "public/reports/fundamentals-research-readiness.json");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const source = JSON.parse(sourceText);
const map = buildRevenueExclusionMap(source.integrity.issues);
const generatedAt = new Date().toISOString();
const sourceSha256 = crypto.createHash("sha256").update(sourceText).digest("hex");
const companies = new Map<number, { cik: number; hardExclusions: number; continuityExclusions: number; reviewRequired: number }>();
for (const cik of new Set(source.integrity.issues.map((issue: any) => issue.cik))) companies.set(cik, { cik, hardExclusions: 0, continuityExclusions: 0, reviewRequired: 0 });
for (const row of map.hardExclusions) companies.get(row.cik)!.hardExclusions++;
for (const row of map.continuityExclusions) companies.get(row.cik)!.continuityExclusions++;
for (const row of map.reviewRequired) companies.get(row.cik)!.reviewRequired++;
const output = {
  ...map,
  generatedAt,
  sourceReport: path.relative(process.cwd(), sourcePath),
  sourceReportSha256: sourceSha256,
  sourceDataSha256: source.sourceDataSha256,
  summary: {
    companies: companies.size,
    hardExclusions: map.hardExclusions.length,
    continuityExclusions: map.continuityExclusions.length,
    reviewRequired: map.reviewRequired.length,
    activeFactorPoints: source.summary.activeFactorPoints,
    activeAvailabilityInversions: source.summary.activeAvailabilityInversions,
    statementIssues: source.summary.statementIssues,
  },
  companies: [...companies.values()].sort((a, b) => a.cik - b.cik),
  policy: {
    exactFactsNotWholeCompanies: true,
    ttmWindowsNotObservedValuesDeleted: true,
    nullTombstonesExcluded: true,
    warningsRequireReviewNotAutomaticDeletion: true,
    noModelEvaluated: true,
    targetNotSelected: true,
  },
};
const jsonPath = path.resolve(arg("--json-out") ?? "research/revenue-pilot-exclusions.json");
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
writeJsonAtomic(jsonPath, output, true);
const markdownPath = path.resolve(arg("--md-out") ?? "docs/REVENUE_PILOT_EXCLUSIONS.md");
const lines = [
  "# Revenue pilot — exclusion map (draft)",
  "",
  `Generated: ${generatedAt}`,
  `Source report: ${output.sourceReport}`,
  `Source report SHA256: ${sourceSha256}`,
  "",
  "This map is **not training data and not a model decision**. Exact invalid facts are excluded, while continuity gaps exclude only the affected TTM windows. Companies and concepts are not deleted or imputed. `NULL` tombstones remain outside coverage. Warnings require review and are not automatic exclusions.",
  "",
  `- Hard exact-fact exclusions: ${map.hardExclusions.length}`,
  `- Missing-quarter/TTM exclusions: ${map.continuityExclusions.length}`,
  `- Review-required warnings: ${map.reviewRequired.length}`,
  `- Active availability inversions: ${output.summary.activeAvailabilityInversions}`,
  `- Independent netDebt/ROE/ROA issues: ${output.summary.statementIssues}`,
  "",
  "## Hard exclusions",
  "",
  "| CIK | Concept | Period | Type | Accession | Reason |",
  "|---:|---|---|---|---|---|",
  ...map.hardExclusions.map((row) => `| ${row.cik} | ${row.concept} | ${row.periodEnd} | ${row.issueType} | ${row.accessionNo ?? "—"} | ${row.reason} |`),
  "",
  "## Continuity exclusions",
  "",
  "| CIK | Concept | Missing quarter | Excluded TTM anchor quarters | Reported at |",
  "|---:|---|---|---|---|",
  ...map.continuityExclusions.map((row) => `| ${row.cik} | ${row.concept} | ${row.missingQuarter} | ${row.excludedAnchorQuarters.join(", ")} | ${row.reportedAt.join(", ")} |`),
  "",
  "## Review required",
  "",
  ...map.reviewRequired.map((row) => `- CIK ${row.cik}${row.concept ? ` · ${row.concept}` : ""}${row.periodEnd ? ` · ${row.periodEnd}` : ""} · ${row.issueType} — ${row.message}`),
];
writeJsonAtomic(markdownPath, `${lines.join("\n")}\n`, true);
console.log(JSON.stringify({ jsonPath, markdownPath, summary: output.summary }, null, 2));
