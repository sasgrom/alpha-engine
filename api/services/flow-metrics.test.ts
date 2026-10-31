import { describe, expect, it } from "vitest";
import { flowMetrics, shareFlowRatio } from "./flow-metrics";

describe("13F share and portfolio-weight flow metrics", () => {
  it("separates share count change from portfolio weight change", () => {
    const m = flowMetrics(120, 100, 2000, 1000);
    expect(m.deltaShares).toBe(20);
    expect(m.deltaSharesPct).toBeCloseTo(0.2);
    expect(m.deltaWeightPp).toBeCloseTo(-4);
  });

  it("returns honest nulls for zero previous shares and missing book values", () => {
    expect(shareFlowRatio(10, 0)).toBeNull();
    const m = flowMetrics(10, 0, 100, 0);
    expect(m.deltaSharesPct).toBeNull();
    expect(m.deltaWeightPp).toBeNull();
    expect(m.deltaShares).toBe(10);
  });
});
