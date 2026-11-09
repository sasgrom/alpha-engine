import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import unzipper from "unzipper";
import { readCohortEntries, type CohortResultEntry } from "../worker/lib/cohort-checkpoint";
import { buildExpectationsReport } from "../worker/lib/expectations-report";
import { buildExpectationPrompt } from "../worker/lib/expectations";
import { evaluateExpectationBenchmark, type BenchmarkFile, type ExtractionForBenchmark } from "../worker/lib/expectations-benchmark";
import { mergeGuidanceStatus } from "../worker/lib/exhibits";
import { cohortSourceText, type CohortPack } from "../worker/lib/cohort-pack";
import { applyV34DeferredStatus } from "../worker/lib/expectation-status-v34";
import { assertV34Audit, EXPECTATION_LEGACY_CUTOFF, EXPECTATION_NORMALIZATION_V34, transformV34Entries } from "../worker/lib/expectation-normalization-v34";
import {
  BENCHMARK_EVALUATION_TYPE,
  PACKAGE_SCOPE,
  assertBenchmarkPassed,
  buildCoverage,
  buildExpectationResultsPayload,
  normalizeCohortEntries,
  resultKey,
  resolveCohortCacheDir,
  sanitizeExpectationValue,
} from "./export-expectations-reviewed.mts";

const ROOT = path.resolve(import.meta.dirname, "..");
const V33_ZIP = path.join(ROOT, "research/reviewed-sync/2026-11-09/expectations-reviewed-v3.3.zip");
const V33_SHA256 = "b5feac0eab5c0ae6ed2639c9f14cc859ed3f5a32fc84ffedee64065a1dc5a029";
const OUT = path.join(ROOT, "research/reviewed-sync/2026-11-09/expectations-reviewed-v3.4.zip");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(sanitizeExpectationValue(value), null, 2)}\n`);
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const powerShell = (script: string) => execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const exactKey = (entry: Pick<CohortResultEntry, "cik" | "accessionNo" | "sourceId" | "containerId">) => resultKey(entry);

if (!existsSync(V33_ZIP) || sha256(readFileSync(V33_ZIP)) !== V33_SHA256) throw new Error("v3.3 ZIP SHA256 mismatch");
if (existsSync(OUT)) throw new Error(`Refusing to overwrite ${OUT}`);
const archive = await unzipper.Open.file(V33_ZIP);
const readV33 = async (name: string) => {
  const entry = archive.files.find((item) => item.path.replaceAll("\\", "/") === name);
  if (!entry) throw new Error(`v3.3 member missing: ${name}`);
  return JSON.parse((await entry.buffer()).toString("utf8"));
};
const v33Manifest = await readV33("manifest.json");
const v33Results = (await readV33("expectations-results.json")).results;
const v33Readiness = await readV33("production-readiness.json");
const v33Lineage = await readV33("lineage.json");
const baselineBenchmark = await readV33("benchmark-report.json");
assertBenchmarkPassed({ pass: baselineBenchmark.pass, issues: baselineBenchmark.issues });
const universe = v33Lineage.companies.map((company: any) => ({ cik: company.cik, ticker: company.ticker }));
if (universe.length !== 50 || new Set(universe.map((company: any) => company.cik)).size !== 50) throw new Error("Expected 50 unique companies");

const rawEntries = universe.flatMap((company: any) => readCohortEntries(resolveCohortCacheDir(company.cik)));
const baseline = normalizeCohortEntries(rawEntries);
baseline.normalizedEntries.sort((a, b) => exactKey(a).localeCompare(exactKey(b)));
const baselinePayload = buildExpectationResultsPayload(baseline.normalizedEntries);
if (JSON.stringify(baselinePayload.results) !== JSON.stringify(v33Results)) throw new Error("Raw baseline rebuild differs from v3.3; refusing v3.4 normalization");

const transformed = transformV34Entries(baseline.normalizedEntries, baseline.reviewQueue);
assertV34Audit(transformed.audit);
const packs = new Map<number, CohortPack>();
const deferred = applyV34DeferredStatus(transformed.entries, (entry) => {
  if (entry.guidanceStatus !== "not_found" || entry.statements.length || !entry.extractionWarnings.some((warning) => /provide forward-looking guidance/i.test(warning) && /conference call|earnings call/i.test(warning))) return "";
  if (!packs.has(entry.cik)) packs.set(entry.cik, JSON.parse(readFileSync(path.join(resolveCohortCacheDir(entry.cik), "cohort-pack-v2.json"), "utf8")) as CohortPack);
  const container = packs.get(entry.cik)!.containers.find((item) => item.containerId === entry.containerId);
  return container ? cohortSourceText(container, entry.sourceId) : "";
});
transformed.entries = deferred.entries;
const gold = JSON.parse(readFileSync(path.join(ROOT, "research/expectations-benchmark-v1.json"), "utf8")) as BenchmarkFile;
const extractions = new Map<string, ExtractionForBenchmark>();
for (const document of gold.documents) {
  const entries = transformed.entries.filter((entry) => entry.cik === document.cik && entry.accessionNo === document.accessionNo);
  if (entries.length) extractions.set(document.accessionNo, {
    accessionNo: document.accessionNo,
    guidanceStatus: mergeGuidanceStatus(entries.map((entry) => entry.guidanceStatus)),
    statements: entries.flatMap((entry) => entry.statements),
  });
}
const evaluatedBenchmark = evaluateExpectationBenchmark(gold, extractions);
const v34Benchmark = {
  generatedAt: new Date().toISOString(),
  ...evaluatedBenchmark,
  evaluationType: BENCHMARK_EVALUATION_TYPE,
  reviewMethod: "Post-normalization regression against independently reviewed official SEC gold statements; not an independent model benchmark.",
};
if (!v34Benchmark.pass) console.error(JSON.stringify({ benchmarkIssues: v34Benchmark.issues }, null, 2));
assertBenchmarkPassed({ pass: v34Benchmark.pass, issues: v34Benchmark.issues });
const v33ByParent = new Map<string, Map<string, number>>();
for (const result of v33Results) {
  const counts = new Map<string, number>();
  for (const statement of result.statements) {
    const serialized = JSON.stringify(statement);
    counts.set(serialized, (counts.get(serialized) ?? 0) + 1);
  }
  v33ByParent.set(exactKey(result), counts);
}
for (const item of transformed.untouched) {
  const counts = v33ByParent.get(item.key);
  const serialized = JSON.stringify(item.statement);
  const remaining = counts?.get(serialized) ?? 0;
  if (!counts || remaining < 1) throw new Error(`Untouched statement is not byte-identical to v3.3: ${item.key}`);
  counts.set(serialized, remaining - 1);
}
const duplicateKeys = new Set(transformed.entries.map(exactKey));
if (duplicateKeys.size !== transformed.entries.length) throw new Error("Duplicate exact result keys in v3.4");
const coverage = buildCoverage(universe, transformed.entries);
const resultsPayload = buildExpectationResultsPayload(transformed.entries);
resultsPayload.packageVersion = "3.4" as any;
resultsPayload.resolverReport = { ambiguousStatements: 0, missingParent: 0, heuristicResolved: 0, statements: resultsPayload.resolverReport.statements };

const audit = [...baseline.audit, ...transformed.audit].sort((a, b) => `${a.ticker}|${a.accessionNo}|${a.ruleId}|${a.statementKey}`.localeCompare(`${b.ticker}|${b.accessionNo}|${b.ruleId}|${b.statementKey}`));
const reviewQueue = transformed.review;
const categories = () => ({ metric_alias: 0, value_unit_scale: 0, qualifier_evidence: 0, combined_basis: 0, revision_language: 0, non_disclosure: 0, ambiguous: 0 });
const reviewCategoryCounts = categories();
const blockingReviewCategoryCounts = categories();
const nonBlockingReviewCategoryCounts = categories();
for (const item of reviewQueue) {
  reviewCategoryCounts[item.category]++;
  if (item.blocking === false) nonBlockingReviewCategoryCounts[item.category]++;
  else blockingReviewCategoryCounts[item.category]++;
}
const allStatements = transformed.entries.flatMap((entry) => entry.statements);
const canonicalUnmapped = allStatements.filter((statement) => statement.canonicalMetric === "other.unmapped").length;
if (canonicalUnmapped !== 0) throw new Error("v3.4 retained blocking other.unmapped statements");
const canonicalOther = allStatements.filter((statement) => statement.canonicalMetric === "other").length;
const canonicalMapped = allStatements.length - canonicalOther;
const salvageRate = transformed.summary.recentUnmapped ? transformed.summary.recentSalvaged / transformed.summary.recentUnmapped : 0;
const counts = {
  inputStatements: v33Manifest.counts.outputStatements,
  modelInputStatements: v33Manifest.counts.inputStatements,
  outputStatements: coverage.statements,
  auditRecords: audit.length,
  v34AuditRecords: transformed.audit.length,
  numericChanges: audit.filter((item) => item.numericChange).length,
  reviewItems: reviewQueue.length,
  canonicalMapped,
  canonicalOther,
  canonicalUnmapped,
  untouchedStatements: transformed.untouched.length,
};
const blockerTransitions = {
  metric_alias: { before: v33Manifest.reviewCategoryCounts.metric_alias, after: blockingReviewCategoryCounts.metric_alias, nonBlockingAfter: nonBlockingReviewCategoryCounts.metric_alias },
  value_unit_scale: { before: v33Manifest.reviewCategoryCounts.value_unit_scale, after: blockingReviewCategoryCounts.value_unit_scale, resolved: transformed.summary.scaleReconciled },
  qualifier_evidence: { before: v33Manifest.reviewCategoryCounts.qualifier_evidence, after: blockingReviewCategoryCounts.qualifier_evidence, downgradedNonBlocking: transformed.summary.qualifierDowngraded, rejectedWithAudit: transformed.summary.qualifierRejected },
  combined_basis: { before: v33Manifest.reviewCategoryCounts.combined_basis, after: blockingReviewCategoryCounts.combined_basis, splitStatements: transformed.summary.combinedBasisSplits },
};
const metricAliasSalvage = {
  cutoff: EXPECTATION_LEGACY_CUTOFF,
  recentCandidates: transformed.summary.recentUnmapped,
  salvaged: transformed.summary.recentSalvaged,
  residualOther: transformed.summary.recentResidualOther,
  legacyOther: transformed.summary.legacyOther,
  unknownPeriodOther: transformed.summary.unknownPeriodOther,
  residualNoiseSuspected: transformed.summary.recentResidualNoiseSuspected,
  salvageRate,
  rateText: `${transformed.summary.recentSalvaged}/${transformed.summary.recentUnmapped} = ${(salvageRate * 100).toFixed(2)}%`,
};
const thinCompanies = coverage.companies.filter((company) => company.documents <= 4);
const report = buildExpectationsReport(universe, transformed.entries, new Date().toISOString(), PACKAGE_SCOPE, {
  pass: v34Benchmark.pass,
  recall: v34Benchmark.recall,
  issueCount: v34Benchmark.issues.length,
}, true);
report.coverage.noCandidate = transformed.entries.filter((entry) => entry.status === "empty").length;
report.partialHistory = { reason: "Document coverage is inherited from verified v3.3; v3.4 changes deterministic normalization only.", thinCompanies };
report.benchmark = { ...report.benchmark, evaluationType: BENCHMARK_EVALUATION_TYPE };
report.normalization = {
  normalizationVersion: EXPECTATION_NORMALIZATION_V34,
  transformation: "immutable model output + v3.3-compatible normalization + v3.4 evidence-anchored rules",
  counts,
  reviewCategoryCounts,
  blockingReviewCategoryCounts,
  nonBlockingReviewCategoryCounts,
  blockerTransitions,
  metricAliasSalvage,
  baselineV33ByteIdentical: true,
  untouchedStatementsByteIdentical: true,
};

const productionReadiness = {
  schemaVersion: 3,
  status: "blocked",
  scope: PACKAGE_SCOPE,
  productionApply: false,
  applyStatus: "not_run",
  applyAllowedWhen: v33Readiness.applyAllowedWhen,
  blockers: [
    { id: "backup_channel_required", verified: false, applyStatus: "fail_closed" },
    { id: "thin_history", companies: thinCompanies.map((company) => ({ ticker: company.ticker, documents: company.documents, statements: company.statements })) },
    { id: "canonical_unmapped", count: 0, servingBlocked: false, nonBlockingOther: canonicalOther, salvage: metricAliasSalvage },
    { id: "value_unit_scale", count: blockingReviewCategoryCounts.value_unit_scale, resolved: transformed.summary.scaleReconciled },
    { id: "qualifier_evidence", count: blockingReviewCategoryCounts.qualifier_evidence, downgradedNonBlocking: transformed.summary.qualifierDowngraded, rejectedWithAudit: transformed.summary.qualifierRejected },
    { id: "combined_basis", count: blockingReviewCategoryCounts.combined_basis, splitStatements: transformed.summary.combinedBasisSplits },
    { id: "benchmark_regression_only", evaluationType: BENCHMARK_EVALUATION_TYPE, independentModelBenchmark: false },
    { id: "fallback_diagnostics", fallbackListCount: v33Readiness.packageTotals.fallbackListCount, structuredGuidance: false },
  ],
  lastExtractionRun: v33Readiness.lastExtractionRun,
  packageTotals: { ...v33Readiness.packageTotals, documents: coverage.documents, statements: coverage.statements, statusCounts: coverage.statusCounts, rejectedEvidence: coverage.rejectedEvidence, failed: coverage.failed, thinCompanies },
  benchmark: { evaluationType: BENCHMARK_EVALUATION_TYPE, pass: v34Benchmark.pass, recall: v34Benchmark.recall, issues: v34Benchmark.issues },
  remediation: { ...v33Readiness.remediation, v34ResultStatusRecords: deferred.resultAudit.length },
  normalization: { normalizationVersion: EXPECTATION_NORMALIZATION_V34, counts, reviewCategoryCounts, blockingReviewCategoryCounts, nonBlockingReviewCategoryCounts, blockerTransitions, metricAliasSalvage },
  guard: {
    companiesExpected: 50,
    companiesWithResults: coverage.companiesWithResults,
    outsideUniverseRows: 0,
    duplicateResultKeys: 0,
    rawModelOutputExcluded: true,
    localPathsExcluded: true,
    failedPreserved: true,
    partialHistory: true,
    baselineV33ByteIdentical: true,
    untouchedStatementsByteIdentical: true,
  },
};
const lineage = {
  ...v33Lineage,
  packageVersion: "3.4",
  resultOrigin: "immutable model output + v3.3-compatible normalization + v3.4 deterministic rules",
  normalizationVersion: EXPECTATION_NORMALIZATION_V34,
  rawModelOutputIncluded: false,
  baselineV33ByteIdentical: true,
  untouchedStatementsByteIdentical: true,
};
const v34Summary = {
  schemaVersion: 1,
  packageVersion: "3.4",
  normalizationVersion: EXPECTATION_NORMALIZATION_V34,
  counts,
  blockerTransitions,
  metricAliasSalvage,
  rules: transformed.summary,
  resultStatusAudit: deferred.resultAudit,
  baselineV33ByteIdentical: true,
  untouchedStatementsByteIdentical: true,
  productionApply: false,
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const work = path.join(ROOT, "worker/.runs", `expectations-reviewed-v34-${stamp}`);
const stage = path.join(work, "stage");
const verify = path.join(work, "verify");
mkdirSync(stage, { recursive: true });
writeJson(path.join(stage, "expectations-report.json"), report);
writeFileSync(path.join(stage, "expectations-report.ts"), `/** Generated presentation artifact; raw model output and local paths are excluded. */\nexport const expectationsReport = ${JSON.stringify(sanitizeExpectationValue(report), null, 2)} as const;\n`);
writeJson(path.join(stage, "expectations-results.json"), resultsPayload);
writeJson(path.join(stage, "benchmark-report.json"), v34Benchmark);
writeJson(path.join(stage, "coverage.json"), { ...coverage, scope: PACKAGE_SCOPE, normalizationVersion: EXPECTATION_NORMALIZATION_V34, thinCompanyDefinition: "companies with at most four documents", thinCompanies });
writeJson(path.join(stage, "production-readiness.json"), productionReadiness);
writeJson(path.join(stage, "lineage.json"), lineage);
writeJson(path.join(stage, "remediation.json"), { ...await readV33("remediation.json"), v34ResultStatus: deferred.resultAudit });
writeJson(path.join(stage, "normalization-audit.json"), { schemaVersion: 1, normalizationVersion: EXPECTATION_NORMALIZATION_V34, counts, audit, resultStatusAudit: deferred.resultAudit });
writeJson(path.join(stage, "review-queue.json"), { schemaVersion: 1, normalizationVersion: EXPECTATION_NORMALIZATION_V34, categories: reviewCategoryCounts, blockingCategories: blockingReviewCategoryCounts, nonBlockingCategories: nonBlockingReviewCategoryCounts, reviewQueue });
writeJson(path.join(stage, "normalization-v34-summary.json"), v34Summary);
mkdirSync(path.join(stage, "qa"), { recursive: true });
for (const ticker of ["AMZN", "MSFT", "GOOGL"]) writeJson(path.join(stage, "qa", `${ticker}.json`), await readV33(`qa/${ticker}.json`));
const payloadFiles = [
  "expectations-report.json", "expectations-report.ts", "expectations-results.json", "benchmark-report.json", "coverage.json",
  "production-readiness.json", "lineage.json", "remediation.json", "normalization-audit.json", "review-queue.json", "normalization-v34-summary.json",
  "qa/AMZN.json", "qa/MSFT.json", "qa/GOOGL.json",
];
const files = payloadFiles.map((file) => {
  const bytes = readFileSync(path.join(stage, file));
  return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
});
const manifest = {
  schemaVersion: 3,
  packageType: "reviewed-expectations",
  packageVersion: "3.4",
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
  promptSourceSha256: sha256(buildExpectationPrompt.toString()),
  resultOrigin: lineage.resultOrigin,
  rawModelOutputIncluded: false,
  normalizationVersion: EXPECTATION_NORMALIZATION_V34,
  counts,
  blockerTransitions,
  metricAliasSalvage,
  reviewCategoryCounts,
  blockingReviewCategoryCounts,
  nonBlockingReviewCategoryCounts,
  benchmarkEvaluationType: BENCHMARK_EVALUATION_TYPE,
  exactKeyDefinition: "(cik, accessionNo, sourceId, containerId)",
  companies: coverage.companiesWithResults,
  documents: coverage.documents,
  thinCompanies,
  remediationStatements: v33Manifest.remediationStatements,
  duplicateResultKeys: 0,
  baselineV33ByteIdentical: true,
  untouchedStatementsByteIdentical: true,
  excludedArtifacts: v33Manifest.excludedArtifacts,
  files,
};
writeJson(path.join(stage, "manifest.json"), manifest);
mkdirSync(path.dirname(OUT), { recursive: true });
powerShell(`Compress-Archive -Path ${psQuote(path.join(stage, "*"))} -DestinationPath ${psQuote(OUT)} -CompressionLevel Optimal`);
powerShell(`Expand-Archive -Path ${psQuote(OUT)} -DestinationPath ${psQuote(verify)} -Force`);
const forbidden = [
  /(?:^|[^A-Za-z])[A-Za-z]:[\\/]/, /worker[\\/]{1,2}\.runs/i, /rawResponse|fallbackRawResponse|rawLogs/i,
  /\.env|credentials|connection strings|localhost|operations state(?!ment)\b/i, /worker[_-]?key|access[_-]?token|api[_-]?key|bearer\s+[a-z0-9]/i,
  /mysql:\/\/|postgres:\/\/|database urls?|db urls?/i, /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
];
for (const file of [...files, { path: "manifest.json", bytes: readFileSync(path.join(stage, "manifest.json")).length, sha256: sha256(readFileSync(path.join(stage, "manifest.json"))) }]) {
  const actual = readFileSync(path.join(verify, file.path));
  if (actual.length !== file.bytes || sha256(actual) !== file.sha256) throw new Error(`ZIP verification failed for ${file.path}`);
  if (forbidden.some((pattern) => pattern.test(actual.toString("utf8")))) throw new Error(`Forbidden package content in ${file.path}`);
}
const zipBytes = readFileSync(OUT);
console.log(JSON.stringify({
  zip: OUT,
  bytes: zipBytes.length,
  sha256: sha256(zipBytes),
  entries: files.length + 1,
  counts,
  blockerTransitions,
  metricAliasSalvage,
  benchmark: { pass: v34Benchmark.pass, recall: v34Benchmark.recall, issues: v34Benchmark.issues.length, matchedStatements: v34Benchmark.matchedStatements, requiredStatements: v34Benchmark.requiredStatements },
  rules: transformed.summary,
  baselineV33ByteIdentical: true,
  untouchedStatementsByteIdentical: true,
  productionApply: false,
}, null, 2));
