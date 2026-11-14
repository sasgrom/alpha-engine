import { describe, expect, it } from "vitest";
import { schwabPriceSeries, schwabSymbol } from "./schwab-price-series";
import { SECTOR_ETF_TICKERS } from "./stooq-price-load";

describe("Schwab price-series universe", () => {
  it("covers every registry company with a price series, SPY and the sector funds without predecessors", () => {
    const series = schwabPriceSeries(), tickers = new Set(series.map(row => row.ticker));
    expect(series).toHaveLength(516);
    expect(tickers.size).toBe(series.length);
    expect(tickers.has("RIVN")).toBe(true);
    expect(tickers.has("ENLT")).toBe(true);
    expect(tickers.has("XOM_PRE")).toBe(false);
    expect(tickers.has("SPY")).toBe(true);
    for (const ticker of SECTOR_ETF_TICKERS) expect(tickers.has(ticker)).toBe(true);
    for (const row of series) expect(Number.isInteger(row.priceKey)).toBe(true);
  });

  it("uses the provider's class-share symbol without changing the registry ticker", () => {
    expect(schwabSymbol("BRK.B")).toBe("BRK/B");
    expect(schwabSymbol("BF-B")).toBe("BF/B");
  });
});
