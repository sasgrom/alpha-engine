import { describe, expect, it } from "vitest";
import { assertBenchmarkPassed, BENCHMARK_EVALUATION_TYPE, buildCoverage, buildFallbackAudit, buildRemediationProvenance, canonicalSecUrl, mergeResultEntries, normalizeCohortEntries, resultKey, sanitizeExpectationValue } from "./export-expectations-reviewed.mts";
import type { CohortResultEntry } from "../worker/lib/cohort-checkpoint";
import benchmark from "../research/expectations-benchmark-v1.json";

const companies = [
  { cik: 1, ticker: "AAA" },
  { cik: 2, ticker: "BBB" },
];

const entry = (overrides: Partial<CohortResultEntry> = {}): CohortResultEntry => ({
  cik: 1,
  ticker: "AAA",
  cohortId: "2026-09-30",
  containerId: "container-1",
  sourceId: "source-1",
  accessionNo: "0000000001-26-000001",
  form: "8-K",
  filingDate: "2026-10-29",
  eventTs: "2026-10-29 00:00:00",
  reportDate: "2026-09-30",
  sourceFile: "filing.htm",
  inputSha256: "abc",
  model: "qwen3.5:9b",
  promptVersion: "expectations-v4",
  status: "extracted",
  guidanceStatus: "found",
  statements: [],
  extractionWarnings: [],
  rejectedEvidence: 0,
  rawResponse: null,
  fallback: null,
  fallbackRawResponse: null,
  fallbackUsage: null,
  usage: null,
  updatedAt: "2026-11-01T00:00:00Z",
  ...overrides,
});

describe("reviewed expectations package", () => {
  it("maps empty to no_candidate_text without creating a statement", () => {
    const coverage = buildCoverage(companies, [entry({ status: "empty", guidanceStatus: "not_found" }), entry({ cik: 2, ticker: "BBB" })]);
    expect(coverage.statusCounts.no_candidate_text).toBe(1);
    expect(coverage.statusCounts.empty).toBe(1);
    expect(coverage.statements).toBe(0);
  });

  it("keeps fallback and fallback_unverified distinct with factual evidence flags", () => {
    const fallback = { summary: "s", dataQuality: "usable" as const, guidancePresence: "present" as const, limitations: [], evidence: "x", evidenceVerified: true };
    const unverified = { ...fallback, evidenceVerified: false };
    const coverage = buildCoverage(companies, [entry({ status: "fallback", fallback }), entry({ cik: 2, ticker: "BBB", status: "fallback_unverified", fallback: unverified })]);
    expect(coverage.fallbacks).toBe(1);
    expect(coverage.fallbackUnverified).toBe(1);
    expect(coverage.fallbackEvidenceVerified).toBe(1);
    expect(coverage.fallbackEvidenceUnverified).toBe(1);
  });

  it("rejects duplicate result keys", () => {
    expect(() => buildCoverage(companies, [entry(), entry(), entry({ cik: 2, ticker: "BBB" })])).toThrow("duplicate result keys");
  });

  it("removes raw responses and local metadata paths", () => {
    const sanitized = sanitizeExpectationValue({ rawResponse: "secret", fallbackRawResponse: "fallback", sourceFile: "C:/dev/alpha-engine/file.htm", benchmarkPath: "C:\\dev\\alpha-engine\\research\\gold.json", statements: [{ evidence: "Revenue" }] });
    expect(sanitized).toEqual({ statements: [{ evidence: "Revenue" }] });
    expect(sanitizeExpectationValue("log-in credentials were not compromised")).toBe("log-in access information were not compromised");
    expect(() => sanitizeExpectationValue("D:\\research\\filing.htm")).toThrow("Local path or secret-like value excluded");
  });

  it("forbids reviewed publication without a passing post-remediation regression", () => {
    expect(() => assertBenchmarkPassed({ pass: false, issues: [] })).toThrow("Post-remediation regression has not passed");
    expect(() => assertBenchmarkPassed({ pass: true, issues: [{}] })).toThrow("Post-remediation regression has not passed");
    expect(() => assertBenchmarkPassed({ pass: true, issues: [] })).not.toThrow();
  });

  it("does not duplicate resumed entries and keeps the newest checkpoint", () => {
    const old = entry({ statements: [{ metric: "old" } as never], updatedAt: "2026-11-01T00:00:00Z" });
    const current = entry({ statements: [{ metric: "new" } as never], updatedAt: "2026-11-02T00:00:00Z" });
    const merged = mergeResultEntries([old, current]);
    expect(merged).toHaveLength(1);
    expect(merged[0].statements[0].metric).toBe("new");
  });

  it("preserves failed=1 with accession and reason", () => {
    const failed = entry({ status: "request_failed", extractionWarnings: ["prediction aborted, token repeat limit reached"] });
    const coverage = buildCoverage(companies, [failed, entry({ cik: 2, ticker: "BBB" })]);
    expect(coverage.failed).toHaveLength(1);
    expect(coverage.failed[0]).toMatchObject({ accessionNo: failed.accessionNo, retryable: false, final: true });
    expect(coverage.failed[0].reason).toContain("token repeat limit reached");
  });

  it("reconciles fallback attachments with statuses after remediation", () => {
    const fallback = { summary: "s", dataQuality: "usable" as const, guidancePresence: "present" as const, limitations: [], evidence: "x", evidenceVerified: true };
    const remediated = entry({ status: "extracted", fallback });
    const audit = buildFallbackAudit([remediated], 1);
    expect(audit.fallbackStatusCount).toBe(0);
    expect(audit.fallbackAttachmentsOutsideFallbackStatus).toHaveLength(1);
    expect(audit.fallbackAttachmentsOutsideFallbackStatus[0]).toMatchObject({ status: "extracted", evidenceVerified: true });
    expect(() => buildFallbackAudit([remediated], 0)).toThrow("does not match attachments");
  });

  it("records deterministic statement provenance with evidence hashes", () => {
    const pfe = benchmark.documents.find((document) => document.ticker === "PFE")!;
    const statements = pfe.required.map((gold) => ({
      metric: gold.metric,
      scopeRaw: gold.scopeAny[0],
      periodRaw: gold.periodAny[0],
      basis: gold.basis,
      qualifier: gold.qualifier,
      valueLow: gold.low ?? null,
      valueHigh: gold.high ?? null,
      valuePoint: gold.point ?? null,
      tolerance: gold.tolerance ?? null,
      toleranceUnit: gold.toleranceUnit ?? null,
      unit: gold.unit ?? "other",
      revision: gold.revision ?? "unclear",
      evidence: `Exact source evidence for ${gold.metric}`,
    }) as never);
    const remediated = entry({ cik: pfe.cik, ticker: pfe.ticker, accessionNo: pfe.accessionNo, statements });
    const provenance = buildRemediationProvenance({ ...benchmark, documents: [pfe] } as never, [remediated]);
    expect(provenance.benchmarkEvaluationType).toBe(BENCHMARK_EVALUATION_TYPE);
    expect(provenance.statements).toHaveLength(2);
    expect(provenance.statements[0]).toMatchObject({ ticker: "PFE", remediationKind: "gold_source_backfill", scriptVersion: 1 });
    expect(provenance.statements.every((statement) => /^[a-f0-9]{64}$/.test(statement.evidenceSha256))).toBe(true);
  });

  it("builds normalized output with audit and a separate scale review queue", () => {
    const statement = {
      kind: "guidance", metricRaw: "total expenses", metric: "other", scopeRaw: "consolidated", periodRaw: "2026", comparisonRaw: null,
      qualifier: "range", valueLow: 1, valueHigh: 2, valuePoint: null, tolerance: null, toleranceUnit: null, valueText: null,
      unit: "usd_billions", basis: "reported", currencyBasis: "reported", revision: "unclear", previousLow: null, previousHigh: null,
      previousPoint: null, previousGuidanceDateRaw: null, assumptionRaw: null, sourceSection: "Outlook", evidence: "Total expenses are expected to be $1 billion to $2 billion.",
    } as never;
    const scale = {
      ...statement, metricRaw: "Revenue", metric: "revenue", qualifier: "point", valueLow: null, valueHigh: null, valuePoint: 1160,
      unit: "usd_millions", evidence: "Revenue is expected to be $1.16 billion.",
    } as never;
    const input = entry({ statements: [statement, scale] });
    const result = normalizeCohortEntries([input]);
    expect(input.statements[0].metric).toBe("other");
    expect(result.normalizedEntries[0].statements.map((item) => item.canonicalMetric)).toEqual(["expense.total", "revenue"]);
    expect(result.counts).toMatchObject({ inputStatements: 2, outputStatements: 2, canonicalUnmapped: 0 });
    expect(result.reviewCategoryCounts.value_unit_scale).toBe(1);
    expect(result.reviewCategoryCounts.ambiguous).toBe(0);
    expect(result.audit.every((item) => item.evidenceSha256 && item.normalizationVersion)).toBe(true);
  });

  it("uses canonical SEC URLs and stable result keys", () => {
    expect(canonicalSecUrl(1045810, "0001045810-26-000073")).toBe("https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/");
    expect(resultKey(entry())).toBe("1|0000000001-26-000001|source-1|container-1");
  });
});
