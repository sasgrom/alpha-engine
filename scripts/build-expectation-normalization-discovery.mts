import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCohortEntries, type CohortResultEntry } from "../worker/lib/cohort-checkpoint";
import {
  discoverExpectationStatement,
  EXPECTATION_NORMALIZATION_VERSION,
  expectationEvidenceSha256,
  expectationStatementKey,
  type ExpectationReviewItem,
} from "../worker/lib/expectation-normalization-rules";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const universePath = path.resolve(arg("--universe") ?? "worker/research-universe-50.json");
const out = path.resolve(arg("--out") ?? "research/expectation-normalization-discovery-v2.json");
const companies = JSON.parse(readFileSync(universePath, "utf8")) as { cik: number; ticker: string }[];
const entries = companies.flatMap((company) => readCohortEntries(path.resolve("worker/cache/edgar", String(company.cik))));

interface OtherMetricRow {
  metricRaw: string;
  count: number;
  examples: { ticker: string; accessionNo: string; statementKey: string; evidenceSha256: string }[];
}

const otherMetrics = new Map<string, OtherMetricRow>();
const reviewQueue: ExpectationReviewItem[] = [];
const perCompany = companies.map((company) => {
  const companyEntries = entries.filter((entry) => entry.cik === company.cik);
  let statements = 0;
  const reviewCounts: Record<string, number> = {};
  for (const entry of companyEntries) {
    statements += entry.statements.length;
    for (const statement of entry.statements) {
      if (statement.metric === "other") {
        const key = statement.metricRaw.trim().replace(/\s+/g, " ");
        const row = otherMetrics.get(key) ?? { metricRaw: key, count: 0, examples: [] };
        row.count++;
        if (row.examples.length < 5) row.examples.push({
          ticker: company.ticker,
          accessionNo: entry.accessionNo,
          statementKey: expectationStatementKey(statement),
          evidenceSha256: expectationEvidenceSha256(statement),
        });
        otherMetrics.set(key, row);
      }
      const reviews = discoverExpectationStatement(statement, { ticker: company.ticker, cik: company.cik, accessionNo: entry.accessionNo });
      for (const review of reviews) {
        reviewQueue.push(review);
        reviewCounts[review.category] = (reviewCounts[review.category] ?? 0) + 1;
      }
    }
  }
  return {
    ...company,
    documents: companyEntries.length,
    statements,
    reviewCounts,
    reviewItems: Object.values(reviewCounts).reduce((sum, count) => sum + count, 0),
  };
});

const categoryCounts: Record<string, number> = { value_unit_scale: 0, qualifier_evidence: 0, combined_basis: 0, revision_language: 0, non_disclosure: 0 };
const ruleCounts: Record<string, number> = {};
for (const review of reviewQueue) {
  categoryCounts[review.category] = (categoryCounts[review.category] ?? 0) + 1;
  ruleCounts[review.ruleId] = (ruleCounts[review.ruleId] ?? 0) + 1;
}
const report = {
  schemaVersion: 1,
  normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
  generatedAt: new Date().toISOString(),
  universe: { companies: companies.length, uniqueCiks: new Set(companies.map((company) => company.cik)).size },
  totals: {
    documents: entries.length,
    statements: entries.reduce((sum: number, entry: CohortResultEntry) => sum + entry.statements.length, 0),
    otherStatements: entries.reduce((sum, entry) => sum + entry.statements.filter((statement) => statement.metric === "other").length, 0),
    reviewItems: reviewQueue.length,
  },
  categoryCounts,
  ruleCounts,
  topOtherMetricRaw: [...otherMetrics.values()].sort((a, b) => b.count - a.count || a.metricRaw.localeCompare(b.metricRaw)).slice(0, 100),
  perCompany,
  reviewQueue,
};
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  out,
  universe: report.universe,
  totals: report.totals,
  categoryCounts,
  topOtherMetricRaw: report.topOtherMetricRaw.slice(0, 20).map((row) => ({ metricRaw: row.metricRaw, count: row.count })),
  thinCompanies: perCompany.filter((company) => company.documents <= 4).map((company) => ({ ticker: company.ticker, documents: company.documents, statements: company.statements })),
}, null, 2));
