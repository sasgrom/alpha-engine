import { describe, expect, it } from "vitest";
import { assertBenchmarkPassed, buildCoverage, canonicalSecUrl, mergeResultEntries, resultKey, sanitizeExpectationValue } from "./export-expectations-reviewed.mts";
import type { CohortResultEntry } from "../worker/lib/cohort-checkpoint";

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

  it("removes raw responses and rejects local paths", () => {
    const sanitized = sanitizeExpectationValue({ rawResponse: "secret", fallbackRawResponse: "fallback", sourceFile: "C:/dev/alpha-engine/file.htm", statements: [{ evidence: "Revenue" }] });
    expect(sanitized).toEqual({ statements: [{ evidence: "Revenue" }] });
    expect(() => sanitizeExpectationValue("D:\\research\\filing.htm")).toThrow("Local path or secret-like value excluded");
  });

  it("forbids reviewed publication without a passing benchmark", () => {
    expect(() => assertBenchmarkPassed({ pass: false, issues: [] })).toThrow("Independent benchmark has not passed");
    expect(() => assertBenchmarkPassed({ pass: true, issues: [{}] })).toThrow("Independent benchmark has not passed");
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

  it("uses canonical SEC URLs and stable result keys", () => {
    expect(canonicalSecUrl(1045810, "0001045810-26-000073")).toBe("https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/");
    expect(resultKey(entry())).toBe("1|0000000001-26-000001|source-1|container-1");
  });
});
