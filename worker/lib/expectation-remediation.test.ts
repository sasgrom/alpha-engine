import { describe, expect, it } from "vitest";
import { remediateExpectationStatements } from "./expectation-remediation";
import { evidenceInSource, type ExpectationStatement } from "./expectations";

const source = [
  "Revenue is expected to be $108.0 billion, plus or minus 2%.",
  "GAAP and non-GAAP gross margins are expected to be 74.0%, plus or minus 50 basis points.",
  "GAAP and non-GAAP tax rates of 16% to 18%.",
].join("\n");

const base = (overrides: Partial<ExpectationStatement> = {}): ExpectationStatement => ({
  kind: "guidance",
  metricRaw: "Revenue is expected to be $108.0 billion, plus or minus 2%.",
  metric: "revenue",
  scopeRaw: "third quarter of fiscal 2027",
  periodRaw: "Q3 FY27",
  comparisonRaw: null,
  qualifier: "point",
  valueLow: null,
  valueHigh: null,
  valuePoint: 108,
  tolerance: 2,
  toleranceUnit: "same_unit",
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
  evidence: "Revenue is expected to be $108.0 billion, plus or minus 2%.",
  ...overrides,
});

describe("deterministic expectation remediation", () => {
  it("normalizes revenue tolerance metadata without changing its value", () => {
    const { statements, changes } = remediateExpectationStatements([base()], source);
    expect(statements[0]).toMatchObject({ metric: "revenue", valuePoint: 108, tolerance: 2, qualifier: "plus_minus", toleranceUnit: "percent", basis: "reported" });
    expect(statements[0].scopeRaw).toContain("Consolidated revenue");
    expect(changes).toHaveLength(3);
  });

  it("splits combined GAAP and non-GAAP margins with exact evidence", () => {
    const margin = base({
      metricRaw: "GAAP and non-GAAP gross margins are expected to be 74.0%, plus or minus 50 basis points.",
      metric: "other",
      valuePoint: 74,
      tolerance: 50,
      toleranceUnit: "basis_points",
      unit: "other",
      evidence: "GAAP and non-GAAP gross margins are expected to be 74.0%, plus or minus 50 basis points.",
    });
    const { statements, changes } = remediateExpectationStatements([margin], source);
    expect(statements).toHaveLength(4);
    expect(statements[0]).toMatchObject({ metric: "margin", basis: "gaap", unit: "percent", valuePoint: 74, tolerance: 50 });
    expect(statements[1]).toMatchObject({ metric: "margin", basis: "non_gaap", unit: "percent", valuePoint: 74, tolerance: 50 });
    expect(changes).toHaveLength(4);
    for (const statement of statements) expect(evidenceInSource(statement.evidence, source)).toBe(true);
  });

  it("adds GAAP and non-GAAP tax rates only from contiguous source evidence", () => {
    const { statements, changes } = remediateExpectationStatements([], source);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatchObject({ metric: "tax_rate", basis: "gaap", qualifier: "range", valueLow: 16, valueHigh: 18, unit: "percent" });
    expect(statements[1]).toMatchObject({ metric: "tax_rate", basis: "non_gaap", qualifier: "range", valueLow: 16, valueHigh: 18, unit: "percent" });
    expect(changes).toHaveLength(2);
    for (const statement of statements) expect(evidenceInSource(statement.evidence, source)).toBe(true);
  });

  it("accepts percent written as a word", () => {
    const wordSource = source.replace("16% to 18%", "16 to 18 percent");
    const { statements } = remediateExpectationStatements([], wordSource);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatchObject({ valueLow: 16, valueHigh: 18, unit: "percent" });
    const dashSource = source.replace("16% to 18%", "16% – 18%");
    expect(remediateExpectationStatements([], dashSource).statements[0]).toMatchObject({ valueLow: 16, valueHigh: 18, unit: "percent" });
    const decimalSource = source.replace("16% to 18%", "16.0% to 18.0%");
    expect(remediateExpectationStatements([], decimalSource).statements[0]).toMatchObject({ valueLow: 16, valueHigh: 18, unit: "percent" });
    const commaSource = source.replace("16% to 18%", "16.0% and 18.0%,");
    expect(remediateExpectationStatements([], commaSource).statements[0]).toMatchObject({ valueLow: 16, valueHigh: 18, unit: "percent" });
  });

  it("is idempotent and does not invent tax evidence", () => {
    const first = remediateExpectationStatements([], source);
    const second = remediateExpectationStatements(first.statements, source);
    expect(second.statements).toHaveLength(2);
    expect(second.changes).toHaveLength(0);
    const noEvidence = remediateExpectationStatements([], "Unrelated filing text without the required metric");
    expect(noEvidence.statements).toHaveLength(0);
    expect(noEvidence.changes).toHaveLength(0);
  });
});
