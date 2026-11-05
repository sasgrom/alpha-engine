import { describe, expect, it } from "vitest";
import { calculatePriceAnalytics, formatTerminalCompact, formatTerminalMoney, formatTerminalPct, movingAverage, terminalChangePct } from "./terminal-data";

const bars = [
  { date: "2026-01-01", close: 100 },
  { date: "2026-01-02", close: 110 },
  { date: "2026-01-03", close: 99 },
  { date: "2026-01-04", close: 120 },
  { date: "2026-01-05", close: 90 },
];

describe("terminal price analytics", () => {
  it("computes return, drawdown, daily extremes and positive-day share", () => {
    const result = calculatePriceAnalytics(bars);
    expect(result.totalReturn).toBeCloseTo(-0.1, 8);
    expect(result.maxDrawdown).toBeCloseTo(-0.25, 8);
    expect(result.bestDay).toBeCloseTo(120 / 99 - 1, 8);
    expect(result.worstDay).toBeCloseTo(-0.25, 8);
    expect(result.positiveShare).toBe(0.5);
    expect(result.annualizedVolatility).toBeGreaterThan(0);
  });

  it("keeps drawdown anchored to the previous peak", () => {
    const result = calculatePriceAnalytics(bars);
    const values = result.drawdown.map((row) => row.value);
    [0, 0, 1 - 1.1, 0, -0.25].forEach((expected, index) => expect(values[index]).toBeCloseTo(expected, 8));
  });

  it("counts every daily return exactly once in the histogram", () => {
    const result = calculatePriceAnalytics(bars);
    expect(result.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(4);
    expect(result.returns).toHaveLength(4);
  });

  it("returns honest null metrics for insufficient evidence", () => {
    const result = calculatePriceAnalytics([{ date: "2026-01-01", close: 100 }]);
    expect(result.totalReturn).toBeNull();
    expect(result.annualizedVolatility).toBeNull();
    expect(result.bestDay).toBeNull();
    expect(result.histogram).toEqual([]);
  });

  it("computes moving averages and stable display formatting", () => {
    const average = movingAverage(bars, 2);
    expect(average[0].value).toBe(100);
    expect(average[1].value).toBe(105);
    expect(average[4].value).toBe(105);
    expect(formatTerminalMoney(1234.5)).toBe("1,234.50");
    expect(formatTerminalCompact(5.06e12)).toBe("5.06T");
    expect(formatTerminalPct(0.1234, 1, true)).toBe("+12.3%");
    expect(formatTerminalPct(null)).toBe("—");
  });

  it("does not replace a missing official change with a stale screener value", () => {
    expect(terminalChangePct({ available: true, changePct: null }, 0.08)).toBeNull();
    expect(terminalChangePct({ available: true, changePct: -0.01 }, 0.08)).toBe(-0.01);
    expect(terminalChangePct({ available: false }, 0.08)).toBe(0.08);
  });
});
