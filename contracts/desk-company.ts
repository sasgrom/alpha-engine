/**
 * Per-company files behind the desk Company page, built from the research standards (never read from the research
 * database at request time): scripts/build-desk-company.mts writes them, api/services/desk-company-files.ts reads them.
 */
export const DESK_COMPANY_SCHEMA_VERSION = 1;

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
}

export interface DeskStatementRow {
  code: string;
  label: string;
  kind: DeskStatementKind;
  /** One cell per quarter of `quarters`, in the same order; null where the company reported nothing. */
  cells: Array<DeskStatementCell | null>;
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
  companies: Array<{ cik: number; ticker: string; quarters: number; lastQuarter: string | null; rows: number; guidancePeriods: number; actions: boolean }>;
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
  /** The figure as first reported, when the standard fundamentals carry a comparable one. */
  actual: { value: number; filed: string; how: "quarter" | "four_quarters" } | null;
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
