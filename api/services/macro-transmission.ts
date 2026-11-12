import type { FundamentalSeriesRow } from "./fundamental-integrity";
import type { ExposureFiling, ExposureMeasure } from "../../worker/lib/exposure-aggregation";
import { buildCompanyExposure, type ExposureMetric, type CompanyExposureRow } from "./company-exposure";
import { carAt, marketModelEventStudy, type EventBar } from "./event-study";
import type { MacroEventHorizon, MacroEventObservation, MacroEventSplit } from "./macro-event-study";
import type { CalibrationChannel } from "./shock-calibration";

export type AtlasExposureKind = "debt_burden" | "fuel_cost" | "oil_revenue" | "oil_cost" | "foreign_revenue";
export interface AtlasRecord {
  eventId: string;
  ticker: string;
  sector: string;
  split: MacroEventSplit;
  seriesId: string;
  channel: CalibrationChannel;
  exposureKind: AtlasExposureKind;
  horizon: MacroEventHorizon;
  shock: number;
  exposure: number;
  abnormalReturn: number;
  concepts: string[];
  exposurePeriodEnd: string;
  exposureSourceFiled: string | null;
}
export interface TransmissionModelFit {
  coefficients: number[];
  coefficientNames: string[];
  baselineSector: string;
  sectorLevels: string[];
  betaInteraction: number;
  ci95Interaction: [number, number] | null;
  meanOutcome: number;
  rows: number;
  companies: number;
  events: number;
  coverage: "pilot" | "full_sample";
}
export interface TransmissionEvaluation {
  rows: number;
  companies: number;
  events: number;
  mae: number;
  rmse: number;
  r2AgainstDiscoveryMean: number | null;
}
export interface MacroTransmissionStudy {
  seriesId: string;
  channel: CalibrationChannel;
  exposureKind: AtlasExposureKind;
  horizon: MacroEventHorizon;
  status: "estimated" | "insufficient_coverage";
  reason: string | null;
  discovery: TransmissionModelFit | null;
  outOfSample: TransmissionEvaluation | null;
}
export interface MacroTransmissionAtlasReport {
  schemaVersion: 1;
  dataMode?: "live" | "fixture";
  generatedAt: string;
  asOf: string;
  status: "estimated" | "partial" | "insufficient_coverage";
  policy: {
    exposureAvailability: "sourceFiled_at_or_before_event_research_eligibility";
    macroVintage: "first_release_per_observation";
    priceModel: "market_model_ols_post_close";
    companyModel: "intercept_shock_exposure_interaction_and_sector_fixed_effects";
    discoveryFitOnlyForOos: true;
    minRows: 30;
    minEvents: 10;
    minCompanies: 5;
    fullSampleCompanies: 20;
    fullSampleEvents: 30;
    bootstrapReplicates: 500;
    maxBlockLength: 3;
    directionalForecast: false;
  };
  coverage: {
    candidatePairs: number;
    exposureMissing: number;
    exposurePartial: number;
    exposureStale: number;
    priceMissing: number;
    shockMissing: number;
    records: number;
  };
  studies: MacroTransmissionStudy[];
  records: AtlasRecord[];
}
export interface MacroTransmissionInput {
  macroObservations: MacroEventObservation[];
  companies: { cik: number; ticker: string; sector: string | null; rows: FundamentalSeriesRow[]; bars: EventBar[] }[];
  spyBars: EventBar[];
  exposureHistory?: ExposureFiling[];
  asOf: string;
  generatedAt: string;
  dataMode?: "live" | "fixture";
}

const HORIZONS: MacroEventHorizon[] = ["1", "5", "21", "63"];
const BOOTSTRAP_REPLICATES = 500;
const MIN_ROWS = 30, MIN_EVENTS = 10, MIN_COMPANIES = 5;
const unique = (values: string[]) => [...new Set(values)];
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function solveOls(x: number[][], y: number[]): number[] | null {
  if (!x.length || x.length !== y.length) return null;
  const width = x[0].length;
  const active = Array.from({ length: width }, (_, column) => column).filter((column) => {
    const norm = x.reduce((sum, row) => sum + row[column] ** 2, 0);
    return norm > 1e-16;
  });
  if (!active.length) return null;
  const scales = active.map((column) => Math.sqrt(x.reduce((sum, row) => sum + row[column] ** 2, 0) / x.length) || 1);
  const a = active.map((column, index) => active.map((other, otherIndex) => x.reduce((sum, row) => sum + (row[column] / scales[index]) * (row[other] / scales[otherIndex]), 0)));
  const b = active.map((column, index) => x.reduce((sum, row, rowIndex) => sum + (row[column] / scales[index]) * y[rowIndex], 0));
  for (let column = 0; column < active.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < active.length; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-10) return null;
    [a[pivot], a[column]] = [a[column], a[pivot]];
    [b[pivot], b[column]] = [b[column], b[pivot]];
    for (let row = column + 1; row < active.length; row++) {
      const factor = a[row][column] / a[column][column];
      for (let index = column; index < active.length; index++) a[row][index] -= factor * a[column][index];
      b[row] -= factor * b[column];
    }
  }
  const solved = new Array(active.length).fill(0);
  for (let row = active.length - 1; row >= 0; row--) {
    let value = b[row];
    for (let column = row + 1; column < active.length; column++) value -= a[row][column] * solved[column];
    solved[row] = value / a[row][row];
  }
  const coefficients = new Array(width).fill(0);
  active.forEach((column, index) => { coefficients[column] = solved[index] / scales[index]; });
  return coefficients.every(Number.isFinite) ? coefficients : null;
}

function sectorSchema(records: AtlasRecord[]): { baselineSector: string; sectorLevels: string[] } {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.sector, (counts.get(record.sector) ?? 0) + 1);
  const baselineSector = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "UNKNOWN";
  return { baselineSector, sectorLevels: unique(records.map((record) => record.sector)).filter((sector) => sector !== baselineSector).sort() };
}
function design(records: AtlasRecord[], sectorLevels: string[]): { x: number[][]; y: number[]; names: string[] } {
  return {
    x: records.map((record) => [1, record.shock, record.exposure, record.shock * record.exposure, ...sectorLevels.map((sector) => record.sector === sector ? 1 : 0)]),
    y: records.map((record) => record.abnormalReturn),
    names: ["intercept", "shock", "exposure", "interaction", ...sectorLevels.map((sector) => `sector:${sector}`)],
  };
}
function fitCore(records: AtlasRecord[], sectorLevels: string[]): number[] | null {
  const { x, y } = design(records, sectorLevels);
  return solveOls(x, y);
}
function eligibleModel(records: AtlasRecord[]): boolean {
  return records.length >= MIN_ROWS && unique(records.map((record) => record.eventId)).length >= MIN_EVENTS && unique(records.map((record) => record.ticker)).length >= MIN_COMPANIES;
}

/** Fit discovery-only OLS with sector fixed effects and event-cluster bootstrap CI. */
export function fitTransmissionModel(records: AtlasRecord[], seed = 42): TransmissionModelFit | null {
  if (!eligibleModel(records)) return null;
  const { baselineSector, sectorLevels } = sectorSchema(records);
  const coefficients = fitCore(records, sectorLevels);
  if (!coefficients) return null;
  const random = seededRandom(seed);
  const events = unique(records.map((record) => record.eventId)).sort();
  const estimates: number[] = [];
  const blockLength = Math.min(3, events.length);
  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate++) {
    const sampled: string[] = [];
    while (sampled.length < events.length) {
      const blockStart = Math.floor(random() * events.length);
      for (let index = 0; index < blockLength && sampled.length < events.length; index++) sampled.push(events[(blockStart + index) % events.length]);
    }
    const sample = sampled.flatMap((eventId) => records.filter((record) => record.eventId === eventId));
    const estimate = fitCore(sample, sectorLevels);
    if (estimate && eligibleModel(sample)) estimates.push(estimate[3]);
  }
  return {
    coefficients,
    coefficientNames: design(records, sectorLevels).names,
    baselineSector,
    sectorLevels,
    betaInteraction: coefficients[3],
    ci95Interaction: estimates.length >= 50 ? [quantile(estimates, 0.025), quantile(estimates, 0.975)] : null,
    meanOutcome: mean(records.map((record) => record.abnormalReturn)),
    rows: records.length,
    companies: unique(records.map((record) => record.ticker)).length,
    events: events.length,
    coverage: unique(records.map((record) => record.ticker)).length >= 20 && events.length >= 30 ? "full_sample" : "pilot",
  };
}

/** Evaluate frozen discovery coefficients on later OOS records without refitting. */
export function evaluateTransmissionModel(fit: TransmissionModelFit, records: AtlasRecord[]): TransmissionEvaluation | null {
  if (!eligibleModel(records)) return null;
  const { x, y } = design(records, fit.sectorLevels);
  const predictions = x.map((row) => row.reduce((sum, value, index) => sum + value * fit.coefficients[index], 0));
  const errors = predictions.map((prediction, index) => y[index] - prediction);
  const sse = errors.reduce((sum, error) => sum + error ** 2, 0);
  const sst = y.reduce((sum, value) => sum + (value - fit.meanOutcome) ** 2, 0);
  return {
    rows: records.length,
    companies: unique(records.map((record) => record.ticker)).length,
    events: unique(records.map((record) => record.eventId)).length,
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(sse / errors.length),
    r2AgainstDiscoveryMean: sst > 0 ? 1 - sse / sst : null,
  };
}

function historyMetric(measure: ExposureMeasure, operating: ExposureMeasure | undefined, asOf: string): ExposureMetric | null {
  if (!Number.isFinite(measure.value) || measure.value < 0 || !measure.periodEnd || measure.periodEnd > asOf.slice(0, 10) || measure.availableAt > asOf) return null;
  let value = measure.value;
  const facts = [...measure.facts];
  if (measure.unit !== "ratio") {
    if (!operating || operating.value <= 0 || operating.periodStart !== measure.periodStart || operating.periodEnd !== measure.periodEnd || operating.availableAt > asOf) return null;
    value /= operating.value;
    facts.push(...operating.facts);
  }
  if (measure.unit === "ratio" && (value < 0 || value > 1)) return null;
  return {
    value,
    unit: "ratio",
    concepts: unique(facts.map(fact => fact.concept.replace(/^.*:/, ""))),
    periodEnd: measure.periodEnd,
    sourceFiled: measure.availableAt,
    quality: "available",
    note: measure.unit === "ratio" ? "Same-filing inline-XBRL geographic share" : "Inline-XBRL flow divided by same-filing, same-period operating income",
    stale: (Date.parse(asOf) - Date.parse(`${measure.periodEnd}T00:00:00Z`)) / 86_400_000 > 550,
  };
}

export function withInlineExposureHistory(row: CompanyExposureRow, history: ExposureFiling[], asOf: string): CompanyExposureRow {
  const result = { ...row };
  const eligible = history.filter(filing => filing.ticker === row.ticker && filing.filingDate <= asOf.slice(0, 10)).sort((a, b) => a.filingDate.localeCompare(b.filingDate) || a.accessionNo.localeCompare(b.accessionNo));
  for (const kind of ["foreignRevenueShare", "fuelCost", "oilAndGasRevenue", "oilCost"] as const) {
    const filing = eligible.filter(item => item.measures.some(measure => measure.kind === kind && measure.availableAt <= asOf)).at(-1);
    const measure = filing?.measures.find(item => item.kind === kind);
    if (!filing || !measure) continue;
    const metric = historyMetric(measure, filing.measures.find(item => item.kind === "operatingIncome"), asOf);
    if (!metric) continue;
    if (kind === "foreignRevenueShare") result.foreignRevenueShare = metric;
    if (kind === "fuelCost") result.fuelCostToOperatingIncome = metric;
    if (kind === "oilAndGasRevenue") {
      result.oilRevenue = { ...metric, value: measure.value, unit: "USD" };
      result.oilRevenueToOperatingIncome = metric;
    }
    if (kind === "oilCost") {
      result.oilCost = { ...metric, value: measure.value, unit: "USD" };
      result.oilCostToOperatingIncome = metric;
    }
  }
  return result;
}

function exposureMetric(row: CompanyExposureRow, kind: AtlasExposureKind): ExposureMetric | undefined {
  if (kind === "debt_burden") return row.debtToOperatingIncome;
  if (kind === "fuel_cost") return row.fuelCostToOperatingIncome;
  if (kind === "oil_revenue") return row.oilRevenueToOperatingIncome;
  if (kind === "oil_cost") return row.oilCostToOperatingIncome;
  return row.foreignRevenueShare;
}
const exposureKinds = (channel: CalibrationChannel): AtlasExposureKind[] => channel === "oil" ? ["fuel_cost", "oil_revenue", "oil_cost"] : channel === "usd" ? ["foreign_revenue"] : ["debt_burden"];
const studyKey = (seriesId: string, channel: CalibrationChannel, exposureKind: AtlasExposureKind, horizon: MacroEventHorizon) => `${seriesId}|${channel}|${exposureKind}|${horizon}`;

/** Build availability-anchored company/macro panel and fixed-discovery OOS studies. */
export function buildMacroTransmissionAtlas(input: MacroTransmissionInput): MacroTransmissionAtlasReport {
  if (!Number.isFinite(Date.parse(input.asOf)) || !Number.isFinite(Date.parse(input.generatedAt))) throw new Error("Atlas timestamps must be ISO timestamps");
  const coverage = { candidatePairs: 0, exposureMissing: 0, exposurePartial: 0, exposureStale: 0, priceMissing: 0, shockMissing: 0, records: 0 };
  const records: AtlasRecord[] = [];
  for (const macro of input.macroObservations) {
    if (macro.researchEligibleAt > input.asOf) continue;
    for (const company of input.companies) {
      const exposure = withInlineExposureHistory(buildCompanyExposure({ cik: company.cik, ticker: company.ticker, name: company.ticker, sector: company.sector, rows: company.rows }, macro.researchEligibleAt), input.exposureHistory ?? [], macro.researchEligibleAt);
      const result = marketModelEventStudy(company.bars, input.spyBars, macro.publishedAt.slice(0, 10), { session: "post_close", horizon: 63 });
      for (const exposureKind of exposureKinds(macro.channel)) {
        coverage.candidatePairs++;
        const metric = exposureMetric(exposure, exposureKind);
        if (!metric || metric.quality === "missing" || metric.value === null || !Number.isFinite(metric.value)) { coverage.exposureMissing++; continue; }
        if (metric.quality === "partial") { coverage.exposurePartial++; continue; }
        if (!metric.sourceFiled || !metric.periodEnd || metric.sourceFiled > macro.researchEligibleAt || metric.periodEnd > macro.researchEligibleAt.slice(0, 10)) { coverage.exposureMissing++; continue; }
        if (metric.stale) { coverage.exposureStale++; continue; }
        if (metric.value < 0) { coverage.exposureMissing++; continue; }
        if (!result) { coverage.priceMissing++; continue; }
        for (const horizon of HORIZONS) {
          const shock = macro.outcomes[horizon]?.change;
          const abnormalReturn = carAt(result, Number(horizon));
          if (shock === undefined || abnormalReturn === null || !Number.isFinite(shock) || !Number.isFinite(abnormalReturn)) { coverage.shockMissing++; continue; }
          records.push({
            eventId: macro.eventId,
            ticker: company.ticker,
            sector: company.sector ?? "UNKNOWN",
            split: macro.split,
            seriesId: macro.seriesId,
            channel: macro.channel,
            exposureKind,
            horizon,
            shock,
            exposure: metric.value,
            abnormalReturn,
            concepts: metric.concepts,
            exposurePeriodEnd: metric.periodEnd,
            exposureSourceFiled: metric.sourceFiled,
          });
        }
      }
    }
  }
  coverage.records = records.length;
  const studies: MacroTransmissionStudy[] = [];
  for (const macro of input.macroObservations) {
    for (const exposureKind of exposureKinds(macro.channel)) {
      for (const horizon of HORIZONS) {
        const key = studyKey(macro.seriesId, macro.channel, exposureKind, horizon);
        if (studies.some((study) => studyKey(study.seriesId, study.channel, study.exposureKind, study.horizon) === key)) continue;
        const subset = records.filter((record) => studyKey(record.seriesId, record.channel, record.exposureKind, record.horizon) === key);
        const discovery = fitTransmissionModel(subset.filter((record) => record.split === "discovery"), macro.seriesId.length * 1000 + Number(horizon));
        const outOfSample = discovery ? evaluateTransmissionModel(discovery, subset.filter((record) => record.split === "out_of_sample")) : null;
        studies.push({
          seriesId: macro.seriesId,
          channel: macro.channel,
          exposureKind,
          horizon,
          status: discovery ? "estimated" : "insufficient_coverage",
          reason: discovery ? outOfSample ? null : "OOS gate was not met" : "Minimum 30 rows, 10 events, 5 companies and a full-rank design are required",
          discovery,
          outOfSample,
        });
      }
    }
  }
  const completed = studies.filter((study) => study.discovery && study.outOfSample).length;
  return {
    schemaVersion: 1,
    ...(input.dataMode ? { dataMode: input.dataMode } : {}),
    generatedAt: input.generatedAt,
    asOf: input.asOf,
    status: completed === studies.length && studies.length > 0 ? "estimated" : studies.some((study) => study.discovery) ? "partial" : "insufficient_coverage",
    policy: {
      exposureAvailability: "sourceFiled_at_or_before_event_research_eligibility",
      macroVintage: "first_release_per_observation",
      priceModel: "market_model_ols_post_close",
      companyModel: "intercept_shock_exposure_interaction_and_sector_fixed_effects",
      discoveryFitOnlyForOos: true,
      minRows: MIN_ROWS,
      minEvents: MIN_EVENTS,
      minCompanies: MIN_COMPANIES,
      fullSampleCompanies: 20,
      fullSampleEvents: 30,
      bootstrapReplicates: BOOTSTRAP_REPLICATES,
      maxBlockLength: 3,
      directionalForecast: false,
    },
    coverage,
    studies,
    records,
  };
}
