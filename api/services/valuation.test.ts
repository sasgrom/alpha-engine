// Unit tests for the 4i (D41) valuation models — pure math only.
import { describe, it, expect } from "vitest";
import { dcfValue, impliedGrowth, residualIncome, earningsPowerValue, zScore, seriesCagr } from "./valuation";

describe("dcfValue / impliedGrowth", () => {
  it("dcfValue is monotonic in growth", () => {
    expect(dcfValue(100, 0.10, 0.025, 0.09)).toBeGreaterThan(dcfValue(100, 0.02, 0.025, 0.09));
  });
  it("impliedGrowth round-trips: DCF at g* returns the market value", () => {
    const fcf = 100; // $100 TTM FCF
    const wacc = 0.09;
    const target = dcfValue(fcf, 0.08, 0.025, wacc);
    const g = impliedGrowth(fcf, target, wacc);
    expect(g).not.toBeNull();
    expect(g!).toBeCloseTo(0.08, 3);
  });
  it("impliedGrowth fails closed when the price is unreachable", () => {
    // absurdly high market value vs reachable PV range
    expect(impliedGrowth(100, dcfValue(100, 1.0, 0.025, 0.09) * 10, 0.09)).toBeNull();
  });
});

describe("residualIncome / EPV / z", () => {
  it("residualIncome = book when ROE == r (no excess returns, no value creation)", () => {
    expect(residualIncome(1000, 0.09, 0.09)).toBeCloseTo(1000, 0);
  });
  it("residualIncome > book when ROE > r", () => {
    expect(residualIncome(1000, 0.20, 0.09)).toBeGreaterThan(1000);
  });
  it("earningsPowerValue", () => {
    expect(earningsPowerValue(100, 0.16, 0.08)).toBeCloseTo(1050);
    expect(earningsPowerValue(100, 0.16, 0)).toBeNull();
  });
  it("zScore and seriesCagr", () => {
    expect(zScore(12, [10, 10, 10, 10, 10, 10, 10, 10, 10, 20])).not.toBeNull();
    expect(zScore(10, [10, 10, 10])).toBeNull(); // too few
    // positions carry time: nulls keep their slot; 4 slots at 4/year = 1y, 1→4 → 300%
    expect(seriesCagr([4, null, 3, 2, 1], 4)).toBeCloseTo(3, 3);
    expect(seriesCagr([null, null], 4)).toBeNull(); // nothing positive — honest
  });
});
