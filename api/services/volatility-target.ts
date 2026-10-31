export interface VolTargetPolicy {
  targetVol: number;
  minScalar: number;
  maxScalar: number;
  sectorCap: number;
  participationRate: number;
  portfolioNotional: number;
}

export const DEFAULT_VOL_TARGET_POLICY: VolTargetPolicy = {
  targetVol: 0.20,
  minScalar: 0.25,
  maxScalar: 1.00,
  sectorCap: 0.25,
  participationRate: 0.10,
  portfolioNotional: 10_000_000,
};

export interface VolTargetInput {
  cik: number;
  ticker: string;
  sector: string;
  forecastVol: number;
  forwardReturn: number;
  advDollar: number | null;
}

export interface VolTargetWeight extends VolTargetInput {
  scalar: number;
  rawWeight: number;
  weight: number;
  sectorCapped: boolean;
  liquidityCapped: boolean;
}

export interface VolTargetPeriod {
  date: string;
  rows: VolTargetInput[];
}

export interface VolTargetPeriodResult {
  date: string;
  grossReturn: number;
  cost: number;
  netReturn: number;
  tradedNotional: number;
  grossExposure: number;
  names: number;
  sectorCappedNames: number;
  liquidityCappedNames: number;
}

/** Name-level risk scalar. It is not a portfolio-volatility guarantee. */
export function volatilityScalar(
  forecastVol: number,
  targetVol = DEFAULT_VOL_TARGET_POLICY.targetVol,
  minScalar = DEFAULT_VOL_TARGET_POLICY.minScalar,
  maxScalar = DEFAULT_VOL_TARGET_POLICY.maxScalar,
): number | null {
  if (![forecastVol, targetVol, minScalar, maxScalar].every(Number.isFinite)) return null;
  if (forecastVol <= 0 || targetVol <= 0 || minScalar <= 0 || maxScalar < minScalar) return null;
  return Math.min(maxScalar, Math.max(minScalar, targetVol / forecastVol));
}

/** Expected move in return units; use the actual option DTE, not a bucket midpoint. */
export function expectedMoveReturn(iv: number, dteDays: number): number | null {
  if (![iv, dteDays].every(Number.isFinite) || iv <= 0 || dteDays <= 0) return null;
  return iv * Math.sqrt(dteDays / 365);
}

/** Signed scenario return normalized by expected-move return. Not a probability. */
export function normalizeExpectedReturn(expectedReturn: number, emReturn: number): number | null {
  if (![expectedReturn, emReturn].every(Number.isFinite) || emReturn <= 0) return null;
  return expectedReturn / emReturn;
}

/**
 * Equal-capital base allocation scaled by name-level volatility, then reduced by
 * sector and liquidity caps. Missing ADV fails closed to zero weight. Cash is
 * never redistributed after a cap, so gross exposure cannot exceed 100%.
 */
export function buildVolTargetWeights(rows: VolTargetInput[], policy: VolTargetPolicy): VolTargetWeight[] {
  if (!rows.length) return [];
  if (!(policy.portfolioNotional > 0) || !(policy.sectorCap > 0) || !(policy.participationRate > 0)) {
    throw new Error("Portfolio notional, sector cap and participation rate must be positive");
  }
  const baseWeight = 1 / rows.length;
  const initial = rows.map((row) => {
    const scalar = volatilityScalar(row.forecastVol, policy.targetVol, policy.minScalar, policy.maxScalar);
    if (scalar === null || !Number.isFinite(row.forwardReturn)) throw new Error(`Invalid volatility input for ${row.ticker}`);
    return { ...row, scalar, rawWeight: baseWeight * scalar, weight: 0, sectorCapped: false, liquidityCapped: false };
  });
  const sectorTotals = new Map<string, number>();
  for (const row of initial) sectorTotals.set(row.sector, (sectorTotals.get(row.sector) ?? 0) + row.rawWeight);
  return initial.map((row) => {
    const sectorTotal = sectorTotals.get(row.sector)!;
    const sectorScale = sectorTotal > policy.sectorCap ? policy.sectorCap / sectorTotal : 1;
    const sectorWeight = row.rawWeight * sectorScale;
    const liquidityCap = row.advDollar !== null && Number.isFinite(row.advDollar) && row.advDollar > 0
      ? policy.participationRate * row.advDollar / policy.portfolioNotional
      : 0;
    return {
      ...row,
      sectorCapped: sectorScale < 1,
      liquidityCapped: liquidityCap < sectorWeight,
      weight: Math.min(sectorWeight, liquidityCap),
    };
  });
}

/** Monthly long-only simulation with cash and explicit cost on every weight change. */
export function simulateVolTarget(
  periods: VolTargetPeriod[],
  policy: VolTargetPolicy,
  costBps = 20,
): VolTargetPeriodResult[] {
  if (!Number.isFinite(costBps) || costBps < 0) throw new Error("Cost must be non-negative");
  let previous = new Map<string, number>();
  return [...periods].sort((a, b) => a.date.localeCompare(b.date)).map((period) => {
    const weights = buildVolTargetWeights(period.rows, policy);
    const current = new Map(weights.map((row) => [row.ticker, row.weight]));
    const tickers = new Set([...previous.keys(), ...current.keys()]);
    let tradedNotional = 0;
    for (const ticker of tickers) tradedNotional += Math.abs((current.get(ticker) ?? 0) - (previous.get(ticker) ?? 0));
    const grossReturn = weights.reduce((sum, row) => sum + row.weight * row.forwardReturn, 0);
    const cost = tradedNotional * costBps / 10_000;
    previous = current;
    return {
      date: period.date,
      grossReturn,
      cost,
      netReturn: grossReturn - cost,
      tradedNotional,
      grossExposure: weights.reduce((sum, row) => sum + row.weight, 0),
      names: weights.length,
      sectorCappedNames: weights.filter((row) => row.sectorCapped).length,
      liquidityCappedNames: weights.filter((row) => row.liquidityCapped).length,
    };
  });
}

export function summarizeVolTarget(results: VolTargetPeriodResult[], periodsPerYear = 12) {
  if (!results.length) {
    return {
      n: 0, totalReturn: null, annualizedReturn: null, annualizedVol: null, sharpe: null, hitRate: null,
      maxDrawdown: null, averageGrossExposure: null, totalTradedNotional: 0, totalCost: 0,
      annualizedCost: null, sectorCappedNames: 0, liquidityCappedNames: 0,
    };
  }
  const returns = results.map((row) => row.netReturn);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const sd = Math.sqrt(variance);
  let equity = 1, peak = 1, maxDrawdown = 0;
  for (const ret of returns) {
    equity *= Math.max(0, 1 + ret);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? 1 - equity / peak : 0);
  }
  const totalReturn = equity - 1;
  const totalCost = results.reduce((sum, row) => sum + row.cost, 0);
  return {
    n: results.length,
    totalReturn,
    annualizedReturn: equity > 0 ? equity ** (periodsPerYear / results.length) - 1 : -1,
    annualizedVol: sd * Math.sqrt(periodsPerYear),
    sharpe: sd > 0 ? mean / sd * Math.sqrt(periodsPerYear) : null,
    hitRate: returns.filter((value) => value > 0).length / returns.length,
    maxDrawdown,
    averageGrossExposure: results.reduce((sum, row) => sum + row.grossExposure, 0) / results.length,
    totalTradedNotional: results.reduce((sum, row) => sum + row.tradedNotional, 0),
    totalCost,
    annualizedCost: totalCost * periodsPerYear / results.length,
    sectorCappedNames: results.reduce((sum, row) => sum + row.sectorCappedNames, 0),
    liquidityCappedNames: results.reduce((sum, row) => sum + row.liquidityCappedNames, 0),
  };
}
