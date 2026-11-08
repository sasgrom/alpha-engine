import { describe, expect, it } from "vitest";
import { parseExpectationResponseDetailed } from "./expectations";

const statement = {
  kind: "guidance",
  metricRaw: "Net sales",
  metric: "revenue",
  scopeRaw: "fourth quarter 2026",
  periodRaw: "Q4 2026",
  comparisonRaw: null,
  qualifier: "At a segment level",
  valueLow: 240,
  valueHigh: 247,
  valuePoint: null,
  tolerance: null,
  toleranceUnit: null,
  valueText: null,
  unit: "usd_billions",
  basis: "gaap",
  currencyBasis: "reported",
  revision: "unclear",
  previousLow: null,
  previousHigh: null,
  previousPoint: null,
  previousGuidanceDateRaw: null,
  assumptionRaw: null,
  sourceSection: "Outlook",
  evidence: "Net sales are expected to be between $240.0 billion and $247.0 billion.",
};

describe("expectation normalization remediation", () => {
  it("normalizes free-text qualifiers from their value shape", () => {
    const parsed = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [statement], extractionWarnings: [] }));
    expect(parsed.issues).toEqual([]);
    expect(parsed.response?.statements[0].qualifier).toBe("range");
  });

  it("normalizes plus-minus, at-least and explicit non-disclosure qualifiers", () => {
    const plus = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "raised midpoint", valueLow: null, valueHigh: null, valuePoint: 108, tolerance: 2, toleranceUnit: "percent" }], extractionWarnings: [] }));
    expect(plus.response?.statements[0].qualifier).toBe("plus_minus");
    const atLeast = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "raised midpoint", valueLow: 20.5, valueHigh: null }], extractionWarnings: [] }));
    expect(atLeast.response?.statements[0].qualifier).toBe("at_least");
    const nonDisclosure = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "explicitly_not_provided", statements: [{ ...statement, qualifier: "explicitly_not_provided", kind: "non_disclosure" }], extractionWarnings: [] }));
    expect(nonDisclosure.response?.statements[0].qualifier).toBe("not_provided");
  });

  it("accepts trailing commas without accepting malformed JSON", () => {
    const json = JSON.stringify({ guidanceStatus: "found", statements: [statement], extractionWarnings: [] });
    const trailing = json.replace(/}$/, ",}");
    const parsed = parseExpectationResponseDetailed(trailing);
    expect(parsed.issues).toEqual([]);
    expect(parsed.response?.statements).toHaveLength(1);
  });
});
