import type { OptionChainSnapshot, OptionContract } from "./options";

export type DteBucket = "0DTE" | "1-7D" | "8-30D" | "31-90D" | "91-365D" | "365+D";
const ORDER: DteBucket[] = ["0DTE", "1-7D", "8-30D", "31-90D", "91-365D", "365+D"];

export function dteBucket(dte: number): DteBucket {
  if (dte <= 0) return "0DTE";
  if (dte <= 7) return "1-7D";
  if (dte <= 30) return "8-30D";
  if (dte <= 90) return "31-90D";
  if (dte <= 365) return "91-365D";
  return "365+D";
}

export interface OptionBucketFeatures {
  bucket: DteBucket;
  atmIv: number | null;
  termSlope: number | null;
  skew25Delta: number | null;
  putCallVolumeRatio: number | null;
  putCallOiRatio: number | null;
  volOiRatio: number | null;
  spreadAtmPct: number | null;
  earningsIvCrush: number | null;
  rows: number;
  calls: number;
  puts: number;
  volume: number;
  openInterest: number;
  warnings: string[];
}

export interface OptionFeatureSet {
  provider: string;
  underlying: string;
  tradeDate: string;
  availableAt: string;
  snapshotId?: string;
  spot: number | null;
  buckets: OptionBucketFeatures[];
  quality: OptionChainSnapshot["quality"];
  warnings: string[];
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}
function mid(c: OptionContract): number | null {
  return c.midpoint ?? (c.bid !== null && c.ask !== null ? (c.bid + c.ask) / 2 : null);
}
function nearest(contracts: OptionContract[], spot: number, right?: "call" | "put"): OptionContract | null {
  const candidates = contracts.filter((c) => (!right || c.right === right) && c.strike > 0);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
}
function nearestDelta(contracts: OptionContract[], target: number): OptionContract | null {
  const candidates = contracts.filter((c) => c.delta !== null);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => Math.abs((a.delta ?? 0) - target) - Math.abs((b.delta ?? 0) - target))[0];
}
function sum(contracts: OptionContract[], key: "volume" | "openInterest"): number {
  return contracts.reduce((n, c) => n + (c[key] ?? 0), 0);
}
function ratio(a: number, b: number): number | null { return b === 0 ? null : a / b; }

export function earningsIvCrush(beforeAtmIv: number | null, afterAtmIv: number | null): number | null {
  return beforeAtmIv === null || afterAtmIv === null || beforeAtmIv === 0 ? null : afterAtmIv / beforeAtmIv - 1;
}

export function buildOptionFeatures(snapshot: OptionChainSnapshot): OptionFeatureSet {
  const spot = typeof snapshot.underlyingData?.current_price === "number" ? snapshot.underlyingData.current_price : null;
  const groups = new Map<DteBucket, OptionContract[]>();
  for (const c of snapshot.contracts) {
    const dte = daysBetween(snapshot.tradeDate, c.expiration);
    if (dte < 0) continue;
    const bucket = dteBucket(dte);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(c);
  }
  const atmCache = new Map<DteBucket, number | null>();
  for (const bucket of ORDER.filter((b) => groups.has(b))) {
    const rows = groups.get(bucket)!;
    const atmCandidates = spot === null ? [] : [nearest(rows, spot, "call"), nearest(rows, spot, "put")].filter((x): x is OptionContract => x !== null);
    const atmIvs = atmCandidates.map((c) => c.impliedVolatility).filter((x): x is number => x !== null);
    atmCache.set(bucket, atmIvs.length ? atmIvs.reduce((a, b) => a + b, 0) / atmIvs.length : null);
  }
  const buckets = ORDER.filter((b) => groups.has(b)).map((bucket, index, all) => {
    const rows = groups.get(bucket)!;
    const calls = rows.filter((c) => c.right === "call"), puts = rows.filter((c) => c.right === "put");
    const atmCandidates = spot === null ? [] : [nearest(rows, spot, "call"), nearest(rows, spot, "put")].filter((x): x is OptionContract => x !== null);
    const atmIv = atmCache.get(bucket)!;
    let next: number | undefined;
    for (let j = index + 1; j < all.length; j++) {
      const candidate = atmCache.get(all[j]);
      if (candidate !== null && candidate !== undefined) { next = candidate; break; }
    }
    const call25 = nearestDelta(calls, 0.25), put25 = nearestDelta(puts, -0.25);
    const skew25Delta = call25?.impliedVolatility !== null && call25?.impliedVolatility !== undefined && put25?.impliedVolatility !== null && put25?.impliedVolatility !== undefined
      ? put25!.impliedVolatility! - call25!.impliedVolatility! : null;
    const callVolume = sum(calls, "volume"), putVolume = sum(puts, "volume");
    const callOi = sum(calls, "openInterest"), putOi = sum(puts, "openInterest");
    const atmSpreads = atmCandidates.map((c) => {
      const m = mid(c);
      return m !== null && m > 0 && c.bid !== null && c.ask !== null ? (c.ask - c.bid) / m : null;
    }).filter((x): x is number => x !== null);
    const warnings: string[] = [];
    if (spot === null) warnings.push("Missing underlying spot; ATM metrics are null.");
    if (atmIv === null) warnings.push("No ATM IV available for this bucket.");
    if (skew25Delta === null) warnings.push("Insufficient 25-delta contracts for skew.");

    return {
      bucket,
      atmIv,
      termSlope: next === undefined || atmIv === null ? null : next - atmIv,
      skew25Delta,
      putCallVolumeRatio: ratio(putVolume, callVolume),
      putCallOiRatio: ratio(putOi, callOi),
      volOiRatio: ratio(callVolume + putVolume, callOi + putOi),
      spreadAtmPct: atmSpreads.length ? atmSpreads.reduce((a, b) => a + b, 0) / atmSpreads.length : null,
      earningsIvCrush: null,
      rows: rows.length,
      calls: calls.length,
      puts: puts.length,
      volume: callVolume + putVolume,
      openInterest: callOi + putOi,
      warnings,
    };
  });
  return {
    provider: snapshot.provider,
    underlying: snapshot.underlying,
    tradeDate: snapshot.tradeDate,
    availableAt: snapshot.availableAt,
    snapshotId: snapshot.snapshotId,
    spot,
    buckets,
    quality: snapshot.quality,
    warnings: snapshot.warnings,
  };
}
