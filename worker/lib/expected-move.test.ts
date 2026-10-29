import { describe, expect, it } from "vitest";
import { absoluteForwardMove, expectedMove, summarizeExpectedMoves } from "./expected-move";

describe("expected move", () => {
  it("computes spot · IV · sqrt(DTE/365) and validates inputs", () => {
    expect(expectedMove(100, 0.2, 365)).toBeCloseTo(20);
    expect(expectedMove(100, 0.2, 91.25)).toBeCloseTo(10);
    expect(expectedMove(0, 0.2, 30)).toBeNull();
    expect(expectedMove(100, -0.1, 30)).toBeNull();
  });

  it("computes actual move in dollars and filters zero expected values from ratios", () => {
    const bars = [
      { date: "2026-01-01", close: 100 },
      { date: "2026-01-05", close: 110 },
      { date: "2026-01-10", close: 120 },
      { date: "2026-01-20", close: 132 },
    ];
    expect(absoluteForwardMove(bars, "2026-01-01", 2)?.move).toBeCloseTo(10);
    expect(summarizeExpectedMoves([{ date: "zero", expected: 0, actual: 0 }]).meanRatio).toBeNull();
  });

  it("measures coverage and errors without assuming a normal 68% interval", () => {
    const result = summarizeExpectedMoves([
      { date: "a", expected: 10, actual: 5 },
      { date: "b", expected: 10, actual: 15 },
    ]);
    expect(result).toMatchObject({ n: 2, coverage: 0.5, mae: 5, rmse: 5, medianRatio: 0.5, meanRatio: 1 });
    expect(summarizeExpectedMoves([]).n).toBe(0);
  });
});
