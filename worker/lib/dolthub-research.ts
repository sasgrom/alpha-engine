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
