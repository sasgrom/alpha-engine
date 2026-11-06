import { describe, expect, it } from "vitest";
import { latestCompleteOfficialDailyBars, officialBarEnrichment, officialDailyBars, type ExistingOfficialBar } from "./schwab-daily";

const candles = [
  { datetime: Date.parse("2026-11-03T05:00:00Z"), open: 340, high: 351, low: 339, close: 348, volume: 40_000_000 },
  { datetime: Date.parse("2026-11-04T05:00:00Z"), open: 350, high: 355, low: 347, close: 349.51, volume: 50_000_000 },
];

describe("official Schwab daily bars", () => {
  it("returns the latest two complete daily candles with OHLCV", () => {
    const bars = latestCompleteOfficialDailyBars({ candles }, "2026-11-05");
    expect(bars.map((bar) => bar.date)).toEqual(["2026-11-03", "2026-11-04"]);
    expect(bars[1]).toMatchObject({ open: 350, high: 355, low: 347, close: 349.51, volume: 50_000_000, adjClose: null });
  });

  it("excludes future and invalid closes instead of fabricating a latest bar", () => {
    const bars = officialDailyBars({ candles: [...candles, { ...candles[1], datetime: Date.parse("2026-11-06T05:00:00Z") }, { ...candles[1], datetime: Date.parse("2026-11-05T05:00:00Z"), close: null }] }, "2026-11-05");
    expect(bars.map((bar) => bar.date)).toEqual(["2026-11-03", "2026-11-04"]);
  });

  it("fails closed when either required candle lacks OHLCV", () => {
    expect(() => latestCompleteOfficialDailyBars({ candles: [{ ...candles[0], open: null }, candles[1]] }, "2026-11-05")).toThrow("complete official daily candles");
    expect(() => latestCompleteOfficialDailyBars({ candles: [candles[1]] }, "2026-11-05")).toThrow("Expected 2");
  });
});

describe("official close-only enrichment", () => {
  const existing: ExistingOfficialBar = {
    id: 1, ticker: "AAPL", date: "2026-11-04", open: null, high: null, low: null,
    close: 349.51, adjClose: null, volume: null, fetchedAt: "2026-11-05T14:07:00.000Z",
  };

  it("fills null OHLCV while preserving close, availability and adjustment policy", () => {
    const patch = officialBarEnrichment(existing, { ...candles[1], date: "2026-11-04", adjClose: null });
    expect(patch).toEqual({ open: 350, high: 355, low: 347, volume: 50_000_000 });
    expect(existing.fetchedAt).toBe("2026-11-05T14:07:00.000Z");
    expect(existing.close).toBe(349.51);
  });

  it("does nothing when confirmed OHLCV already matches", () => {
    const complete = { ...existing, open: 350, high: 355, low: 347, volume: 50_000_000 };
    expect(officialBarEnrichment(complete, { ...candles[1], date: "2026-11-04", adjClose: null })).toEqual({});
  });

  it("rejects conflicting values instead of overwriting them", () => {
    expect(() => officialBarEnrichment(existing, { ...candles[1], date: "2026-11-04", close: 350, adjClose: null })).toThrow("Conflicting Schwab close");
    expect(() => officialBarEnrichment({ ...existing, open: 349 }, { ...candles[1], date: "2026-11-04", adjClose: null })).toThrow("Conflicting Schwab open");
    expect(() => officialBarEnrichment({ ...existing, adjClose: 349.51 }, { ...candles[1], date: "2026-11-04", adjClose: null })).toThrow("Unexpected adjusted Schwab close");
  });
});
