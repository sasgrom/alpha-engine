/**
 * 6d — pure conditional-magnitude and cross-sectional metrics.
 * No DB, no fitting against evaluation/holdout, no portfolio claims.
 */
import { spearman } from "./ic";

export interface MagnitudeSample { cik: number | string; anchor: string; ret: number; pUp: number }
export interface DistributionMoments {
  n: number;
  nUp: number;
  nDown: number;
  muPlus: number | null;
  muMinus: number | null;
  q10: number | null;
  q50: number | null;
  q90: number | null;
}
export interface CompanyMagnitude {
  upCount: number;
  downCount: number;
  muPlus: number | null;
  muMinus: number | null;
}
export interface MagnitudeBaseline {
  tau: number;
  panel: DistributionMoments;
  companies: Record<string, CompanyMagnitude>;
}

function finite(values: number[]): number[] { return values.filter(Number.isFinite); }
function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Linear-interpolated quantile over finite values; invalid inputs are null. */
export function quantile(values: number[], q: number): number | null {
  const xs = finite(values).sort((a, b) => a - b);
  if (xs.length === 0 || !Number.isFinite(q) || q < 0 || q > 1) return null;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos), w = pos - lo;
  return xs[lo] + (xs[hi] - xs[lo]) * w;
}

export function conditionalMoments(returns: number[]): DistributionMoments {
  const xs = finite(returns), up = xs.filter((r) => r > 0), down = xs.filter((r) => r <= 0);
  return {
    n: xs.length,
    nUp: up.length,
    nDown: down.length,
    muPlus: mean(up),
    muMinus: mean(down),
    q10: quantile(xs, 0.1),
    q50: quantile(xs, 0.5),
    q90: quantile(xs, 0.9),
  };
}

function poolMean(panel: number | null, company: number | null, n: number, tau: number): number | null {
  if (company === null) return panel;
  if (panel === null) return company;
  const w = n / (n + tau);
  return w * company + (1 - w) * panel;
}

/** Historical conditional baseline. Company means shrink to panel means with
 * side-specific counts. It uses returns only; probabilities arrive at predict. */
export function fitMagnitudeBaseline(samples: MagnitudeSample[], tau = 8): MagnitudeBaseline | null {
  const clean = samples.filter((s) => Number.isFinite(s.ret));
  if (clean.length === 0 || !Number.isFinite(tau) || tau < 0) return null;
  const panel = conditionalMoments(clean.map((s) => s.ret));
  const grouped = new Map<string, number[]>();
  for (const s of clean) {
    const key = String(s.cik);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s.ret);
  }
  const companies: Record<string, CompanyMagnitude> = {};
  for (const [key, returns] of grouped) {
    const m = conditionalMoments(returns);
    companies[key] = {
      upCount: m.nUp,
      downCount: m.nDown,
      muPlus: poolMean(panel.muPlus, m.muPlus, m.nUp, tau),
      muMinus: poolMean(panel.muMinus, m.muMinus, m.nDown, tau),
    };
  }
  return { tau, panel, companies };
}

export function expectedExcess(pUp: number, muPlus: number | null, muMinus: number | null): number | null {
  if (!Number.isFinite(pUp) || pUp < 0 || pUp > 1 || muPlus === null || muMinus === null) return null;
  if (!Number.isFinite(muPlus) || !Number.isFinite(muMinus)) return null;
  return pUp * muPlus + (1 - pUp) * muMinus;
}

export function predictMagnitude(
  input: { cik: number | string; pUp: number },
  model: MagnitudeBaseline
): number | null {
  const company = model.companies[String(input.cik)];
  return expectedExcess(
    input.pUp,
    company?.muPlus ?? model.panel.muPlus,
    company?.muMinus ?? model.panel.muMinus
  );
}

export interface ErrorPoint { actual: number; predicted: number }
export interface ErrorMetrics { n: number; mae: number; medianAe: number; rmse: number; bias: number }

export function magnitudeErrors(points: ErrorPoint[]): ErrorMetrics | null {
  const clean = points.filter((p) => Number.isFinite(p.actual) && Number.isFinite(p.predicted));
  if (clean.length === 0) return null;
  const signed = clean.map((p) => p.predicted - p.actual), abs = signed.map(Math.abs);
  return {
    n: clean.length,
    mae: mean(abs)!,
    medianAe: quantile(abs, 0.5)!,
    rmse: Math.sqrt(mean(signed.map((e) => e * e))!),
    bias: mean(signed)!,
  };
}

/** Pinball loss for one quantile prediction. */
export function pinballLoss(actual: number, predicted: number, q: number): number | null {
  if (![actual, predicted, q].every(Number.isFinite) || q < 0 || q > 1) return null;
  const error = actual - predicted;
  return error >= 0 ? q * error : (q - 1) * error;
}

export function meanPinballLoss(points: { actual: number; predicted: number; q: number }[]): number | null {
  const losses = points.map((p) => pinballLoss(p.actual, p.predicted, p.q)).filter((v): v is number => v !== null);
  return mean(losses);
}

export interface CrossSectionPoint { cik: number | string; anchor: string; score: number; ret: number }

function crossSections(points: CrossSectionPoint[], minNames: number): CrossSectionPoint[][] {
  const byAnchor = new Map<string, Map<string, CrossSectionPoint>>();
  for (const p of points) {
    if (!p.anchor || !Number.isFinite(p.score) || !Number.isFinite(p.ret)) continue;
    if (!byAnchor.has(p.anchor)) byAnchor.set(p.anchor, new Map());
    // Last input row wins: one company votes once per availability anchor.
    byAnchor.get(p.anchor)!.set(String(p.cik), p);
  }
  return [...byAnchor.values()].map((rows) => [...rows.values()]).filter((rows) => rows.length >= minNames);
}

export interface RankIcResult {
  status: "ok" | "insufficient";
  anchors: number;
  mean: number | null;
  median: number | null;
  values: { anchor: string; n: number; ic: number }[];
}

export function crossSectionalRankIC(points: CrossSectionPoint[], minNames = 5): RankIcResult {
  const values: RankIcResult["values"] = [];
  for (const rows of crossSections(points, minNames)) {
    const ic = spearman(rows.map((r) => r.score), rows.map((r) => r.ret));
    if (ic !== null) values.push({ anchor: rows[0].anchor, n: rows.length, ic });
  }
  const ics = values.map((v) => v.ic);
  return {
    status: values.length ? "ok" : "insufficient",
    anchors: values.length,
    mean: mean(ics),
    median: quantile(ics, 0.5),
    values,
  };
}

export interface BucketSpreadResult {
  status: "ok" | "insufficient";
  anchors: number;
  meanSpread: number | null;
  positiveFraction: number | null;
  values: { anchor: string; n: number; spread: number; means: (number | null)[] }[];
}

/** Highest-score bucket minus lowest-score bucket, independently per anchor. */
export function bucketedReturnSpread(points: CrossSectionPoint[], buckets = 4, minNames = 8): BucketSpreadResult {
  const empty: BucketSpreadResult = { status: "insufficient", anchors: 0, meanSpread: null, positiveFraction: null, values: [] };
  if (!Number.isInteger(buckets) || buckets < 2) return empty;
  const values: BucketSpreadResult["values"] = [];
  for (const rows of crossSections(points, Math.max(minNames, buckets))) {
    const ordered = [...rows].sort((a, b) => b.score - a.score || String(a.cik).localeCompare(String(b.cik)));
    const groups: number[][] = Array.from({ length: buckets }, () => []);
    ordered.forEach((row, i) => groups[Math.min(buckets - 1, Math.floor((i * buckets) / ordered.length))].push(row.ret));
    const means = groups.map(mean);
    const high = means[0], low = means[means.length - 1];
    if (high === null || low === null) continue;
    values.push({ anchor: rows[0].anchor, n: rows.length, spread: high - low, means });
  }
  const spreads = values.map((v) => v.spread);
  return {
    status: values.length ? "ok" : "insufficient",
    anchors: values.length,
    meanSpread: mean(spreads),
    positiveFraction: spreads.length ? spreads.filter((s) => s > 0).length / spreads.length : null,
    values,
  };
}

export interface ReturnCalibrationBin {
  from: number;
  to: number;
  n: number;
  predictedMean: number;
  actualMean: number;
  actualMedian: number;
}

/** Equal-count calibration bins. The caller decides which fit/cal/eval segment
 * is allowed to produce them; this function never chooses rows by outcome. */
export function returnCalibrationBins(points: ErrorPoint[], binCount = 5): ReturnCalibrationBin[] {
  const clean = points.filter((p) => Number.isFinite(p.predicted) && Number.isFinite(p.actual))
    .sort((a, b) => a.predicted - b.predicted);
  if (clean.length === 0) return [];
  const bins = Math.max(1, Math.min(Math.floor(binCount), clean.length));
  const out: ReturnCalibrationBin[] = [];
  for (let b = 0; b < bins; b++) {
    const rows = clean.filter((_, i) => Math.min(bins - 1, Math.floor((i * bins) / clean.length)) === b);
    if (rows.length === 0) continue;
    out.push({
      from: rows[0].predicted,
      to: rows[rows.length - 1].predicted,
      n: rows.length,
      predictedMean: mean(rows.map((r) => r.predicted))!,
      actualMean: mean(rows.map((r) => r.actual))!,
      actualMedian: quantile(rows.map((r) => r.actual), 0.5)!,
    });
  }
  return out;
}
