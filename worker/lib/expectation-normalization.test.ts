import { describe, expect, it } from "vitest";
import type { ExpectationStatement } from "./expectations";
import { normalizeExpectationStatement } from "./expectation-normalization";
import { expectationEvidenceSha256 } from "./expectation-normalization-rules";

const base = (overrides: Partial<ExpectationStatement> = {}): ExpectationStatement => ({
  kind: "guidance",
  metricRaw: "Revenue",
  metric: "revenue",
  scopeRaw: "consolidated",
  periodRaw: "Q3 FY27",
  comparisonRaw: null,
  qualifier: "point",
  valueLow: null,
  valueHigh: null,
  valuePoint: 108,
  tolerance: null,
  toleranceUnit: null,
  valueText: null,
  unit: "usd_billions",
  basis: "reported",
  currencyBasis: "reported",
  revision: "unclear",
  previousLow: null,
  previousHigh: null,
  previousPoint: null,
  previousGuidanceDateRaw: null,
  assumptionRaw: null,
  sourceSection: "Outlook",
  evidence: "Revenue is expected to be $108.0 billion, plus or minus 2%.",
  ...overrides,
});

const context = { ticker: "NVDA", cik: 1045810, accessionNo: "acc-1" };

describe("generic expectation normalization development sample", () => {
  it("extracts evidence-backed numeric tolerance with an immutable audit trail", () => {
    const input = base();
    const before = structuredClone(input);
    const result = normalizeExpectationStatement(input, context);
    expect(input).toEqual(before);
    expect(result.statements[0]).toMatchObject({ qualifier: "plus_minus", tolerance: 2, toleranceUnit: "percent" });
    const audit = result.audit.find((item) => item.ruleId === "GENERIC_PLUS_MINUS_FROM_EVIDENCE")!;
    expect(audit.numericChange).toBe(true);
    expect(audit.normalizationVersion).toBe("expectation-normalization-v2");
    expect(audit.evidenceSha256).toBe(expectationEvidenceSha256(input));
    expect(audit.changes).toContainEqual({ field: "tolerance", before: null, after: 2 });
  });

  it("splits combined GAAP and non-GAAP margins without NVDA-specific code", () => {
    const input = base({
      metricRaw: "GAAP and non-GAAP gross margins are expected to be 74.0%, plus or minus 50 basis points.",
      metric: "other",
      valuePoint: 74,
      tolerance: 50,
      toleranceUnit: "basis_points",
      unit: "percent",
      basis: "gaap",
      evidence: "GAAP and non-GAAP gross margins are expected to be 74.0%, plus or minus 50 basis points.",
    });
    const result = normalizeExpectationStatement(input, context);
    expect(result.statements).toHaveLength(2);
    expect(result.statements.map((statement) => statement.basis)).toEqual(["gaap", "non_gaap"]);
    expect(result.statements.map((statement) => statement.canonicalMetric)).toEqual(["margin.gross.gaap", "margin.gross.non_gaap"]);
    expect(result.audit.some((item) => item.ruleId === "GENERIC_SPLIT_COMBINED_BASIS")).toBe(true);
  });

  it("keeps respectively-valued combined statements in the review queue", () => {
    const input = base({
      metricRaw: "GAAP and non-GAAP gross margins",
      metric: "margin",
      valuePoint: 55.2,
      evidence: "GAAP and non-GAAP gross margins are expected to be 55.2 percent and 55.5 percent, respectively.",
    });
    const result = normalizeExpectationStatement(input, context);
    expect(result.statements).toHaveLength(1);
    expect(result.review.some((item) => item.ruleId === "REVIEW_COMBINED_BASIS_VALUES")).toBe(true);
  });

  it("uses the reviewed industry alias map for bank metrics", () => {
    const result = normalizeExpectationStatement(base({ metricRaw: "NII excluding markets", metric: "nii", evidence: "NII excluding markets is expected to be approximately $96.5 billion." }), { ticker: "JPM", cik: 19617, accessionNo: "acc-jpm" });
    expect(result.statements[0].canonicalMetric).toBe("nii.excluding_markets");
  });

  it("normalizes guidance-vintage revision language for retail guidance", () => {
    const result = normalizeExpectationStatement(base({ metricRaw: "Net sales", evidence: "We raised our full year guidance for net sales." }), { ticker: "WMT", cik: 104169, accessionNo: "acc-wmt" });
    expect(result.statements[0]).toMatchObject({ revision: "raised", canonicalMetric: "revenue.net_sales" });
  });

  it("does not rewrite scale anomalies or numeric values without review", () => {
    const input = base({ unit: "usd_millions", valuePoint: 1160, evidence: "Revenue is expected to be $1.16 billion." });
    const result = normalizeExpectationStatement(input, context);
    expect(result.statements[0].valuePoint).toBe(1160);
    expect(result.statements[0].unit).toBe("usd_millions");
    expect(result.audit.filter((item) => item.numericChange)).toHaveLength(0);
    expect(result.review.some((item) => item.ruleId === "DISCOVER_UNIT_EVIDENCE_SCALE")).toBe(true);
  });

  it("does not attach another metric's tolerance across evidence clauses", () => {
    const amd = normalizeExpectationStatement(base({ metricRaw: "gross margin", metric: "margin", qualifier: "approximately", valuePoint: 45, unit: "percent", basis: "non_gaap", evidence: "AMD expects 2020 revenue to grow by approximately 25 percent, plus or minus 5 percentage points, compared to 2019 and non-GAAP gross margin to be approximately 45 percent." }), { ticker: "AMD", cik: 2488, accessionNo: "acc-amd" });
    expect(amd.statements[0]).toMatchObject({ qualifier: "approximately", tolerance: null });
    expect(amd.audit.filter((item) => item.numericChange)).toHaveLength(0);
    const nee = normalizeExpectationStatement(base({ metricRaw: "adjusted equity ratio of 55.8%", metric: "other", qualifier: "approximately", valuePoint: 55.8, unit: "percent", evidence: "FPL was granted a regulatory return on common equity of 10.0% with a range of plus or minus 100 basis points and an adjusted equity ratio of 55.8%, as well as the shift of certain costs to the cost recovery clauses." }), { ticker: "NEE", cik: 753308, accessionNo: "acc-nee" });
    expect(nee.statements[0]).toMatchObject({ qualifier: "approximately", tolerance: null });
    expect(nee.audit.filter((item) => item.numericChange)).toHaveLength(0);
  });

  it("converts evidence-backed percentage points to basis points with numeric audit", () => {
    const result = normalizeExpectationStatement(base({ qualifier: "approximately", valuePoint: 25, unit: "percent", evidence: "Revenue is expected to grow approximately 25 percent, plus or minus 5 percentage points." }), context);
    expect(result.statements[0]).toMatchObject({ qualifier: "plus_minus", tolerance: 500, toleranceUnit: "basis_points" });
    const audit = result.audit.find((item) => item.ruleId === "GENERIC_PLUS_MINUS_FROM_EVIDENCE")!;
    expect(audit.numericChange).toBe(true);
    expect(audit.changes).toContainEqual({ field: "tolerance", before: null, after: 500 });
  });

  it("normalizes explicit non-disclosure only when no numeric target is present", () => {
    const result = normalizeExpectationStatement(base({ valuePoint: null, valueText: "not provided", unit: "text", evidence: "We do not provide guidance for this metric." }), context);
    expect(result.statements[0]).toMatchObject({ kind: "non_disclosure", qualifier: "not_provided", revision: "not_provided" });
  });
});
