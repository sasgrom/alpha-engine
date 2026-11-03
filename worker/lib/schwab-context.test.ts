import { describe, expect, it } from "vitest";
import { buildSchwabContextReport, parseInstrument, parseMarketHours, parseMovers, schwabMarketHoursPath, summarizeIntraday } from "./schwab-context";

describe("Schwab Context Pack", () => {
  it("maps market hours to the required markets query parameter", () => {
    expect(schwabMarketHoursPath("option")).toBe("markets?markets=option");
    expect(schwabMarketHoursPath("equity")).toBe("markets?markets=equity");
  });

  it("parses market sessions without inventing open times", () => {
    const raw = JSON.stringify({ equity: { EQ: { date: "2026-10-31", isOpen: false, isHoliday: true, sessionHours: { regularMarket: [{ start: "2026-10-31T09:30:00-04:00", end: "2026-10-31T16:00:00-04:00" }] } } } });
    const session = parseMarketHours(raw, "2026-10-31T12:00:00Z");
    expect(session.isOpen).toBe(false);
    expect(session.isHoliday).toBe(true);
    expect(session.regularMarket[0].start).toContain("09:30");
    expect(parseMarketHours("{}", "2026-10-31T12:00:00Z").regularMarket).toEqual([]);
  });

  it("normalizes movers and preserves actual direction and volume", () => {
    const rows = parseMovers(JSON.stringify([
      { symbol: "AAPL", description: "Apple Inc", last: 200, change: 4, percentChange: 2, totalVolume: 1000, direction: "up" },
      { symbol: "MSFT", lastPrice: 100, netChange: -2, netPercentChange: -2, totalVolume: 500 },
    ]));
    expect(rows[0]).toMatchObject({ symbol: "AAPL", percentChange: 2, direction: "up", volume: 1000 });
    expect(rows[1]).toMatchObject({ symbol: "MSFT", percentChange: -2, direction: "down" });
  });

  it("keeps only primitive fundamental fields", () => {
    const profile = parseInstrument(JSON.stringify({ AAPL: { symbol: "AAPL", cusip: "037833100", description: "Apple Inc", exchange: "NASDAQ", assetType: "EQUITY", assetMainType: "EQUITY", fundamental: { marketCap: 1000, peRatio: 30, nested: { ignored: true } } } }), "AAPL");
    expect(profile.cusip).toBe("037833100");
    expect(profile.fundamental).toEqual({ marketCap: 1000, peRatio: 30 });
  });

  it("computes VWAP and a 30-minute opening range from 5-minute bars", () => {
    const start = Date.parse("2026-10-30T13:30:00Z");
    const candles = Array.from({ length: 7 }, (_, index) => ({ datetime: start + index * 300000, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 100 }));
    const series = summarizeIntraday("AAPL", JSON.stringify({ candles }));
    expect(series.openingRangeHigh).toBe(106);
    expect(series.openingRangeLow).toBe(99);
    expect(series.vwap).not.toBeNull();
    expect(series.lastClose).toBe(106);
    expect(series.bars).toHaveLength(7);
  });

  it("builds a report with honest endpoint coverage", () => {
    const report = buildSchwabContextReport({
      generatedAt: "2026-10-31T12:00:00Z", capturedAt: "2026-10-31T12:00:00Z",
      hours: { equity: "{}", option: "{}" }, movers: { SPX: "[]", COMPX: "[]", DJI: "[]" },
      instruments: { AAPL: JSON.stringify({ symbol: "AAPL" }) }, intraday: { AAPL: "{}", SPY: "{}" },
      files: [{ kind: "hours/equity", capturedAt: "2026-10-31T12:00:00Z", sourceHash: "x", status: "failed", error: "HTTP 500" }],
    });
    expect(report.coverage.errors).toBe(1);
    expect(report.files[0].error).toBe("HTTP 500");
  });
});
