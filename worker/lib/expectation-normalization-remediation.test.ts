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

  it("normalizes delivery and plan qualifiers without accepting arbitrary text", () => {
    const plan = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "plans to serve", valueLow: 30, valueHigh: null, valuePoint: null }], extractionWarnings: [] }));
    expect(plan.response?.statements[0].qualifier).toBe("at_least");
    const delivery = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "deliver inside", valueLow: null, valueHigh: null, valuePoint: 30 }], extractionWarnings: [] }));
    expect(delivery.response?.statements[0].qualifier).toBe("point");
    const over = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "over", valueLow: 20, valueHigh: null, valuePoint: null }], extractionWarnings: [] }));
    expect(over.response?.statements[0].qualifier).toBe("at_least");
    const updated = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "updated outlook" }], extractionWarnings: [] }));
    expect(updated.response?.statements[0].qualifier).toBe("range");
    const growth = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "Growth in mid-teens", valueLow: null, valueHigh: null, valuePoint: null, valueText: "mid-teens" }], extractionWarnings: [] }));
    expect(growth.response?.statements[0].qualifier).toBe("qualitative");
    const unchanged = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "No change" }], extractionWarnings: [] }));
    expect(unchanged.response?.statements[0].qualifier).toBe("unchanged");
    const rejected = parseExpectationResponseDetailed(JSON.stringify({ guidanceStatus: "found", statements: [{ ...statement, qualifier: "banana" }], extractionWarnings: [] }));
    expect(rejected.response).toBeNull();
  });

  it("accepts trailing commas without accepting malformed JSON", () => {
    const json = JSON.stringify({ guidanceStatus: "found", statements: [statement], extractionWarnings: [] });
    const trailing = json.replace(/}$/, ",}");
    const parsed = parseExpectationResponseDetailed(trailing);
    expect(parsed.issues).toEqual([]);
    expect(parsed.response?.statements).toHaveLength(1);
  });
});
