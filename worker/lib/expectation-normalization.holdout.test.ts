import { describe, expect, it } from "vitest";
import type { ExpectationStatement } from "./expectations";
import { normalizeExpectationStatement } from "./expectation-normalization";

const statement = (overrides: Partial<ExpectationStatement>): ExpectationStatement => ({
  kind: "guidance",
  metricRaw: "Adjusted diluted EPS",
  metric: "other",
  scopeRaw: "consolidated",
  periodRaw: "2026",
  comparisonRaw: null,
  qualifier: "range",
  valueLow: 2.8,
  valueHigh: 3,
  valuePoint: null,
  tolerance: null,
  toleranceUnit: null,
  valueText: null,
  unit: "usd_per_share",
  basis: "non_gaap",
  currencyBasis: "reported",
  revision: "reaffirmed",
  previousLow: null,
  previousHigh: null,
  previousPoint: null,
  previousGuidanceDateRaw: null,
  assumptionRaw: null,
  sourceSection: "Outlook",
  evidence: "Adjusted diluted EPS is expected to be $2.80 to $3.00.",
  ...overrides,
});

describe("expectation normalization sealed sector holdout", () => {
  it("canonicalizes pharmaceutical adjusted diluted EPS without changing values", () => {
    const input = statement({});
    const result = normalizeExpectationStatement(input, { ticker: "PFE", cik: 78003, accessionNo: "holdout-pfe" });
    expect(result.statements[0]).toMatchObject({ canonicalMetric: "eps.diluted.non_gaap", valueLow: 2.8, valueHigh: 3 });
    expect(result.audit.filter((item) => item.numericChange)).toHaveLength(0);
  });

  it("canonicalizes managed-care adjusted net earnings", () => {
    const result = normalizeExpectationStatement(statement({ metricRaw: "Adjusted net earnings", unit: "usd_billions", evidence: "Adjusted net earnings are expected to be at least $20.5 billion." }), { ticker: "UNH", cik: 731766, accessionNo: "holdout-unh" });
    expect(result.statements[0].canonicalMetric).toBe("net_income.non_gaap");
  });

  it("applies only an explicitly reviewed company alias in the software holdout", () => {
    const result = normalizeExpectationStatement(statement({ metricRaw: "Intelligent Cloud revenue", metric: "other", unit: "usd_billions", evidence: "Intelligent Cloud revenue is expected to be $30 billion to $31 billion." }), { ticker: "MSFT", cik: 789019, accessionNo: "holdout-msft" });
    expect(result.statements[0].canonicalMetric).toBe("segment_revenue.intelligent_cloud");
  });

  it("keeps an unmapped holdout metric in review instead of guessing", () => {
    const result = normalizeExpectationStatement(statement({ metricRaw: "Deferred to call", metric: "other", evidence: "The outlook will be deferred to the earnings call." }), { ticker: "MSFT", cik: 789019, accessionNo: "holdout-msft-review" });
    expect(result.statements[0].canonicalMetric).toBe("other.unmapped");
    expect(result.review.some((item) => item.ruleId === "REVIEW_UNMAPPED_METRIC")).toBe(true);
  });
});
