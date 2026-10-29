import { describe, expect, it } from "vitest";
import { expectedMove, summarizeExpectedMoves } from "./expected-move";

describe("expected move", () => {
  it("computes spot · IV · sqrt(DTE/365) and validates inputs", () => {
    expect(expectedMove(100, 0.2, 365)).toBeCloseTo(20);
    expect(expectedMove(100, 0.2, 91.25)).toBeCloseTo(10);
    expect(expectedMove(0, 0.2, 30)).toBeNull();
    expect(expectedMove(100, -0.1, 30)).toBeNull();
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
