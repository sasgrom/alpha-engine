import type { NormalizedMacroPoint } from "../../worker/lib/fred";

export type CalibrationChannel = "rates" | "oil" | "usd" | "credit";
export interface CalibrationDistribution {
  n: number;
  firstPeriod: string;
  lastPeriod: string;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  ci95P50: [number, number] | null;
  ci95P90: [number, number] | null;
}
export interface ShockCalibration {
  seriesId: string;
  channel: CalibrationChannel;
  status: "ready" | "insufficient_history";
  unit: "decimal" | "decimal_percentage";
  observations: number;
  distributions: Record<"1" | "5" | "21" | "63", CalibrationDistribution | null>;
  presets: {
    mild: { shock: number; percentile: 50 };
    severe: { shock: number; percentile: 90 };
    extreme: { shock: number; percentile: 99 };
  } | null;
}
export interface ShockCalibrationReport {
  schemaVersion: 1;
  generatedAt: string;
  asOf: string;
  policy: {
    availabilityAnchored: true;
    latestVintagePerObservationPeriod: true;
    movingBlockBootstrap: 200;
    maxBlockLength: 20;
  };
  calibrations: ShockCalibration[];
}

const HORIZONS = [1, 5, 21, 63] as const;
type Horizon = (typeof HORIZONS)[number];
const channelUnit = (channel: CalibrationChannel): ShockCalibration["unit"] => channel === "rates" || channel === "credit" ? "decimal" : "decimal_percentage";
const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
};
const absQuantile = (values: number[]): CalibrationDistribution => ({
  n: values.length,
  firstPeriod: "",
  lastPeriod: "",
  p50: quantile(values, 0.50),
  p75: quantile(values, 0.75),
  p90: quantile(values, 0.90),
  p95: quantile(values, 0.95),
  p99: quantile(values, 0.99),
  ci95P50: null,
  ci95P90: null,
});
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function bootstrapCi(values: number[], q: number, seed: number): [number, number] {
  const random = seededRandom(seed);
  const blockLength = Math.min(20, values.length);
  const estimates: number[] = [];
  for (let replicate = 0; replicate < 200; replicate++) {
    const sample: number[] = [];
    for (let start = 0; start < values.length; start += blockLength) {
      const blockStart = Math.floor(random() * values.length);
      for (let index = 0; index < blockLength; index++) sample.push(values[(blockStart + index) % values.length]);
    }
    estimates.push(quantile(sample, q));
  }
  return [quantile(estimates, 0.025), quantile(estimates, 0.975)];
}
function latestByPeriod(rows: NormalizedMacroPoint[], asOf: string): NormalizedMacroPoint[] {
  const byPeriod = new Map<string, NormalizedMacroPoint>();
  for (const row of rows) {
    if (row.value === null || !Number.isFinite(row.value) || row.observationPeriod > asOf.slice(0, 10) || row.availableAt > asOf || row.researchEligibleAt > asOf) continue;
    const prior = byPeriod.get(row.observationPeriod);
    if (!prior || row.availableAt > prior.availableAt) byPeriod.set(row.observationPeriod, row);
  }
  return [...byPeriod.values()].sort((a, b) => a.observationPeriod.localeCompare(b.observationPeriod));
}
function decimalRate(point: NormalizedMacroPoint): number {
  const unit = point.unit.trim().toLowerCase();
  if (unit === "percent" || unit === "%") return point.value! / 100;
  if (unit === "decimal" || unit === "ratio") return point.value!;
  throw new Error(`Unsupported rate unit for ${point.seriesId}: ${point.unit}`);
}
function delta(current: NormalizedMacroPoint, previous: NormalizedMacroPoint, channel: CalibrationChannel): number | null {
  if (channel === "rates" || channel === "credit") return decimalRate(current) - decimalRate(previous);
  return previous.value! > 0 && current.value! > 0 ? Math.log(current.value! / previous.value!) : null;
}
function distribution(points: NormalizedMacroPoint[], channel: CalibrationChannel, horizon: Horizon, seed: number): CalibrationDistribution | null {
  const values: number[] = [];
  for (let index = horizon; index < points.length; index++) {
    const change = delta(points[index], points[index - horizon], channel);
    if (change !== null && Number.isFinite(change)) values.push(Math.abs(change));
  }
  if (values.length < 30) return null;
  return {
    ...absQuantile(values),
    firstPeriod: points[0].observationPeriod,
    lastPeriod: points.at(-1)!.observationPeriod,
    ci95P50: bootstrapCi(values, 0.5, seed),
    ci95P90: bootstrapCi(values, 0.9, seed + 1),
  };
}

export function calibrateShockSeries(seriesId: string, channel: CalibrationChannel, rows: NormalizedMacroPoint[], asOf: string): ShockCalibration {
  const points = latestByPeriod(rows, asOf);
  const unit = channelUnit(channel);
  const distributions = Object.fromEntries(HORIZONS.map((horizon) => [String(horizon), distribution(points, channel, horizon, seriesId.length * 1000 + horizon)])) as ShockCalibration["distributions"];
  const daily = distributions["1"];
  return {
    seriesId,
    channel,
    status: daily ? "ready" : "insufficient_history",
    unit,
    observations: points.length,
    distributions,
    presets: daily ? {
      mild: { shock: daily.p50, percentile: 50 },
      severe: { shock: daily.p90, percentile: 90 },
      extreme: { shock: daily.p99, percentile: 99 },
    } : null,
  };
}

export function buildShockCalibrationReport(series: { seriesId: string; channel: CalibrationChannel; rows: NormalizedMacroPoint[] }[], asOf: string, generatedAt: string): ShockCalibrationReport {
  return {
    schemaVersion: 1,
    generatedAt,
    asOf,
    policy: { availabilityAnchored: true, latestVintagePerObservationPeriod: true, movingBlockBootstrap: 200, maxBlockLength: 20 },
    calibrations: series.map((item) => calibrateShockSeries(item.seriesId, item.channel, item.rows, asOf)),
  };
}
