/**
 * Desk snapshot: one precomputed file that feeds the new desk view (market map, screener, today page).
 * Built locally by scripts/build-desk-snapshot.mts from stored daily closes, the Schwab fundamentals and quotes
 * captured for the S&P 500 and the research companies, the Schwab option features and the stored earnings events.
 * Served through the report whitelist as desk-snapshot.json; never part of an automatic production push.
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
}

export interface DeskSnapshot {
  schemaVersion: typeof DESK_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  codeVersion: string;
  /** Latest session that at least half of the series have reached. */
  session: string;
  previousSession: string | null;
  inputs: DeskSnapshotInputs;
  benchmark: DeskBenchmark | null;
  breadth: DeskBreadth;
  sectors: DeskSector[];
  companies: DeskCompany[];
}
