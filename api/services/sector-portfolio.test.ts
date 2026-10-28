import { describe, expect, it } from "vitest";
import { applyVolTarget, legTurnover, quintileSpreads, strategyMetrics } from "./sector-portfolio";
import type { NeutralizedPoint } from "./sector-neutral-ic";

const p = (cik: number, x: number, y: number): NeutralizedPoint => ({
  cik, sector: "A", factor: "assetGrowth", quarter: "2026-07", horizon: 126, x, y,
  xMethod: "sector", yMethod: "sector",
});

describe("sector-neutral quintile portfolio", () => {
  it("forms high-minus-low and low-minus-high spreads", () => {
    const rows = [p(1, 1, 0.1), p(2, 2, 0.2), p(3, 3, 0.3), p(4, 4, 0.4), p(5, 5, 0.5)];
    expect(quintileSpreads(rows, 1)[0].ret).toBeCloseTo(0.4);
    expect(quintileSpreads(rows, -1)[0].ret).toBeCloseTo(-0.4);
  });

  it("charges initial and replacement turnover, not unchanged positions", () => {
    expect(legTurnover(new Set(), new Set([1, 2]))).toBe(1);
    expect(legTurnover(new Set([1, 2]), new Set([1, 2]))).toBe(0);
    expect(legTurnover(new Set([1, 2]), new Set([2, 3]))).toBe(0.5);
    const spread = { quarter: "2026-07", ret: 0.1, longSet: new Set([1]), shortSet: new Set([2]) };
    const metrics = strategyMetrics([spread, spread]);
    expect(metrics.turnover).toBe(2);
    expect(metrics.cost).toBeCloseTo(0.003);
    expect(metrics.totalReturn).toBeCloseTo(0.2067);
  });
});

describe("pre-registered volatility targeting", () => {
  it("uses only trailing returns and charges leverage adjustments", () => {
    const spreads = [0.2, -0.2, 0.2, -0.2, 0.01].map((ret, i) => ({
      quarter: `2026-0${i + 1}`, ret, longSet: new Set([1]), shortSet: new Set([2]),
    }));
    const targeted = applyVolTarget(spreads);
    expect(targeted[0].leverage).toBe(1); // future volatility is never used
    expect(targeted[4].leverage).toBe(0.25); // clamped after high-vol history
    const metrics = strategyMetrics(targeted);
    expect(metrics.turnover).toBeCloseTo(2.75); // initial two legs + 0.75 leverage reduction
  });
});
