import { describe, expect, it } from "vitest";
import { missingSessions, planSchwabBars, splitAtStooqEnd } from "./schwab-daily-bars";
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

  it("fills a missing field when the close agrees", () => {
    const plan = planSchwabBars([bar("2026-11-06", 100, null, null)], [bar("2026-11-06", 100, 1500, 99)]);
    expect(plan.enrich).toEqual([{ date: "2026-11-06", patch: { open: 99, volume: 1500 } }]);
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
