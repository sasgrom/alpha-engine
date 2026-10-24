/**
 * 6b — probability engine core (pure, unit-tested).
 *
 * Legacy cbai pattern, corrected:
 *  - factor set per company per window is selected by ROLLING IC, never by the
 *    full history (selection leakage killed the old out-of-sample);
 *  - target = forward-return SIGN (red/black), not the market-cap level;
 *  - per-factor reliability = the e_plus/e_minus taxonomy (lost money vs
 *    unrealized profit), clamped to [0.1, 0.9] to avoid zero-products;
 *  - naive Bayes with geometric-mean normalization AND correlation dedup
 *    (correlated factors share one vote instead of triple-counting);
 *  - the prior comes from the FRED regime pack (D46), not a hand-set 0.5;
 *  - calibration is measured (reliability bins) BEFORE any threshold is used.
 */

export interface Reliability { lpp: number; lmm: number }

/** Clamp to avoid zero-multiplication in the Bayes product (legacy clamp). */
export function clampReliability(v: number): number {
  return Math.max(0.1, Math.min(0.9, v));
}

/**
 * Naive Bayes with geometric-mean normalization (old cbai formula):
 *   p = (Π l+·p0)^(1/n) / ((Π l+·p0)^(1/n) + (Π l−·(1−p0))^(1/n)
 * where l+ = P(correct up) per factor, l− = P(correct down) per factor.
 * `n` = number of INDEPENDENT votes after correlation dedup.
 */
export function naiveBayesPUp(rels: Reliability[], prior = 0.5): number | null {
  if (rels.length === 0) return null;
  const n = rels.length;
  const logUp = rels.reduce((a, r) => a + Math.log(clampReliability(r.lpp)), 0);
  // down-side likelihood = P(predictUp | actual down) = 1 − correctDown = 1 − lmm
  const logDown = rels.reduce((a, r) => a + Math.log(1 - clampReliability(r.lmm)), 0);
  const up = Math.exp(logUp / n) * prior;
  const down = Math.exp(logDown / n) * (1 - prior);
  if (up + down === 0) return null;
  return up / (up + down);
}

/**
 * Correlation dedup: greedy cluster by |ρ| ≥ threshold (default 0.7).
 * One representative per cluster (the highest |meanIC| factor) — correlated
 * factors must not vote three times (revenue/rps/grossMargin are one thing).
 */
export function dedupFactors<T extends { factor: string; meanAbsIc: number }>(
  items: T[],
  correlationOf: (a: string, b: string) => number,
  threshold = 0.7
): T[] {
  const sorted = [...items].sort((a, b) => b.meanAbsIc - a.meanAbsIc);
  const kept: T[] = [];
  for (const item of sorted) {
    if (kept.every((k) => Math.abs(correlationOf(k.factor, item.factor)) < threshold) && !kept.some((k) => k.factor === item.factor)) {
      kept.push(item);
    }
  }
  return kept;
}

/** e_plus / e_minus from walk-forward calls vs realized direction. */
export function reliabilityFromCalls(calls: { predictUp: boolean; realizedUp: boolean }[]): Reliability | null {
  const ups = calls.filter((c) => c.predictUp);
  const downs = calls.filter((c) => !c.predictUp);
  if (ups.length === 0 && downs.length === 0) return null;
  const eMinus = ups.length ? ups.filter((c) => !c.realizedUp).length / ups.length : 0.5; // wrong down among ups (unrealized profit)
  const ePlus = downs.length ? downs.filter((c) => c.realizedUp).length / downs.length : 0.5; // wrong up among downs (lost money)
  return { lpp: clampReliability(1 - eMinus), lmm: clampReliability(1 - ePlus) };
}

/** Reliability calibration bins: predicted p vs realized up-frequency. */
export function calibrationBins(points: { p: number; realizedUp: boolean }[], binCount = 5): { from: number; to: number; n: number; meanP: number; observedUp: number }[] {
  const out: { from: number; to: number; n: number; meanP: number; observedUp: number }[] = [];
  for (let b = 0; b < binCount; b++) {
    const from = b / binCount, to = (b + 1) / binCount;
    const inBin = points.filter((p) => p.p >= from && (b === binCount - 1 ? p.p <= to : p.p < to));
    if (inBin.length === 0) continue;
    out.push({
      from, to, n: inBin.length,
      meanP: inBin.reduce((a, p) => a + p.p, 0) / inBin.length,
      observedUp: inBin.filter((p) => p.realizedUp).length / inBin.length,
    });
  }
  return out;
}

/**
 * Economic factor families (6b+): grouping by FINANCIAL LOGIC, not by
 * statistical correlation. Price and market cap move together mechanically,
 * yet price and volume are different concepts even when ρ>0.7 historically.
 * A family casts ONE vote; its value is the z-average of its members, so no
 * economically distinct stream is dropped just for co-moving.
 */
export const FACTOR_FAMILIES: Record<string, string> = {
  accruals: "quality",
  sue: "quality",
  altmanZ: "quality",
  fScore: "quality",
  grossProfitability: "profitability",
  assetGrowth: "growth",
  buybackYield: "capital_return",
  momentum122: "price_momentum",
  high52: "price_momentum",
  smartMoneyFlow: "smart_money",
  edgarTone: "sentiment",
};

/** z = (x − median) / IQR per factor per company. Robust to fat tails. */
export function zScores(values: number[]): (number | null)[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 4) return values.map(() => null);
  const med = sorted[Math.floor(sorted.length / 2)];
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  if (iqr === 0) return values.map(() => null);
  return values.map((v) => (v - med) / iqr);
}

/** Average available z-values at an anchor; null when nothing computable. */
export function familyZ(zs: (number | null)[]): number | null {
  const valid = zs.filter((z): z is number => z !== null && Number.isFinite(z));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

/** Macro prior from the FRED regime pack (D46). Deterministic, documented. */
export function macroPrior(inp: { vix: number | null; hySpread: number | null; t10y2y: number | null }): number {
  const { vix, hySpread, t10y2y } = inp;
  let prior = 0.5;
  if (vix !== null && vix > 25) prior -= 0.08;
  if (hySpread !== null && hySpread > 450) prior -= 0.05; // HY OAS > 450bp = stress
  if (t10y2y !== null && t10y2y < 0) prior -= 0.03;        // inversion = late cycle
  if (vix !== null && vix < 17 && (hySpread === null || hySpread < 350) && (t10y2y === null || t10y2y > 0) ) prior += 0.04; // calm goldilocks
  return Math.max(0.35, Math.min(0.65, prior));
}
