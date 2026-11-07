/** Fundamentals research-readiness QA: coverage, PIT integrity and independent Statements checks. */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { companies, facts, factorPoints, seriesPoints } from "@db/schema";
import { buildFundamentalIntegrityReport, type FundamentalFactRow, type FundamentalFactorRow, type FundamentalSeriesRow, type IntegrityIssue } from "../api/services/fundamental-integrity";
import { isFinancialStatementFactForm } from "../api/services/series";
import { buildStatements } from "../api/services/statements";
import { auditStatementView, factorReadiness, RESEARCH_FACTOR_CONCEPTS } from "../api/services/research-readiness";
import { FACTOR_META } from "../api/services/factor-meta";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const universeFile = arg("--universe") ?? "research-universe-50.json";
const universe = loadEdgarUniverse(universeFile);
const strict = process.argv.includes("--strict");
const out = arg("--out");
const db = getDb();
const prog = startProgress("fundamentals-readiness", `${universe.length} companies · read-only QA`);
const hash = crypto.createHash("sha256");
const allFacts: FundamentalFactRow[] = [], allSeries: FundamentalSeriesRow[] = [], allFactors: FundamentalFactorRow[] = [];
const companyReports = [];
const registered = new Set((await db.select({ cik: companies.cik }).from(companies)).map((row) => row.cik));
for (const [index, company] of universe.entries()) {
  const conceptFilter = inArray(facts.concept, [...RESEARCH_FACTOR_CONCEPTS]);
  const [factRows, seriesRows, factorRows, metadata] = await Promise.all([
    db.select().from(facts).where(and(eq(facts.cik, company.cik), conceptFilter)),
    db.select().from(seriesPoints).where(and(eq(seriesPoints.cik, company.cik), inArray(seriesPoints.concept, [...RESEARCH_FACTOR_CONCEPTS]))),
    db.select().from(factorPoints).where(eq(factorPoints.cik, company.cik)),
    db.select().from(companies).where(eq(companies.cik, company.cik)).limit(1),
  ]);
  const eligibleFacts = factRows.filter((row) => isFinancialStatementFactForm(row.form));
  eligibleFacts.sort((a, b) => a.concept.localeCompare(b.concept) || (a.endDate ?? "").localeCompare(b.endDate ?? "") || (a.filed ?? "").localeCompare(b.filed ?? "") || (a.accn ?? "").localeCompare(b.accn ?? "") || a.id - b.id);
  seriesRows.sort((a, b) => a.concept.localeCompare(b.concept) || a.periodEnd.localeCompare(b.periodEnd) || a.vintage.localeCompare(b.vintage) || a.id - b.id);
  factorRows.sort((a, b) => a.factor.localeCompare(b.factor) || a.periodEnd.localeCompare(b.periodEnd) || a.id - b.id);
  hash.update(JSON.stringify(eligibleFacts));
  hash.update(JSON.stringify(seriesRows));
  hash.update(JSON.stringify(factorRows));
  allFacts.push(...eligibleFacts);
  allSeries.push(...seriesRows);
  allFactors.push(...factorRows);
  const view = buildStatements({ points: seriesRows, fyEnd: metadata[0]?.fiscalYearEnd ?? null, mode: "quarterly", vintage: "latest", periods: 20 });
  const statementAudit = auditStatementView(view, seriesRows);
  const active = factorRows.filter((row) => row.value !== null);
  companyReports.push({
    cik: company.cik,
    ticker: company.ticker,
    registered: registered.has(company.cik),
    facts: eligibleFacts.length,
    series: seriesRows.length,
    factorPoints: active.length,
    retiredFactorPoints: factorRows.length - active.length,
    materializedFactors: new Set(active.map((row) => row.factor)).size,
    activeAvailabilityInversions: active.filter((row) => row.filedAt.slice(0, 10) < row.periodEnd).length,
    statement: statementAudit,
  });
  prog.item(index + 1, universe.length, `${company.ticker} · factors ${active.length} · statement issues ${statementAudit.issues.length}`);
}
const universeSha256 = crypto.createHash("sha256").update(JSON.stringify(universe.map((company) => company.cik).sort((a, b) => a - b))).digest("hex");
const integrity = buildFundamentalIntegrityReport({ facts: allFacts, series: allSeries, factors: allFactors, universeSha256, generatedAt: new Date().toISOString(), maxIssues: 100_000 });
const issuesByCik = new Map<number, IntegrityIssue[]>();
for (const issue of integrity.issues) issuesByCik.set(issue.cik, [...(issuesByCik.get(issue.cik) ?? []), issue]);
for (const company of companyReports) {
  const issues = issuesByCik.get(company.cik) ?? [];
  company.integrityErrors = issues.filter((issue) => issue.severity === "error").length;
  company.integrityWarnings = issues.filter((issue) => issue.severity === "warning").length;
  company.status = company.activeAvailabilityInversions > 0 || company.statement.issues.length > 0 || !company.registered
    ? "excluded"
    : company.integrityErrors > 0 || company.materializedFactors < FACTOR_META.length
      ? "limited"
      : "reviewed";
}
const activeFactors = allFactors.filter((row) => row.value !== null);
const factors = FACTOR_META.map((meta) => {
  const rows = activeFactors.filter((row) => row.factor === meta.key);
  const companies = new Set(rows.map((row) => row.cik));
  const readiness = factorReadiness({ points: rows.length, companies: companies.size });
  return {
    key: meta.key,
    points: rows.length,
    companies: companies.size,
    minPeriod: rows.map((row) => row.periodEnd).sort()[0] ?? null,
    maxPeriod: rows.map((row) => row.periodEnd).sort().at(-1) ?? null,
    readiness,
    reason: readiness === "not_evaluated" ? "No active factor points; not included in the pilot" : `${rows.length} active points / ${companies.size} companies`,
  };
});
const statementIssues = companyReports.reduce((total, company) => total + company.statement.issues.length, 0);
const activeInversions = activeFactors.filter((row) => row.filedAt.slice(0, 10) < row.periodEnd).length;
const legacyNullInversions = allFactors.filter((row) => row.value === null && row.filedAt.slice(0, 10) < row.periodEnd).length;
const summary = {
  companies: companyReports.length,
  registeredFactors: FACTOR_META.length,
  materializedFactors: factors.filter((factor) => factor.points > 0).length,
  activeFactorPoints: activeFactors.length,
  retiredFactorPoints: allFactors.length - activeFactors.length,
  activeAvailabilityInversions: activeInversions,
  legacyNullAvailabilityInversions: legacyNullInversions,
  statementIssues,
  integrityErrors: integrity.summary.errors,
  integrityWarnings: integrity.summary.warnings,
  overallStatus: activeInversions === 0 && statementIssues === 0 && integrity.summary.errors === 0 ? "ready_for_methodology_review" : "partial",
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  universeFile,
  universeSha256,
  sourceDataSha256: hash.digest("hex"),
  policy: {
    noNewFactors: true,
    noModelEvaluation: true,
    tombstonesExcludedFromCoverage: true,
    readinessIsNotInvestmentAdvice: true,
    expectationsRemainSeparate: true,
  },
  summary,
  factors,
  companies: companyReports,
  integrity: {
    status: integrity.status,
    summary: integrity.summary,
    issues: integrity.issues,
  },
};
const jsonPath = path.resolve(out ?? "public/reports/fundamentals-research-readiness.json");
writeJsonAtomic(jsonPath, report, true);
const lines = [
  "# Fundamentals research readiness",
  "",
  `Generated: ${report.generatedAt}`,
  `Universe: ${universeFile} · ${universeSha256}`,
  `Overall: **${summary.overallStatus}**`,
  "",
  "Mechanical data QA only. No factor IC, OLS, Bayes or model promotion. NULL tombstones are excluded from research coverage and remain preserved in the database.",
  "",
  `- Companies: ${summary.companies}`,
  `- Active factor points: ${summary.activeFactorPoints}; retired NULL points: ${summary.retiredFactorPoints}`,
  `- Materialized factors: ${summary.materializedFactors}/${summary.registeredFactors}`,
  `- Active availability inversions: ${summary.activeAvailabilityInversions}; preserved NULL inversions: ${summary.legacyNullAvailabilityInversions}`,
  `- Independent netDebt/ROE/ROA issues: ${summary.statementIssues}`,
  `- Integrity errors / warnings: ${summary.integrityErrors} / ${summary.integrityWarnings}`,
  `- Source data SHA256: ${report.sourceDataSha256}`,
  "",
  "## Factor coverage",
  "",
  "| Factor | Readiness | Active points | Companies | First period | Last period |",
  "|---|---|---:|---:|---|---|",
  ...factors.map((factor) => `| ${factor.key} | ${factor.readiness} | ${factor.points} | ${factor.companies} | ${factor.minPeriod ?? "—"} | ${factor.maxPeriod ?? "—"} |`),
  "",
  "## Company readiness",
  "",
  "| Ticker | Status | Facts | Series | Active factors | Active factor points | Statement issues | Integrity errors |",
  "|---|---|---:|---:|---:|---:|---:|---:|",
  ...companyReports.map((company) => `| ${company.ticker} | ${company.status} | ${company.facts} | ${company.series} | ${company.materializedFactors} | ${company.factorPoints} | ${company.statement.issues.length} | ${company.integrityErrors} |`),
  "",
  "## First integrity issues",
  "",
  ...integrity.issues.slice(0, 100).map((issue) => `- **${issue.severity.toUpperCase()}** ${issue.type} · CIK ${issue.cik}${issue.concept ? ` · ${issue.concept}` : ""}${issue.periodEnd ? ` · ${issue.periodEnd}` : ""} — ${issue.message}`),
];
writeJsonAtomic(jsonPath.replace(/\.json$/i, ".md"), `${lines.join("\n")}\n`, true);
if (!out && fs.existsSync("dist/public/reports")) {
  writeJsonAtomic(path.join("dist/public/reports", "fundamentals-research-readiness.json"), report, true);
  writeJsonAtomic(path.join("dist/public/reports", "fundamentals-research-readiness.md"), `${lines.join("\n")}\n`, true);
}
prog.done(`${summary.overallStatus} · active inversions ${activeInversions} · statement issues ${statementIssues} · integrity errors ${integrity.summary.errors} · ${jsonPath}`);
process.exit(strict && (activeInversions > 0 || statementIssues > 0 || integrity.summary.errors > 0) ? 1 : 0);
