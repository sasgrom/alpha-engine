export const REPORT_ENGINES = ["ollama", "strata"] as const;

export interface AbPlanItem {
  ticker: string;
  cik: number;
  accessionNo: string;
  form: string;
  filingDate: string;
  eventTs: string;
  windows: string[];
  chars: number;
}

/** Deterministic full-history coverage rather than 100 adjacent 8-Ks. */
export function evenSample<T>(rows: T[], limit: number): T[] {
  if (limit <= 0 || rows.length === 0) return [];
  if (rows.length <= limit) return [...rows];
  if (limit === 1) return [rows[rows.length - 1]];
  const indexes = new Set<number>();
  for (let i = 0; i < limit; i++) indexes.add(Math.round(i * (rows.length - 1) / (limit - 1)));
  return [...indexes].sort((a, b) => a - b).map((i) => rows[i]);
}

export interface ScorePair { a: number; b: number }
const mean = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
function category(x: number): number { return x <= -0.1 ? -1 : x >= 0.1 ? 1 : 0 }

/** Agreement is descriptive, not proof of absolute tone correctness. */
export function compareScores(pairs: ScorePair[]) {
  if (pairs.length === 0) return {
    n: 0, meanA: null, meanB: null, meanDelta: null, mae: null, rmse: null,
    pearson: null, signAgreement: null, within01: null, within02: null,
  };
  const a = pairs.map((p) => p.a), b = pairs.map((p) => p.b);
  const deltas = pairs.map((p) => p.b - p.a);
  const ma = mean(a), mb = mean(b);
  const covariance = mean(pairs.map((p) => (p.a - ma) * (p.b - mb)));
  const va = mean(a.map((x) => (x - ma) ** 2));
  const vb = mean(b.map((x) => (x - mb) ** 2));
  return {
    n: pairs.length,
    meanA: ma,
    meanB: mb,
    meanDelta: mean(deltas),
    mae: mean(deltas.map(Math.abs)),
    rmse: Math.sqrt(mean(deltas.map((x) => x ** 2))),
    pearson: va > 0 && vb > 0 ? covariance / Math.sqrt(va * vb) : null,
    signAgreement: pairs.filter((p) => category(p.a) === category(p.b)).length / pairs.length,
    within01: pairs.filter((p) => Math.abs(p.b - p.a) <= 0.1).length / pairs.length,
    within02: pairs.filter((p) => Math.abs(p.b - p.a) <= 0.2).length / pairs.length,
  };
}
