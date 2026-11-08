import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCohortEntries } from "../worker/lib/cohort-checkpoint";
import { assertExpectationNormalizationAudit, normalizeExpectationStatement, type ExpectationNormalizationAudit } from "../worker/lib/expectation-normalization";
import { EXPECTATION_DEVELOPMENT_TICKERS, EXPECTATION_HOLDOUT_TICKERS, EXPECTATION_NORMALIZATION_VERSION, type ExpectationReviewItem } from "../worker/lib/expectation-normalization-rules";

const DEVELOPMENT = new Set(EXPECTATION_DEVELOPMENT_TICKERS);
const HOLDOUT = new Set(EXPECTATION_HOLDOUT_TICKERS);
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const universePath = path.resolve(arg("--universe") ?? "worker/research-universe-50.json");
const out = path.resolve(arg("--out") ?? "research/expectation-normalization-postprocessing-v2.json");
const companies = JSON.parse(readFileSync(universePath, "utf8")) as { cik: number; ticker: string }[];
const entries = companies.flatMap((company) => readCohortEntries(path.resolve("worker/cache/edgar", String(company.cik))));
const audit: ExpectationNormalizationAudit[] = [];
const reviewQueue: ExpectationReviewItem[] = [];
const unmapped = new Map<string, number>();
const perCompany = companies.map((company) => {
  const companyEntries = entries.filter((entry) => entry.cik === company.cik);
  let inputStatements = 0;
  let outputStatements = 0;
  let auditRecords = 0;
  let numericChanges = 0;
  let reviewItems = 0;
  for (const entry of companyEntries) {
    for (const statement of entry.statements) {
      inputStatements++;
      const result = normalizeExpectationStatement(statement, { ticker: company.ticker, cik: company.cik, accessionNo: entry.accessionNo });
      outputStatements += result.statements.length;
      audit.push(...result.audit);
      reviewQueue.push(...result.review);
      auditRecords += result.audit.length;
      numericChanges += result.audit.filter((item) => item.numericChange).length;
      reviewItems += result.review.length;
      for (const item of result.statements.filter((candidate) => candidate.canonicalMetric === "other.unmapped")) {
        unmapped.set(item.metricRaw, (unmapped.get(item.metricRaw) ?? 0) + 1);
      }
    }
  }
  return {
    ...company,
    partition: HOLDOUT.has(company.ticker) ? "holdout" : DEVELOPMENT.has(company.ticker) ? "development" : "discovery",
    documents: companyEntries.length,
    inputStatements,
    outputStatements,
    auditRecords,
    numericChanges,
    reviewItems,
  };
});
const summarize = (tickers: Set<string>) => {
  const rows = perCompany.filter((company) => tickers.has(company.ticker));
  return {
    tickers: rows.map((row) => row.ticker),
    companies: rows.length,
    documents: rows.reduce((sum, row) => sum + row.documents, 0),
    inputStatements: rows.reduce((sum, row) => sum + row.inputStatements, 0),
    outputStatements: rows.reduce((sum, row) => sum + row.outputStatements, 0),
    auditRecords: rows.reduce((sum, row) => sum + row.auditRecords, 0),
    numericChanges: rows.reduce((sum, row) => sum + row.numericChanges, 0),
    reviewItems: rows.reduce((sum, row) => sum + row.reviewItems, 0),
  };
};
assertExpectationNormalizationAudit(audit);
const ruleCounts: Record<string, number> = {};
for (const item of audit) ruleCounts[item.ruleId] = (ruleCounts[item.ruleId] ?? 0) + 1;
const reviewCategoryCounts: Record<string, number> = {};
for (const item of reviewQueue) reviewCategoryCounts[item.category] = (reviewCategoryCounts[item.category] ?? 0) + 1;
const report = {
  schemaVersion: 1,
  normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
  generatedAt: new Date().toISOString(),
  productionApply: false,
  checkpointsModified: false,
  rawModelOutputIncluded: false,
  totals: {
    companies: companies.length,
    documents: entries.length,
    inputStatements: perCompany.reduce((sum, row) => sum + row.inputStatements, 0),
    outputStatements: perCompany.reduce((sum, row) => sum + row.outputStatements, 0),
    auditRecords: audit.length,
    numericChanges: audit.filter((item) => item.numericChange).length,
    reviewItems: reviewQueue.length,
    canonicalMapped: perCompany.reduce((sum, row) => sum + row.outputStatements, 0) - reviewQueue.filter((item) => item.ruleId === "REVIEW_UNMAPPED_METRIC").length,
    unmapped: reviewQueue.filter((item) => item.ruleId === "REVIEW_UNMAPPED_METRIC").length,
  },
  development: summarize(DEVELOPMENT),
  holdout: summarize(HOLDOUT),
  ruleCounts,
  reviewCategoryCounts,
  topUnmappedMetricRaw: [...unmapped.entries()].map(([metricRaw, count]) => ({ metricRaw, count })).sort((a, b) => b.count - a.count || a.metricRaw.localeCompare(b.metricRaw)).slice(0, 100),
  perCompany,
  audit,
  reviewQueue,
};
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ out, totals: report.totals, development: report.development, holdout: report.holdout, ruleCounts, reviewCategoryCounts, topUnmappedMetricRaw: report.topUnmappedMetricRaw.slice(0, 20) }, null, 2));
