// Unit tests for the Stage 1.7 bulk archive import helpers (iteration 3g/3k).
import { describe, it, expect } from "vitest";
import { parseMetastockDaily, entryToTicker, partIndexFromKey } from "./price-import";

describe("parseMetastockDaily", () => {
  const sample = [
    "<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>",
    "AAPL,D,20240102,000000,187.15,188.44,183.89,185.64,82488700,0",
    "AAPL,D,20240103,000000,184.22,185.89,183.50,184.25,58414500,0",
    "", // trailing blank line
  ].join("\n");

  it("parses rows, skips the header, and converts dates to ISO", () => {
    const bars = parseMetastockDaily(sample);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      date: "2024-01-02",
      open: 187.15,
      high: 188.44,
      low: 183.89,
      close: 185.64,
      adjClose: 185.64, // Stooq daily is pre-adjusted
      volume: 82488700,
    });
    expect(bars[1].date).toBe("2024-01-03");
  });

  it("drops rows with a non-numeric close (halted days)", () => {
    const text = [
      "AAPL,D,20240102,000000,187.15,188.44,183.89,185.64,82488700,0",
      "AAPL,D,20240103,000000,0,0,0,,0,0",
      "AAPL,D,20240104,000000,184.22,185.89,183.50,184.25,58414500,0",
    ].join("\n");
    const bars = parseMetastockDaily(text);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.date)).toEqual(["2024-01-02", "2024-01-04"]);
  });

  it("keeps null OHLC when fields are empty but close is present", () => {
    const bars = parseMetastockDaily("AAPL,D,20240102,000000,,,,10.5,,0");
    expect(bars).toHaveLength(1);
    expect(bars[0].open).toBeNull();
    expect(bars[0].volume).toBeNull();
    expect(bars[0].close).toBe(10.5);
  });

  it("ignores malformed lines and short rows", () => {
    const bars = parseMetastockDaily("garbage\nAAPL,D,2024\nAAPL,D,20240102,000000,1,2,0.5,1.5,100,0");
    expect(bars).toHaveLength(1);
  });
});

describe("partIndexFromKey (3k resume support)", () => {
  it("parses plain and platform-suffixed part keys", () => {
    expect(partIndexFromKey("prices-import/batch/part-0000-1643ffae.bin")).toBe(0);
    expect(partIndexFromKey("prices-import/batch/part-0017-21c952bd.bin")).toBe(17);
    expect(partIndexFromKey("prices-import/batch/part-0003.bin")).toBe(3);
  });
  it("returns null for non-part keys (listing is already prefix-scoped)", () => {
    expect(partIndexFromKey("prices-import/batch/notes.txt")).toBeNull();
    expect(partIndexFromKey("prices-import/batch/part-1.bin")).toBeNull(); // not zero-padded
    expect(partIndexFromKey("prices-import/batch/part-0001.txt")).toBeNull(); // wrong extension
  });
});

describe("entryToTicker", () => {
  const wanted = new Set(["AAPL", "SPY", "BRK.B"]);

  it("matches a wanted ticker by basename regardless of folder depth", () => {
    expect(entryToTicker("data/daily/us/nasdaq stocks/1/aapl.us.txt", wanted)).toBe("AAPL");
    expect(entryToTicker("spy.us.txt", wanted)).toBe("SPY");
  });

  it("maps Stooq dash class-share filenames to our dot spelling", () => {
    expect(entryToTicker("data/daily/us/nyse stocks/1/brk-b.us.txt", wanted)).toBe("BRK.B");
  });

  it("returns null for tickers outside the wanted set and non-txt entries", () => {
    expect(entryToTicker("data/daily/us/nasdaq stocks/1/zzzz.us.txt", wanted)).toBeNull();
    expect(entryToTicker("data/daily/us/nasdaq stocks/1/aapl.us.csv", wanted)).toBeNull();
    expect(entryToTicker("data/daily/us/readme.txt", wanted)).toBeNull();
  });
});
