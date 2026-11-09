import { describe, expect, it } from "vitest";
import type { CohortResultEntry } from "./cohort-checkpoint";
import type { ExpectationStatement } from "./expectations";
import { normalizeExpectationStatement } from "./expectation-normalization";
import { assertV34Audit, transformV34Entries } from "./expectation-normalization-v34";
import { applyV34DeferredStatus, deferredToCallEvidence } from "./expectation-status-v34";

const base = (overrides: Partial<ExpectationStatement> = {}): ExpectationStatement => ({
  kind: "guidance",
  metricRaw: "Revenue",
  metric: "revenue",
  scopeRaw: "consolidated",
  periodRaw: "Q1 2026",
  comparisonRaw: null,
  qualifier: "point",
  valueLow: null,
  valueHigh: null,
  valuePoint: 1160,
  tolerance: null,
  toleranceUnit: null,
  valueText: null,
  unit: "usd_millions",
  basis: "reported",
  currencyBasis: "reported",
  revision: "unclear",
  previousLow: null,
  previousHigh: null,
  previousPoint: null,
  previousGuidanceDateRaw: null,
  assumptionRaw: null,
  sourceSection: "Outlook",
  evidence: "Revenue is expected to be $1.16 billion.",
  ...overrides,
});

const context = { ticker: "NVDA", cik: 1045810, accessionNo: "acc-1" };
function run(statement: ExpectationStatement) {
  const normalized = normalizeExpectationStatement(statement, context);
  const entry = {
    cik: context.cik,
    ticker: context.ticker,
    cohortId: "2026-03-31",
    containerId: "container",
    sourceId: "source",
    accessionNo: context.accessionNo,
    form: "8-K",
    filingDate: "2026-01-01",
    eventTs: "2026-01-01 00:00:00",
    reportDate: "2025-12-31",
    sourceFile: "source.htm",
    inputSha256: "hash",
    model: "model",
    promptVersion: "v4",
    status: "extracted",
    guidanceStatus: "found",
    statements: normalized.statements,
    extractionWarnings: [],
    rejectedEvidence: 0,
    rawResponse: null,
    fallback: null,
    fallbackRawResponse: null,
    fallbackUsage: null,
    usage: null,
    updatedAt: "2026-01-01T00:00:00Z",
  } as CohortResultEntry & { statements: typeof normalized.statements };
  const result = transformV34Entries([entry], normalized.review);
  assertV34Audit(result.audit);
  return result;
}

describe("Expectations normalization v3.4", () => {
  it("reconciles scale only when explicit evidence amounts match after x1e-3", () => {
    const result = run(base());
    expect(result.entries[0].statements[0]).toMatchObject({ unit: "usd_billions", valuePoint: 1.16 });
    expect(result.audit.find((item) => item.ruleId === "SCALE_EVIDENCE_RECONCILE")?.numericChange).toBe(true);
    expect(result.review.some((item) => item.ruleId === "DISCOVER_UNIT_EVIDENCE_SCALE")).toBe(false);
  });

  it("does not convert when evidence has no explicit scale word", () => {
    const input = base({ evidence: "Revenue is expected to be $1,160." });
    const result = run(input);
    expect(result.entries[0].statements[0]).toEqual(expect.objectContaining({ unit: "usd_millions", valuePoint: 1160 }));
    expect(result.untouched.map((item) => item.statement)).toEqual([expect.objectContaining({ unit: "usd_millions", valuePoint: 1160 })]);
    expect(result.audit).toHaveLength(0);
  });

  it("splits respectively values into per-basis statements", () => {
    const result = run(base({
      metricRaw: "GAAP and non-GAAP gross margins are expected to be 52.9 percent and 53.2 percent, respectively.",
      metric: "other",
      basis: "gaap",
      valuePoint: 53.05,
      unit: "percent",
      evidence: "GAAP and non-GAAP gross margins are expected to be 52.9 percent and 53.2 percent, respectively.",
    }));
    expect(result.entries[0].statements.map((statement) => [statement.basis, statement.valuePoint])).toEqual([["gaap", 52.9], ["non_gaap", 53.2]]);
    expect(result.audit.some((item) => item.ruleId === "COMBINED_BASIS_SPLIT")).toBe(true);
    expect(result.review.some((item) => item.category === "combined_basis")).toBe(false);
  });

  it("does not split respectively with only one explicit value", () => {
    const result = run(base({
      metricRaw: "GAAP and non-GAAP gross margins are expected to be 52.9 percent, respectively.",
      metric: "other",
      valuePoint: 52.9,
      unit: "percent",
      evidence: "GAAP and non-GAAP gross margins are expected to be 52.9 percent, respectively.",
    }));
    expect(result.entries[0].statements).toHaveLength(1);
    expect(result.audit.some((item) => item.ruleId === "COMBINED_BASIS_SPLIT")).toBe(false);
    expect(result.untouched).toHaveLength(1);
  });

  it("downgrades an incomplete range with a value and records a non-blocking warning", () => {
    const result = run(base({ qualifier: "range", valueLow: 1, valuePoint: null, evidence: "Revenue is expected to range from $1 million." }));
    expect(result.entries[0].statements[0]).toMatchObject({ qualifier: "approximately", valuePoint: 1, valueLow: null });
    expect(result.audit.some((item) => item.ruleId === "QUALIFIER_DOWNGRADE")).toBe(true);
    expect(result.review.find((item) => item.ruleId === "QUALIFIER_DOWNGRADE")?.blocking).toBe(false);
  });

  it("rejects a value-free incomplete plus/minus only with an explicit audit record", () => {
    const result = run(base({ qualifier: "plus_minus", valuePoint: null, tolerance: 2, toleranceUnit: "percent", evidence: "Revenue is expected to be flat, plus or minus two percent." }));
    expect(result.entries[0].statements).toHaveLength(0);
    const audit = result.audit.find((item) => item.ruleId === "QUALIFIER_DOWNGRADE");
    expect(audit?.afterStatementKeys).toEqual([]);
    expect(audit?.changes).toContainEqual({ field: "disposition", before: "incomplete_qualifier", after: "rejected_no_numeric_value" });
  });

  it("uses legacy other instead of salvaging beyond the two-year cutoff", () => {
    const result = run(base({ metricRaw: "comp store sales", metric: "other", periodRaw: "Q1 2020", evidence: "Comp store sales are expected to increase." }));
    expect(result.entries[0].statements[0].canonicalMetric).toBe("other");
    expect(result.audit.some((item) => item.ruleId === "METRIC_OTHER_LEGACY")).toBe(true);
    expect(result.review.find((item) => item.ruleId === "METRIC_OTHER_LEGACY")?.blocking).toBe(false);
  });

  it("salvages reviewed aliases in the recent slice", () => {
    const result = run(base({ metricRaw: "Core FFO", metric: "other", evidence: "Core FFO is expected to increase." }));
    expect(result.entries[0].statements[0].canonicalMetric).toBe("ffo.core");
    expect(result.summary).toMatchObject({ recentUnmapped: 1, recentSalvaged: 1, recentResidualOther: 0 });
    expect(result.audit.some((item) => item.ruleId === "METRIC_ALIAS_SALVAGE")).toBe(true);
  });

  it("retains recent residual noise as non-blocking other and reports it", () => {
    const result = run(base({ metricRaw: "DCF", metric: "other", evidence: "DCF" }));
    expect(result.entries[0].statements[0].canonicalMetric).toBe("other");
    expect(result.summary).toMatchObject({ recentUnmapped: 1, recentSalvaged: 0, recentResidualOther: 1, recentResidualNoiseSuspected: 1 });
    expect(result.review.find((item) => item.ruleId === "METRIC_OTHER_RESIDUAL")?.blocking).toBe(false);
  });

  it("resolves two-digit fiscal years before applying the cutoff", () => {
    const legacy = run(base({ metricRaw: "comp store sales", metric: "other", periodRaw: "Q2 FY24", evidence: "Comp store sales are expected to increase." }));
    expect(legacy.audit.some((item) => item.ruleId === "METRIC_OTHER_LEGACY" && item.periodEnd === "2024-06-30")).toBe(true);
    const recent = run(base({ metricRaw: "comp store sales", metric: "other", periodRaw: "Q2 FY25", evidence: "Comp store sales are expected to increase." }));
    expect(recent.entries[0].statements[0].canonicalMetric).toBe("revenue.comparable_sales");
    expect(recent.summary.recentUnmapped).toBe(1);
  });

  it("resolves the missing-point review after a respectively split", () => {
    const result = run(base({
      metricRaw: "GAAP and non-GAAP gross margins are expected to be 56.2 percent and 56.5 percent, respectively, plus or minus 50 basis points.",
      metric: "other",
      qualifier: "plus_minus",
      basis: "gaap",
      valuePoint: null,
      tolerance: 50,
      toleranceUnit: "basis_points",
      unit: "percent",
      evidence: "GAAP and non-GAAP gross margins are expected to be 56.2 percent and 56.5 percent, respectively, plus or minus 50 basis points.",
    }));
    expect(result.entries[0].statements).toHaveLength(2);
    expect(result.review.some((item) => item.ruleId === "DISCOVER_TOLERANCE_SHAPE")).toBe(false);
  });

  it("rejects approximate plus/minus evidence with no numeric statement value", () => {
    const result = run(base({ qualifier: "approximately", valuePoint: null, tolerance: 3, toleranceUnit: "percent", evidence: "Revenue to increase 5 percent, plus or minus 3 percent, sequentially." }));
    expect(result.entries[0].statements).toHaveLength(0);
    expect(result.summary.qualifierRejected).toBe(1);
  });

  it("aligns reviewed metric metadata without changing values or evidence", () => {
    const input = base({
      metricRaw: "Net sales",
      metric: "other",
      scopeRaw: "Fourth Quarter 2026",
      periodRaw: "fourth quarter 2026",
      qualifier: "range",
      valueLow: 240,
      valueHigh: 247,
      valuePoint: null,
      unit: "usd_billions",
      basis: "gaap",
      evidence: "Net sales are expected to be between $240.0 billion and $247.0 billion.",
    });
    const result = run(input);
    expect(result.entries[0].statements[0]).toMatchObject({ metric: "revenue", scopeRaw: "Net sales", basis: "reported", valueLow: 240, valueHigh: 247, evidence: input.evidence });
    expect(result.audit.some((item) => item.ruleId === "METRIC_ALIAS_SALVAGE")).toBe(true);
  });

  it("derives reaffirmed revision from continued guidance language", () => {
    const result = run(base({
      metricRaw: "Cash capital expenditures",
      metric: "capex",
      scopeRaw: "2026",
      periodRaw: "2026",
      qualifier: "approximately",
      valueLow: null,
      valueHigh: null,
      valuePoint: 220,
      unit: "usd_billions",
      basis: "gaap",
      evidence: "We continue to expect 2026 cash capital expenditures to be approximately $220 billion.",
    }));
    expect(result.entries[0].statements[0]).toMatchObject({ revision: "reaffirmed", scopeRaw: "Cash capital expenditures", basis: "reported" });
    expect(result.audit.some((item) => item.ruleId === "REVISION_REAFFIRM_FROM_EVIDENCE")).toBe(true);
  });

  it("marks deferred guidance only with source-backed call language", () => {
    const entry = {
      guidanceStatus: "not_found",
      statements: [],
      extractionWarnings: ["Microsoft will provide forward-looking guidance on its earnings conference call; no values are present."],
    } as never;
    const source = "Microsoft will provide forward-looking guidance in connection with this quarterly earnings announcement on its earnings conference call and webcast.";
    expect(deferredToCallEvidence(entry, source)).toBe(true);
    const result = applyV34DeferredStatus([entry], () => source);
    expect(result.entries[0].guidanceStatus).toBe("deferred_to_call");
    expect(result.resultAudit[0]).toMatchObject({ ruleId: "GUIDANCE_STATUS_DEFERRED_TO_CALL", beforeGuidanceStatus: "not_found", afterGuidanceStatus: "deferred_to_call" });
    expect(deferredToCallEvidence(entry, "No guidance values are present in this release.")).toBe(false);
  });

  it("preserves untouched statements byte-for-byte", () => {
    const input = base({ metricRaw: "Revenue", evidence: "Revenue is expected to be $1.16 billion.", unit: "usd_billions", valuePoint: 1.16 });
    const result = run(input);
    expect(result.audit).toHaveLength(0);
    expect(JSON.stringify(result.untouched[0].statement)).toBe(JSON.stringify(result.entries[0].statements[0]));
  });
});
