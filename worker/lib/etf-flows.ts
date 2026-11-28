/**
 * ETF share counts as daily money flows (owner, 2026-11-28: volume flows per company, peers, sector and the market).
 *
 * An ETF creates or cancels shares in whole creation units when money comes in or goes out, so a change in its
 * shares outstanding times its price is a real dollar flow, not an estimate. Schwab quotes carry the count in
 * `fundamental.sharesOutstanding`; SPY moves in steps of 50,000 shares. This module holds the fund list, the
 * compact row taken from one quote and the flow between two counts. Market data only.
 */

export type EtfGroup = "market" | "sector" | "industry";

export interface EtfFund {
  ticker: string;
  group: EtfGroup;
  /** What the fund holds, in a few words; the sector funds follow GICS sectors, the industry funds narrower groups. */
  covers: string;
}

const f = (ticker: string, group: EtfGroup, covers: string): EtfFund => ({ ticker, group, covers });

/** Funds whose share counts are captured. Order is stable; a new fund is appended, never inserted. */
export const ETF_FUNDS: readonly EtfFund[] = Object.freeze([
  f("SPY", "market", "S&P 500"), f("IVV", "market", "S&P 500"), f("VOO", "market", "S&P 500"),
  f("RSP", "market", "S&P 500 equal weight"), f("QQQ", "market", "Nasdaq-100"), f("DIA", "market", "Dow Jones 30"),
  f("IWB", "market", "Russell 1000"), f("IWM", "market", "Russell 2000"), f("MDY", "market", "S&P MidCap 400"),
  f("XLB", "sector", "materials"), f("XLC", "sector", "communication services"), f("XLE", "sector", "energy"),
  f("XLF", "sector", "financials"), f("XLI", "sector", "industrials"), f("XLK", "sector", "information technology"),
  f("XLP", "sector", "consumer staples"), f("XLRE", "sector", "real estate"), f("XLU", "sector", "utilities"),
  f("XLV", "sector", "health care"), f("XLY", "sector", "consumer discretionary"),
  f("SMH", "industry", "semiconductors"), f("SOXX", "industry", "semiconductors"), f("XSD", "industry", "semiconductors (equal weight)"),
  f("IGV", "industry", "software"), f("XSW", "industry", "software and services (equal weight)"),
  f("CIBR", "industry", "cybersecurity"), f("SKYY", "industry", "cloud computing"),
  f("IBB", "industry", "biotechnology"), f("XBI", "industry", "biotechnology (equal weight)"),
  f("XPH", "industry", "pharmaceuticals"), f("IHI", "industry", "medical devices"), f("XHE", "industry", "health care equipment"),
  f("XHS", "industry", "health care services"),
  f("KBE", "industry", "banks"), f("KRE", "industry", "regional banks"), f("KIE", "industry", "insurance"),
  f("KCE", "industry", "capital markets"),
  f("ITA", "industry", "aerospace and defense"), f("XAR", "industry", "aerospace and defense (equal weight)"),
  f("IYT", "industry", "transportation"), f("XTN", "industry", "transportation (equal weight)"),
  f("ITB", "industry", "home construction"), f("XHB", "industry", "homebuilders"),
  f("XRT", "industry", "retail"), f("XOP", "industry", "oil and gas exploration and production"),
  f("OIH", "industry", "oil services"), f("XME", "industry", "metals and mining"), f("GDX", "industry", "gold miners"),
  f("XTL", "industry", "telecom"), f("VNQ", "industry", "REITs"), f("TAN", "industry", "solar"),
]);

export interface EtfShareRow {
  ticker: string;
  capturedAt: string;
  /** Schwab's quote time (ms since 1970) as an ISO string, null when absent. */
  quoteTime: string | null;
  sharesOutstanding: number | null;
  lastPrice: number | null;
  /** The regular session's last price (`regular.regularMarketLastPrice`), without after-hours trades. */
  regularPrice: number | null;
  /** Schwab's closePrice: during a session the previous close; after the session (seen 2026-11-28) it equals regularPrice. */
  closePrice: number | null;
  totalVolume: number | null;
  /** Net asset value when Schwab reports one (field `nAV`), else null. */
  nav: number | null;
  assetSubType: string | null;
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The compact row of one ETF from a Schwab `quotes?fields=quote,fundamental,reference` answer. */
export function etfShareRow(ticker: string, entry: any, capturedAt: string): EtfShareRow {
  const quote = entry?.quote ?? {}, fundamental = entry?.fundamental ?? {}, regular = entry?.regular ?? {};
  const quoteTime = num(quote.quoteTime);
  return {
    ticker,
    capturedAt,
    quoteTime: quoteTime === null ? null : new Date(quoteTime).toISOString(),
    sharesOutstanding: num(fundamental.sharesOutstanding),
    lastPrice: num(quote.lastPrice),
    regularPrice: num(regular.regularMarketLastPrice),
    closePrice: num(quote.closePrice),
    totalVolume: num(quote.totalVolume),
    nav: num(quote.nAV),
    assetSubType: typeof entry?.assetSubType === "string" ? entry.assetSubType : null,
  };
}

export interface EtfFlow {
  ticker: string;
  from: string;
  to: string;
  shareChange: number;
  /** shareChange times the price; positive = money in. */
  dollars: number;
  price: number;
}

/**
 * Flows between consecutive captures in time order: one entry each time the share count changes. The price is the
 * later capture's regular-session last price, falling back to its last trade (which includes after-hours trades).
 * Which session a new count belongs to is settled from the hourly captures, not here.
 */
export function etfFlows(rows: EtfShareRow[]): EtfFlow[] {
  const sorted = [...rows].filter((row) => row.sharesOutstanding !== null).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const out: EtfFlow[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    const change = (b.sharesOutstanding as number) - (a.sharesOutstanding as number);
    const price = b.regularPrice ?? b.lastPrice;
    if (change === 0 || price === null) continue;
    out.push({ ticker: b.ticker, from: a.capturedAt, to: b.capturedAt, shareChange: change, dollars: change * price, price });
  }
  return out;
}
