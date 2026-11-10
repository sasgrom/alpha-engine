/** Fail-closed fundamental integrity and continuity audit. No writes to the database. */
import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { companies, facts, seriesPoints, factorPoints } from "@db/schema";
import { buildFundamentalIntegrityReport, type FundamentalFactRow, type FundamentalSeriesRow, type FundamentalFactorRow, type IntegrityIssue } from "../api/services/fundamental-integrity";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { startProgress } from "../worker/lib/progress";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const universeFile = arg("--universe") ?? "research-universe-50.json";
const only = arg("--only")?.toUpperCase() ?? null;
const strict = process.argv.includes("--strict");
const maxIssues = Number(arg("--max-issues") ?? 10_000);
if (!Number.isInteger(maxIssues) || maxIssues < 100 || maxIssues > 100_000) throw new Error("--max-issues must be between 100 and 100000");
const universe = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universe.length) throw new Error(`Unknown ticker ${only}`);
const universeSha256 = createHash("sha256").update(JSON.stringify(universe.map((company) => company.cik).sort((a, b) => a - b))).digest("hex");
const prog = startProgress("fundamental-integrity", `read-only audit · ${universeFile}${strict ? " · strict" : ""}`);
const db = getDb();
const registered = new Set((await db.select({ cik: companies.cik }).from(companies)).map((row) => row.cik));
const allFacts: FundamentalFactRow[] = [], allSeries: FundamentalSeriesRow[] = [], allFactors: FundamentalFactorRow[] = [];
const orphanIssues: IntegrityIssue[] = [];
for (const [index, company] of universe.entries()) {
  if (!registered.has(company.cik)) orphanIssues.push({ severity: "error", type: "orphan_cik", cik: company.cik, message: `${company.ticker} is absent from companies registry` });
  const [factRows, seriesRows, factorRows] = await Promise.all([
    db.select().from(facts).where(eq(facts.cik, company.cik)),
    db.select().from(seriesPoints).where(eq(seriesPoints.cik, company.cik)),
    db.select().from(factorPoints).where(eq(factorPoints.cik, company.cik)),
  ]);
  factRows.sort((a, b) => a.concept.localeCompare(b.concept) || (a.endDate ?? "").localeCompare(b.endDate ?? "") || (a.filed ?? "").localeCompare(b.filed ?? "") || (a.accn ?? "").localeCompare(b.accn ?? "") || a.id - b.id);
  seriesRows.sort((a, b) => a.concept.localeCompare(b.concept) || a.periodEnd.localeCompare(b.periodEnd) || a.vintage.localeCompare(b.vintage) || a.id - b.id);
  factorRows.sort((a, b) => a.factor.localeCompare(b.factor) || a.periodEnd.localeCompare(b.periodEnd) || a.id - b.id);
  allFacts.push(...factRows);
  allSeries.push(...seriesRows);
  allFactors.push(...factorRows);
  prog.item(index + 1, universe.length, `${company.ticker} facts ${factRows.length} · series ${seriesRows.length} · factors ${factorRows.length}`);
}
const report = buildFundamentalIntegrityReport({ facts: allFacts, series: allSeries, factors: allFactors, universeSha256, generatedAt: new Date().toISOString(), maxIssues });
report.issues.unshift(...orphanIssues);
report.summary.errors += orphanIssues.length;
if (orphanIssues.length) report.status = "fail";
const jsonPath = path.resolve("public/reports/fundamental-integrity.json");
writeJsonAtomic(jsonPath, report, true);
const distRoot = path.resolve("dist/public/reports");
const distDir = path.dirname(distRoot);
if (existsSync(distDir)) writeJsonAtomic(path.join(distRoot, "fundamental-integrity.json"), report, true);
const top = report.issues.slice(0, 100);
const lines = [
  "# Fundamental integrity and continuity audit",
  "",
  `Generated: ${report.generatedAt}`,
  `Universe SHA256: ${universeSha256}`,
  `Status: ${report.status.toUpperCase()}`,
  "",
  `- CIKs: ${report.summary.ciks}`,
  `- Facts: ${report.summary.facts}`,
  `- Series points: ${report.summary.series}`,
  `- Factor points: ${report.summary.factors}`,
  `- Errors: ${report.summary.errors}`,
  `- Warnings: ${report.summary.warnings}`,
  `- Duplicate facts/series/factors: ${report.summary.duplicates}`,
  `- Continuity gaps: ${report.summary.continuityGaps}`,
  `- Availability inversions: ${report.summary.availabilityInversions}`,
  `- Concept coverage gaps: ${report.summary.coverageGaps}`,
  `- Omitted issues beyond display cap: ${report.summary.omittedIssues}`,
  "",
  "No rows were modified. Exact duplicates, frame conflicts, unit conflicts, availability inversions and factor-before-fact are errors. Missing concept groups, unit changes, irregular durations, revision outliers and annual-only cadence gaps are warnings. Annual-only concepts are not forced onto a quarterly grid or imputed.",
  "",
  "## First issues",
  "",
];
for (const issue of top) lines.push(`- **${issue.severity.toUpperCase()}** ${issue.type} · CIK ${issue.cik}${issue.concept ? ` · ${issue.concept}` : ""}${issue.periodEnd ? ` · ${issue.periodEnd}` : ""} — ${issue.message}${issue.accessionNo ? ` (${issue.accessionNo})` : ""}`);
writeJsonAtomic(path.resolve("public/reports/fundamental-integrity.md"), `${lines.join("\n")}\n`, true);
if (existsSync(distDir)) writeJsonAtomic(path.join(distRoot, "fundamental-integrity.md"), `${lines.join("\n")}\n`, true);
prog.done(`${report.status.toUpperCase()} · errors ${report.summary.errors} · warnings ${report.summary.warnings} · report ${jsonPath}`);
process.exit(strict && report.summary.errors > 0 ? 1 : 0);
