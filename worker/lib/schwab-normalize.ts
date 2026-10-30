import { createHash } from "node:crypto";

export interface SchwabOptionRow {
  symbol: string;
  osiId: string;
  underlying: string;
  expiration: string;
  dte: number;
  strike: number;
  putCall: "CALL" | "PUT";
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  spread: number | null;
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  underlyingPrice: number | null;
  delayed: boolean;
  sourceHash: string;
  sourceStatus: string;
}
export interface SchwabMarketQa {
  duplicateOsi: number;
  zeroBid: number;
  zeroAsk: number;
  crossed: number;
  invalidGreeks: number;
  invalidIv: number;
}
export interface SchwabMarketSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  provider: "schwab";
  files: { ticker: string; file: string; sourceHash: string; status: string; capturedAt: string; error?: string }[];
  coverage: {
    tickersExpected: number;
    tickersCompleted: number;
    endpointsComplete: number;
    errors: number;
    contracts: number;
    expirations: number;
    latestCapture: string | null;
    tokenExpiresAt: string | null;
    lastRefreshAt: string | null;
  };
  options: SchwabOptionRow[];
  qa: SchwabMarketQa & { manifestErrors: number };
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const ivDecimal = (value: unknown): number | null => {
  const n = num(value);
  return n === null ? null : n / 100;
};
export function osiStrike(strike: number): string {
  return String(Math.round(strike * 1000)).padStart(8, "0");
}
export function osiOptionId(underlying: string, expiration: string, putCall: "CALL" | "PUT", strike: number): string {
  const root = underlying.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(6, " ");
  const yymmdd = expiration.slice(2).replace(/-/g, "");
  return `${root}${yymmdd}${putCall === "CALL" ? "C" : "P"}${osiStrike(strike)}`;
}
export function dteDays(expiration: string, capturedAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(`${expiration}T00:00:00Z`) - Date.parse(capturedAt)) / 86_400_000));
}
export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface SchwabRawChain {
  symbol?: unknown;
  status?: unknown;
  isDelayed?: unknown;
  isChainTruncated?: unknown;
  underlyingPrice?: unknown;
  underlying?: { symbol?: unknown };
  callExpDateMap?: Record<string, Record<string, Record<string, unknown>[]>>;
  putExpDateMap?: Record<string, Record<string, Record<string, unknown>[]>>;
}

export function normalizeSchwabChain(raw: string, capturedAt: string): { rows: SchwabOptionRow[]; sourceHash: string; sourceStatus: string; delayed: boolean; chainTruncated: boolean } {
  const doc = JSON.parse(raw) as SchwabRawChain;
  const sourceHash = sha256Text(raw);
  const sourceStatus = String(doc.status ?? "UNKNOWN");
  const delayed = Boolean(doc.isDelayed);
  const chainTruncated = Boolean(doc.isChainTruncated);
  const underlyingPrice = num(doc.underlyingPrice);
  const underlying = String(doc.symbol ?? doc.underlying?.symbol ?? "UNKNOWN");
  const rows: SchwabOptionRow[] = [];
  for (const [side, map] of [["CALL", doc.callExpDateMap], ["PUT", doc.putExpDateMap]] as const) {
    if (!map || typeof map !== "object") continue;
    for (const [expirationKey, strikeMap] of Object.entries(map)) {
      const expiration = expirationKey.split(":", 1)[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration) || !Number.isFinite(Date.parse(`${expiration}T00:00:00Z`))) {
        throw new Error(`Invalid Schwab expiration key: ${expirationKey}`);
      }
      if (!strikeMap || typeof strikeMap !== "object" || Array.isArray(strikeMap)) throw new Error(`Invalid Schwab strike map: ${expirationKey}`);
      for (const contracts of Object.values(strikeMap)) {
        if (!Array.isArray(contracts)) throw new Error(`Invalid Schwab contract list: ${expirationKey}`);
        for (const contract of contracts) {
          const strike = num(contract.strikePrice);
          if (strike === null || strike <= 0) throw new Error(`Invalid Schwab strike: ${expirationKey}`);
          const putCall = side as "CALL" | "PUT";
          const nativeSymbol = String(contract.symbol ?? underlying);
          const bid = num(contract.bid);
          const ask = num(contract.ask);
          rows.push({
            symbol: nativeSymbol,
            osiId: osiOptionId(underlying, expiration, putCall, strike),
            underlying,
            expiration,
            dte: dteDays(expiration, capturedAt),
            strike,
            putCall,
            bid,
            ask,
            last: num(contract.last),
            mark: num(contract.mark),
            spread: bid !== null && ask !== null ? ask - bid : null,
            volume: num(contract.totalVolume),
            openInterest: num(contract.openInterest),
            iv: ivDecimal(contract.volatility),
            delta: num(contract.delta),
            gamma: num(contract.gamma),
            theta: num(contract.theta),
            vega: num(contract.vega),
            rho: num(contract.rho),
            underlyingPrice,
            delayed,
            sourceHash,
            sourceStatus,
          });
        }
      }
    }
  }
  rows.sort((a, b) => a.expiration.localeCompare(b.expiration) || a.strike - b.strike || a.putCall.localeCompare(b.putCall));
  return { rows, sourceHash, sourceStatus, delayed, chainTruncated };
}

export function schwabQa(rows: SchwabOptionRow[]): SchwabMarketQa {
  const seen = new Set<string>();
  let duplicateOsi = 0, zeroBid = 0, zeroAsk = 0, crossed = 0, invalidGreeks = 0, invalidIv = 0;
  for (const row of rows) {
    if (seen.has(row.osiId)) duplicateOsi++;
    seen.add(row.osiId);
    if (row.bid === 0) zeroBid++;
    if (row.ask === 0) zeroAsk++;
    if (row.bid !== null && row.ask !== null && row.ask < row.bid) crossed++;
    if ([row.delta, row.gamma, row.theta, row.vega, row.rho].some((value) => value !== null && (!Number.isFinite(value) || value <= -999))) invalidGreeks++;
    if (row.iv !== null && (!Number.isFinite(row.iv) || row.iv <= 0 || row.iv > 5)) invalidIv++;
  }
  return { duplicateOsi, zeroBid, zeroAsk, crossed, invalidGreeks, invalidIv };
}
