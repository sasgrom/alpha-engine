import { readFileSync } from "node:fs";
import path from "node:path";
import { ETF_CIK_BY_TICKER, SECTOR_ETF_TICKERS, stooqPriceCik } from "./stooq-price-load";

/** One daily price series collected from Schwab: our ticker, the provider's symbol, and the local price key (prices.cik). */
export interface SchwabPriceSeries {
  ticker: string;
  schwabSymbol: string;
  priceKey: number;
}

/** Class shares are written BRK-B (or BRK.B) in the universe files and BRK/B in Schwab requests; BRK.B returns no data. */
export function schwabSymbol(ticker: string): string {
  return ticker.replace(/[-.]/g, "/");
}

const universe = (file: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")) as { cik: number; ticker: string }[];

/**
 * Every series the Schwab daily price jobs cover: every registry company with a price series (the 53-name research
 * source plus the S&P 500 snapshot, both listings of dual-class companies and RIVN/ENLT), SPY and the eleven sector
 * funds. XOM_PRE stays out. Price keys follow the Stooq load, so the two sources of one series share a key and differ
 * only by prices.source.
 */
export function schwabPriceSeries(files = ["research-universe-53.json", "edgar-universe.json"]): SchwabPriceSeries[] {
  const byTicker = new Map<string, SchwabPriceSeries>();
  for (const file of files) {
    for (const company of universe(file)) {
      if (!company.cik || !company.ticker || company.ticker.endsWith("_PRE") || byTicker.has(company.ticker)) continue;
      byTicker.set(company.ticker, { ticker: company.ticker, schwabSymbol: schwabSymbol(company.ticker), priceKey: stooqPriceCik(company.cik, company.ticker) });
    }
  }
  byTicker.set("SPY", { ticker: "SPY", schwabSymbol: "SPY", priceKey: 0 });
  for (const ticker of SECTOR_ETF_TICKERS) byTicker.set(ticker, { ticker, schwabSymbol: ticker, priceKey: ETF_CIK_BY_TICKER[ticker] });
  return [...byTicker.values()];
}
