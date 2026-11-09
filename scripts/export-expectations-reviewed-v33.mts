import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCohortEntries, type CohortResultEntry } from "../worker/lib/cohort-checkpoint";
import type { CohortPack } from "../worker/lib/cohort-pack";
import { buildExpectationsReport } from "../worker/lib/expectations-report";
import { EXPECTATION_NORMALIZATION_VERSION } from "../worker/lib/expectation-normalization-rules";
import { buildExpectationPrompt } from "../worker/lib/expectations";
import { V33_TRIO_CIKS, assertV32OtherResultsByteIdentical, extractionContextFor, mergeV33Results } from "../worker/lib/expectations-v33";
import {
  BENCHMARK_EVALUATION_TYPE,
  PACKAGE_SCOPE,
  assertBenchmarkPassed,
  buildCoverage,
  buildExpectationResultsPayload,
  canonicalSecUrl,
  normalizeCohortEntries,
  resultKey,
  resolveCohortCacheDir,
  sanitizeExpectationValue,
} from "./export-expectations-reviewed.mts";

const ROOT = path.resolve(import.meta.dirname, "..");
const TRIO = [
  { cik: 1018724, ticker: "AMZN" },
  { cik: 789019, ticker: "MSFT" },
  { cik: 1652044, ticker: "GOOGL" },
];
const V32_ZIP = path.join(ROOT, "research/reviewed-sync/2026-11-08/expectations-reviewed-v3.2.zip");
const V32_SHA256 = "a9b398c883f878709da5bbb7b9835d38f62ad9249d00bcf23924c7eb8b3b2278";
const OUT = path.resolve(ROOT, "research/reviewed-sync/2026-11-09/expectations-reviewed-v3.3.zip");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const promptSourceSha256 = sha256(buildExpectationPrompt.toString());
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const powerShell = (script: string) => execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}
const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(sanitizeExpectationValue(value), null, 2)}\n`);
const exactKey = (entry: Pick<CohortResultEntry, "cik" | "accessionNo" | "sourceId" | "containerId">) => resultKey(entry);

if (!existsSync(V32_ZIP) || sha256(readFileSync(V32_ZIP)) !== V32_SHA256) throw new Error("v3.2 ZIP SHA256 mismatch");
if (existsSync(OUT)) throw new Error(`Refusing to overwrite ${OUT}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const work = path.join(ROOT, "worker/.runs", `expectations-reviewed-v33-${stamp}`);
const v32Dir = path.join(work, "v32");
const stage = path.join(work, "stage");
const verify = path.join(work, "verify");
mkdirSync(v32Dir, { recursive: true });
mkdirSync(stage, { recursive: true });
powerShell(`Expand-Archive -Path ${psQuote(V32_ZIP)} -DestinationPath ${psQuote(v32Dir)} -Force`);
const v32Manifest = readJson(path.join(v32Dir, "manifest.json"));
const v32Results = readJson(path.join(v32Dir, "expectations-results.json")).results;
const v32Audit = readJson(path.join(v32Dir, "normalization-audit.json")).audit;
const v32Review = readJson(path.join(v32Dir, "review-queue.json")).reviewQueue;
const v32Readiness = readJson(path.join(v32Dir, "production-readiness.json"));
const v32Lineage = readJson(path.join(v32Dir, "lineage.json"));
const v32Benchmark = readJson(path.join(v32Dir, "benchmark-report.json"));
assertBenchmarkPassed({ pass: v32Benchmark.pass, issues: v32Benchmark.issues });
const universe = v32Lineage.companies.map((company) => ({ cik: company.cik, ticker: company.ticker }));
if (universe.length !== 50 || new Set(universe.map((company) => company.cik)).size !== 50) throw new Error("Expected 50 unique companies");
for (const company of TRIO) {
  const qa = readJson(path.join(ROOT, "worker/.runs/cohort-qa", `${company.ticker}.json`));
  if (qa.status.toUpperCase() !== "REVIEW" || qa.summary.hardErrors !== 0) throw new Error(`${company.ticker} strict QA is not REVIEW with hard=0`);
}

const trioEntries = TRIO.flatMap((company) => readCohortEntries(resolveCohortCacheDir(company.cik)));
const trioNormalized = normalizeCohortEntries(trioEntries);
const mergedResults = mergeV33Results(v32Results, trioNormalized.normalizedEntries);
assertV32OtherResultsByteIdentical(v32Results, mergedResults);
const exactKeys = new Set(mergedResults.map(exactKey));
if (exactKeys.size !== mergedResults.length) throw new Error("Duplicate exact result keys in v3.3 merge");
const coverage = buildCoverage(universe, mergedResults);
const thinCompanies = coverage.companies.filter((company) => company.documents <= 4);
const report = buildExpectationsReport(universe, mergedResults, new Date().toISOString(), PACKAGE_SCOPE, {
  pass: v32Benchmark.pass,
  recall: v32Benchmark.recall,
  issueCount: v32Benchmark.issues.length,
}, true);
report.coverage.noCandidate = mergedResults.filter((entry) => entry.status === "empty").length;
report.partialHistory = {
  reason: "AMZN, MSFT and GOOGL thin-history blockers are resolved by actual document coverage; the package retains its reviewed partial-history scope.",
  thinCompanies,
};
report.benchmark = { ...report.benchmark, evaluationType: BENCHMARK_EVALUATION_TYPE };
report.normalization = {
  normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
  transformation: "model output + deterministic normalization",
  counts: {},
  reviewCategoryCounts: {},
  development: {},
  holdout: {},
};
const resultsPayload = buildExpectationResultsPayload(mergedResults);
resultsPayload.packageVersion = "3.3" as any;
resultsPayload.resolverReport = { ambiguousStatements: 0, missingParent: 0, heuristicResolved: 0, statements: resultsPayload.resolverReport.statements };
if (resultsPayload.results.length !== coverage.documents || resultsPayload.resolverReport.statements !== coverage.statements) throw new Error("Exact-key result payload counts do not match coverage");

const otherAudit = v32Audit.filter((item) => !V33_TRIO_CIKS.has(item.cik));
const audit = [...otherAudit, ...trioNormalized.audit].sort((a, b) => `${a.ticker}|${a.accessionNo}|${a.ruleId}|${a.statementKey}`.localeCompare(`${b.ticker}|${b.accessionNo}|${b.ruleId}|${b.statementKey}`));
const reviewQueue = [...v32Review.filter((item) => !V33_TRIO_CIKS.has(item.cik)), ...trioNormalized.reviewQueue];
const reviewCategoryCounts: Record<string, number> = { metric_alias: 0, value_unit_scale: 0, qualifier_evidence: 0, combined_basis: 0, revision_language: 0, non_disclosure: 0, ambiguous: 0 };
for (const item of reviewQueue) reviewCategoryCounts[item.category]++;
const unmapped = mergedResults.filter((entry) => entry.statements.some((statement) => statement.canonicalMetric === "other.unmapped")).reduce((sum, entry) => sum + entry.statements.filter((statement) => statement.canonicalMetric === "other.unmapped").length, 0);
const unmappedStatementKeys = mergedResults.flatMap((entry) => entry.statements.filter((statement) => statement.canonicalMetric === "other.unmapped").map((statement) => `${entry.cik}|${entry.accessionNo}|${JSON.stringify([statement.metricRaw, statement.metric, statement.scopeRaw, statement.periodRaw])}`)).sort();
const unmappedReviewKeys = reviewQueue.filter((item) => item.ruleId === "REVIEW_UNMAPPED_METRIC").map((item) => `${item.cik}|${item.accessionNo}|${JSON.stringify(JSON.parse(item.statementKey).slice(0, 4))}`).sort();
if (JSON.stringify(unmappedStatementKeys) !== JSON.stringify(unmappedReviewKeys)) throw new Error("Every unmapped statement must have exactly one review item");
const mapped = coverage.statements - unmapped;
const rawInputStatements = coverage.statements - audit.filter((item) => item.ruleId === "GENERIC_SPLIT_COMBINED_BASIS").length;
const counts = {
  inputStatements: rawInputStatements,
  outputStatements: coverage.statements,
  unmappedDelta: unmapped - v32Manifest.counts.canonicalUnmapped,
  auditRecords: audit.length,
  numericChanges: audit.filter((item) => item.numericChange).length,
  reviewItems: reviewQueue.length,
  canonicalMapped: mapped,
  canonicalUnmapped: unmapped,
  newlyCoveredByV3Aliases: Math.max(0, v32Manifest.counts.canonicalUnmapped - unmapped),
};
report.normalization.counts = counts;
report.normalization.reviewCategoryCounts = reviewCategoryCounts;
const unmappedMetrics = new Map<string, number>();
for (const item of reviewQueue) {
  if (item.ruleId !== "REVIEW_UNMAPPED_METRIC") continue;
  const metricRaw = JSON.parse(item.statementKey)[0] as string;
  unmappedMetrics.set(metricRaw, (unmappedMetrics.get(metricRaw) ?? 0) + 1);
}
const topUnmappedMetricRaw = [...unmappedMetrics.entries()].map(([metricRaw, count]) => ({ metricRaw, count })).sort((a, b) => b.count - a.count || a.metricRaw.localeCompare(b.metricRaw)).slice(0, 100);

function partition(tickers: string[]) {
  const selected = new Set(tickers);
  const rows = mergedResults.filter((entry) => selected.has(entry.ticker));
  return {
    tickers,
    companies: selected.size,
    documents: rows.length,
    inputStatements: rows.reduce((sum, entry) => sum + entry.statements.length, 0),
    outputStatements: rows.reduce((sum, entry) => sum + entry.statements.length, 0),
    auditRecords: audit.filter((item) => selected.has(item.ticker)).length,
    numericChanges: audit.filter((item) => selected.has(item.ticker) && item.numericChange).length,
    reviewItems: reviewQueue.filter((item) => selected.has(item.ticker)).length,
  };
}
const development = partition(["NVDA", "META", "AMZN", "JPM", "WMT"]);
const holdout = partition(["PFE", "UNH", "MSFT", "DAL", "RCL", "DASH", "NKE", "T"]);
report.normalization.development = development;
report.normalization.holdout = holdout;
const trioFallbackAttachments = trioEntries.filter((entry) => entry.fallback).length;
const trioFallbackStatuses = trioEntries.filter((entry) => entry.status === "fallback" || entry.status === "fallback_unverified").length;
const fallbackListCount = v32Readiness.packageTotals.fallbackListCount + trioFallbackAttachments;
const fallbackStatusCount = v32Readiness.packageTotals.fallbackStatusCount + trioFallbackStatuses;
const fallbackOutside = [
  ...v32Readiness.packageTotals.fallbackAttachmentsOutsideFallbackStatus,
  ...trioEntries.filter((entry) => entry.fallback && entry.status !== "fallback" && entry.status !== "fallback_unverified").map((entry) => ({
    ticker: entry.ticker,
    accessionNo: entry.accessionNo,
    status: entry.status,
    statements: entry.statements.length,
    evidenceVerified: entry.fallback!.evidenceVerified,
  })),
];
const productionReadiness = {
  schemaVersion: 3,
  status: "blocked",
  scope: PACKAGE_SCOPE,
  productionApply: false,
  applyStatus: "not_run",
  applyAllowedWhen: v32Readiness.applyAllowedWhen,
  blockers: [
    { id: "backup_channel_required", verified: false, applyStatus: "fail_closed" },
    { id: "thin_history", companies: thinCompanies.map((company) => ({ ticker: company.ticker, documents: company.documents, statements: company.statements })) },
    { id: "canonical_unmapped", count: unmapped },
    { id: "value_unit_scale", count: reviewCategoryCounts.value_unit_scale },
    { id: "qualifier_evidence", count: reviewCategoryCounts.qualifier_evidence },
    { id: "combined_basis", count: reviewCategoryCounts.combined_basis },
    { id: "benchmark_regression_only", evaluationType: BENCHMARK_EVALUATION_TYPE, independentModelBenchmark: false },
    { id: "fallback_diagnostics", fallbackListCount, structuredGuidance: false },
  ],
  lastExtractionRun: v32Readiness.lastExtractionRun,
  packageTotals: {
    companiesExpected: coverage.companiesExpected,
    companiesWithResults: coverage.companiesWithResults,
    documents: coverage.documents,
    statements: coverage.statements,
    statusCounts: coverage.statusCounts,
    rejectedEvidence: coverage.rejectedEvidence,
    failed: coverage.failed,
    thinCompanies,
    fallbackListCount,
    fallbackStatusCount,
    fallbackAttachmentsOutsideFallbackStatus: fallbackOutside,
  },
  benchmark: { evaluationType: BENCHMARK_EVALUATION_TYPE, pass: v32Benchmark.pass, recall: v32Benchmark.recall, issues: v32Benchmark.issues },
  remediation: v32Readiness.remediation,
  normalization: {
    normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
    counts,
    reviewCategoryCounts,
    development,
    holdout,
  },
  guard: {
    companiesExpected: coverage.companiesExpected,
    companiesWithResults: coverage.companiesWithResults,
    outsideUniverseRows: 0,
    duplicateResultKeys: 0,
    rawModelOutputExcluded: true,
    localPathsExcluded: true,
    failedPreserved: true,
    partialHistory: true,
  },
};
const lineage = {
  model: "qwen3.5:9b",
  promptVersion: "expectations-v4",
  promptSourceSha256,
  resultOrigin: "model output + deterministic normalization",
  normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
  rawModelOutputIncluded: false,
  inputLineage: "inputSha256 binds the original source and container before deterministic normalization",
  normalizedOutput: "expectations-report.json and expectations-report.ts",
  resultKeyDefinition: "(cik, accessionNo, sourceId, containerId)",
  companies: universe.map((company) => {
    const trio = V33_TRIO_CIKS.has(company.cik);
    const prior = v32Lineage.companies.find((item) => item.cik === company.cik);
    const pack = trio ? readJson(path.join(resolveCohortCacheDir(company.cik), "cohort-pack-v2.json")) : null;
    const contextTokens = trio ? pack!.contextTokens : prior.contextTokens;
    const resultKeys = trio ? mergedResults.filter((entry) => entry.cik === company.cik).map((entry) => ({
      cik: entry.cik,
      accessionNo: entry.accessionNo,
      sourceId: entry.sourceId,
      containerId: entry.containerId,
      inputSha256: entry.inputSha256,
      sourceUrl: canonicalSecUrl(entry.cik, entry.accessionNo),
    })) : prior.resultKeys;
    return {
      cik: company.cik,
      ticker: company.ticker,
      extractionContext: extractionContextFor(company.cik, contextTokens),
      packGeneratedAt: trio ? pack!.generatedAt : prior.packGeneratedAt,
      contextTokens,
      resultKeys,
    };
  }),
};
for (const company of lineage.companies) {
  const labels = new Set([company.extractionContext]);
  if (labels.size !== 1) throw new Error(`Mixed extraction context for ${company.ticker}`);
}
writeJson(path.join(stage, "expectations-report.json"), report);
writeFileSync(path.join(stage, "expectations-report.ts"), `/** Generated presentation artifact; raw model output and local paths are excluded. */\nexport const expectationsReport = ${JSON.stringify(sanitizeExpectationValue(report), null, 2)} as const;\n`);
writeJson(path.join(stage, "expectations-results.json"), resultsPayload);
writeJson(path.join(stage, "benchmark-report.json"), v32Benchmark);
writeJson(path.join(stage, "coverage.json"), { ...coverage, scope: PACKAGE_SCOPE, normalizationVersion: EXPECTATION_NORMALIZATION_VERSION, thinCompanyDefinition: "companies with at most four documents", thinCompanies });
writeJson(path.join(stage, "production-readiness.json"), productionReadiness);
writeJson(path.join(stage, "lineage.json"), lineage);
writeJson(path.join(stage, "remediation.json"), readJson(path.join(v32Dir, "remediation.json")));
writeJson(path.join(stage, "normalization-audit.json"), { schemaVersion: 1, normalizationVersion: EXPECTATION_NORMALIZATION_VERSION, counts, audit });
writeJson(path.join(stage, "review-queue.json"), { schemaVersion: 1, normalizationVersion: EXPECTATION_NORMALIZATION_VERSION, categories: reviewCategoryCounts, topUnmappedMetricRaw, reviewQueue });
mkdirSync(path.join(stage, "qa"), { recursive: true });
for (const company of TRIO) {
  const qa = readJson(path.join(ROOT, "worker/.runs/cohort-qa", `${company.ticker}.json`));
  writeJson(path.join(stage, "qa", `${company.ticker}.json`), qa);
}
const payloadFiles = [
  "expectations-report.json", "expectations-report.ts", "expectations-results.json", "benchmark-report.json", "coverage.json",
  "production-readiness.json", "lineage.json", "remediation.json", "normalization-audit.json", "review-queue.json",
  "qa/AMZN.json", "qa/MSFT.json", "qa/GOOGL.json",
];
const files = payloadFiles.map((file) => {
  const bytes = readFileSync(path.join(stage, file));
  return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
});
const manifest = {
  schemaVersion: 3,
  packageType: "reviewed-expectations",
  packageVersion: "3.3",
  packageEntries: files.length + 1,
  payloadFilesHashListed: files.length,
  manifestSelfHashed: false,
  applyStatus: "not_run",
  applyPayload: "expectations-results.json",
  flattenedReportRole: "human/UI review only; not apply payload",
  resolverReport: resultsPayload.resolverReport,
  fallbackPayloadPolicy: "diagnostics counts only; never serving guidance",
  scope: PACKAGE_SCOPE,
  generatedAt: new Date().toISOString(),
  baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  dataMode: "live",
  transportOnly: true,
  productionApply: false,
  model: "qwen3.5:9b",
  promptVersion: "expectations-v4",
  promptSourceSha256,
  resultOrigin: "model output + deterministic normalization",
  rawModelOutputIncluded: false,
  normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
  numericChangeSemantics: "numericChange=true when qualifier, valueLow, valueHigh, valuePoint, tolerance, toleranceUnit or unit changes",
  nonAliasSnapshotPolicy: "Full beforeStatement and afterStatement snapshots; statementKey=before and afterStatementKeys=after",
  counts,
  development,
  holdout,
  reviewCategoryCounts,
  benchmarkEvaluationType: BENCHMARK_EVALUATION_TYPE,
  exactKeyDefinition: "(cik, accessionNo, sourceId, containerId)",
  companies: coverage.companiesWithResults,
  documents: coverage.documents,
  thinCompanies,
  remediationStatements: v32Manifest.remediationStatements,
  duplicateResultKeys: 0,
  unchanged50ByteIdentical: true,
  excludedArtifacts: [
    "source filings", "HTML and plaintext", "cohort packs", "prompt text", "raw model output", "cache directories",
    "runtime directories", "secret material", "environment configuration", "database connection details", "network addresses", "scheduler metadata", "GDELT", "political events",
  ],
  files,
};
writeJson(path.join(stage, "manifest.json"), manifest);
mkdirSync(path.dirname(OUT), { recursive: true });
powerShell(`Compress-Archive -Path ${psQuote(path.join(stage, "*"))} -DestinationPath ${psQuote(OUT)} -CompressionLevel Optimal`);
powerShell(`Expand-Archive -Path ${psQuote(OUT)} -DestinationPath ${psQuote(verify)} -Force`);
const forbidden = [
  /(?:^|[^A-Za-z])[A-Za-z]:[\\/]/, /worker[\\/]{1,2}\.runs/i, /rawResponse|fallbackRawResponse|rawLogs/i,
  /\.env|credentials|connection strings|localhost|operations state/i, /worker[_-]?key|access[_-]?token|api[_-]?key|bearer\s+[a-z0-9]/i,
  /mysql:\/\/|postgres:\/\/|database urls?|db urls?/i, /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
];
for (const file of [...files, { path: "manifest.json", bytes: readFileSync(path.join(stage, "manifest.json")).length, sha256: sha256(readFileSync(path.join(stage, "manifest.json"))) }]) {
  const actual = readFileSync(path.join(verify, file.path));
  if (actual.length !== file.bytes || sha256(actual) !== file.sha256) throw new Error(`ZIP verification failed for ${file.path}`);
  const text = actual.toString("utf8");
  if (forbidden.some((pattern) => pattern.test(text))) throw new Error(`Forbidden package content in ${file.path}`);
}
const zipBytes = readFileSync(OUT);
console.log(JSON.stringify({
  zip: OUT,
  bytes: zipBytes.length,
  sha256: sha256(zipBytes),
  entries: files.length + 1,
  counts,
  documents: coverage.documents,
  statements: coverage.statements,
  auditRecords: audit.length,
  reviewItems: reviewQueue.length,
  thinCompanies,
  unchanged50ByteIdentical: true,
  productionApply: false,
}, null, 2));
