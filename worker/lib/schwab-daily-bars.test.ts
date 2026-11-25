import { describe, expect, it } from "vitest";
import { basisChange, declaredDistribution, distributionShift, missingSessions, planSchwabBars, splitAtStooqEnd } from "./schwab-daily-bars";
import { schwabPriceSeries, schwabSymbol } from "./schwab-price-series";

const bar = (date: string, close: number, volume: number | null = 1000, open: number | null = close) => ({ date, open, high: close + 1, low: close - 1, close, adjClose: null, volume });

describe("Schwab daily bars into local prices", () => {
  it("inserts new dates and leaves identical stored bars alone", () => {
    const plan = planSchwabBars([bar("2026-11-06", 100)], [bar("2026-11-06", 100), bar("2026-11-09", 101)]);
    expect(plan.insert.map((row) => row.date)).toEqual(["2026-11-09"]);
    expect(plan.unchanged).toBe(1);
    expect(plan.closeConflicts).toEqual([]);
  });

  it("never changes a stored close and lists a differing volume without overwriting it", () => {
    const plan = planSchwabBars([bar("2026-11-06", 100, 1000)], [bar("2026-11-06", 100.5, 1000)]);
    expect(plan.closeConflicts).toEqual([{ date: "2026-11-06", stored: 100, candidate: 100.5 }]);
    expect(plan.insert).toEqual([]);
    const volume = planSchwabBars([bar("2026-11-06", 100, 1000)], [bar("2026-11-06", 100, 1200)]);
    expect(volume.fieldDifferences).toEqual([{ date: "2026-11-06", field: "volume", stored: 1000, candidate: 1200 }]);
    expect(volume.enrich).toEqual([]);
  });

  it("takes a later fetch's final values for a recent provisional bar of the same source (2026-11-12 AAPL case)", () => {
    const stored = [bar("2026-11-10", 350), bar("2026-11-11", 352), bar("2026-11-12", 354.838, 31_000_000)];
    const fresh = [bar("2026-11-10", 350), bar("2026-11-11", 352), bar("2026-11-12", 354.88, 31_874_926), bar("2026-11-13", 356.27)];
    const plan = planSchwabBars(stored, fresh, { from: "2026-11-11", maxCloseMove: 0.005 });
    expect(plan.closeConflicts).toEqual([]);
    expect(plan.fieldDifferences).toEqual([]);
    expect(plan.corrections).toEqual([{ date: "2026-11-12", before: { open: 354.838, high: 355.838, low: 353.838, close: 354.838, volume: 31_000_000 }, after: { open: 354.88, high: 355.88, low: 353.88, close: 354.88, volume: 31_874_926 } }]);
    expect(plan.insert.map((row) => row.date)).toEqual(["2026-11-13"]);
  });

  it("keeps old, large and history-wide differences as conflicts", () => {
    const window = { from: "2026-11-11", maxCloseMove: 0.005 };
    const old = planSchwabBars([bar("2026-11-06", 100), bar("2026-11-12", 100)], [bar("2026-11-06", 100.2), bar("2026-11-12", 100)], window);
    expect(old.closeConflicts).toEqual([{ date: "2026-11-06", stored: 100, candidate: 100.2 }]);
    expect(old.corrections).toEqual([]);
    const large = planSchwabBars([bar("2026-11-12", 100)], [bar("2026-11-12", 103)], window);
    expect(large.closeConflicts).toEqual([{ date: "2026-11-12", stored: 100, candidate: 103 }]);
    expect(large.corrections).toEqual([]);
    // an older close moved too: an adjustment of the whole history, so the recent small move is no correction either
    const wide = planSchwabBars([bar("2026-11-06", 100), bar("2026-11-12", 100)], [bar("2026-11-06", 99.5), bar("2026-11-12", 99.7)], window);
    expect(wide.corrections).toEqual([]);
    expect(wide.closeConflicts.map((row) => row.date)).toEqual(["2026-11-06", "2026-11-12"]);
  });

  it("fills a missing field when the close agrees", () => {
    const plan = planSchwabBars([bar("2026-11-06", 100, null, null)], [bar("2026-11-06", 100, 1500, 99)]);
    expect(plan.enrich).toEqual([{ date: "2026-11-06", patch: { open: 99, volume: 1500 } }]);
  });

  it("recognises a split: Schwab re-bases every stored date by one factor, and the new session follows", () => {
    // a 4:1 split effective 2026-11-13: the month's earlier candles come back at a quarter of the stored closes
    const stored = [bar("2026-11-09", 400), bar("2026-11-10", 404), bar("2026-11-11", 408), bar("2026-11-12", 412)];
    const fresh = [bar("2026-11-09", 100), bar("2026-11-10", 101), bar("2026-11-11", 102), bar("2026-11-12", 103), bar("2026-11-13", 104)];
    expect(basisChange(stored, fresh)).toEqual({ ratio: 0.25, firstNewBasisDate: "2026-11-13", dates: 4 });
  });

  it("recognises a split seen late: re-based dates first, agreeing ones after", () => {
    const stored = [bar("2026-11-09", 400), bar("2026-11-10", 404), bar("2026-11-11", 408), bar("2026-11-12", 103)];
    const fresh = [bar("2026-11-09", 100), bar("2026-11-10", 101), bar("2026-11-11", 102), bar("2026-11-12", 103)];
    expect(basisChange(stored, fresh)).toEqual({ ratio: 0.25, firstNewBasisDate: "2026-11-12", dates: 3 });
  });

  it("recognises an adjustment of the whole stored history with no new session yet", () => {
    const stored = [bar("2026-11-10", 404), bar("2026-11-11", 408), bar("2026-11-12", 412)];
    const fresh = [bar("2026-11-10", 101), bar("2026-11-11", 102), bar("2026-11-12", 103)];
    expect(basisChange(stored, fresh)).toEqual({ ratio: 0.25, firstNewBasisDate: "2026-11-13", dates: 3 });
  });

  it("keeps a one-day correction, mixed factors and ordinary days as they were", () => {
    const stored = [bar("2026-11-09", 400), bar("2026-11-10", 404), bar("2026-11-11", 408), bar("2026-11-12", 412)];
    expect(basisChange(stored, [bar("2026-11-09", 401), bar("2026-11-10", 404), bar("2026-11-11", 408), bar("2026-11-12", 412)])).toBeNull();
    expect(basisChange(stored, [bar("2026-11-09", 100), bar("2026-11-10", 202), bar("2026-11-11", 102), bar("2026-11-12", 103)])).toBeNull();
    expect(basisChange(stored, stored)).toBeNull();
    // a moved date after an agreeing one is no clean re-basing
    expect(basisChange(stored, [bar("2026-11-09", 100), bar("2026-11-10", 404), bar("2026-11-11", 102), bar("2026-11-12", 103)])).toBeNull();
  });

  it("keeps Schwab bars out of the dates the Stooq history covers", () => {
    const bars = [bar("2026-11-09", 100), bar("2026-11-10", 101), bar("2026-11-11", 102)];
    expect(splitAtStooqEnd(bars, "2026-11-10")).toEqual({ history: bars.slice(0, 2), current: bars.slice(2) });
    expect(splitAtStooqEnd(bars, null)).toEqual({ history: [], current: bars });
  });

  it("finds the sessions a series lacks inside its own span", () => {
    const calendar = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"];
    expect(missingSessions(["2026-10-28", "2026-11-02"], calendar, "2026-10-01")).toEqual(["2026-10-29", "2026-10-30"]);
    expect(missingSessions(["2026-10-27", "2026-11-03"], calendar, "2026-11-01")).toEqual(["2026-11-02"]);
    expect(missingSessions([], calendar, "2026-10-01")).toEqual([]);
  });

  it("covers the research universe, the S&P snapshot with both listings, SPY and the sector funds with Stooq's price keys", () => {
    const series = schwabPriceSeries();
    const byTicker = new Map(series.map((row) => [row.ticker, row]));
    expect(byTicker.get("SPY")?.priceKey).toBe(0);
    expect(byTicker.get("XLK")?.priceKey).toBe(-1006);
    expect(byTicker.get("GOOG")?.priceKey).toBe(-2001);
    expect(byTicker.get("GOOGL")?.priceKey).toBe(1652044);
    expect(byTicker.get("AAPL")?.priceKey).toBe(320193);
    expect(series.length).toBeGreaterThan(500);
    expect(new Set(series.map((row) => row.ticker)).size).toBe(series.length);
    expect(schwabSymbol("BRK-B")).toBe("BRK/B");
    expect(schwabSymbol("BF.B")).toBe("BF/B");
    expect(schwabSymbol("AAPL")).toBe("AAPL");
  });
});


describe("a special cash distribution Schwab took off the history", () => {
  const bar = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, adjClose: null, volume: 1 });
  const stored = [bar("2026-11-18", 1096.62), bar("2026-11-19", 1093.83), bar("2026-11-20", 1102.15), bar("2026-11-23", 1097.91)];
  const fetched = [bar("2026-11-18", 1066.62), bar("2026-11-19", 1063.83), bar("2026-11-20", 1072.15), bar("2026-11-23", 1097.91), bar("2026-11-24", 1091.71)];

  it("is every earlier close lower by one amount, ending at the ex-date (Costco, $30, 2026-11-24)", () => {
    expect(distributionShift(stored, fetched)).toEqual({ amount: 30, exDate: "2026-11-23", lastShifted: "2026-11-20", dates: 3 });
    // with the agreeing session not yet stored, the first new session is the ex-date
    expect(distributionShift(stored.slice(0, 3), fetched)).toEqual({ amount: 30, exDate: "2026-11-23", lastShifted: "2026-11-20", dates: 3 });
  });

  it("is not recognised for mixed amounts, fewer than three dates, a ratio, or no known ex-date", () => {
    expect(distributionShift(stored, [bar("2026-11-18", 1066.62), bar("2026-11-19", 1060), bar("2026-11-20", 1072.15), bar("2026-11-23", 1097.91)])).toBeNull();
    expect(distributionShift(stored, [bar("2026-11-19", 1063.83), bar("2026-11-20", 1072.15), bar("2026-11-23", 1097.91)])).toBeNull();
    expect(distributionShift(stored, stored.map((item) => bar(item.date, item.close! / 2)))).toBeNull();
    expect(distributionShift(stored.slice(0, 3), fetched.slice(0, 3))).toBeNull();
    expect(distributionShift(stored, stored)).toBeNull();
  });

  it("counts as declared only when Schwab's own quote names the amount and an ex-date just after the shifted sessions", () => {
    // as Schwab did it: shifted through Friday, Monday left as traded, ex-date Tuesday
    const shift = { amount: 30, exDate: "2026-11-23", lastShifted: "2026-11-20", dates: 20 };
    expect(declaredDistribution(shift, { divExDate: "2026-11-24T00:00:00Z", divPayAmount: 30.0, divAmount: 5.88 })).toBe(true);
    expect(declaredDistribution({ ...shift, exDate: "2026-11-24", lastShifted: "2026-11-23" }, { divExDate: "2026-11-24T00:00:00Z", divPayAmount: 30.0 })).toBe(true);
    expect(declaredDistribution(shift, { divExDate: "2026-11-24T00:00:00Z", divPayAmount: 1.47, divAmount: 5.88 })).toBe(false);
    expect(declaredDistribution(shift, { divExDate: "2026-11-20T00:00:00Z", divPayAmount: 30.0 })).toBe(false);
    expect(declaredDistribution(shift, { divExDate: "2026-11-30T00:00:00Z", divPayAmount: 30.0 })).toBe(false);
    expect(declaredDistribution(shift, null)).toBe(false);
  });
});
