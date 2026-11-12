/**
 * Fund flows: what the tracked 13F filers bought and sold each quarter, where the money went, what happened to
 * it afterwards, and how funds and companies connect. Built locally by scripts/build-fund-flows.mts into
 * worker/.runs/desk-flows/ (overview.json, fund/<cik>.json, company/<cik>.json) and read by the desk.
 *
 * What a 13F can and cannot say, and how every number here is made:
 * - A filing is a quarter-end snapshot of holdings, public up to 45 days later. Nothing inside a quarter is seen.
 * - A position is the sum of all rows a filing states for a security (a filer lists one security once per manager
 *   and voting arrangement). Options and bonds in the filings are not holdings of shares and are kept apart.
 * - A flow is the change in shares between two quarter ends, corrected for stock splits, valued at the later
 *   quarter-end price. It is trading, not price drift. Only funds that filed both quarters are counted.
 * - Rotation between sectors is an ESTIMATE: each fund's sales are paired with the same fund's purchases of the
 *   quarter in proportion; the unpaired remainder enters from or leaves to "outside the covered stocks".
 * - Returns use stored total-return closes at quarter ends. "Paper" returns hold a quarter-end book for one
 *   quarter; trade outcomes follow the dollars bought and sold from the quarter end (the fund's own view) and
 *   from the filing deadline 45 days later (what a reader of the filings could have followed).
 */
export const FUND_FLOWS_SCHEMA_VERSION = 1;
export const FLOW_OUTSIDE = "Outside";

export interface FlowLink {
  from: string;
  to: string;
  usd: number;
}

export interface FlowSectorRow {
  sector: string;
  bought: number;
  sold: number;
  net: number;
  held: number;
}

export interface FlowCompanyRow {
  cik: number;
  ticker: string;
  net: number;
  bought: number;
  sold: number;
  buyers: number;
  sellers: number;
  opened: number;
  closed: number;
}

export interface FlowFundRow {
  cik: number;
  net: number;
  bought: number;
  sold: number;
}

/** Value-weighted total return of the dollars bought and of the dollars sold in a quarter, over a horizon. */
export interface FlowOutcome {
  bought: number | null;
  sold: number | null;
  /** bought − sold: positive when the money went the right way. */
  spread: number | null;
}

export interface FlowQuarter {
  /** Quarter-end date of the later filing; flows run from `previous` to it. */
  quarter: string;
  previous: string;
  funds: number;
  fundsLeftOut: number;
  /** Funds left out because their book changed far beyond what the market explains (a reporting change). */
  reportingChanges: string[];
  bought: number;
  sold: number;
  net: number;
  held: number;
  sectors: FlowSectorRow[];
  rotation: FlowLink[];
  topBought: FlowCompanyRow[];
  topSold: FlowCompanyRow[];
  topBuyers: FlowFundRow[];
  topSellers: FlowFundRow[];
  /**
   * Every company the counted funds hold this quarter: [cik, net flow, value held, total return of the stock from
   * this quarter end to the latest close].
   */
  companyFlows: [cik: number, net: number, held: number, since: number | null][];
  /** Every counted fund: [cik, bought, sold]. */
  fundFlows: [number, number, number][];
  /** Split corrections applied in this pair of quarters ("NVDA ×10"). */
  splits: string[];
  /**
   * Companies most of whose holders appear in this quarter at once: a listing, a spin-off or a share exchange, not
   * purchases. They are left out of this quarter's flows and counted from the next.
   */
  listed: string[];
  /**
   * Where every fund that reported this quarter stands in the hall: `[fund CIK, home sector, sector, stake, …]`.
   * Sectors are indexes into `FundFlowsOverview.sectorNames` (−1: no home); a stake is per mille of the fund's book.
   * Home is the sector of its biggest sizable net purchase of the quarter (1.5% of its book or more), else where it
   * leans most against all funds (3 points or more), else its largest holding; it visits up to three other sectors
   * where it bought 1.5% of its book or leans 5 points or more (worker/lib/fund-flows.ts `fundPlace`).
   */
  places: number[][];
  /**
   * How each fund's book did in the quarter: `[fund CIK, return]`, the return of its book as reported at the previous
   * quarter end, held through this quarter (its trades inside the quarter are not seen), for every fund with both
   * reports. Against `allFundsReturn` it tells the quarter's winners from its losers in the hall.
   */
  fundReturns: [cik: number, paperReturn: number][];
  /** What followed, from the quarter end: over the next quarter, the next four, and to the latest close. */
  next1: FlowOutcome;
  next4: FlowOutcome;
  toDate: FlowOutcome;
  /** The same over one quarter, started at the filing deadline (45 days after the quarter end). */
  followed: FlowOutcome;
  /** Paper return of the quarter: all tracked funds' previous book held through this quarter, and SPY. */
  allFundsReturn: number | null;
  benchmarkReturn: number | null;
  /** CPI index level of the quarter-end month (or the latest published before it). */
  cpi: number | null;
}

export type FundCategory = "index" | "manager" | "quant" | "hedge" | "pension" | "bank";

export const FUND_CATEGORY_LABEL: Record<FundCategory, string> = {
  index: "Index giants",
  manager: "Asset managers",
  quant: "Quant and trading firms",
  hedge: "Hedge funds and activists",
  pension: "Pensions and sovereign funds",
  bank: "Banks, insurers and wealth platforms",
};

export interface FlowFundDirectoryRow {
  cik: number;
  name: string;
  category: FundCategory;
  tags: string[];
  /** Quarter of the fund's latest report; older than the overview's latest when the filer stopped or was replaced. */
  latestQuarter: string;
  /** Value of the covered stocks at that quarter, and the whole 13F book. */
  tracked: number;
  book: number | null;
  positions: number;
  top10Share: number | null;
  /** Median share of the book traded per quarter (the smaller of bought and sold over the average book). */
  turnover: number | null;
  quarters: number;
  /** Latest quarter's net flow. */
  net: number | null;
  /** Growth of one dollar in the fund's reported books since its first quarter here, and the same for all funds. */
  growth: number | null;
  growthAllFunds: number | null;
  /** Average spread (bought − sold) of its trades over the following four quarters. */
  tradeSpread4: number | null;
}

export interface FlowCompanyDirectoryRow {
  cik: number;
  ticker: string;
  name: string;
  sector: string;
  /** Latest quarter: value held, number of holders and net flow. */
  held: number;
  holders: number;
  net: number;
}

export interface FundFlowsOverview {
  schemaVersion: typeof FUND_FLOWS_SCHEMA_VERSION;
  generatedAt: string;
  codeVersion: string;
  /** The fund books the flows were built from (contracts/fund-books.ts) and the number of filings behind them. */
  books: { generatedAt: string; codeVersion: string; filings: number };
  /** Sectors with a bookcase, largest holding first; `FlowQuarter.places` points into this list. */
  sectorNames: string[];
  /** First quarter end of the history (the base of every growth index) and the latest complete one. */
  firstQuarter: string;
  latestQuarter: string;
  /** A newer quarter whose filing window is still open, with the funds filed so far; not used for flows. */
  openQuarter: { quarter: string; funds: number } | null;
  latestPriceDate: string | null;
  quarters: FlowQuarter[];
  funds: FlowFundDirectoryRow[];
  companies: FlowCompanyDirectoryRow[];
}

export interface FundSeriesPoint {
  quarter: string;
  tracked: number;
  book: number | null;
  positions: number;
  bought: number | null;
  sold: number | null;
  net: number | null;
  /** Paper return of the quarter (previous book held through it) and the growth index it builds (1 at the start). */
  paperReturn: number | null;
  growth: number | null;
  growthAllFunds: number | null;
  /** CPI index level of the quarter, to restate growth after inflation. */
  cpi: number | null;
  /** Outcome of the quarter's trades over the next four quarters. */
  next4: FlowOutcome;
}

export interface FundPosition {
  cik: number;
  ticker: string;
  name: string;
  sector: string;
  usd: number;
  weight: number;
  heldSince: string;
  /** Latest quarter's flow in this position (0 when unchanged). */
  flow: number;
}

export interface FundMove {
  cik: number;
  ticker: string;
  usd: number;
  kind: "new" | "add" | "trim" | "exit";
  /** Total return of the stock from that quarter end to the latest close. */
  since: number | null;
}

export interface FundFlowsFund {
  cik: number;
  name: string;
  category: FundCategory;
  tags: string[];
  /** Sentences written from the fund's own record. */
  story: string[];
  /** Value of the covered shares underlying the put and call options in its latest filing; null when it reports none. */
  options: { puts: number; calls: number } | null;
  latestQuarter: string;
  tracked: number;
  book: number | null;
  positions: number;
  top10Share: number | null;
  effectivePositions: number | null;
  turnover: number | null;
  holdingYears: number | null;
  series: FundSeriesPoint[];
  /** Latest sector weights against the weights of all tracked funds together. */
  sectors: { sector: string; weight: number; allFunds: number }[];
  topPositions: FundPosition[];
  /** Per quarter, newest first: the largest purchases and sales. */
  moves: { quarter: string; buys: FundMove[]; sells: FundMove[] }[];
  /** Funds whose latest books overlap most with this one (cosine of position weights). */
  alike: { cik: number; name: string; overlap: number }[];
}

export interface CompanySeriesPoint {
  quarter: string;
  net: number;
  bought: number;
  sold: number;
  buyers: number;
  sellers: number;
  opened: number;
  closed: number;
  holders: number;
  held: number;
  /** Total return of the stock over the following quarter and over the following four. */
  next1: number | null;
  next4: number | null;
}

export interface CompanyFundRow {
  cik: number;
  name: string;
  usd: number;
  kind?: "new" | "add" | "trim" | "exit";
  /** Weight of the position in the fund's covered book (holders list). */
  weight?: number;
}

export interface FundFlowsCompany {
  cik: number;
  ticker: string;
  name: string;
  sector: string;
  series: CompanySeriesPoint[];
  holders: CompanyFundRow[];
  /** Per quarter, newest first: who bought and who sold most. */
  quarters: { quarter: string; buyers: CompanyFundRow[]; sellers: CompanyFundRow[] }[];
}
