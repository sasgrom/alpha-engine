/**
 * Desk snapshot: one precomputed file that feeds the new desk view (market map, screener, today page).
 * Built locally by scripts/build-desk-snapshot.mts from stored daily closes, the Schwab fundamentals and quotes
 * captured for the S&P 500 and the research companies, the Schwab option features and the stored earnings events.
 * Served by the desk.snapshot procedure; never part of an automatic production push.
 * Optional fields were added after the first release: a reader treats an absent one as null (no version bump).
 */
export const DESK_SNAPSHOT_SCHEMA_VERSION = 1;

/** Return periods, all measured to the latest close: one session, then calendar look-backs. */
export const DESK_PERIODS = ["d1", "w1", "m1", "m3", "ytd", "y1"] as const;
export type DeskPeriod = (typeof DESK_PERIODS)[number];
export type DeskReturns = Record<DeskPeriod, number | null>;

export const DESK_PERIOD_LABELS: Record<DeskPeriod, string> = {
  d1: "1D",
  w1: "1W",
  m1: "1M",
  m3: "3M",
  ytd: "YTD",
  y1: "1Y",
};

/** One expiry bucket of the option features (straddle-implied move until that expiry). */
export interface DeskOptionBucket {
  bucket: string;
  days: number;
  atmIv: number | null;
  expectedMovePct: number | null;
  skew25: number | null;
  putCallOiRatio: number | null;
}

export interface DeskOptions {
  capturedAt: string;
  rv20: number | null;
  ivRvSpread: number | null;
  buckets: DeskOptionBucket[];
}

/** Latest stored short-interest reading and the change in shares short from the reading before it. */
export interface DeskShortInterest {
  date: string;
  shares: number | null;
  pctFloat: number | null;
  daysToCover: number | null;
  changePct: number | null;
}

export interface DeskInsiderSummary {
  /** Open-market purchases (code P) outside 10b5-1 plans. */
  buys: number;
  buyers: number;
  buyUsd: number;
  lastBuy: string | null;
  /** Open-market sales (code S), plans included. */
  sells: number;
  sellUsd: number;
}

export interface DeskCompany {
  /** The traded common share (the ticker its stored prices were fetched under). */
  ticker: string;
  /** The ticker in the company registry, which classic pages look up (differs for a few share classes). */
  registryTicker: string;
  cik: number;
  name: string;
  /** GICS sector; "Other" for research companies outside the S&P 500 classification. */
  sector: string;
  industry: string | null;
  /** One of the research companies (full filings, events and option features). */
  research: boolean;
  /** Latest stored close and its date (equals the snapshot session unless the series is behind). */
  close: number;
  lastDate: string;
  returns: DeskReturns;
  /** 52-week closing range of the stored series. */
  high52: number | null;
  low52: number | null;
  ma50: number | null;
  ma200: number | null;
  /** Annualized standard deviation of the last 20 daily log returns. */
  vol20: number | null;
  /** From the Schwab fundamentals captured with the latest quotes (USD; yield as a fraction). */
  marketCap: number | null;
  pe: number | null;
  beta: number | null;
  dividendYield: number | null;
  epsTtm: number | null;
  /** Latest earnings report date: stored 8-K events for research companies, else Schwab's last earnings date. */
  lastEarnings: string | null;
  /** Close before the report day to the close of the session after it (1 when only the report day exists). */
  lastEarningsReaction: number | null;
  lastEarningsReactionSessions: 1 | 2 | null;
  /** Projected next report date: same quarter last year + 52 weeks when the history allows, else + 13 weeks. */
  nextEarnings: string | null;
  nextEarningsBasis: "history" | "cadence" | null;
  /** Return from the close that ends the reaction window to the latest close, and the sessions it spans. */
  lastEarningsDrift?: number | null;
  lastEarningsDriftSessions?: number | null;
  /** Return from the close a year ago to the close a month ago (the classic 12-minus-1 momentum reading). */
  momentum12m1?: number | null;
  shortInterest?: DeskShortInterest | null;
  /** Form 4 activity of the last 90 days (companies whose Form 4 filings are collected). */
  insiders?: DeskInsiderSummary | null;
  options: DeskOptions | null;
  /** Up to 63 latest closes (about three months), oldest first. */
  spark: number[];
}

export interface DeskSector {
  name: string;
  companies: number;
  marketCap: number;
  /** Market-cap weighted mean of the members' returns (members without a cap or a return are left out). */
  returns: DeskReturns;
  advancers: number;
  decliners: number;
}

export interface DeskBreadth {
  measured: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  medianChange: number | null;
  /** Latest close is the highest (lowest) close of the 52-week window. */
  newHighs: number;
  newLows: number;
  aboveMa50: number;
  withMa50: number;
  aboveMa200: number;
  withMa200: number;
}

export interface DeskBenchmark {
  ticker: string;
  close: number;
  lastDate: string;
  returns: DeskReturns;
  spark: number[];
}

export interface DeskSnapshotInputs {
  priceRows: number;
  priceSeries: number;
  latestPriceDate: string | null;
  schwabQuoteDates: string[];
  fundamentals: number;
  quotes: number;
  optionTickers: number;
  optionsGeneratedAt: string | null;
  earningsEvents: number;
  companiesWithoutPrices: string[];
  /** Registry rows of index members that disagree with the GICS snapshot ("BAC stored as MER-PK"); empty when clean. */
  registryIssues?: string[];
}

/** During a session: the intraday prices (every 20 minutes) used as the session's provisional closes. */
export interface DeskLive {
  session: string;
  /** The latest regular-session trade among the quotes: the prices are "as of" this moment. */
  asOf: string;
  capturedAt: string;
  /** Series that received a live price. */
  quotes: number;
}

export interface DeskSnapshot {
  schemaVersion: typeof DESK_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  codeVersion: string;
  /** Latest session that at least half of the series have reached. */
  session: string;
  previousSession: string | null;
  /** Present while the session's prices are live (provisional); null or absent once the official closes are stored. */
  live?: DeskLive | null;
  inputs: DeskSnapshotInputs;
  benchmark: DeskBenchmark | null;
  breadth: DeskBreadth;
  sectors: DeskSector[];
  companies: DeskCompany[];
}
