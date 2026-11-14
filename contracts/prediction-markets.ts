export type PredictionVenue = "kalshi" | "polymarket";
export type LiquidityFlag = "ok" | "thin" | "unknown";
export type PredictionKind = "market" | "business";

export interface PredictionSnapshot {
  series: string;
  ticker?: string;
  cik?: number;
  kind?: PredictionKind;
  fetchedAt: string;
  venue: PredictionVenue;
  market: string;
  event: string | null;
  title: string | null;
  yesBid: number | null;
  yesAsk: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  closeTime: string | null;
  strikeType: string | null;
  floor: number | null;
  cap: number | null;
  liquidityFlag: LiquidityFlag;
  rulesHash: string | null;
  status: string;
  result: "yes" | "no" | null;
  settlementValue: number | null;
  settlementRaw: string | null;
  volume24h: number | null;
  liquidity: number | null;
  historyFile?: string;
}

export interface PredictionValues {
  primary: number | null;
  alternate: number | null;
}

export interface PredictionExpectationsReport {
  schemaVersion: 1;
  generatedAt: string;
  asOf: string | null;
  status: "ok" | "partial" | "empty";
  closed: boolean;
  fed: {
    meeting: string | null;
    alternateMeeting: string | null;
    currentUpper: number | null;
    expectedUpper: PredictionValues;
    outcomes: { cut: PredictionValues; unchanged: PredictionValues; hike: PredictionValues };
    next: { meeting: string; expected: number | null }[];
  };
  cpi: { event: string | null; expected: PredictionValues; spread: PredictionValues };
  recession: { event: string | null; probability: PredictionValues };
  calibration: { fed: string; cpi: string };
  notes: string[];
}

export interface DailyExpectationState {
  date: string;
  asOf?: string;
  rule?: "snapshot";
  fedNow?: number;
  fed1Meeting?: string;
  fed1Expected?: number;
  fed1PHike?: number;
  fed1PCut?: number;
  fed2Meeting?: string;
  fed2Expected?: number;
  fed3Meeting?: string;
  fed3Expected?: number;
  fed4Meeting?: string;
  fed4Expected?: number;
  cpiNextExpected?: number;
  cpiNextSd?: number;
  recessionThisYear?: number;
}

export interface CompanyMappingEntry {
  series: string;
  title?: string;
  ticker: string;
  cik: number;
  kind: PredictionKind;
  markets: number;
  settled: number;
  open: number;
  events: number;
  settledEvents: number;
  failedCandles: number;
}

export interface CompanyMapping {
  date: string;
  rule: string;
  accepted: CompanyMappingEntry[];
  rejected: { series: string; title?: string; byTicker: string | null; named: string[]; markets: number; reason?: string }[];
}
