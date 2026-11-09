import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCohortPack, type CohortSourceDocument } from "./cohort-pack";
import { auditCohortResults } from "./cohort-qa";
import type { CohortResultEntry } from "./cohort-checkpoint";
import type { ExpectationStatement } from "./expectations";

const doc = (sourceId: string, plain: string): CohortSourceDocument => ({
  cik: 1,
  ticker: "AAA",
  accessionNo: `0001-26-${sourceId === "a" ? "000001" : "000002"}`,
  sourceId,
  form: "8-K",
  role: "exhibit",
  sourceFile: `${sourceId}.htm`,
  filingDate: "2026-10-30",
  eventTs: "2026-10-30 12:00:00",
  reportDate: "2026-09-30",
  plain,
});
const pack = buildCohortPack([
  doc("a", "Revenue was $50 billion in the quarter."),
  doc("b", "Revenue is expected to be $100 billion."),
], { contextTokens: 32768, generatedAt: "now" });
const container = pack.containers[0];
const inputHash = (sourceId: string) => createHash("sha256").update(`${sourceId}\n${container.inputSha256}`).digest("hex");
const statement: ExpectationStatement = {
  kind: "guidance",
  metricRaw: "revenue",
  metric: "revenue",
  scopeRaw: "company",
  periodRaw: "next quarter",
  comparisonRaw: null,
  qualifier: "point",
  valueLow: null,
  valueHigh: null,
  valuePoint: 100,
  tolerance: null,
  toleranceUnit: null,
  valueText: null,
  unit: "usd_billions",
  basis: "gaap",
  currencyBasis: "reported",
  revision: "initial",
  previousLow: null,
  previousHigh: null,
  previousPoint: null,
  previousGuidanceDateRaw: null,
  assumptionRaw: null,
  sourceSection: null,
  evidence: "Revenue is expected to be $100 billion.",
};
const entry = (sourceId: string, overrides: Partial<CohortResultEntry> = {}): CohortResultEntry => ({
  cik: 1,
  ticker: "AAA",
  cohortId: container.cohortId,
  containerId: container.containerId,
  sourceId,
  accessionNo: sourceId === "a" ? "0001-26-000001" : "0001-26-000002",
  form: "8-K",
  filingDate: "2026-10-30",
  eventTs: "2026-10-30 12:00:00",
  reportDate: "2026-09-30",
  sourceFile: `${sourceId}.htm`,
  inputSha256: inputHash(sourceId),
  model: "model",
  promptVersion: "prompt",
  status: "extracted",
  guidanceStatus: sourceId === "a" ? "not_found" : "found",
  statements: sourceId === "a" ? [] : [statement],
  extractionWarnings: [],
  rejectedEvidence: 0,
  rawResponse: "{}",
  fallback: null,
  fallbackRawResponse: null,
  fallbackUsage: null,
  usage: { promptTokens: 6000, evalCount: 110, promptMs: 100, evalMs: 100, totalMs: 200 },
  updatedAt: "2026-10-30T13:00:00Z",
  ...overrides,
});

describe("cohort result QA", () => {
  it("accepts valid short structured responses without treating not_found as an error", () => {
    const report = auditCohortResults(pack, [entry("a"), entry("b")]);
    expect(report.status).toBe("pass");
    expect(report.summary.statements).toBe(1);
    expect(report.summary.notFound).toBe(1);
    expect(report.summary.medianPromptTokens).toBe(6000);
    expect(report.summary.medianGeneratedTokens).toBe(110);
  });

  it("fails output truncation and found-without-statements instead of hiding them", () => {
    const report = auditCohortResults(pack, [
      entry("a", { usage: { promptTokens: 6000, evalCount: 4096, promptMs: 100, evalMs: 100, totalMs: 200 } }),
      entry("b", { guidanceStatus: "found", statements: [] }),
    ]);
    expect(report.status).toBe("fail");
    expect(report.issues.some((issue) => issue.type === "output_truncated")).toBe(true);
    expect(report.issues.some((issue) => issue.type === "found_without_statements")).toBe(true);
  });

  it("marks missing coverage and suspicious not_found separately from hard failures", () => {
    const report = auditCohortResults(pack, [entry("b", { guidanceStatus: "not_found", statements: [] })]);
    expect(report.status).toBe("incomplete");
    expect(report.summary.missingSources).toBe(1);
    expect(report.issues.some((issue) => issue.type === "not_found_with_expectation_language")).toBe(true);
    expect(report.summary.hardErrors).toBe(0);
  });

  it("rejects stored evidence that is absent from the exact target block", () => {
    const report = auditCohortResults(pack, [entry("a"), entry("b", { statements: [{ ...statement, evidence: "Revenue is expected to be $999 billion." }] })]);
    expect(report.status).toBe("fail");
    expect(report.issues.some((issue) => issue.type === "evidence_mismatch")).toBe(true);
  });

  it("honors per-entry output caps for retry lineage", () => {
    const report = auditCohortResults(pack, [entry("a", { outputTokens: 8192, usage: { promptTokens: 6000, evalCount: 4096, promptMs: 100, evalMs: 100, totalMs: 200 } })]);
    expect(report.issues.some((issue) => issue.type === "output_truncated")).toBe(false);
  });
});
