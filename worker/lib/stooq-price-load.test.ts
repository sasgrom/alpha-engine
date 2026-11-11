import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entryToTicker, parseMetastockDaily } from "../../api/services/price-import";
import { compareArchiveBars, ETF_CIK_BY_TICKER, findBarQualityIssues, findDailyMoveOutliers, findSessionGaps, listStooqTextFiles, SECTOR_ETF_TICKERS, STOOQ_SECOND_LISTING_CIK_BY_TICKER, stooqPriceCik } from "./stooq-price-load";

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

  describe("comparing a newer archive with stored bars", () => {
    const bar = (date: string, close: number, volume = 1000) => ({ date, open: close, high: close * 1.01, low: close * 0.99, close, adjClose: close, volume });
    const stored = [bar("2026-10-22", 100), bar("2026-10-23", 50.1234), bar("2026-10-26", 0.1234)];

    it("adds only the new dates when the overlap is identical", () => {
      const result = compareArchiveBars(stored, [...stored, bar("2026-10-27", 101)]);
      expect(result).toMatchObject({ kind: "identical", overlap: 3, newDates: 1, differing: 0 });
      expect(result.rows.map((row) => row.date)).toEqual(["2026-10-27"]);
    });

    it("accepts a whole history rescaled by one dividend factor, within the archive's four-decimal rounding", () => {
      const factor = 0.9925;
      const archive = [...stored.map((row) => bar(row.date, Math.round(row.close * factor * 1e4) / 1e4)), bar("2026-11-10", 99)];
      const result = compareArchiveBars(stored, archive);
      expect(result.kind).toBe("readjusted");
      expect(result.factor).toBeCloseTo(factor, 3);
      expect(result.rows).toHaveLength(4);
      expect(result.firstDiffering).toBe("2026-10-22");
    });

    it("treats a split after the old archive date as a rescaling too", () => {
      const result = compareArchiveBars(stored, stored.map((row) => bar(row.date, Math.round((row.close / 10) * 1e4) / 1e4, row.volume * 10)));
      expect(result.kind).toBe("readjusted");
      expect(result.factor).toBeCloseTo(0.1, 4);
    });

    it("accepts corrected volumes with unchanged closes", () => {
      const result = compareArchiveBars(stored, stored.map((row, index) => (index === 2 ? bar(row.date, row.close, 1234) : row)));
      expect(result).toMatchObject({ kind: "corrected", differing: 1, factor: 1 });
      expect(result.rows.map((row) => row.date)).toEqual(["2026-10-26"]);
    });

    it("accepts dividend adjustments the stored archive had not applied: lower earlier prices, rising towards the present", () => {
      const long = Array.from({ length: 40 }, (_, index) => bar(`2026-0${1 + Math.floor(index / 10)}-${String(10 + (index % 10)).padStart(2, "0")}`, 100 + index));
      const archive = long.map((row, index) => bar(row.date, Math.round(row.close * (index < 10 ? 0.985 : index < 20 ? 0.99 : index < 30 ? 0.995 : 1) * 1e4) / 1e4));
      const result = compareArchiveBars(long, archive);
      expect(result).toMatchObject({ kind: "readjusted", pattern: "dividend steps" });
      expect(result.earliestRatio).toBeCloseTo(0.985, 4);
      expect(result.largestStep).toBeCloseTo(0.00505, 4);
      expect(result.rows).toHaveLength(30);
    });

    it("holds a ratio step the size of a split even when every price is lower", () => {
      const long = Array.from({ length: 20 }, (_, index) => bar(`2026-09-${String(index + 1).padStart(2, "0")}`, 100 + index));
      const result = compareArchiveBars(long, long.map((row, index) => bar(row.date, row.close * (index < 10 ? 0.5 : 1))));
      expect(result).toMatchObject({ kind: "revised", rows: [] });
      expect(result.largestStep).toBeCloseTo(1, 6);
    });

    it("holds a series whose closes differ by more than one factor and writes nothing for it", () => {
      const long = Array.from({ length: 20 }, (_, index) => bar(`2026-09-${String(index + 1).padStart(2, "0")}`, 100 + index));
      const archive = long.map((row, index) => (index % 4 === 0 ? bar(row.date, row.close * 1.05) : row));
      const result = compareArchiveBars(long, [...archive, bar("2026-10-01", 130)]);
      expect(result.kind).toBe("revised");
      expect(result.rows).toEqual([]);
    });

    it("appends the new dates of a held series when its latest twenty common closes agree", () => {
      const long = Array.from({ length: 40 }, (_, index) => bar(`2026-${String(7 + Math.floor(index / 20)).padStart(2, "0")}-${String(1 + (index % 20)).padStart(2, "0")}`, 100 + index));
      const archive = long.map((row, index) => (index < 10 ? bar(row.date, row.close * (index % 2 ? 1.2 : 0.8)) : row));
      const result = compareArchiveBars(long, [...archive, bar("2026-10-01", 150)]);
      expect(result).toMatchObject({ kind: "revised", newDatesAppended: true });
      expect(result.rows.map((row) => row.date)).toEqual(["2026-10-01"]);
    });

    it("keeps stored dates the archive no longer has and loads a series that was never stored", () => {
      const result = compareArchiveBars(stored, stored.slice(1));
      expect(result.storedOnlyDates).toEqual(["2026-10-22"]);
      expect(compareArchiveBars([], stored)).toMatchObject({ kind: "new", newDates: 3 });
      expect(compareArchiveBars([], stored).rows).toHaveLength(3);
    });
  });

  it("lists the daily text files of an extracted dump with forward slashes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stooq-dump-"));
    try {
      mkdirSync(path.join(dir, "nasdaq stocks", "1"), { recursive: true });
      mkdirSync(path.join(dir, "nyse etfs", "2"), { recursive: true });
      writeFileSync(path.join(dir, "nasdaq stocks", "1", "aapl.us.txt"), "");
      writeFileSync(path.join(dir, "nyse etfs", "2", "spy.us.txt"), "");
      writeFileSync(path.join(dir, "nyse etfs", "2", "readme.txt"), "");
      expect(listStooqTextFiles(dir)).toEqual(["nasdaq stocks/1/aapl.us.txt", "nyse etfs/2/spy.us.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
