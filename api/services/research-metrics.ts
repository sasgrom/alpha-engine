import { pearson, type IcPair } from "./ic";

/** Naive descriptive t-stat. Autocorrelation-aware bootstrap remains primary. */
export function meanTStat(values: number[]): number | null {
  const xs = values.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  return variance === 0 ? null : mean / Math.sqrt(variance / xs.length);
}

export interface QuantileBucket { bucket: number; n: number; meanX: number; meanY: number }
export function quantileSpread(pairs: IcPair[], buckets = 5): { buckets: QuantileBucket[]; topBottom: number } | null {
  if (pairs.length < buckets || buckets < 2) return null;
  const sorted = [...pairs].sort((a, b) => a.x - b.x || a.y - b.y);
  const groups: QuantileBucket[] = [];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor(bucket * sorted.length / buckets), end = Math.floor((bucket + 1) * sorted.length / buckets);
    const rows = sorted.slice(start, end);
    if (!rows.length) return null;
    groups.push({
      bucket: bucket + 1, n: rows.length,
      meanX: rows.reduce((s, p) => s + p.x, 0) / rows.length,
      meanY: rows.reduce((s, p) => s + p.y, 0) / rows.length,
    });
  }
  return { buckets: groups, topBottom: groups.at(-1)!.meanY - groups[0].meanY };
}

export interface TimedValue { key: string; period: string; value: number }
/** Lag-one Pearson correlation across consecutive observations within each key. */
export function groupedLagAutocorrelation(rows: TimedValue[]): number | null {
  const groups = new Map<string, TimedValue[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.value)) continue;
    if (!groups.has(row.key)) groups.set(row.key, []);
    groups.get(row.key)!.push(row);
  }
  const before: number[] = [], after: number[] = [];
  for (const values of groups.values()) {
    values.sort((a, b) => a.period.localeCompare(b.period));
    for (let i = 1; i < values.length; i++) {
      before.push(values[i - 1].value);
      after.push(values[i].value);
    }
  }
  return pearson(before, after);
}

/** Standard one-way weight turnover: 0.5 * sum(abs(after-before)), missing = 0. */
export function weightTurnover(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>): number {
  const keys = new Set([...before.keys(), ...after.keys()]);
  let total = 0;
  for (const key of keys) total += Math.abs((after.get(key) ?? 0) - (before.get(key) ?? 0));
  return total / 2;
}

/** Mean long-short turnover from sign weights, including universe entries/exits. */
export function longShortTurnover(rows: TimedValue[]): number | null {
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  if (periods.length < 2) return null;
  const turnovers: number[] = [];
  for (let i = 1; i < periods.length; i++) {
    const weights = (period: string) => {
      const current = rows.filter((r) => r.period === period && Number.isFinite(r.value));
      const n = current.length;
      return new Map(current.map((r) => [r.key, n ? Math.sign(r.value) / n : 0]));
    };
    turnovers.push(weightTurnover(weights(periods[i - 1]), weights(periods[i])));
  }
  return turnovers.reduce((a, b) => a + b, 0) / turnovers.length;
}

export function coverageRatio(valid: number, total: number): number | null {
  return total > 0 && valid >= 0 && valid <= total ? valid / total : null;
}

export interface BhResult { pAdjusted: number; rejected: boolean }
/** Benjamini-Hochberg adjusted p-values and rejection flags, input order retained. */
export function benjaminiHochberg(pValues: number[], q = 0.05): BhResult[] {
  if (q <= 0 || q > 1 || pValues.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error("Invalid p-value or FDR q");
  const n = pValues.length;
  const adjusted = new Array<number>(n).fill(1);
  const ordered = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let running = 1;
  for (let rank = n; rank >= 1; rank--) {
    const item = ordered[rank - 1];
    running = Math.min(running, item.p * n / rank);
    adjusted[item.i] = Math.min(1, running);
  }
  return adjusted.map((pAdjusted) => ({ pAdjusted, rejected: pAdjusted <= q }));
}

export interface RobustnessRun { runId: string; metric: number | null; error?: string }
/** Keep every run visible and select the worst valid slice, never the best. */
export function summarizeRobustnessRuns(runs: RobustnessRun[]) {
  const valid = runs.filter((r): r is RobustnessRun & { metric: number } => r.metric !== null && Number.isFinite(r.metric));
  const sorted = [...valid].sort((a, b) => a.metric - b.metric);
  return {
    totalRuns: runs.length,
    failedRuns: runs.length - valid.length,
    validRuns: valid.length,
    worstRunId: sorted[0]?.runId ?? null,
    worstMetric: sorted[0]?.metric ?? null,
    medianMetric: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)].metric : null,
    positiveShare: valid.length ? valid.filter((r) => r.metric > 0).length / valid.length : null,
  };
}
