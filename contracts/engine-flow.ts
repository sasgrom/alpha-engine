/**
 * The engine-flow files: what prediction engine v1 saw and did at every decision of a company, built on the home
 * machine by the lab's tools/flow/build-flow.mts from a traced engine run (D:\research\alpha-engine\engine\flow,
 * read through the junction worker/.runs/engine-flow). The desk's Engine page shows them step by step.
 */
export const ENGINE_FLOW_SCHEMA_VERSION = 1;

/** One factor's working at one decision, as step 3 traced it (positions in the array, see TRACE in step3-model.mts). */
export type EngineFactorRow = (number | null)[];
export const FACTOR_ROW = {
  factor: 0, raw: 1, z: 2, earlier: 3, n: 4, slope: 5, intercept: 6, side: 7, level: 8, table: 9,
  evidence: 21, variance: 22, spread: 23, kept: 24, k: 25, status: 26,
} as const;
/** Why a factor did not take part (status 0 means it voted). */
export const FACTOR_STATUS = ["votes", "fewer than 50 earlier readings", "fewer than 30 finished outcomes", "no direction", "no track record yet"] as const;

export interface EngineTrace {
  /** Finished outcomes so far over all companies: [falls, rises]; the usual rate is (rises + 1) / (all + 2). */
  base: [number, number];
  prior: number;
  /** graded is the engine's answer; table and soft are its two simpler variants; joint is the reference logistic model. */
  p: { graded: number; table: number; soft: number; joint: number };
  /** What happened: [rose against the sector 1/0, move in usual moves, the day it was known]. */
  out: [number, number, string] | null;
  f: EngineFactorRow[];
}

export interface EngineOutcome { r: number; s: number; m: number; days: number; exit: string }

export interface EngineDecision {
  id: string;
  kind: "release" | "filing";
  date: string;
  periodEnd: string;
  form: string;
  accession: string;
  published: string;
  release: string | null;
  filed: string;
  firstSession: string;
  lastDate: string;
  sameDay: boolean;
  /** Usual daily moves over the 126 sessions before: the stock (r), the company against its sector (c), the sector (a), the market (m). */
  sigma: { r: number; c: number; a: number; m: number };
  px: Record<string, number | null>;
  figures: Record<string, number | null> | null;
  inputs: {
    pairs: Record<string, [number, number] | null> | null;
    trend: Record<string, [number, number, number] | null>;
    peer: Record<string, [number, number] | null>;
  } | null;
  out: Record<string, EngineOutcome | null>;
  trace: Record<string, EngineTrace>;
  /** On or after the sealed line: the forecast is shown, the outcome is withheld for the one final test of a frozen design. */
  sealed?: boolean;
}

export interface EngineFlowCompany {
  schemaVersion: number;
  cik: number;
  ticker: string;
  name: string;
  sector: string;
  sectorFund: string | null;
  /** Raw filed figures: [concept index, start, end, value, filed, accession, form]. */
  facts: { concepts: string[]; rows: [number, string | null, string, number, string, string, string][] };
  /** Weekly log prices. */
  prices: { dates: string[]; stock: (number | null)[] | null; fund: (number | null)[] | null; market: (number | null)[] | null };
  decisions: EngineDecision[];
}

export interface EngineFlowIndex {
  schemaVersion: number;
  generatedAt: string;
  run: { folder: string; name: string; scored: [string, string] };
  horizons: string[];
  factors: { release: string[]; filing: string[]; families: { release: string[]; filing: string[] } };
  /** The engine over all companies, scored years: gain in log score per 1000 decisions with a 90% interval by quarter. */
  /** Over all companies' scored decisions: gain per 1000 with its 90% interval, how many leaned ≥ 5 points and how often
   * those went the engine's way, and the share of decisions where the company beat its sector. */
  overall: { kind: string; h: string; decisions: number; gain: number; low: number; high: number; leaned: number; won: number | null; upShare?: number | null }[];
  companies: { cik: number; ticker: string; name: string; sector: string; decisions: number; traced: number; first: string | null; last: string | null }[];
}
