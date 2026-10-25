import { describe, it, expect } from "vitest";
import { sigmoid, fitLogisticRidge, solve, partialPooledIntercept, isotonicFit, blockBootstrapAccuracyCI, costMetrics } from "./logistic";

describe("logistic core", () => {
  it("sigmoid bounds", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(10)).toBeCloseTo(0.99995, 4);
    expect(sigmoid(-10)).toBeCloseTo(0.0000454, 6);
  });
  it("solve handles a simple system", () => {
    const x = solve([[2, 1], [1, 3]], [5, 10]);
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(3);
  });
  it("ridge logistic separates classes on easy data", () => {
    const X = [[-2], [-1], [1], [2]];
    const y = [0, 0, 1, 1];
    const b = fitLogisticRidge(X, y, 0.1);
    expect(b[0]).toBeGreaterThan(0);
  });
  it("partial pooling shrinks toward global intercept by n/(n+tau)", () => {
    expect(partialPooledIntercept(0, 1, 0, 8)).toBe(0);
    expect(partialPooledIntercept(0, 1, 16, 8)).toBeCloseTo(2 / 3);
  });
  it("isotonic is nondecreasing in p and identity-safe on small n", () => {
    const f = isotonicFit([{ p: 0.2, y: 0 }, { p: 0.8, y: 1 }]);
    expect(f(0.2)).toBe(0.2);
    expect(f(0.8)).toBe(0.8);
    expect(f(0.5)).toBe(0.5); // too few points -> identity
  });
  it("bootstrap CI brackets the empirical accuracy", () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ correct: i % 4 !== 0 }));
    const ci = blockBootstrapAccuracyCI(pts, 100);
    const acc = pts.filter((p) => p.correct).length / pts.length;
    expect(ci.low).toBeLessThanOrEqual(acc);
    expect(ci.high).toBeGreaterThanOrEqual(acc);
  });
  it("isotonic pools adjacent violations instead of keeping a decreasing step", () => {
    const f = isotonicFit([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((p, i) => ({ p, y: [0, 0, 0, 1, 0, 0, 1, 1][i] })));
    expect(f(0.5)).toBeCloseTo(1 / 3); // pooled block (.4,.5,.6), mean x=.5
    expect(f(0.4)).toBeCloseTo(1 / 6); // linear interpolation between block centers
    expect(f(0.6)).toBeCloseTo(2 / 3);
    const curve = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map(f);
    expect(curve.every((v, i) => i === 0 || v >= curve[i - 1])).toBe(true);
  });
  it("costMetrics computes turnover, cost, Sharpe and maxDD", () => {
    const m = costMetrics([
      { ret: 0.1, positionChanged: true },
      { ret: -0.05, positionChanged: false },
      { ret: 0.02, positionChanged: true },
    ], { commissionBps: 5, slippageBps: 10 });
    expect(m.turnover).toBe(2);
    expect(m.cost).toBeCloseTo(0.0015 * 2);
    expect(m.maxDD).toBeGreaterThan(0);
  });
  it("position mode charges entry and exit and applies the position to returns", () => {
    const m = costMetrics([
      { ret: 0.1, position: 1 },
      { ret: 0.1, position: 0 },
    ], { commissionBps: 5, slippageBps: 10, initialPosition: 0 });
    expect(m.turnover).toBe(2);
    expect(m.cost).toBeCloseTo(0.003);
    expect(m.totalReturn).toBeCloseTo(1.0985 * 0.9985 - 1);
    expect(m.maxDD).toBeCloseTo(1 - (1.0985 * 0.9985) / 1.0985);
  });
});
