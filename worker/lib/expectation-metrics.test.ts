import { describe, expect, it } from "vitest";
import type { ExpectationStatement } from "./expectations";
import {
  expectationPairCompatible,
  guidanceCenter,
  guidanceCredibility,
  guidanceOutcome,
  guidanceRevision,
  guidanceSurprise,
  guidanceWidth,
  reactionZ,
  reversal,
} from "./expectation-metrics";

const statement = (overrides: Partial<ExpectationStatement> = {}): ExpectationStatement => ({
  kind: "guidance", metricRaw: "Revenue", metric: "revenue", scopeRaw: "Consolidated", periodRaw: "FY2026", comparisonRaw: "FY2025",
  qualifier: "range", valueLow: 60.5, valueHigh: 62.5, valuePoint: null, tolerance: null, toleranceUnit: null, valueText: null,
  unit: "usd_billions", basis: "reported", revision: "raised", previousLow: 59.5, previousHigh: 62.5, previousPoint: null,
  previousGuidanceDateRaw: "previous quarter", assumptionRaw: null, sourceSection: "Guidance", evidence: "Revenue is expected to be $60.5 to $62.5 billion",
  ...overrides,
});

describe("deterministic expectation metrics", () => {
  it("requires exact metric, scope, period, unit and basis compatibility", () => {
    const guidance = statement();
    expect(expectationPairCompatible(guidance, statement({ kind: "actual" }))).toBe(true);
    expect(expectationPairCompatible(guidance, statement({ kind: "actual", basis: "constant_currency" }))).toBe(false);
    expect(expectationPairCompatible(guidance, statement({ kind: "actual", scopeRaw: "AWS" }))).toBe(false);
    expect(expectationPairCompatible(guidance, statement({ kind: "actual", periodRaw: "Q4 2026" }))).toBe(false);
  });

  it("computes centers only for compatible numeric forms", () => {
    expect(guidanceCenter(statement())).toBe(61.5);
    expect(guidanceCenter(statement({ qualifier: "point", valuePoint: 108, valueLow: null, valueHigh: null }))).toBe(108);
    expect(guidanceCenter(statement({ qualifier: "at_least", valueLow: 20.5, valueHigh: null }))).toBeNull();
    expect(guidanceCenter(statement({ qualifier: "qualitative", valueText: "high teens", valueLow: null, valueHigh: null }))).toBeNull();
  });

  it("measures revision and range width without LLM arithmetic", () => {
    expect(guidanceRevision(statement())).toBeCloseTo(0.5 / 61, 12);
    expect(guidanceWidth(statement())).toBeCloseTo(2 / 61.5, 12);
    expect(guidanceRevision(statement({ previousLow: null, previousHigh: null }))).toBeNull();
  });

  it("classifies range, floor and ceiling outcomes and surprise", () => {
    expect(guidanceOutcome(60, statement())).toBe("below_range");
    expect(guidanceOutcome(61.5, statement())).toBe("within_range");
    expect(guidanceOutcome(63, statement())).toBe("above_range");
    expect(guidanceOutcome(20, statement({ qualifier: "at_least", valueLow: 20.5, valueHigh: null }))).toBe("below_floor");
    expect(guidanceOutcome(21, statement({ qualifier: "at_least", valueLow: 20.5, valueHigh: null }))).toBe("above_floor");
    expect(guidanceSurprise(63, statement())).toBeCloseTo(1.5 / 61.5, 12);
    expect(guidanceSurprise(20, statement({ qualifier: "at_least", valueLow: 20.5, valueHigh: null }))).toBeCloseTo(-0.5 / 20.5, 12);
  });

  it("normalizes reaction and measures reversal only with valid inputs", () => {
    expect(reactionZ(-0.12, 0.06)).toBe(-2);
    expect(reactionZ(-0.12, 0)).toBeNull();
    expect(reversal(-0.12, 0.05)).toBe(0.05);
    expect(reversal(0.08, -0.03)).toBe(0.03);
    expect(reversal(-0.12, -0.05)).toBe(-0.05);
    expect(reversal(0, 0.05)).toBeNull();
  });

  it("shrinks guidance credibility only after the preregistered history threshold", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ signedError: i % 2 ? 0.02 : 0, hit: i % 3 !== 0 }));
    expect(guidanceCredibility(rows.slice(0, 7)).usable).toBe(false);
    const result = guidanceCredibility(rows);
    expect(result.usable).toBe(true);
    expect(result.rawMeanError).toBeCloseTo(0.01, 12);
    expect(result.shrunkMeanError).toBeCloseTo(0.08 / 12, 12);
    expect(result.hitRate).toBe(0.625);
  });
});
