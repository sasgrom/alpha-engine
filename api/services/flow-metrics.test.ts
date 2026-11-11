import { describe, expect, it } from "vitest";
import { flowMetrics, shareFlowRatio } from "./flow-metrics";

describe("13F share and portfolio-weight flow metrics", () => {
  it("separates share count change from portfolio weight change", () => {
    // 120 shares worth $240 in a $2,000 book (12%) against 100 shares worth $100 in a $1,000 book (10%)
    const m = flowMetrics(120, 100, 2000, 1000, 240, 100);
    expect(m.deltaShares).toBe(20);
    expect(m.deltaSharesPct).toBeCloseTo(0.2);
    expect(m.deltaWeightPp).toBeCloseTo(2);
  });

  it("computes the weight from dollar values only, never from share counts", () => {
    expect(flowMetrics(120, 100, 2000, 1000).deltaWeightPp).toBeNull();
    expect(flowMetrics(5_000_000, 4_000_000, 2e9, 1e9, 1e8, 4e7).deltaWeightPp).toBeCloseTo(1);
  });

  it("returns honest nulls for zero previous shares and missing book values", () => {
    expect(shareFlowRatio(10, 0)).toBeNull();
    const m = flowMetrics(10, 0, 100, 0, 5, 0);
    expect(m.deltaSharesPct).toBeNull();
    expect(m.deltaWeightPp).toBeNull();
    expect(m.deltaShares).toBe(10);
  });
});
