import { describe, expect, it } from "vitest";
import { blockBootstrapWeightedCi, forwardRealizedVolatility, normalCdf, trailingRealizedVolatility, type VolBar } from "./forward-volatility";

const bars: VolBar[] = Array.from({ length: 100 }, (_, i) => ({ date: `2026-${String(1 + Math.floor(i / 20)).padStart(2, "0")}-${String(1 + i % 20).padStart(2, "0")}`, close: 100 * (1 + 0.01 * (i % 3 - 1)) }));

describe("forward volatility and bootstrap", () => {
  it("uses strictly forward returns and exposes the exit date", () => {
    const result = forwardRealizedVolatility(bars, bars[20].date, 20)!;
    expect(result.vol).toBeGreaterThan(0);
    expect(result.exitDate).toBe(bars[40].date);
    expect(forwardRealizedVolatility(bars, bars.at(-1)!.date, 20)).toBeNull();
  });

  it("uses only trailing returns for VRP inputs", () => {
    expect(trailingRealizedVolatility(bars, bars[50].date, 20)).toBeGreaterThan(0);
    expect(trailingRealizedVolatility(bars, bars[5].date, 20)).toBeNull();
  });

  it("approximates normal CDF and computes a deterministic bootstrap interval", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 5);
    const rows = Array.from({ length: 20 }, (_, i) => ({ value: 0.05 + i * 0.001, weight: 10 + i }));
    const ci = blockBootstrapWeightedCi(rows, 4, 100, 42);
    expect(ci.low).not.toBeNull();
    expect(ci.high).not.toBeNull();
    expect(ci.low!).toBeLessThanOrEqual(ci.high!);
  });
});
