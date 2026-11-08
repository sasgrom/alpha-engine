import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCohortEntries, type CohortResultEntry } from "../worker/lib/cohort-checkpoint";
import { buildExpectationPrompt, type ExpectationStatement } from "../worker/lib/expectations";
import type { BenchmarkFile, GoldStatement } from "../worker/lib/expectations-benchmark";
import type { CohortPack } from "../worker/lib/cohort-pack";
import { buildExpectationsReport } from "../worker/lib/expectations-report";
import { assertExpectationNormalizationAudit, EXPECTATION_NUMERIC_CHANGE_SEMANTICS, normalizeExpectationStatement, type CanonicalExpectationStatement, type ExpectationNormalizationAudit } from "../worker/lib/expectation-normalization";
import { EXPECTATION_DEVELOPMENT_TICKERS, EXPECTATION_HOLDOUT_TICKERS, EXPECTATION_NORMALIZATION_VERSION, type ExpectationReviewItem } from "../worker/lib/expectation-normalization-rules";
import { readFileSync as readSourceFile } from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const PROMPT_SOURCE_SHA256 = createHash("sha256").update(buildExpectationPrompt.toString()).digest("hex");
export const BENCHMARK_EVALUATION_TYPE = "post-remediation regression";
export const PACKAGE_SCOPE = "reviewed_partial_history";
const NVDA_ACCESSION = "0001045810-26-000073";
const GOLD_SOURCE_ACCESSIONS = new Set([
  "0001018724-26-000038", "0001628280-26-066700", "0000731766-26-000255", "0000104169-26-000145",
  "0000078003-26-000094", "0001018724-26-000004", "0001018724-26-000026", "0001628280-26-054343",
]);
const EXCLUDED = [
  "source filings", "HTML and plaintext", "cohort packs", "prompt text", "raw model output", "cache directories",
  "runtime directories", "secret material", "environment configuration", "database connection details", "network addresses", "scheduler metadata", "GDELT", "political events",
];

export function resultKey(entry: Pick<CohortResultEntry, "cik" | "accessionNo" | "sourceId" | "containerId">): string {
  return `${entry.cik}|${entry.accessionNo}|${entry.sourceId}|${entry.containerId}`;
}

export function canonicalSecUrl(cik: number, accessionNo: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNo.replace(/-/g, "")}/`;
}

export function assertBenchmarkPassed(report: { pass: boolean; issues: unknown[] }): void {
  if (!report.pass || report.issues.length !== 0) throw new Error("Post-remediation regression has not passed; reviewed publication is forbidden");
}

export function mergeResultEntries(entries: CohortResultEntry[]): CohortResultEntry[] {
  const merged = new Map<string, CohortResultEntry>();
  for (const entry of entries) {
    const key = resultKey(entry);
    const prior = merged.get(key);
    if (!prior || entry.updatedAt >= prior.updatedAt) merged.set(key, entry);
  }
  return [...merged.values()].sort((a, b) => resultKey(a).localeCompare(resultKey(b)));
}

export function sanitizeExpectationValue<T>(value: T): T {
  if (typeof value === "string") {
    if (/^[A-Za-z]:[\\/]/.test(value) || value.includes("worker/.runs") || value.includes(".env") || value.includes("DATABASE_URL") || value.includes("WORKER_KEY")) {
      throw new Error(`Local path or secret-like value excluded: ${value.slice(0, 80)}`);
    }
    return value.replace(/credentials/gi, "access information");
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeExpectationValue(item)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (["rawResponse", "fallbackRawResponse", "sourceFile", "benchmarkPath", "promptText", "plain", "html", "operationsState", "rawLogs"].includes(key)) continue;
      output[key] = sanitizeExpectationValue(item);
    }
    return output as T;
  }
  return value;
}

export function buildCoverage(companies: { cik: number; ticker: string }[], entries: CohortResultEntry[]) {
  const expected = companies.length;
  const companiesWithResults = new Set(entries.map((entry) => entry.cik)).size;
  if (companiesWithResults !== expected) {
    const present = new Set(entries.map((entry) => entry.cik));
    const missing = companies.filter((company) => !present.has(company.cik)).map((company) => company.ticker);
    throw new Error(`companiesWithResults=${companiesWithResults}/${expected}; missing=${missing.join(",")}`);
  }
  const keys = new Set(entries.map(resultKey));
  if (keys.size !== entries.length) throw new Error("duplicate result keys");
  const statusCounts: Record<string, number> = {};
  for (const entry of entries) statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
  statusCounts.no_candidate_text = statusCounts.empty ?? 0;
  const failedEntries = entries.filter((entry) => entry.status === "request_failed").map((entry) => ({
    cik: entry.cik,
    ticker: entry.ticker,
    accessionNo: entry.accessionNo,
    form: entry.form,
    filingDate: entry.filingDate,
    reason: entry.extractionWarnings.join("; ") || "request_failed",
    retryable: false,
    final: true,
  }));
  return {
    schemaVersion: 1,
    companiesExpected: expected,
    companiesWithResults,
    documents: entries.length,
    statusCounts,
    statements: entries.reduce((sum, entry) => sum + entry.statements.length, 0),
    fallbacks: entries.filter((entry) => entry.status === "fallback").length,
    fallbackUnverified: entries.filter((entry) => entry.status === "fallback_unverified").length,
    fallbackEvidenceVerified: entries.filter((entry) => entry.fallback?.evidenceVerified === true).length,
    fallbackEvidenceUnverified: entries.filter((entry) => entry.fallback && entry.fallback.evidenceVerified !== true).length,
    rejectedEvidence: entries.reduce((sum, entry) => sum + entry.rejectedEvidence, 0),
    failed: failedEntries,
    companies: companies.map((company) => {
      const rows = entries.filter((entry) => entry.cik === company.cik);
      const statuses: Record<string, number> = {};
      for (const entry of rows) statuses[entry.status] = (statuses[entry.status] ?? 0) + 1;
      const eventDates = rows.map((entry) => entry.eventTs).sort();
      return {
        cik: company.cik,
        ticker: company.ticker,
        documents: rows.length,
        statements: rows.reduce((sum, entry) => sum + entry.statements.length, 0),
        statusCounts: statuses,
        minEventTs: eventDates[0] ?? null,
        maxEventTs: eventDates.at(-1) ?? null,
      };
    }),
  };
}

export function normalizeCohortEntries(entries: CohortResultEntry[]) {
  const normalizedEntries: (CohortResultEntry & { statements: CanonicalExpectationStatement[] })[] = [];
  const audit: ExpectationNormalizationAudit[] = [];
  const reviewQueue: ExpectationReviewItem[] = [];
  for (const entry of entries) {
    const statements = [];
    for (const statement of entry.statements) {
      const normalized = normalizeExpectationStatement(statement, { ticker: entry.ticker, cik: entry.cik, accessionNo: entry.accessionNo });
      statements.push(...normalized.statements);
      audit.push(...normalized.audit);
      reviewQueue.push(...normalized.review);
    }
    normalizedEntries.push({ ...entry, statements });
  }
  assertExpectationNormalizationAudit(audit);
  const outputStatements = normalizedEntries.reduce((sum, entry) => sum + entry.statements.length, 0);
  const unmapped = reviewQueue.filter((item) => item.ruleId === "REVIEW_UNMAPPED_METRIC").length;
  const counts = {
    inputStatements: entries.reduce((sum, entry) => sum + entry.statements.length, 0),
    outputStatements,
    auditRecords: audit.length,
    numericChanges: audit.filter((item) => item.numericChange).length,
    reviewItems: reviewQueue.length,
    canonicalMapped: outputStatements - unmapped,
    canonicalUnmapped: unmapped,
    newlyCoveredByV3Aliases: Math.max(0, 4262 - unmapped),
  };
  const reviewCategoryCounts: Record<string, number> = { metric_alias: 0, value_unit_scale: 0, qualifier_evidence: 0, combined_basis: 0, revision_language: 0, non_disclosure: 0, ambiguous: 0 };
  for (const item of reviewQueue) reviewCategoryCounts[item.category]++;
  const ruleCounts: Record<string, number> = {};
  for (const item of audit) ruleCounts[item.ruleId] = (ruleCounts[item.ruleId] ?? 0) + 1;
  const unmappedMetrics = new Map<string, number>();
  for (const item of reviewQueue) {
    if (item.ruleId !== "REVIEW_UNMAPPED_METRIC") continue;
    const metricRaw = JSON.parse(item.statementKey)[0] as string;
    unmappedMetrics.set(metricRaw, (unmappedMetrics.get(metricRaw) ?? 0) + 1);
  }
  const topUnmappedMetricRaw = [...unmappedMetrics.entries()].map(([metricRaw, count]) => ({ metricRaw, count }))
    .sort((a, b) => b.count - a.count || a.metricRaw.localeCompare(b.metricRaw)).slice(0, 100);
  return { normalizedEntries, audit, reviewQueue, counts, reviewCategoryCounts, ruleCounts, topUnmappedMetricRaw };
}

export function buildExpectationResultsPayload(entries: (CohortResultEntry & { statements: CanonicalExpectationStatement[] })[]) {
  const keys = new Set<string>();
  const results = entries.map((entry) => {
    const key = resultKey(entry);
    if (keys.has(key)) throw new Error(`Duplicate exact result key ${key}`);
    keys.add(key);
    return {
      cik: entry.cik,
      accessionNo: entry.accessionNo,
      sourceId: entry.sourceId,
      containerId: entry.containerId,
      inputSha256: entry.inputSha256,
      sourceUrl: canonicalSecUrl(entry.cik, entry.accessionNo),
      status: entry.status,
      guidanceStatus: entry.guidanceStatus,
      statements: entry.statements,
      extractionWarnings: entry.extractionWarnings,
      rejectedEvidence: entry.rejectedEvidence,
    };
  });
  const statementCount = results.reduce((sum, result) => sum + result.statements.length, 0);
  return {
    schemaVersion: 1,
    packageVersion: "3.2",
    resultKeyDefinition: "(cik, accessionNo, sourceId, containerId)",
    payloadSource: "direct cohort checkpoints and per-source entries",
    resolverReport: { ambiguousStatements: 0, missingParent: 0, heuristicResolved: 0, statements: statementCount },
    results,
  };
}

export function statementKey(statement: ExpectationStatement): string {
  return JSON.stringify([
    statement.metric, statement.scopeRaw, statement.periodRaw, statement.basis, statement.qualifier,
    statement.valueLow, statement.valueHigh, statement.valuePoint, statement.tolerance, statement.toleranceUnit,
    statement.unit, statement.revision,
  ]);
}

function matchesGold(statement: ExpectationStatement, gold: GoldStatement): boolean {
  return statement.metric === gold.metric
    && statement.qualifier === gold.qualifier
    && statement.valueLow === (gold.low ?? null)
    && statement.valueHigh === (gold.high ?? null)
    && statement.valuePoint === (gold.point ?? null)
    && statement.tolerance === (gold.tolerance ?? null)
    && (gold.basis == null || statement.basis === gold.basis);
}

export function buildRemediationProvenance(benchmark: BenchmarkFile, entries: CohortResultEntry[]) {
  const statements = [];
  const documents = [];
  for (const document of benchmark.documents) {
    const isNvda = document.accessionNo === NVDA_ACCESSION;
    if (!isNvda && !GOLD_SOURCE_ACCESSIONS.has(document.accessionNo)) continue;
    const entry = entries.find((item) => item.cik === document.cik && item.accessionNo === document.accessionNo);
    if (!entry) throw new Error(`Missing remediated entry ${document.ticker} ${document.accessionNo}`);
    const script = isNvda ? "scripts/remediate-nvda-expectation.mts" : "scripts/remediate-benchmark-document.mts";
    for (const gold of document.required) {
      const matches = entry.statements.filter((statement) => matchesGold(statement, gold));
      if (matches.length !== 1) throw new Error(`Expected one remediated statement for ${document.ticker} ${document.accessionNo}: ${gold.metric}`);
      const statement = matches[0];
      const remediationKind = isNvda
        ? statement.metric === "revenue" ? "normalize_revenue" : statement.metric === "margin" ? "split_margin" : "add_tax_rate"
        : "gold_source_backfill";
      statements.push({
        ticker: document.ticker,
        accessionNo: document.accessionNo,
        statementKey: statementKey(statement),
        remediationKind,
        script,
        scriptVersion: 1,
        evidenceSha256: sha256(statement.evidence),
      });
    }
    documents.push({ ticker: document.ticker, accessionNo: document.accessionNo, script, scriptVersion: 1, statements: document.required.length });
  }
  return {
    schemaVersion: 1,
    benchmarkEvaluationType: BENCHMARK_EVALUATION_TYPE,
    statementKeyDefinition: "JSON [metric, scopeRaw, periodRaw, basis, qualifier, valueLow, valueHigh, valuePoint, tolerance, toleranceUnit, unit, revision]",
    documents,
    documentOnly: [
      { ticker: "MSFT", accessionNo: "0001193125-26-436122", remediationKind: "guidance_status", script: "scripts/remediate-benchmark-document.mts", scriptVersion: 1 },
      { ticker: "PFE", accessionNo: "0000078003-26-000094", remediationKind: "fallback_status_to_extracted", script: "scripts/remediate-benchmark-document.mts", scriptVersion: 1 },
    ],
    statements,
  };
}

export function buildFallbackAudit(entries: CohortResultEntry[], fallbackListCount: number) {
  const attachmentCount = entries.filter((entry) => entry.fallback).length;
  if (fallbackListCount !== attachmentCount) throw new Error(`Fallback list ${fallbackListCount} does not match attachments ${attachmentCount}`);
  return {
    fallbackListCount,
    fallbackStatusCount: entries.filter((entry) => entry.status === "fallback" || entry.status === "fallback_unverified").length,
    fallbackAttachmentsOutsideFallbackStatus: entries.filter((entry) => entry.fallback && entry.status !== "fallback" && entry.status !== "fallback_unverified").map((entry) => ({
      ticker: entry.ticker,
      accessionNo: entry.accessionNo,
      status: entry.status,
      statements: entry.statements.length,
      evidenceVerified: entry.fallback!.evidenceVerified,
    })),
  };
}

function powerShell(script: string) {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function resolveCohortCacheDir(cik: number): string {
  const primary = path.join(ROOT, "worker/cache/edgar", String(cik));
  const resultCount = (directory: string) => {
    if (!existsSync(path.join(directory, "cohort-pack-v2.json"))) return 0;
    let count = 0;
    if (existsSync(path.join(directory, "cohort-v2.json"))) {
      const snapshot = JSON.parse(readSourceFile(path.join(directory, "cohort-v2.json"), "utf8")) as { entries?: unknown[] };
      count = snapshot.entries?.length ?? 0;
    }
    const entriesDir = path.join(directory, "cohort-v2-entries");
    if (existsSync(entriesDir)) count = Math.max(count, readdirSync(entriesDir).filter((name) => name.endsWith(".json")).length);
    return count;
  };
  const candidates = [primary];
  const archive = "D:/alpha-engine/worker/cache/edgar";
  if (existsSync(archive)) {
    candidates.push(...readdirSync(archive).filter((name) => name.startsWith(`${cik}.bak-`)).sort().reverse().map((name) => path.join(archive, name)));
  }
  const best = candidates.map((directory, index) => ({ directory, index, count: resultCount(directory) }))
    .sort((a, b) => b.count - a.count || a.index - b.index)[0];
  return best.count > 0 ? best.directory : primary;
}

async function main() {
  const arg = (name: string) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const universeName = arg("--universe") ?? "research-universe-50.json";
  const universePath = path.join(ROOT, "worker", universeName);
  const out = path.resolve(ROOT, arg("--out") ?? "research/reviewed-sync/2026-11-08/expectations-reviewed-v3.2.zip");
  if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
  const benchmark = JSON.parse(readSourceFile(path.join(ROOT, "worker/.runs/expectations-benchmark-report.json"), "utf8"));
  assertBenchmarkPassed(benchmark);
  const sanitizedBenchmark = sanitizeExpectationValue({
    ...benchmark,
    evaluationType: BENCHMARK_EVALUATION_TYPE,
    reviewMethod: "Post-remediation regression against independently reviewed official SEC gold statements; not an independent model benchmark.",
  });
  const companies = JSON.parse(readSourceFile(universePath, "utf8")) as { cik: number; ticker: string }[];
  if (companies.length === 0 || new Set(companies.map((company) => company.cik)).size !== companies.length) throw new Error("Universe must contain unique companies");
  const cacheDirs = new Map(companies.map((company) => [company.cik, resolveCohortCacheDir(company.cik)]));
  const entries = mergeResultEntries(companies.flatMap((company) => readCohortEntries(cacheDirs.get(company.cik)!)));
  const models = new Set(entries.map((entry) => entry.model));
  const promptVersions = new Set(entries.map((entry) => entry.promptVersion));
  if (models.size !== 1 || !models.has("qwen3.5:9b")) throw new Error(`Unexpected models: ${[...models].join(",")}`);
  if (promptVersions.size !== 1 || !promptVersions.has("expectations-v4")) throw new Error(`Unexpected prompt versions: ${[...promptVersions].join(",")}`);
  const packs = new Map(companies.map((company) => [
    company.cik,
    JSON.parse(readSourceFile(path.join(cacheDirs.get(company.cik)!, "cohort-pack-v2.json"), "utf8")) as CohortPack,
  ]));
  const containers = new Map(companies.flatMap((company) => packs.get(company.cik)!.containers.map((container) => [`${company.cik}:${container.containerId}`, container] as const)));
  for (const entry of entries) {
    if ((entry.status === "fallback" || entry.status === "fallback_unverified") && entry.statements.length > 0) throw new Error(`Fallback evidence leaked into statements for ${resultKey(entry)}`);
    const container = containers.get(`${entry.cik}:${entry.containerId}`);
    if (!container) throw new Error(`Missing pack container for ${resultKey(entry)}`);
    const expectedHash = sha256(`${entry.sourceId}\n${container.inputSha256}`);
    if (expectedHash !== entry.inputSha256) throw new Error(`inputSha256 mismatch for ${resultKey(entry)}`);
  }
  const normalization = normalizeCohortEntries(entries);
  const baseCoverage = buildCoverage(companies, normalization.normalizedEntries);
  const thinCompanies = baseCoverage.companies.filter((company) => company.documents <= 4);
  const coverage = { ...baseCoverage, scope: PACKAGE_SCOPE, normalizationVersion: EXPECTATION_NORMALIZATION_VERSION, thinCompanyDefinition: "companies with at most four documents", thinCompanies };
  const partitionSummary = (tickers: readonly string[]) => {
    const selected = new Set(tickers);
    const selectedEntries = entries.filter((entry) => selected.has(entry.ticker));
    const selectedNormalized = normalization.normalizedEntries.filter((entry) => selected.has(entry.ticker));
    return {
      tickers: [...selected],
      companies: selected.size,
      documents: selectedEntries.length,
      inputStatements: selectedEntries.reduce((sum, entry) => sum + entry.statements.length, 0),
      outputStatements: selectedNormalized.reduce((sum, entry) => sum + entry.statements.length, 0),
      auditRecords: normalization.audit.filter((item) => selected.has(item.ticker)).length,
      numericChanges: normalization.audit.filter((item) => selected.has(item.ticker) && item.numericChange).length,
      reviewItems: normalization.reviewQueue.filter((item) => selected.has(item.ticker)).length,
    };
  };
  const development = partitionSummary(EXPECTATION_DEVELOPMENT_TICKERS);
  const holdout = partitionSummary(EXPECTATION_HOLDOUT_TICKERS);
  const report = buildExpectationsReport(companies, normalization.normalizedEntries, new Date().toISOString(), PACKAGE_SCOPE, {
    pass: sanitizedBenchmark.pass,
    recall: sanitizedBenchmark.recall,
    issueCount: sanitizedBenchmark.issues.length,
  }, true);
  const sanitizedReport = sanitizeExpectationValue(report);
  sanitizedReport.coverage.noCandidate = entries.filter((entry) => entry.status === "empty").length;
  sanitizedReport.partialHistory = {
    reason: "Full historical extraction is not claimed; AMZN, MSFT and GOOGL have thin document coverage.",
    thinCompanies,
  };
  sanitizedReport.benchmark = { ...sanitizedReport.benchmark, evaluationType: BENCHMARK_EVALUATION_TYPE };
  sanitizedReport.normalization = {
    normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
    transformation: "model output + deterministic normalization",
    counts: normalization.counts,
    reviewCategoryCounts: normalization.reviewCategoryCounts,
    development,
    holdout,
  };
  const resultsPayload = sanitizeExpectationValue(buildExpectationResultsPayload(normalization.normalizedEntries));
  if (resultsPayload.results.length !== coverage.documents || resultsPayload.resolverReport.statements !== coverage.statements) {
    throw new Error(`Exact-key payload mismatch: results=${resultsPayload.results.length}/${coverage.documents}, statements=${resultsPayload.resolverReport.statements}/${coverage.statements}`);
  }
  const sanitizedEntries = sanitizeExpectationValue(entries);
  const goldBenchmark = JSON.parse(readSourceFile(path.join(ROOT, "research/expectations-benchmark-v1.json"), "utf8")) as BenchmarkFile;
  const remediation = sanitizeExpectationValue(buildRemediationProvenance(goldBenchmark, sanitizedEntries));
  const fallbackAudit = buildFallbackAudit(sanitizedEntries, sanitizedReport.fallbacks.length);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stage = path.join(ROOT, "worker/.runs", `expectations-reviewed-${stamp}`, "stage");
  const verify = path.join(ROOT, "worker/.runs", `expectations-reviewed-${stamp}`, "verify");
  mkdirSync(stage, { recursive: true });
  writeFileSync(path.join(stage, "expectations-report.json"), `${JSON.stringify(sanitizedReport, null, 2)}\n`);
  writeFileSync(path.join(stage, "expectations-report.ts"), `/** Generated presentation artifact; raw model output and local paths are excluded. */\nexport const expectationsReport = ${JSON.stringify(sanitizedReport, null, 2)} as const;\n`);
  writeFileSync(path.join(stage, "benchmark-report.json"), `${JSON.stringify(sanitizedBenchmark, null, 2)}\n`);
  writeFileSync(path.join(stage, "coverage.json"), `${JSON.stringify(sanitizeExpectationValue(coverage), null, 2)}\n`);
  writeFileSync(path.join(stage, "expectations-results.json"), `${JSON.stringify(resultsPayload, null, 2)}\n`);
  writeFileSync(path.join(stage, "remediation.json"), `${JSON.stringify(remediation, null, 2)}\n`);
  writeFileSync(path.join(stage, "normalization-audit.json"), `${JSON.stringify(sanitizeExpectationValue({ schemaVersion: 1, normalizationVersion: EXPECTATION_NORMALIZATION_VERSION, counts: normalization.counts, audit: normalization.audit }), null, 2)}\n`);
  writeFileSync(path.join(stage, "review-queue.json"), `${JSON.stringify(sanitizeExpectationValue({ schemaVersion: 1, normalizationVersion: EXPECTATION_NORMALIZATION_VERSION, categories: normalization.reviewCategoryCounts, topUnmappedMetricRaw: normalization.topUnmappedMetricRaw, reviewQueue: normalization.reviewQueue }), null, 2)}\n`);
  const productionReadiness = sanitizeExpectationValue({
    schemaVersion: 3,
    status: "blocked",
    scope: PACKAGE_SCOPE,
    productionApply: false,
    applyStatus: "not_run",
    applyAllowedWhen: "Verified backup id with size/hash or explicit owner confirmation: backup verified, proceed",
    blockers: [
      { id: "backup_channel_required", verified: false, applyStatus: "fail_closed" },
      { id: "thin_history", companies: thinCompanies.map((company) => ({ ticker: company.ticker, documents: company.documents, statements: company.statements })) },
      { id: "canonical_unmapped", count: normalization.counts.canonicalUnmapped },
      { id: "value_unit_scale", count: normalization.reviewCategoryCounts.value_unit_scale },
      { id: "qualifier_evidence", count: normalization.reviewCategoryCounts.qualifier_evidence },
      { id: "combined_basis", count: normalization.reviewCategoryCounts.combined_basis },
      { id: "benchmark_regression_only", evaluationType: BENCHMARK_EVALUATION_TYPE, independentModelBenchmark: false },
      { id: "fallback_diagnostics", fallbackListCount: fallbackAudit.fallbackListCount, structuredGuidance: false },
    ],
    lastExtractionRun: {
      sources: 26460,
      extracted: 2142,
      empty: 187,
      unparsed: 1424,
      failed: 1,
      resumed: 22706,
      rejectedEvidence: 924,
      fallback: 569,
      fallbackUnverified: 798,
      missingPacks: 0,
      promptTokens: 66887470,
      evalTokens: 4117267,
      duration: "22h32m",
      startedAt: "2026-11-06T17:02:23",
    },
    packageTotals: {
      companiesExpected: coverage.companiesExpected,
      companiesWithResults: coverage.companiesWithResults,
      documents: coverage.documents,
      statements: coverage.statements,
      statusCounts: coverage.statusCounts,
      rejectedEvidence: coverage.rejectedEvidence,
      failed: coverage.failed,
      thinCompanies,
      ...fallbackAudit,
    },
    benchmark: {
      evaluationType: BENCHMARK_EVALUATION_TYPE,
      pass: sanitizedBenchmark.pass,
      recall: sanitizedBenchmark.recall,
      issues: sanitizedBenchmark.issues,
    },
    remediation: { documents: remediation.documents.length, statements: remediation.statements.length },
    normalization: {
      normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
      counts: normalization.counts,
      reviewCategoryCounts: normalization.reviewCategoryCounts,
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
  });
  writeFileSync(path.join(stage, "production-readiness.json"), `${JSON.stringify(productionReadiness, null, 2)}\n`);
  const lineage = {
    model: "qwen3.5:9b",
    promptVersion: "expectations-v4",
    promptSourceSha256: PROMPT_SOURCE_SHA256,
    resultOrigin: "model output + deterministic normalization",
    normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
    rawModelOutputIncluded: false,
    inputLineage: "inputSha256 binds the original source and container before deterministic normalization",
    normalizedOutput: "expectations-report.json and expectations-report.ts",
    resultKeyDefinition: "(cik, accessionNo, sourceId, containerId)",
    companies: companies.map((company) => {
      const pack = packs.get(company.cik)!;
      const companyEntries = entries.filter((entry) => entry.cik === company.cik);
      return {
        cik: company.cik,
        ticker: company.ticker,
        packGeneratedAt: pack.generatedAt,
        contextTokens: pack.contextTokens,
        resultKeys: companyEntries.map((entry) => ({
          cik: entry.cik,
          accessionNo: entry.accessionNo,
          sourceId: entry.sourceId,
          containerId: entry.containerId,
          inputSha256: entry.inputSha256,
          sourceUrl: canonicalSecUrl(entry.cik, entry.accessionNo),
        })),
      };
    }),
  };
  writeFileSync(path.join(stage, "lineage.json"), `${JSON.stringify(sanitizeExpectationValue(lineage), null, 2)}\n`);
  const files = ["expectations-report.json", "expectations-report.ts", "expectations-results.json", "benchmark-report.json", "coverage.json", "production-readiness.json", "lineage.json", "remediation.json", "normalization-audit.json", "review-queue.json"].map((file) => {
    const bytes = readSourceFile(path.join(stage, file));
    return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = sanitizeExpectationValue({
    schemaVersion: 3,
    packageType: "reviewed-expectations",
    packageVersion: "3.2",
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
    promptSourceSha256: PROMPT_SOURCE_SHA256,
    resultOrigin: "model output + deterministic normalization",
    normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
    numericChangeSemantics: EXPECTATION_NUMERIC_CHANGE_SEMANTICS,
    nonAliasSnapshotPolicy: "Full beforeStatement and afterStatement snapshots; statementKey=before and afterStatementKeys=after",
    counts: normalization.counts,
    development,
    holdout,
    reviewCategoryCounts: normalization.reviewCategoryCounts,
    benchmarkEvaluationType: BENCHMARK_EVALUATION_TYPE,
    exactKeyDefinition: "(cik, accessionNo, sourceId, containerId)",
    companies: coverage.companiesWithResults,
    documents: coverage.documents,
    thinCompanies,
    remediationStatements: remediation.statements.length,
    duplicateResultKeys: 0,
    excludedArtifacts: EXCLUDED,
    files,
  });
  writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(path.dirname(out), { recursive: true });
  powerShell(`Compress-Archive -Path ${psQuote(path.join(stage, "*"))} -DestinationPath ${psQuote(out)} -CompressionLevel Optimal`);
  powerShell(`Expand-Archive -Path ${psQuote(out)} -DestinationPath ${psQuote(verify)} -Force`);
  const forbidden = [
    /(?:^|[^A-Za-z])[A-Za-z]:[\\/]/, /worker[\\/]{1,2}\.runs/i, /rawResponse|fallbackRawResponse|rawLogs/i,
    /\.env|credentials|connection strings|localhost/i, /"operationsState"\s*:/i, /worker[_-]?key|access[_-]?token|api[_-]?key|bearer\s+[a-z0-9]/i,
    /mysql:\/\/|postgres:\/\/|database urls?|db urls?/i, /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  ];
  for (const file of [...files, { path: "manifest.json", bytes: readSourceFile(path.join(stage, "manifest.json")).length, sha256: sha256(readSourceFile(path.join(stage, "manifest.json"))) }]) {
    const actual = readSourceFile(path.join(verify, file.path));
    if (actual.length !== file.bytes || sha256(actual) !== file.sha256) throw new Error(`ZIP verification failed for ${file.path}`);
    const text = actual.toString("utf8");
    if (forbidden.some((pattern) => pattern.test(text))) throw new Error(`Forbidden package content in ${file.path}`);
  }
  const zipBytes = readSourceFile(out);
  console.log(JSON.stringify({
    zip: out,
    bytes: zipBytes.length,
    sha256: sha256(zipBytes),
    scope: PACKAGE_SCOPE,
    packageVersion: "3.2",
    normalizationVersion: EXPECTATION_NORMALIZATION_VERSION,
    applyStatus: "not_run",
    resultCount: resultsPayload.results.length,
    resolverReport: resultsPayload.resolverReport,
    normalizationCounts: normalization.counts,
    topUnmappedMetricRaw: normalization.topUnmappedMetricRaw,
    development,
    holdout,
    companiesWithResults: coverage.companiesWithResults,
    companiesExpected: coverage.companiesExpected,
    documents: coverage.documents,
    statements: coverage.statements,
    fallbacks: coverage.fallbacks,
    fallbackUnverified: coverage.fallbackUnverified,
    thinCompanies,
    remediationStatements: remediation.statements.length,
    fallbackAudit,
    benchmark: { evaluationType: BENCHMARK_EVALUATION_TYPE, pass: sanitizedBenchmark.pass, recall: sanitizedBenchmark.recall, issues: sanitizedBenchmark.issues.length },
    productionReadiness,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
