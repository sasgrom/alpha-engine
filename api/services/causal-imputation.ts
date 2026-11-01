import type { RecentGapDiagnosisReport } from "./edgar-recent-gap-diagnosis";
import type { FundamentalSeriesRow } from "./fundamental-integrity";

export interface TrendEstimate {
  slope: number;
  intercept: number;
  forecast: number;
}
export interface ImputationValue {
  method: "causal_ols4" | "retrospective_ols4_next_average";
  value: number;
  availableAt: string;
  usesFutureObservation: boolean;
}
export interface QuarterImputation {
  cik: number;
  concept: string;
  quarter: string;
  status: "candidate" | "skipped";
  unit: string | null;
  reason: string;
  sourceQuarters: string[];
  causal: ImputationValue | null;
  retrospective: ImputationValue | null;
}
export interface CausalImputationReport {
  schemaVersion: 1;
  generatedAt: string;
  sourceDiagnosisGeneratedAt: string;
  sourceFactsSha256: string;
  cik: number;
  policy: {
    rawSeriesChanged: false;
    causalRule: string;
    retrospectiveRule: string;
  };
  summary: {
    annualExcludedQuarters: number;
    evaluatedQuarters: number;
    candidateQuarters: number;
    skippedQuarters: number;
  };
  quarters: QuarterImputation[];
}

interface SeriesObservation {
  quarter: string;
  periodEnd: string;
  val: number;
  unit: string;
  sourceFiled: string;
}

export function quarterIndex(quarter: string): number {
  const match = /^(\d{4})Q([1-4])$/.exec(quarter);
  if (!match) throw new Error(`Invalid quarter ${quarter}`);
  return Number(match[1]) * 4 + Number(match[2]) - 1;
}

export function linearTrendForecast(values: number[]): TrendEstimate {
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("OLS4 requires exactly four finite observations");
  }
  const n = 4;
  const meanX = 2.5;
  const meanY = values.reduce((total, value) => total + value, 0) / n;
  const numerator = values.reduce((total, value, index) => total + (index + 1 - meanX) * (value - meanY), 0);
  const denominator = values.reduce((total, _value, index) => total + (index + 1 - meanX) ** 2, 0);
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  return { slope, intercept, forecast: intercept + slope * 5 };
}

function observationsByQuarter(rows: FundamentalSeriesRow[]): Map<string, SeriesObservation[]> {
  const result = new Map<string, SeriesObservation[]>();
  for (const row of rows) {
    if (row.val === null || !Number.isFinite(row.val) || !row.unit || !row.sourceFiled) continue;
    const quarter = `${row.periodEnd.slice(0, 4)}Q${Math.ceil(Number(row.periodEnd.slice(5, 7)) / 3)}`;
    if (!/^\d{4}Q[1-4]$/.test(quarter)) continue;
    const observation = { quarter, periodEnd: row.periodEnd, val: row.val, unit: row.unit, sourceFiled: row.sourceFiled };
    result.set(quarter, [...(result.get(quarter) ?? []), observation]);
  }
  for (const observations of result.values()) observations.sort((a, b) => a.sourceFiled.localeCompare(b.sourceFiled) || a.periodEnd.localeCompare(b.periodEnd));
  return result;
}

function uniqueObservation(observations: SeriesObservation[]): SeriesObservation | null {
  if (!observations.length) return null;
  const first = observations[0];
  if (observations.some((row) => row.unit !== first.unit || Math.abs(row.val - first.val) > 1e-9)) return null;
  return first;
}

function earliestObservation(observations: SeriesObservation[], unit: string): SeriesObservation | null {
  const eligible = observations.filter((observation) => observation.unit === unit);
  if (!eligible.length) return null;
  const firstFiled = eligible[0].sourceFiled;
  return uniqueObservation(eligible.filter((observation) => observation.sourceFiled === firstFiled));
}

function latestObservationBefore(observations: SeriesObservation[], availableAt: string, unit: string): SeriesObservation | null {
  const eligible = observations.filter((observation) => observation.unit === unit && observation.sourceFiled <= availableAt);
  if (!eligible.length) return null;
  const lastFiled = eligible[eligible.length - 1].sourceFiled;
  return uniqueObservation(eligible.filter((observation) => observation.sourceFiled === lastFiled));
}

export function buildCausalImputationReport(
  diagnosis: RecentGapDiagnosisReport,
  series: FundamentalSeriesRow[],
  generatedAt: string,
): CausalImputationReport {
  const quarters: QuarterImputation[] = [];
  const gaps = diagnosis.gaps.filter((gap) => gap.cadence !== "annual_only");
  for (const gap of gaps) {
    const conceptRows = series.filter((row) => row.cik === diagnosis.cik && row.concept === gap.concept);
    const byQuarter = observationsByQuarter(conceptRows);
    const units = [...new Set(conceptRows.map((row) => row.unit).filter((unit): unit is string => Boolean(unit)))];
    for (const quarter of gap.recentQuarters) {
      const base = { cik: diagnosis.cik, concept: gap.concept, quarter, unit: units.length === 1 ? units[0] : null, sourceQuarters: [] as string[], causal: null, retrospective: null };
      if (units.length !== 1) {
        quarters.push({ ...base, status: "skipped", reason: "Concept has missing or conflicting units; no value was imputed." });
        continue;
      }
      const targetIndex = quarterIndex(quarter);
      const nextQuarter = [...byQuarter.keys()].find((candidate) => quarterIndex(candidate) === targetIndex + 1);
      const next = nextQuarter ? earliestObservation(byQuarter.get(nextQuarter) ?? [], units[0]) : null;
      if (!next || next.unit !== units[0]) {
        quarters.push({ ...base, status: "skipped", reason: "No unambiguous actual observation exists in the immediately following quarter; tail and multi-quarter gaps are not trend-filled." });
        continue;
      }
      const availableAt = next.sourceFiled;
      const sourceQuarters = Array.from({ length: 4 }, (_, index) => targetIndex - 4 + index);
      const prior = sourceQuarters.map((index) => {
        const candidates = [...byQuarter.entries()]
          .filter(([candidate]) => quarterIndex(candidate) === index)
          .flatMap(([, observations]) => observations);
        return latestObservationBefore(candidates, availableAt, units[0]);
      });
      if (prior.some((observation) => !observation)) {
        quarters.push({ ...base, status: "skipped", reason: "Four consecutive actual quarters were not available before the imputation availability date." });
        continue;
      }
      const observations = prior as SeriesObservation[];
      const trend = linearTrendForecast(observations.map((observation) => observation.val));
      const sourceQuarterLabels = observations.map((observation) => observation.quarter);
      quarters.push({
        ...base,
        status: "candidate",
        reason: "Isolated gap with four prior actual quarters and a following-quarter availability anchor; review before materialization.",
        sourceQuarters: sourceQuarterLabels,
        causal: { method: "causal_ols4", value: trend.forecast, availableAt, usesFutureObservation: false },
        retrospective: {
          method: "retrospective_ols4_next_average",
          value: (trend.forecast + next.val) / 2,
          availableAt,
          usesFutureObservation: true,
        },
      });
    }
  }
  const candidateQuarters = quarters.filter((quarter) => quarter.status === "candidate").length;
  return {
    schemaVersion: 1,
    generatedAt,
    sourceDiagnosisGeneratedAt: diagnosis.generatedAt,
    sourceFactsSha256: diagnosis.sourceFactsSha256,
    cik: diagnosis.cik,
    policy: {
      rawSeriesChanged: false,
      causalRule: "OLS4 uses only four consecutive observations before the target quarter. It never uses the following-quarter value. Conservative availability is the following actual observation's sourceFiled date.",
      retrospectiveRule: "The OLS4/next-actual average is a separate two-sided smoother, uses future information and is unavailable before the following actual sourceFiled date. Never substitute it into an earlier signal.",
    },
    summary: {
      annualExcludedQuarters: diagnosis.summary.annualOnlyQuarters,
      evaluatedQuarters: quarters.length,
      candidateQuarters,
      skippedQuarters: quarters.length - candidateQuarters,
    },
    quarters,
  };
}
