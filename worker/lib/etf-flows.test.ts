import { describe, expect, it } from "vitest";
import { ETF_FUNDS, etfFlows, etfShareRow, type EtfShareRow } from "./etf-flows";

describe("ETF share counts", () => {
  it("lists each fund once, with SPY and the eleven sector funds", () => {
    const tickers = ETF_FUNDS.map((fund) => fund.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
    expect(tickers).toContain("SPY");
    expect(ETF_FUNDS.filter((fund) => fund.group === "sector")).toHaveLength(11);
  });

  it("takes the share count, prices and quote time from a Schwab quote", () => {
    const row = etfShareRow("SPY", {
      assetSubType: "ETF",
      quote: { lastPrice: 601.5, closePrice: 600, totalVolume: 123, quoteTime: Date.parse("2026-11-27T21:00:00Z") },
      fundamental: { sharesOutstanding: 1064582116 },
      regular: { regularMarketLastPrice: 601.25 },
    }, "2026-11-28T08:00:00.000Z");
    expect(row).toEqual({
      ticker: "SPY", capturedAt: "2026-11-28T08:00:00.000Z", quoteTime: "2026-11-27T21:00:00.000Z",
      sharesOutstanding: 1064582116, lastPrice: 601.5, regularPrice: 601.25, closePrice: 600, totalVolume: 123, nav: null, assetSubType: "ETF",
    });
  });

  it("keeps missing fields as null instead of inventing numbers", () => {
    const row = etfShareRow("XLK", {}, "2026-11-28T08:00:00.000Z");
    expect(row.sharesOutstanding).toBeNull();
    expect(row.quoteTime).toBeNull();
  });

  it("turns changes in the count into dollar flows and skips unchanged captures", () => {
    const at = (capturedAt: string, sharesOutstanding: number | null, regularPrice = 100): EtfShareRow => ({
      ticker: "XLK", capturedAt, quoteTime: null, sharesOutstanding, lastPrice: null, regularPrice, closePrice: 90, totalVolume: null, nav: null, assetSubType: "ETF",
    });
    const flows = etfFlows([at("2026-11-28T02:00:00Z", 1_050_000), at("2026-11-28T00:00:00Z", 1_000_000), at("2026-11-28T01:00:00Z", 1_000_000), at("2026-11-28T03:00:00Z", null)]);
    expect(flows).toEqual([{ ticker: "XLK", from: "2026-11-28T01:00:00Z", to: "2026-11-28T02:00:00Z", shareChange: 50_000, dollars: 5_000_000, price: 100 }]);
  });
});
