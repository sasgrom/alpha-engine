export const INTRADAY_SNAPSHOT_LABEL = "Built from 5-minute price snapshots; highs and lows are approximate";

export const SECTOR_FUND_BY_SECTOR: Readonly<Record<string, string>> = Object.freeze({
  "Communication Services": "XLC",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Energy: "XLE",
  Financials: "XLF",
  "Health Care": "XLV",
  Industrials: "XLI",
  "Information Technology": "XLK",
  Materials: "XLB",
  "Real Estate": "XLRE",
  Utilities: "XLU",
});

export const SECTOR_NAME_BY_FUND: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.entries(SECTOR_FUND_BY_SECTOR).map(([name, ticker]) => [ticker, name])));

export interface DeskIntradayPoint {
  time: string;
  value: number;
}

export interface DeskIntradayBar {
  end: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  vwap: number | null;
}

export interface DeskIntradaySeries {
  bars: DeskIntradayBar[];
  previousClose: number | null;
  vwap: number | null;
  openGap: number | null;
  delayed: boolean | null;
  splitAdjusted: boolean;
}

export interface DeskIntradayMarker {
  time: string | null;
  date: string;
  kind: "release" | "8-K";
  label: string;
  accessionNo: string | null;
  sourceUrl: string | null;
  precision: "second" | "day";
}

export interface DeskIntradaySession {
  date: string;
  company: DeskIntradaySeries;
  spy: DeskIntradaySeries;
  sector: DeskIntradaySeries | null;
  markers: DeskIntradayMarker[];
}

export interface DeskIntradayResponse {
  schemaVersion: 1;
  ticker: string;
  cik: number;
  name: string;
  sector: string;
  sectorFund: string | null;
  requestedSessions: number;
  status: "ok" | "partial";
  session: string;
  asOf: string;
  marketOpen: boolean;
  delayed: boolean | null;
  sessions: DeskIntradaySession[];
}

export interface DeskIntradayMarketSeries {
  points: DeskIntradayPoint[];
  change: number | null;
}

export interface DeskIntradayMarketMover extends DeskIntradayMarketSeries {
  ticker: string;
  name: string;
}

export interface DeskIntradayMarket {
  schemaVersion: 1;
  generatedAt: string;
  session: string;
  asOf: string;
  marketOpen: boolean;
  delayed: boolean | null;
  status: "ok" | "partial";
  coverage: { expected: number; measured: number };
  breadth: { time: string; above: number; measured: number; share: number | null }[];
  spy: DeskIntradayMarketSeries;
  equalWeight: DeskIntradayMarketSeries;
  sectors: (DeskIntradayMarketSeries & { ticker: string; name: string })[];
  movers: DeskIntradayMarketMover[];
  paths: Record<string, DeskIntradayPoint[]>;
}
