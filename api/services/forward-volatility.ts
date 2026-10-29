export interface VolBar { date: string; close: number }
function logReturns(bars: VolBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) out.push(Math.log(bars[i].close / bars[i - 1].close));
  return out;
}
function annualized(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(252 * variance);
}

/** Annualized RV using only returns strictly after the anchor date. */
export function forwardRealizedVolatility(bars: VolBar[], anchorDate: string, horizon: number): { vol: number; exitDate: string } | null {
  if (!Number.isInteger(horizon) || horizon < 2) return null;
  const start = bars.findIndex((b) => b.date > anchorDate);
  if (start < 1 || start + horizon - 1 >= bars.length) return null;
  const vol = annualized(logReturns(bars.slice(start - 1, start + horizon)));
  return vol === null ? null : { vol, exitDate: bars[start + horizon - 1].date };
}

/** Annualized trailing RV ending at the last close on or before the anchor. */
export function trailingRealizedVolatility(bars: VolBar[], anchorDate: string, horizon = 20): number | null {
  const start = bars.findIndex((b) => b.date > anchorDate);
  const end = start < 0 ? bars.length : start;
  if (end < horizon + 1) return null;
  return annualized(logReturns(bars.slice(end - horizon - 1, end)));
}

/** Fast normal CDF approximation for descriptive p-values only. */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.5 * z);
  const coefficients = [1.00002368, 0.37409196, 0.09678418, -0.18628806, 0.27886807, -1.13520398, 1.48851587, -0.82215223, 0.17087277];
  let poly = coefficients.at(-1)!;
  for (let i = coefficients.length - 2; i >= 0; i--) poly = coefficients[i] + t * poly;
  const tau = t * Math.exp(-z * z - 1.26551223 + t * poly);
  return x >= 0 ? 1 - tau / 2 : tau / 2;
}

export interface WeightedValue { value: number; weight: number }
/** Circular moving-block bootstrap for a weighted mean, deterministic by seed. */
export function blockBootstrapWeightedCi(rows: WeightedValue[], blockSize = 4, iterations = 2000, seed = 42): { low: number | null; high: number | null } {
  const valid = rows.filter((r) => Number.isFinite(r.value) && Number.isFinite(r.weight) && r.weight > 0);
  if (!valid.length) return { low: null, high: null };
  let state = seed >>> 0;
  const rnd = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  const means: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let value = 0, weight = 0;
    for (let j = 0; j < valid.length; j += blockSize) {
      const start = Math.floor(rnd() * valid.length);
      for (let k = 0; k < blockSize; k++) {
        const row = valid[(start + k) % valid.length];
        value += row.value * row.weight;
        weight += row.weight;
      }
    }
    if (weight > 0) means.push(value / weight);
  }
  means.sort((a, b) => a - b);
  return { low: means[Math.floor(means.length * 0.025)], high: means[Math.floor(means.length * 0.975)] };
}
