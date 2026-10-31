// Unit tests for the 4n (D47) metric-history helpers.
import { describe, it, expect } from "vitest";
import { trailingMean, olsSlope, monthlyReturns, epsTtmAsOf, valueAsOf, monthEnds, normalizeShareSplits, splitsFromActionsCsv, applySplitMap } from "./metric-history";

describe("metric-history helpers", () => {
  it("trailingMean over the trailing window, nulls skipped honestly", () => {
    expect(trailingMean([1, 2, 3, 4], 3, 3)).toBeCloseTo(3); // (2+3+4)/3
    expect(trailingMean([1, null, 3], 2, 3)).toBeCloseTo(2); // null skipped
    expect(trailingMean([], 0, 3)).toBeNull();
  });
  it("olsSlope = cov/var (beta), NaN pairs skipped", () => {
    // bench = 2× stock → slope of stock on bench = cov(s,2s)/var(2s) = 0.5
    expect(olsSlope([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(0.5);
    expect(olsSlope([1, 2], [2, 4])).toBeNull(); // <3 pairs
  });
  it("monthlyReturns skips non-finite pairs", () => {
    const r = monthlyReturns([100, 110, 121]);
    expect(r[0]).toBeCloseTo(0.1, 5);
    expect(r[1]).toBeCloseTo(0.1, 5);
    const g = monthlyReturns([100, NaN, 130]);
    expect(Number.isNaN(g[0])).toBe(true);
    expect(Number.isNaN(g[1])).toBe(true); // both pairs touch the NaN
  });
  it("epsTtmAsOf sums the latest 4 quarters known by T", () => {
    const eps = [
      { periodEnd: "2026-06-27", val: 2.0 },
      { periodEnd: "2026-03-28", val: 1.9 },
      { periodEnd: "2025-12-27", val: 1.8 },
      { periodEnd: "2025-09-27", val: 1.7 },
      { periodEnd: "2025-06-28", val: 1.6 },
    ];
    expect(epsTtmAsOf(eps, "2026-07-15")).toBeCloseTo(7.4);
    expect(epsTtmAsOf(eps, "2025-11-15")).toBeNull(); // only 2 quarters known by then
  });
  it("valueAsOf returns the latest series value known by T", () => {
    const s = [{ periodEnd: "2026-06-27", val: 10 }, { periodEnd: "2025-12-27", val: 9 }];
    expect(valueAsOf(s, "2026-07-01")).toBe(10);
    expect(valueAsOf(s, "2026-01-15")).toBe(9);
    expect(valueAsOf(s, "2020-01-01")).toBeNull();
  });
  it("monthEnds returns the last calendar day of each covered month", () => {
    expect(monthEnds(["2026-01-05", "2026-01-20", "2026-02-10"])).toEqual(["2026-01-31", "2026-02-28"]);
  });
  it("splitsFromActionsCsv reads exact split factors from the Yahoo CSV", () => {
    const csv = "Date,Dividends,Stock Splits\n2014-06-09T04:00:00.000Z,0.0,7.0\n2020-08-31T04:00:00.000Z,0.0,4.0\n2021-01-01T00:00:00.000Z,0.05,0.0\n";
    expect(splitsFromActionsCsv(csv)).toEqual([
      { date: "2014-06-09", factor: 7 },
      { date: "2020-08-31", factor: 4 },
    ]);
  });
  it("applySplitMap scales pre-split points to the latest basis, cumulatively", () => {
    const s = [
      { periodEnd: "2021-06-26", val: 16.7, sourceFiled: "2021-07-27" },
      { periodEnd: "2019-09-28", val: 4.44, sourceFiled: "2019-10-31" }, // nominal then
      { periodEnd: "2013-09-28", val: 63.1, sourceFiled: "2013-10-30" }, // nominal then
    ];
    const n = applySplitMap(s, [{ date: "2014-06-09", factor: 7 }, { date: "2020-08-31", factor: 4 }]);
    expect(n[0].val).toBe(16.7);
    expect(n[1].val).toBeCloseTo(4.44 * 4);
    expect(n[2].val).toBeCloseTo(63.1 * 28);
  });
  it("applySplitMap never double-scales later restatements (the AAPL FY19 artifact)", () => {
    // the FY19 point's latest vintage was FILED after the 2020 split → already post-split
    const s = [
      { periodEnd: "2020-12-26", val: 16.82, sourceFiled: "2021-01-28" },
      { periodEnd: "2019-09-28", val: 17.77, sourceFiled: "2020-10-30" }, // restated post-split
    ];
    const n = applySplitMap(s, [{ date: "2020-08-31", factor: 4 }]);
    expect(n[1].val).toBe(17.77); // untouched — filed after the split
  });
  it("applySplitMap direction 'down' divides per-share values", () => {
    const s = [{ periodEnd: "2019-09-28", val: 4.0, sourceFiled: "2019-10-30" }];
    const n = applySplitMap(s, [{ date: "2020-08-31", factor: 4 }], "down");
    expect(n[0].val).toBeCloseTo(1.0);
  });
  it("normalizeShareSplits brings history to the latest split basis", () => {
    // AAPL-like: 4:1 split between the 2020-06 and 2020-09 points
    const s = [
      { periodEnd: "2021-06-26", val: 16.7 },
      { periodEnd: "2020-09-26", val: 17.1 },
      { periodEnd: "2020-06-27", val: 66.6 }, // nominal pre-split (≈4×)
      { periodEnd: "2019-09-28", val: 68.5 },
    ];
    const n = normalizeShareSplits(s);
    expect(n[0].val).toBe(16.7); // newest basis untouched
    expect(n[1].val).toBe(17.1);
    expect(n[2].val).toBeCloseTo(66.6 * 4);
    expect(n[3].val).toBeCloseTo(68.5 * 4);
  });
  it("normalizeShareSplits leaves gradual buyback declines alone", () => {
    const s = [
      { periodEnd: "2026-06-27", val: 14.7 },
      { periodEnd: "2025-06-28", val: 15.1 }, // ≈2.7% shrink — not a split
      { periodEnd: "2024-09-28", val: 15.2 },
    ];
    const n = normalizeShareSplits(s);
    expect(n[1].val).toBe(15.1);
    expect(n[2].val).toBe(15.2);
  });
});
