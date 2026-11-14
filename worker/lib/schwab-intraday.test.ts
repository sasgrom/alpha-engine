import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATION_JOB_MAP } from "../../contracts/operations";
import { cronParts, nextCronRun } from "./operations-scheduler";
import { buildBars, livePrices, parseQuotes, rawSnapshotDue, sessionWindow, symbolBatches, type IntradaySnapshot } from "./schwab-intraday";

const hours = (date: string, isOpen = true) => ({
  date, isOpen, isHoliday: !isOpen,
  regularMarket: isOpen ? [{ start: `${date}T09:30:00-05:00`, end: `${date}T16:00:00-05:00` }] : [],
});

describe("live prices: quotes", () => {
  it("takes the regular session's last trade, the previous close and the day's running values", () => {
    const quotes = parseQuotes({
      AAPL: { realtime: true, quote: { lastPrice: 354.78, closePrice: 355.36, openPrice: 357.81, highPrice: 359.37, lowPrice: 354.41, totalVolume: 31874978, tradeTime: 1794531599068 }, regular: { regularMarketLastPrice: 354.88, regularMarketTradeTime: 1794517200125 } },
      "BRK/B": { realtime: false, quote: { lastPrice: 512.1, closePrice: 510, totalVolume: 1200 } },
      HALTED: { quote: { lastPrice: 0, closePrice: 12 } },
    });
    expect(quotes.get("AAPL")).toEqual({ last: 354.88, previousClose: 355.36, open: 357.81, high: 359.37, low: 354.41, volume: 31874978, tradeTime: 1794517200125, delayed: false });
    expect(quotes.get("BRK/B")).toMatchObject({ last: 512.1, previousClose: 510, open: null, tradeTime: null, delayed: true });
    expect(quotes.has("HALTED")).toBe(false);
  });

  it("asks for the whole universe in a few batched requests", () => {
    const symbols = Array.from({ length: 515 }, (_, i) => `T${i}`);
    expect(symbolBatches(symbols).map((batch) => batch.length)).toEqual([200, 200, 115]);
  });

  it("retains raw responses only at the 20-minute marks and keeps compact quotes between them", () => {
    expect(rawSnapshotDue("2026-11-13T14:40:00Z")).toBe(true);
    expect(rawSnapshotDue("2026-11-13T15:00:00Z")).toBe(true);
    expect(rawSnapshotDue("2026-11-13T15:20:00Z")).toBe(true);
    expect(rawSnapshotDue("2026-11-13T14:45:00Z")).toBe(false);
    expect(rawSnapshotDue("2026-11-13T14:50:00Z")).toBe(false);
    expect(rawSnapshotDue("2026-11-13T14:55:00Z")).toBe(false);
    expect(rawSnapshotDue("not-a-time")).toBe(false);
  });
});

describe("live prices: the session window", () => {
  it("runs from shortly before the regular session to shortly after it, never on a holiday", () => {
    expect(sessionWindow(hours("2026-11-13"), new Date("2026-11-13T14:40:00Z")).open).toBe(true); // 09:40 ET
    expect(sessionWindow(hours("2026-11-13"), new Date("2026-11-13T21:20:00Z")).open).toBe(true); // 16:20 ET
    expect(sessionWindow(hours("2026-11-13"), new Date("2026-11-13T21:40:00Z"))).toMatchObject({ open: false, reason: expect.stringContaining("after the session") });
    expect(sessionWindow(hours("2026-11-13"), new Date("2026-11-13T13:00:00Z"))).toMatchObject({ open: false, reason: expect.stringContaining("before the session") });
    expect(sessionWindow(hours("2026-11-26", false), new Date("2026-11-26T16:00:00Z"))).toEqual({ open: false, reason: "market closed on 2026-11-26" });
  });

  it("is scheduled every five minutes of a weekday session, 06:40 to 13:20 Pacific", () => {
    const cron = OPERATION_JOB_MAP["schwab-intraday"].cron!;
    expect(cronParts(cron)).toHaveLength(3);
    const runs: string[] = [];
    let at = new Date(2026, 10, 13, 0, 0); // Friday, local time
    for (;;) {
      at = nextCronRun(cron, at)!;
      if (at.getDate() !== 13) break;
      runs.push(`${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`);
    }
    expect(runs.slice(0, 5)).toEqual(["06:40", "06:45", "06:50", "06:55", "07:00"]);
    expect(runs.slice(-5)).toEqual(["13:00", "13:05", "13:10", "13:15", "13:20"]);
    expect(runs).toHaveLength(81);
    expect(nextCronRun(cron, new Date(2026, 10, 14, 0, 0))).toEqual(new Date(2026, 10, 16, 6, 40)); // Saturday -> Monday
    expect(OPERATION_JOB_MAP["desk-snapshot-live"].dependsOn).toEqual(["schwab-intraday"]);
  });
});

describe("live prices: five-minute bars, the live file and ten sessions", () => {
  const snap = (capturedAt: string, last: number, high: number, low: number, volume: number): IntradaySnapshot => ({
    schemaVersion: 1, session: "2026-11-13", capturedAt,
    quotes: { XYZ: { last, previousClose: 100, open: 101, high, low, volume, tradeTime: Date.parse(capturedAt) - 5_000 } },
  });

  it("builds bars from consecutive snapshots: open/close prices, new extremes, volume differences", () => {
    const bars = buildBars([
      snap("2026-11-13T14:45:00Z", 102, 103, 100.5, 1_000), // first bar opens at the day's open
      snap("2026-11-13T14:40:00Z", 101.5, 102, 100.5, 400), // out of order on purpose
      snap("2026-11-13T14:50:00Z", 101, 103, 99, 1_600), // a new low inside the interval, no new high
    ]).XYZ;
    expect(bars.map((bar) => bar.end)).toEqual(["2026-11-13T14:40:00Z", "2026-11-13T14:45:00Z", "2026-11-13T14:50:00Z"]);
    expect(bars[0]).toEqual({ end: "2026-11-13T14:40:00Z", o: 101, h: 102, l: 100.5, c: 101.5, v: 400 });
    expect(bars[1]).toEqual({ end: "2026-11-13T14:45:00Z", o: 101.5, h: 103, l: 101.5, c: 102, v: 600 });
    expect(bars[2]).toEqual({ end: "2026-11-13T14:50:00Z", o: 102, h: 102, l: 99, c: 101, v: 600 });
  });

  it("dates live prices by the latest trade, keeps the true capture time and never prunes sessions", () => {
    const live = livePrices(snap("2026-11-13T18:40:00Z", 102, 103, 100, 900));
    expect(live).toMatchObject({ session: "2026-11-13", asOf: "2026-11-13T18:39:55.000Z", quotes: { XYZ: { last: 102, previousClose: 100 } } });
    const source = readFileSync(new URL("../schwab-intraday.mts", import.meta.url), "utf8");
    expect(source).toContain("const capturedAt = new Date()");
    expect(source).toContain("realpathSync(ROOT)");
    expect(source).not.toMatch(/\brmSync\b|sessionsToDrop|INTRADAY_SESSIONS_KEPT/);
  });
});
