import { icStats, type IcPair } from "../../api/services/ic";
import { blockBootstrapWeightedCi, normalCdf } from "../../api/services/forward-volatility";
import { meanTStat, quantileSpread } from "../../api/services/research-metrics";
import { neutralizeBySector, type SectorReturnPoint } from "../../api/services/sector-neutral-ic";
import type { OptionBucketFeatures } from "./option-features";

export interface ResearchRow extends SectorReturnPoint {
  ticker: string;
  date: string;
  quarter: string;
  bucket: string;
}
export interface FactorConfig {
  bucketPreference: string[];
  select: (bucket: OptionBucketFeatures) => number | null;
}
export const FACTOR_CONFIGS: Record<string, FactorConfig> = {
  rv20: { bucketPreference: ["31-90D", "8-30D"], select: (b) => b.atmIv },
  atmIv: { bucketPreference: ["31-90D", "8-30D"], select: (b) => b.atmIv },
  termSlope: { bucketPreference: ["8-30D", "31-90D"], select: (b) => b.termSlope },
  skew25: { bucketPreference: ["31-90D", "8-30D"], select: (b) => b.skew25Delta },
  vrp: { bucketPreference: ["31-90D", "8-30D"], select: (b) => b.atmIv },
};

export function chooseBucket(buckets: OptionBucketFeatures[], preference: string[]): OptionBucketFeatures | null {
  for (const name of preference) {
    const bucket = buckets.find((b) => b.bucket === name);
    if (bucket) return bucket;
  }
  return null;
}

function summarize(rows: ResearchRow[]) {
  const byMonth = new Map<string, IcPair[]>();
  for (const row of rows) {
    if (!byMonth.has(row.quarter)) byMonth.set(row.quarter, []);
    byMonth.get(row.quarter)!.push({ x: row.x, y: row.y });
  }
  const stats = [...byMonth.entries()].map(([month, pairs]) => ({ month, ...icStats(pairs) }))
    .filter((r) => r.n >= 5 && r.spearman !== null);
  const n = stats.reduce((s, r) => s + r.n, 0);
  const weighted = stats.map((r) => ({ value: r.spearman!, weight: r.n }));
  const t = meanTStat(stats.map((r) => r.spearman!));
  const spreads = [...byMonth.values()].map((pairs) => quantileSpread(pairs)).filter((x): x is NonNullable<typeof x> => x !== null);
  const spreadN = spreads.reduce((s, x) => s + x.buckets.reduce((n, b) => n + b.n, 0), 0);
  return {
    months: stats.length, n,
    weightedSpearman: n ? weighted.reduce((s, r) => s + r.value * r.weight, 0) / n : null,
    medianSpearman: stats.length ? stats.map((r) => r.spearman).sort((a, b) => a - b)[Math.floor((stats.length - 1) / 2)] : null,
    positiveShare: stats.length ? stats.filter((r) => r.spearman! > 0).length / stats.length : null,
    tStatNaive: t,
    pNormalApprox: t === null ? null : 2 * (1 - normalCdf(Math.abs(t))),
    ci95: blockBootstrapWeightedCi(weighted),
    quantileTopBottom: spreadN ? spreads.reduce((s, x) => s + x.topBottom * x.buckets.reduce((n, b) => n + b.n, 0), 0) / spreadN : null,
  };
}

function pairedDelta(a: ResearchRow[], b: ResearchRow[]) {
  const group = (rows: ResearchRow[]) => {
    const out = new Map<string, { spearman: number | null; n: number }>();
    for (const row of rows) {
      const key = `${row.quarter}|${row.horizon}`;
      if (!out.has(key)) out.set(key, { spearman: null, n: 0 });
      const current = out.get(key)!;
      current.n++;
      const pairs = rows.filter((r) => `${r.quarter}|${r.horizon}` === key).map((r) => ({ x: r.x, y: r.y }));
      current.spearman = icStats(pairs).spearman;
      out.set(key, current);
    }
    return out;
  };
  const aStats = group(a), bStats = group(b);
  const deltas: { delta: number; weight: number; year: string }[] = [];
  for (const [key, av] of aStats) {
    const bv = bStats.get(key);
    if (!bv || av.spearman === null || bv.spearman === null || av.n < 5 || bv.n < 5) continue;
    deltas.push({ delta: av.spearman - bv.spearman, weight: Math.min(av.n, bv.n), year: key.slice(0, 4) });
  }
  return deltas;
}

export function compareFactorRows(a: ResearchRow[], b: ResearchRow[]) {
  const deltas = pairedDelta(a, b);
  const weight = deltas.reduce((s, r) => s + r.weight, 0);
  const years = [...new Set(deltas.map((r) => r.year))].sort();
  return {
    months: deltas.length,
    n: weight,
    deltaSpearman: weight ? deltas.reduce((s, r) => s + r.delta * r.weight, 0) / weight : null,
    betterShare: deltas.length ? deltas.filter((r) => r.delta > 0).length / deltas.length : null,
    ci95: blockBootstrapWeightedCi(deltas.map((r) => ({ value: r.delta, weight: r.weight }))),
    byYear: Object.fromEntries(years.map((year) => {
      const rows = deltas.filter((r) => r.year === year), w = rows.reduce((s, r) => s + r.weight, 0);
      return [year, { months: rows.length, n: w, deltaSpearman: w ? rows.reduce((s, r) => s + r.delta * r.weight, 0) / w : null, betterShare: rows.length ? rows.filter((r) => r.delta > 0).length / rows.length : null }];
    })),
  };
}

export function evaluateFactorRows(rows: ResearchRow[]) {
  const byYear = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort();
  const byBucket = [...new Set(rows.map((r) => r.bucket))].sort();
  return {
    overall: summarize(rows),
    oddCik: summarize(rows.filter((r) => r.cik % 2 === 1)),
    evenCik: summarize(rows.filter((r) => r.cik % 2 === 0)),
    sectorNeutral: summarize(neutralizeBySector(rows)),
    byYear: Object.fromEntries(byYear.map((year) => [year, summarize(rows.filter((r) => r.date.startsWith(year)))])),
    byBucket: Object.fromEntries(byBucket.map((bucket) => [bucket, summarize(rows.filter((r) => r.bucket === bucket))])),
  };
}
