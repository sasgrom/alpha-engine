import type { NormalizedMacroPoint } from "../../worker/lib/fred";
import type { CompanyExposureRow, ExposureMetric } from "./company-exposure";
import type { ExposureEvidence, PilotEvidence } from "./pilot-exposure-evidence";

export type ScenarioChannel = "rates" | "oil" | "usd" | "credit";
export type ScenarioStatus = "computable" | "historical_only" | "not_computable";
export interface MacroScenarioDefinition { channel: ScenarioChannel; shock: number }
export interface ScenarioMetric {
  name: "interest_upper_bound" | "interest_estimate" | "fuel_cost_gross" | "oil_revenue_gross" | "oil_cost_gross" | "usd_translation_elasticity";
  value: number;
  unit: "USD/year" | "USD" | "ratio";
  impactType: "upper_bound" | "estimate" | "gross_exposure";
  formula: string;
  concepts: string[];
  periodEnd: string | null;
  availableAt: string | null;
  stale: boolean;
}
export interface CompanyScenarioImpact {
  ticker: string;
  status: ScenarioStatus;
  reasons: string[];
  metrics: ScenarioMetric[];
}
export interface MacroScenario {
  channel: ScenarioChannel;
  shock: number;
  shockUnit: "decimal" | "decimal_percentage";
  baseline: {
    seriesId: string;
    observationPeriod: string;
    value: number;
    scenarioValue: number;
    unit: string;
    availableAt: string;
    researchEligibleAt: string;
    vintageId: string;
    stale: boolean;
  } | null;
  status: "complete" | "partial" | "historical_only" | "not_computable";
  reasons: string[];
  impacts: CompanyScenarioImpact[];
}
export interface MacroScenarioReport {
  schemaVersion: 1;
  generatedAt: string;
  asOf: string;
  policy: {
    noSectorInference: true;
    upperBoundWhenHedgeUnknown: true;
    staleEvidenceIsHistoricalOnly: true;
    creditRequiresNewIssuanceTerms: true;
  };
  scenarios: MacroScenario[];
}
export interface MacroScenarioInput {
  asOf: string;
  definitions: MacroScenarioDefinition[];
  macroSeries: Record<string, NormalizedMacroPoint[]>;
  pilot: PilotEvidence[];
  exposures: CompanyExposureRow[];
}

const SERIES: Record<ScenarioChannel, string> = { rates: "DGS10", oil: "DCOILWTICO", usd: "DTWEXBGS", credit: "BAMLH0A0HYM2" };
const UNIT: Record<ScenarioChannel, MacroScenario["shockUnit"]> = { rates: "decimal", oil: "decimal_percentage", usd: "decimal_percentage", credit: "decimal" };
const MAX_SHOCK: Record<ScenarioChannel, number> = { rates: 0.05, oil: 0.90, usd: 0.90, credit: 0.05 };
const stale = (periodEnd: string | null, asOf: string): boolean => periodEnd ? (Date.parse(asOf) - Date.parse(`${periodEnd}T00:00:00Z`)) / 86_400_000 > 550 : false;

export function latestMacroPoint(rows: NormalizedMacroPoint[], asOf: string): NormalizedMacroPoint | null {
  const eligible = rows.filter((row) => row.value !== null && Number.isFinite(row.value) && row.observationPeriod <= asOf.slice(0, 10) && row.availableAt <= asOf && row.researchEligibleAt <= asOf);
  const byPeriod = new Map<string, NormalizedMacroPoint>();
  for (const row of eligible) {
    const prior = byPeriod.get(row.observationPeriod);
    if (!prior || row.availableAt > prior.availableAt) byPeriod.set(row.observationPeriod, row);
  }
  return [...byPeriod.values()].sort((a, b) => b.observationPeriod.localeCompare(a.observationPeriod) || b.availableAt.localeCompare(a.availableAt))[0] ?? null;
}
function metricDetails(metric: ExposureMetric | ExposureEvidence, asOf: string): { concepts: string[]; periodEnd: string | null; availableAt: string | null; stale: boolean } {
  const concepts = "concept" in metric && metric.concept ? [metric.concept] : "concepts" in metric ? metric.concepts : [];
  const availableAt = "availableAt" in metric ? metric.availableAt : "sourceFiled" in metric ? metric.sourceFiled : null;
  return { concepts, periodEnd: metric.periodEnd, availableAt, stale: metric.stale === true || stale(metric.periodEnd, asOf) };
}
function validShare(value: number | null): boolean { return value !== null && Number.isFinite(value) && value >= 0 && value <= 1; }
function availabilityDate(metric: ExposureMetric | ExposureEvidence, asOf: string): string | null {
  const availableAt = "availableAt" in metric ? metric.availableAt : "sourceFiled" in metric ? metric.sourceFiled : null;
  return availableAt && availableAt <= asOf ? availableAt : null;
}
function notComputable(ticker: string, reasons: string[]): CompanyScenarioImpact { return { ticker, status: "not_computable", reasons, metrics: [] }; }

function rateImpact(pilot: PilotEvidence | undefined, exposure: CompanyExposureRow | undefined, shock: number, asOf: string): CompanyScenarioImpact {
  if (!pilot || !exposure) return notComputable(pilot?.ticker ?? exposure?.ticker ?? "UNKNOWN", ["pilot_or_exposure_evidence_missing"]);
  const fixed = pilot.fixedInterestShare;
  const debt = exposure.debt;
  if (!fixed || !validShare(fixed.value)) return notComputable(pilot.ticker, ["fixed_interest_share_missing_or_invalid"]);
  if (!availabilityDate(fixed, asOf)) return notComputable(pilot.ticker, ["fixed_interest_share_unavailable_asof"]);
  if (debt.quality === "missing" || debt.value === null || debt.value < 0) return notComputable(pilot.ticker, ["debt_missing_or_invalid"]);
  if (!availabilityDate(debt, asOf)) return notComputable(pilot.ticker, ["debt_unavailable_asof"]);
  const isHistorical = stale(fixed.periodEnd, asOf) || stale(debt.periodEnd, asOf);
  const hedge = pilot.interestRateHedgeShare;
  if (hedge && !validShare(hedge.value)) return notComputable(pilot.ticker, ["interest_rate_hedge_share_invalid"]);
  const hedgeAvailable = hedge ? availabilityDate(hedge, asOf) : null;
  const hedgeValue = hedge && hedgeAvailable ? hedge.value! : 0;
  const exposedDebt = debt.value * (1 - fixed.value!) * (1 - hedgeValue);
  const impactType = hedgeAvailable ? "estimate" : "upper_bound";
  const status = isHistorical || (hedge && stale(hedge.periodEnd, asOf)) ? "historical_only" : "computable";
  const details = metricDetails(debt, asOf);
  return {
    ticker: pilot.ticker,
    status,
    reasons: hedgeAvailable ? [] : ["hedge_share_unknown_upper_bound"],
    metrics: [{
      name: impactType === "estimate" ? "interest_estimate" : "interest_upper_bound",
      value: exposedDebt * shock,
      unit: "USD/year",
      impactType,
      formula: "debt × (1 − fixedInterestShare) × (1 − interestRateHedgeShare) × rateShock; assumes immediate full repricing of exposed debt",
      ...details,
    }],
  };
}
function oilMetrics(pilot: PilotEvidence, shock: number, asOf: string): { metrics: ScenarioMetric[]; historical: boolean } {
  const metrics: ScenarioMetric[] = [];
  let historical = false;
  for (const [name, evidence] of [["fuel_cost_gross", pilot.fuelCost], ["oil_revenue_gross", pilot.oilRevenue], ["oil_cost_gross", pilot.oilCost]] as const) {
    if (!evidence || evidence.value === null || !availabilityDate(evidence, asOf)) continue;
    historical ||= stale(evidence.periodEnd, asOf);
    metrics.push({
      name,
      value: evidence.value * shock,
      unit: "USD",
      impactType: "gross_exposure",
      formula: `${name === "fuel_cost_gross" ? "fuelCost" : name === "oil_revenue_gross" ? "oilRevenue" : "oilCost"} × oilShockPct; gross exposure before hedges, basis, pass-through and tax`,
      ...metricDetails(evidence, asOf),
    });
  }
  return { metrics, historical };
}
function oilImpact(pilot: PilotEvidence | undefined, shock: number, asOf: string): CompanyScenarioImpact {
  if (!pilot) return notComputable("UNKNOWN", ["pilot_evidence_missing"]);
  const { metrics, historical } = oilMetrics(pilot, shock, asOf);
  if (!metrics.length) return notComputable(pilot.ticker, ["fuel_cost_and_oil_revenue_cost_missing"]);
  return { ticker: pilot.ticker, status: historical ? "historical_only" : "computable", reasons: ["hedge_and_pass_through_unknown_gross_exposure"], metrics };
}
function usdImpact(pilot: PilotEvidence | undefined, shock: number, asOf: string): CompanyScenarioImpact {
  if (!pilot?.foreignRevenueShare || !validShare(pilot.foreignRevenueShare.value)) return notComputable(pilot?.ticker ?? "UNKNOWN", ["foreign_revenue_share_missing_or_invalid"]);
  const share = pilot.foreignRevenueShare;
  if (!availabilityDate(share, asOf)) return notComputable(pilot.ticker, ["foreign_revenue_share_unavailable_asof"]);
  return {
    ticker: pilot.ticker,
    status: stale(share.periodEnd, asOf) ? "historical_only" : "computable",
    reasons: ["translation_elasticity_only_not_profit_or_hedge_direction"],
    metrics: [{
      name: "usd_translation_elasticity",
      value: -share.value! * shock,
      unit: "ratio",
      impactType: "gross_exposure",
      formula: "−foreignRevenueShare × usdShockPct; translation elasticity only, not earnings or hedge-adjusted impact",
      ...metricDetails(share, asOf),
    }],
  };
}
function scenarioStatus(impacts: CompanyScenarioImpact[], baselineStale: boolean): MacroScenario["status"] {
  if (baselineStale) return "historical_only";
  if (impacts.some((impact) => impact.status === "computable")) return "complete";
  if (impacts.some((impact) => impact.status === "historical_only")) return "partial";
  return "not_computable";
}

export function buildMacroScenarioReport(input: MacroScenarioInput): MacroScenarioReport {
  const exposures = new Map(input.exposures.map((company) => [company.ticker, company]));
  const scenarios = input.definitions.map((definition): MacroScenario => {
    if (!Number.isFinite(definition.shock) || Math.abs(definition.shock) > MAX_SHOCK[definition.channel]) {
      return { channel: definition.channel, shock: definition.shock, shockUnit: UNIT[definition.channel], baseline: null, status: "not_computable", reasons: ["shock_out_of_bounds"], impacts: [] };
    }
    const point = latestMacroPoint(input.macroSeries[SERIES[definition.channel]] ?? [], input.asOf);
    if (!point || point.value === null) {
      return { channel: definition.channel, shock: definition.shock, shockUnit: UNIT[definition.channel], baseline: null, status: "not_computable", reasons: ["fred_baseline_missing"], impacts: input.pilot.map((pilot) => notComputable(pilot.ticker, ["fred_baseline_missing"])) };
    }
    const baselineStale = stale(point.observationPeriod, input.asOf);
    const scenarioValue = definition.channel === "rates" || definition.channel === "credit" ? point.value + definition.shock : point.value * (1 + definition.shock);
    const baseline = { seriesId: point.seriesId, observationPeriod: point.observationPeriod, value: point.value, scenarioValue, unit: point.unit, availableAt: point.availableAt, researchEligibleAt: point.researchEligibleAt, vintageId: point.vintageId, stale: baselineStale };
    const impacts = input.pilot.map((pilot) => {
      if (definition.channel === "rates") return rateImpact(pilot, exposures.get(pilot.ticker), definition.shock, input.asOf);
      if (definition.channel === "oil") return oilImpact(pilot, definition.shock, input.asOf);
      if (definition.channel === "usd") return usdImpact(pilot, definition.shock, input.asOf);
      return notComputable(pilot.ticker, ["new_issuance_spread_maturity_and_rating_missing"]);
    });
    return { channel: definition.channel, shock: definition.shock, shockUnit: UNIT[definition.channel], baseline, status: scenarioStatus(impacts, baselineStale), reasons: [], impacts };
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    asOf: input.asOf,
    policy: { noSectorInference: true, upperBoundWhenHedgeUnknown: true, staleEvidenceIsHistoricalOnly: true, creditRequiresNewIssuanceTerms: true },
    scenarios,
  };
}
