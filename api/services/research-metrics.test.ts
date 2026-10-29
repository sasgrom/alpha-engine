import { describe, expect, it } from "vitest";
import { benjaminiHochberg, coverageRatio, groupedLagAutocorrelation, longShortTurnover, meanTStat, quantileSpread, summarizeRobustnessRuns, weightTurnover } from "./research-metrics";

describe("research review metrics", () => {
  it("computes a descriptive t-stat without confusing it with bootstrap inference", () => {
    expect(meanTStat([1, 1, 1, -1])).toBeCloseTo(1);
    expect(meanTStat([1])).toBeNull();
    expect(meanTStat([2, 2, 2])).toBeNull();
  });

  it("computes quantile buckets and top-bottom spread", () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({ x: i + 1, y: i + 1 }));
    const result = quantileSpread(pairs)!;
    expect(result.buckets).toHaveLength(5);
    expect(result.buckets[0]).toMatchObject({ n: 2, meanY: 1.5 });
    expect(result.topBottom).toBe(8);
    expect(quantileSpread(pairs.slice(0, 4))).toBeNull();
  });

  it("measures signal persistence and long-short weight turnover", () => {
    const rows = [
      { key: "A", period: "2024Q1", value: 1 }, { key: "A", period: "2024Q2", value: 2 }, { key: "A", period: "2024Q3", value: 3 }, { key: "A", period: "2024Q4", value: 4 },
      { key: "B", period: "2024Q1", value: 4 }, { key: "B", period: "2024Q2", value: 3 }, { key: "B", period: "2024Q3", value: 2 },
    ];
    expect(groupedLagAutocorrelation(rows.slice(0, 4))).toBeCloseTo(1);
    expect(weightTurnover(new Map([["A", 0.5], ["B", 0.5]]), new Map([["A", 1], ["B", 0]]))).toBe(0.5);
    expect(longShortTurnover([
      { key: "A", period: "p1", value: 1 }, { key: "B", period: "p1", value: -1 },
      { key: "A", period: "p2", value: 1 }, { key: "B", period: "p2", value: 1 },
    ])).toBe(0.5);
  });

  it("validates coverage and applies Benjamini-Hochberg monotonicity", () => {
    expect(coverageRatio(5, 10)).toBe(0.5);
    expect(coverageRatio(0, 0)).toBeNull();
    expect(coverageRatio(11, 10)).toBeNull();
    expect(benjaminiHochberg([0.01, 0.5], 0.05)).toEqual([{ pAdjusted: 0.02, rejected: true }, { pAdjusted: 0.5, rejected: false }]);
    expect(benjaminiHochberg([0.01, 0.02, 0.03, 0.04], 0.05).every((x) => x.rejected)).toBe(true);
    expect(() => benjaminiHochberg([1.2])).toThrow();
  });

  it("keeps failed robustness runs and selects the worst valid slice", () => {
    const result = summarizeRobustnessRuns([
      { runId: "base", metric: 0.1 }, { runId: "stress", metric: -0.05 }, { runId: "broken", metric: null, error: "timeout" },
    ]);
    expect(result).toMatchObject({ totalRuns: 3, failedRuns: 1, validRuns: 2, worstRunId: "stress", worstMetric: -0.05, positiveShare: 0.5 });
  });
});
