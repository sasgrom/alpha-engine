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
  builtAt: string;
  /** sha256 over the built company files, in CIK order. */
  contentHash: string;
  companies: Array<{ cik: number; ticker: string; quarters: number; lastQuarter: string | null; rows: number }>;
}
