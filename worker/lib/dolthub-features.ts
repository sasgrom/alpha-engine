import { buildOptionFeatures, type OptionFeatureSet } from "./option-features";
import { DOLT_COLUMNS } from "./dolthub-export";
import { finalizeSnapshot, num, type OptionChainSnapshot, type OptionContract } from "./options";

export interface DoltCsvRow {
  date: string;
  act_symbol: string;
  expiration: string;
  strike: string;
  call_put: string;
  bid: string;
  ask: string;
  vol: string;
  delta: string;
  gamma: string;
  theta: string;
  vega: string;
  rho: string;
}
export interface SpotBar { date: string; close: number; adjClose: number | null }
export interface SpotInfo { price: number; date: string; source?: "put-call parity" | "price history"; strike?: number }

/** 3: spot read from the quotes by put-call parity (was: split- and dividend-adjusted close, wrong before splits). */
export const FEATURE_SCHEMA_VERSION = 3;

const mid = (row: DoltCsvRow): number | null => {
  const bid = Number(row.bid), ask = Number(row.ask);
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
};
const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/**
 * Where the stock stood at the close of the snapshot, read from the quotes alone: at the strike where call and put
 * cost most nearly the same, spot ≈ strike + call − put (put-call parity; carry and dividends are small for the
 * nearest expiration at least a week away). The quotes and the strikes are in the same unadjusted terms, so a later
 * split cannot distort it, unlike a split-adjusted close. Null when no strike has both a call and a put quote.
 */
export function impliedSpot(rows: DoltCsvRow[]): SpotInfo | null {
  if (!rows.length) return null;
  const tradeDate = rows[0].date;
  const byExpiration = new Map<string, Map<number, { call?: number; put?: number }>>();
  for (const row of rows) {
    const price = mid(row), strike = Number(row.strike), side = row.call_put.toLowerCase();
    if (price === null || !(strike > 0) || (side !== "call" && side !== "put")) continue;
    const strikes = byExpiration.get(row.expiration) ?? byExpiration.set(row.expiration, new Map()).get(row.expiration)!;
    const pair = strikes.get(strike) ?? strikes.set(strike, {}).get(strike)!;
    pair[side] = price;
  }
  const usable = [...byExpiration.keys()].filter((expiration) => days(tradeDate, expiration) >= 0).sort();
  const ordered = [...usable.filter((expiration) => days(tradeDate, expiration) >= 7), ...usable.filter((expiration) => days(tradeDate, expiration) < 7).reverse()];
  for (const expiration of ordered) {
    let best: { gap: number; spot: number; strike: number } | null = null;
    for (const [strike, pair] of byExpiration.get(expiration)!) {
      if (pair.call === undefined || pair.put === undefined) continue;
      const gap = Math.abs(pair.call - pair.put);
      if (!best || gap < best.gap) best = { gap, spot: strike + pair.call - pair.put, strike };
    }
    if (best && best.spot > 0) return { price: best.spot, date: tradeDate, source: "put-call parity", strike: best.strike };
  }
  return null;
}
export function isFeatureManifestCurrent(manifest: { schemaVersion?: number }): boolean {
  return manifest.schemaVersion === FEATURE_SCHEMA_VERSION;
}

export function parseDoltRow(line: string): DoltCsvRow {
  const p = line.split(",");
  if (p.length !== DOLT_COLUMNS.length) throw new Error(`Invalid Dolt CSV row with ${p.length} columns`);
  return {
    date: p[0], act_symbol: p[1], expiration: p[2], strike: p[3], call_put: p[4], bid: p[5], ask: p[6],
    vol: p[7], delta: p[8], gamma: p[9], theta: p[10], vega: p[11], rho: p[12],
  };
}

export function rowToContract(row: DoltCsvRow): OptionContract {
  const strike = Number(row.strike), right = row.call_put.toLowerCase() === "call" ? "call" : row.call_put.toLowerCase() === "put" ? "put" : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^\d{4}-\d{2}-\d{2}$/.test(row.expiration) || !(strike > 0) || !right) throw new Error("Invalid Dolt option row");
  const underlying = row.act_symbol.toUpperCase();
  return {
    contractId: `${underlying}${row.expiration.slice(2).replace(/-/g, "")}${right === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
    underlying, expiration: row.expiration, strike, right, exchange: null, providerRowId: null,
    bid: num(row.bid), ask: num(row.ask), bidSize: null, askSize: null, last: null,
    volume: null, openInterest: null, impliedVolatility: num(row.vol), delta: num(row.delta),
    gamma: num(row.gamma), theta: num(row.theta), vega: num(row.vega), rho: num(row.rho),
    theoretical: null, midpoint: null, tradeDate: row.date,
  };
}

export function createSpotLookup(bars: SpotBar[]): (date: string) => SpotInfo | null {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  return (date: string): SpotInfo | null => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].date <= date) lo = mid + 1;
      else hi = mid;
    }
    const bar = sorted[lo - 1];
    if (!bar) return null;
    const price = Number(bar.adjClose ?? bar.close);
    return Number.isFinite(price) && price > 0 ? { price, date: bar.date } : null;
  };
}

export function snapshotFromRows(rows: DoltCsvRow[], spot: SpotInfo | null, ingestedAt: string): OptionChainSnapshot {
  if (!rows.length) throw new Error("Cannot build a snapshot without rows");
  const tradeDate = rows[0].date;
  return finalizeSnapshot({
    provider: "dolthub", underlying: rows[0].act_symbol.toUpperCase(), tradeDate,
    availableAt: tradeDate, ingestedAt, snapshotId: `dolt-${tradeDate}`,
    providerTimeLabel: "Date-only EOD; treat as post-close",
    underlyingData: spot ? { current_price: spot.price, spot_date: spot.date } : null,
    warnings: ["DoltHub source has no volume, open interest or underlying spot; volume/OI ratios are null."],
    contracts: rows.map(rowToContract),
  });
}

export function featureFromRows(rows: DoltCsvRow[], spot: SpotInfo | null, ingestedAt: string): OptionFeatureSet & { spotSource: string | null } {
  const features = buildOptionFeatures(snapshotFromRows(rows, spot, ingestedAt));
  return { ...features, spotDate: spot?.date ?? null, spotSource: spot?.source ?? null };
}
