/**
 * Per-company files behind the desk Company page, built from the research standards (never read from the research
 * database at request time): scripts/build-desk-company.mts writes them, api/services/desk-company-files.ts reads them.
 */
export const DESK_COMPANY_SCHEMA_VERSION = 2;

export type DeskStatementName = "income" | "balance" | "cashflow";
export type DeskStatementKind = "flow" | "instant" | "shares" | "perShare";

export interface DeskStatementQuarter {
  /** Fiscal period end, YYYY-MM-DD. */
  end: string;
  fy: number | null;
  fq: number | null;
  /** The company's own report of this quarter: form and filing date; null when the quarter is known only as a comparison figure. */
  form: string | null;
  filed: string | null;
}

/** One reported value: what the company first filed, where it came from, and the latest figure when a later filing changed it. */
export interface DeskStatementCell {
  /** As first reported. */
  value: number;
  /** Filing date of that first report. */
  filed: string;
  /** The XBRL tag the value was read from, or "derived" for a value computed from other lines. */
  source: string;
  /** The latest filed value and its date, only when it differs from the first report. */
  restated?: { value: number; filed: string };
  /**
   * Set when a share count or per-share figure is out of scale against the company's other share figures (a units
   * slip in the filing, or a figure derived from one). The page names it instead of showing it as a figure, and it
   * enters no fiscal-year or trailing-year figure.
   */
  suspect?: true;
  /**
   * Share counts and per-share figures only, and only when a split came after the filing the figure is from: today's
   * share basis / that filing's. The page multiplies a share count by it and divides a per-share figure by it, so a
   * line reads on one basis; the hover gives the figure as filed.
   */
  factor?: number;
}

export interface DeskStatementRow {
  code: string;
  label: string;
  kind: DeskStatementKind;
  /** One cell per quarter of `quarters`, in the same order; null where the company reported nothing. */
  cells: Array<DeskStatementCell | null>;
}

/**
 * A figure for four consecutive quarters (a fiscal year, or the year ending at a quarter): flows are summed, weighted
 * share counts averaged by days, per-share lines summed on one share basis.
 */
export interface DeskStatementSum {
  /** From the figures known when the period's last quarter was first reported. */
  value: number;
  /** The same from the latest filed figures, only when it differs. */
  restated?: number;
  /**
   * Set only when one of the four figures was first filed after the period's own report (a year restated for a
   * spin-off, for example): the date all four were known, and the figures are as known on that date.
   */
  filed?: string;
  /** Per-share lines: true when the figure is net income to common stockholders / the average share count, not a sum of the quarters' figures. */
  ratio?: true;
  /**
   * Share counts and per-share figures only, and only when a split came after the filing the figure is from: today's
   * share basis / that filing's. The page multiplies a share count by it and divides a per-share figure by it, so a
   * line reads on one basis; the hover gives the figure as filed.
   */
  factor?: number;
}

/** One line's sums; lines that are amounts at a date (the balance sheet) are not here: their quarter-end cell is the figure. */
export interface DeskStatementSumRow {
  code: string;
  cells: Array<DeskStatementSum | null>;
}

export interface DeskStatementYear {
  /** Fiscal year end, YYYY-MM-DD. */
  end: string;
  fy: number | null;
  /** Filing date of the annual report. */
  filed: string | null;
  /** Column of the year's last quarter in `quarters`. */
  quarter: number;
}

export interface DeskCompanyStatements {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  cik: number;
  ticker: string;
  name: string;
  /** The standard fundamentals version the file was built from, and that build's own date. */
  standard: string;
  standardGeneratedAt: string;
  builtAt: string;
  /** Oldest first. */
  quarters: DeskStatementQuarter[];
  statements: Record<DeskStatementName, DeskStatementRow[]>;
  /** Fiscal years that end inside `quarters` with an annual report, oldest first. */
  years: DeskStatementYear[];
  /** One cell per entry of `years`. */
  annual: Record<DeskStatementName, DeskStatementSumRow[]>;
  /** The year ending at each quarter: one cell per entry of `quarters`. */
  trailing: Record<DeskStatementName, DeskStatementSumRow[]>;
}

export interface DeskCompanyIndex {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  standard: string;
  standardGeneratedAt: string;
  /** The guidance standard version, and the last session of the standard prices, the other files were built from. */
  guidanceVersion: string;
  pricesAsOf: string | null;
  builtAt: string;
  /** sha256 over the built company files, in CIK order. */
  contentHash: string;
  /** The 13F standard's build and last quarter, and the insider standard's build and last filing date, behind the holders and insiders files. */
  holdersVersion: string | null;
  holdersPeriod: string | null;
  insidersVersion: string | null;
  insidersAsOf: string | null;
  /** The last filing date of the release calendar behind the filings files. */
  filingsAsOf: string | null;
  companies: Array<{ cik: number; ticker: string; quarters: number; lastQuarter: string | null; rows: number; guidancePeriods: number; actions: boolean; holders: boolean; insiderTrades: number; filings: number }>;
}

/** One statement of guidance for a period, as a release gave it; amounts in dollars (or dollars per share). */
export interface DeskGuidanceUpdate {
  /** First session the release could be acted on. */
  issued: string;
  low: number | null;
  high: number | null;
  mid: number;
}

export type DeskGuidanceNote = "not_reported_yet" | "adjusted_basis" | "not_in_standard" | "other_meaning";

/** What a company said about one period and one measure, release after release, and what it then reported. */
export interface DeskGuidancePeriod {
  metric: "revenue" | "eps";
  basis: "gaap" | "non_gaap" | "unclear";
  kind: "Q" | "FY";
  /** Fiscal period end, YYYY-MM-DD (the company's own quarter end where the standard fundamentals have it). */
  periodEnd: string;
  fy: number | null;
  fq: number | null;
  /** Oldest first; a release that repeated the previous figures is counted in `reaffirmed`, not listed. */
  updates: DeskGuidanceUpdate[];
  reaffirmed: number;
  /**
   * The figure as first reported: from the standard fundamentals ("quarter", or "four_quarters" for a fiscal year's
   * revenue), or, for adjusted earnings per share, the figure the earnings release itself printed ("release"; `filed`
   * is then the release's first session, and only figures a later release repeated, or from that same row, are used).
   */
  actual: { value: number; filed: string; how: "quarter" | "four_quarters" | "release" } | null;
  /** Why there is nothing to compare with, when `actual` is null. */
  note: DeskGuidanceNote | null;
}

export interface DeskCompanyGuidance {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  cik: number;
  ticker: string;
  /** The guidance standard and the standard fundamentals the file was built from. */
  guidanceVersion: string;
  standard: string;
  /** The version of the adjusted-earnings reading, when the file carries figures from it. */
  adjustedVersion?: string;
  builtAt: string;
  /** Newest period first. */
  periods: DeskGuidancePeriod[];
}

/** Splits, dividends and other distributions from the standard prices, in as-traded amounts. */
export interface DeskCompanyActions {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  cik: number;
  ticker: string;
  /** Last session in the standard prices and its as-traded close. */
  pricesAsOf: string;
  lastClose: number;
  /** Newest first. A split of 4 means four shares for one; below 1 is a reverse split. */
  splits: Array<{ date: string; ratio: number }>;
  /** Spin-offs and special distributions, as the factor the price was adjusted by. Newest first. */
  distributions: Array<{ date: string; factor: number }>;
  /** Cash dividends by ex-date, in dollars per share as paid then. Newest first. */
  dividends: Array<{ date: string; amount: number }>;
  /** Cash dividends of the 365 days up to `pricesAsOf`. */
  dividendsLastYear: number;
  builtAt: string;
}

/** One quarter of the 13F standard for a company: the funds read, as known a set time after the quarter. */
export interface DeskHoldersQuarter {
  /** Quarter end, YYYY-MM-DD. */
  period: string;
  /** The day the reports counted here were all on file. */
  knownAt: string;
  /** Funds holding the company, of `fundsFiled` funds whose report for the quarter was on file by then (`fundsInBook` filed in the end). */
  holders: number;
  fundsFiled: number;
  fundsInBook: number;
  valueUsd: number;
  /** Shares held by those funds / shares outstanding; null where the standard marks the figure as unusable. */
  shareOfStock: number | null;
  /** Among funds that reported both this quarter and the one before: new holders, full exits, and (entries - exits) / those funds. */
  entries: number | null;
  exits: number | null;
  continuing: number | null;
  breadthChange: number | null;
  /** Shares bought and sold over the quarter, on today's share basis. */
  sharesBought: number | null;
  sharesSold: number | null;
  /** The ten largest holders' part of the value held. */
  top10Share: number | null;
}

export interface DeskCompanyHolders {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  cik: number;
  ticker: string;
  /** The 13F standard's build. */
  version: string;
  builtAt: string;
  /** Oldest first. */
  quarters: DeskHoldersQuarter[];
}

/** One filed line of a Form 4 or 5: a transaction in the company's stock by an officer, director or large holder. */
export interface DeskInsiderTrade {
  /** Transaction date and the filing's date. */
  date: string;
  filed: string;
  /** The reporting person as filed, and how many others reported the same line jointly. */
  owner: string;
  more: number;
  /** Officer title, "Director" or "10% owner". */
  role: string | null;
  /** SEC transaction code: P purchase, S sale, A grant, M exercise, F tax withholding, G gift ... */
  code: string;
  shares: number | null;
  price: number | null;
  /** shares x price as filed; null without a price, or when the standard flags the price as out of line. */
  valueUsd: number | null;
  /** Reported under a Rule 10b5-1 trading plan. */
  plan: boolean;
}

/** Open-market purchases and sales (codes P and S) of one calendar quarter, in dollars, with the number of insiders on each side. */
export interface DeskInsiderQuarter {
  /** Quarter end, YYYY-MM-DD. */
  quarter: string;
  bought: number;
  sold: number;
  buyers: number;
  sellers: number;
}

export interface DeskCompanyInsiders {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  cik: number;
  ticker: string;
  /** The insider standard's build, and the last filing date it holds for any company. */
  version: string;
  asOf: string;
  builtAt: string;
  /**
   * Stock transactions of the last three years, newest first: the open-market purchases and sales (codes P and S, at
   * most 300) and the newest other lines (grants, exercises, tax withholding, gifts; at most 150).
   */
  trades: DeskInsiderTrade[];
  /** How many such lines the three years hold in all, and how many of them are open-market purchases and sales. */
  tradeCount: number;
  marketCount: number;
  /** The last 20 calendar quarters, oldest first. */
  quarters: DeskInsiderQuarter[];
  /** Open-market purchases and sales of the 365 days to `asOf`. */
  year: { bought: number; sold: number; buyers: number; sellers: number; soldUnderPlan: number };
}

/** One open-market purchase with a usable dollar value, for the view across companies. */
export interface DeskInsiderMarketTrade {
  cik: number;
  ticker: string;
  date: string;
  filed: string;
  /** The Form 4's accession number, for the link to the SEC's copy. */
  accession: string;
  owner: string;
  more: number;
  role: string | null;
  shares: number | null;
  price: number | null;
  valueUsd: number;
}

/** Several insiders of one company buying in the open market within a few days of each other. */
export interface DeskInsiderWindow {
  cik: number;
  ticker: string;
  /** First and last purchase date of the window. */
  start: string;
  end: string;
  insiders: number;
  valueUsd: number;
  /** The distinct roles among the buyers ("Chief Executive Officer", "Director"), at most four. */
  roles: string[];
}

/** One company's open-market purchases and sales in the recent period, in dollars. */
export interface DeskInsiderCompanyNet {
  cik: number;
  ticker: string;
  bought: number;
  sold: number;
  buyers: number;
  sellers: number;
  /** Dollars sold under Rule 10b5-1 trading plans. */
  soldUnderPlan: number;
}

/**
 * Insider trading across all companies of the insider standard, for the Ownership page: the same lines and rules as
 * the company files (original reports, each trade once, no derivative lines, no flagged dollar values).
 */
export interface DeskInsiderMarket {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  version: string;
  /** The last filing date the standard holds for any company: every window ends there. */
  asOf: string;
  builtAt: string;
  companies: number;
  /** Length of the recent period in days. */
  days: number;
  /** Open-market purchases and sales (codes P and S) of the recent period. */
  totals: { bought: number; sold: number; buyers: number; sellers: number; buyingCompanies: number; sellingCompanies: number; soldUnderPlan: number };
  /** Open-market purchases of twice the recent period, newest first (at most 60). */
  purchases: DeskInsiderMarketTrade[];
  /** Windows of ten days with two or more buying insiders, from the last year, newest first (at most 40). */
  windows: DeskInsiderWindow[];
  /** The companies with the most dollars bought less sold in the recent period, and the most sold less bought (ten each). */
  netBuyers: DeskInsiderCompanyNet[];
  netSellers: DeskInsiderCompanyNet[];
}

/**
 * One company's figures for the Screener, from the standard fundamentals and the standard prices: the four quarters
 * ending at its last reported quarter, in the latest filed figures.
 */
export interface DeskScreenCompany {
  cik: number;
  ticker: string;
  /** End of the last quarter the company has reported, and the day that report was filed. */
  periodEnd: string;
  filed: string | null;
  /** Revenue of the four quarters, in dollars, and of the four quarters before them; null where one of the four is missing. */
  revenue: number | null;
  revenueYearAgo: number | null;
  /** Net income to common stockholders (net income where the standard has no such line) and free cash flow of the four quarters. */
  netIncome: number | null;
  freeCashFlow: number | null;
  /** Diluted earnings per share of the four quarters, on today's share basis. */
  epsDiluted: number | null;
  /**
   * How it was computed: "year" as on the company page (net income to common / the year's average diluted shares, or
   * the four quarters' figures added up); "last_shares" where the standard lacks a quarter's share count (the fourth
   * quarter of a year with a split): the four quarters' net income to common / the last quarter's diluted shares.
   */
  epsHow: "year" | "last_shares" | null;
  /** Mean of close x volume over the last 63 sessions of the standard prices (about three months), in dollars a day. */
  dollarVolume: number | null;
}

/** The Screener's fundamentals for all companies. */
export interface DeskScreen {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  /** The standard fundamentals version and the last session of the standard prices behind the figures. */
  standard: string;
  pricesAsOf: string | null;
  builtAt: string;
  companies: DeskScreenCompany[];
}

/** One periodic or current report of the company, from the engine's release calendar. */
export interface DeskCompanyFiling {
  accession: string;
  /** 10-K, 10-Q, 8-K and their amendments. */
  form: string;
  filed: string;
  /** Acceptance by the SEC, Eastern time, when known. */
  acceptedEt: string | null;
  /** The period a 10-K or 10-Q reports on; for an 8-K, the date of the event. */
  period: string | null;
  /** 8-K item numbers ("2.02", "9.01"). */
  items: string[];
  /** The 8-K carries the quarter's earnings release. */
  earnings: boolean;
  /** The filing's main document, for the link to the SEC's copy. */
  primaryDoc: string | null;
  /** Cached exhibits of an earnings release that the page can show as text, largest first. */
  exhibits: string[];
}

export interface DeskCompanyFilings {
  schemaVersion: typeof DESK_COMPANY_SCHEMA_VERSION;
  cik: number;
  ticker: string;
  /** The last filing date the calendar holds for any company: nothing after it is listed. */
  asOf: string;
  builtAt: string;
  /** Newest first, the last five years. */
  filings: DeskCompanyFiling[];
}

/** A cached release exhibit as plain text. */
export interface DeskDocumentText {
  accession: string;
  file: string;
  /** Paragraphs in reading order; table rows are one paragraph each, cells set apart by " | ". */
  paragraphs: string[];
  /** True when the document was longer than the page shows. */
  truncated: boolean;
}
