import { describe, expect, it } from "vitest";
import { entryToTicker, parseMetastockDaily } from "../../api/services/price-import";
import { ETF_CIK_BY_TICKER, findBarQualityIssues, findDailyMoveOutliers, findSessionGaps, SECTOR_ETF_TICKERS, STOOQ_SECOND_LISTING_CIK_BY_TICKER, stooqPriceCik } from "./stooq-price-load";

describe("Stooq price loading", () => {
  it("maps class shares and parses the Metastock header without zero substitution", () => {
    expect(entryToTicker("data/daily/us/nasdaq stocks/1/brk-b.us.txt", new Set(["BRK.B"]))).toBe("BRK.B");
    expect(entryToTicker("data/daily/us/nyse stocks/1/aapl.us.txt", new Set(["AAPL"]))).toBe("AAPL");
    const bars = parseMetastockDaily("<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>\nAAPL.US,D,20261009,000000,250.1,251.0,249.5,250.5,12345678,0\nAAPL.US,D,20261010,000000,,,,,0");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ date: "2026-10-09", open: 250.1, high: 251, low: 249.5, close: 250.5, volume: 12345678 });
  });

  it("assigns eleven unique negative ETF keys and keeps SPY separate", () => {
    expect(SECTOR_ETF_TICKERS).toHaveLength(11);
    expect(new Set(Object.values(ETF_CIK_BY_TICKER)).size).toBe(11);
    expect(Math.max(...Object.values(ETF_CIK_BY_TICKER))).toBeLessThan(0);
    expect(ETF_CIK_BY_TICKER.XLRE).toBe(-1008);
    expect(ETF_CIK_BY_TICKER.XLC).toBe(-1002);
  });

  it("keeps dual-class price histories distinct without changing ordinary SEC keys", () => {
    expect(stooqPriceCik(1652044, "GOOG")).toBe(-2001);
    expect(stooqPriceCik(1652044, "GOOGL")).toBe(1652044);
    expect(stooqPriceCik(1754301, "FOX")).toBe(-2002);
    expect(stooqPriceCik(1754301, "FOXA")).toBe(1754301);
    expect(stooqPriceCik(1564708, "NWS")).toBe(-2003);
    expect(stooqPriceCik(1564708, "NWSA")).toBe(1564708);
    expect(stooqPriceCik(320193, "AAPL")).toBe(320193);
    const keys = [...Object.values(STOOQ_SECOND_LISTING_CIK_BY_TICKER), ...Object.values(ETF_CIK_BY_TICKER), 0];
    expect(new Set(keys).size).toBe(15);
    expect(Math.max(...keys)).toBe(0);
  });

  it("handles unsorted bars and duplicate unsorted benchmark dates", () => {
    const bars = ["2026-01-20", "2026-01-01", "2026-01-02"].map((date) => ({ date, open: 100, high: 101, low: 99, close: 100, adjClose: 100, volume: 1 }));
    const spyDates = ["2026-01-02", "2026-01-20", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16", "2026-01-19", "2026-01-01", "2026-01-05"];
    expect(findSessionGaps("AAA", bars, spyDates)).toEqual([{ ticker: "AAA", from: "2026-01-02", to: "2026-01-20", missingSessions: 11 }]);
  });

  it("finds session gaps and preserves large moves for review", () => {
    const bars = [
      { date: "2026-01-01", open: 100, high: 101, low: 99, close: 100, adjClose: 100, volume: 1 },
      { date: "2026-01-02", open: 100, high: 101, low: 99, close: 100, adjClose: 100, volume: 1 },
      { date: "2026-01-20", open: 40, high: 60, low: 30, close: 20, adjClose: 20, volume: 1 },
    ];
    expect(findSessionGaps("AAA", bars, ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16", "2026-01-19", "2026-01-20"])[0].missingSessions).toBe(11);
    expect(findDailyMoveOutliers("AAA", bars)).toHaveLength(1);
    expect(findDailyMoveOutliers("AAA", bars)[0].move).toBeCloseTo(-0.8);
    expect(findBarQualityIssues("AAA", bars).nonPositive).toHaveLength(0);
    expect(findBarQualityIssues("AAA", bars).highLow).toHaveLength(0);
  });
});
