import { describe, it, expect } from "vitest";
import { pearson, spearman, ranks, icStats, forwardReturn, entryCloseAfter } from "./ic";

describe("ic stats", () => {
  it("pearson basic + degenerate guards", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull(); // zero variance
    expect(pearson([1, 2], [1, 2])).toBeNull(); // <3
  });
  it("ranks handle ties with averages", () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });
  it("spearman is robust to monotone nonlinear maps", () => {
    const x = [1, 2, 3, 4, 5], y = [1, 4, 9, 16, 25];
    expect(spearman(x, y)).toBeCloseTo(1);
  });
  it("icStats counts pairs", () => {
    const s = icStats([{ x: 1, y: 0.1 }, { x: 2, y: 0.2 }, { x: 3, y: 0.3 }]);
    expect(s.n).toBe(3);
  });
});

describe("forwardReturn (no lookahead)", () => {
  const bars = [
    { date: "2026-01-01", close: 100 },
    { date: "2026-01-05", close: 110 },
    { date: "2026-01-10", close: 120 },
    { date: "2026-01-20", close: 132 },
  ];
  it("entry is the first close STRICTLY after the anchor", () => {
    expect(entryCloseAfter(bars, "2026-01-01")?.date).toBe("2026-01-05");
    expect(entryCloseAfter(bars, "2026-01-20")).toBeNull();
  });
  it("forward return uses entry+h trading days, entry is post-filing", () => {
    const r = forwardReturn(bars, "2026-01-01", 2);
    expect(r).toBeCloseTo(132 / 110 - 1);
  });
  it("no exit bar → honest null", () => {
    expect(forwardReturn(bars, "2026-01-01", 99)).toBeNull();
  });
});
