import { attachMeasuredResponse, latestAnnualExposure, maturityRateImpact, mergeInlineExposure } from "./scenario-rate-atlas";
import type { NormalizedMacroPoint } from "../../worker/lib/fred";
import type { ExposureFiling } from "../../worker/lib/exposure-aggregation";
import type { CompanyExposureRow, ExposureMetric } from "./company-exposure";
import type { ExposureEvidence, PilotEvidence } from "./pilot-exposure-evidence";
import type { AtlasRecord, MeasuredResponse } from "./scenario-rate-atlas";

export type ScenarioChannel = "rates" | "oil" | "usd" | "credit";
export type ScenarioStatus = "computable" | "historical_only" | "not_applicable" | "not_computable";
export interface MacroScenarioDefinition { channel: ScenarioChannel; shock: number }
export interface ScenarioMetric {
  name: "interest_upper_bound" | "interest_estimate" | "fuel_cost_gross" | "oil_revenue_gross" | "oil_cost_gross" | "usd_translation_elasticity" | "credit_refinancing_upper_bound";
  value: number;
  unit: "USD/year" | "USD" | "ratio";
  impactType: "upper_bound" | "estimate" | "gross_exposure";
  formula: string;
  concepts: string[];
  periodStart?: string | null;
  periodEnd: string | null;
  availableAt: string | null;
  stale: boolean;
}
export interface CompanyScenarioImpact {
  ticker: string;
  status: ScenarioStatus;
  reasons: string[];
  metrics: ScenarioMetric[];
  measuredResponse?: MeasuredResponse;
  exposureEvidence?: ExposureFiling[];
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
    frequency: string;
    releasedAt: null;
    availabilityBasis: "fred_realtime_start";
    supersededAt: string | null;
    ingestedAt: string;
    sourceUrl: string;
    sourceHash: string;
    provenance?: NormalizedMacroPoint["provenance"];
    stale: boolean;
  } | null;
  status: "complete" | "partial" | "historical_only" | "not_computable";
  reasons: string[];
  impacts: CompanyScenarioImpact[];
}
export interface MacroScenarioReport {
  schemaVersion: 1;
  dataMode?: "live" | "fixture";
  generatedAt: string;
  asOf: string;
  policy: {
    noSectorInference: true;
    upperBoundWhenHedgeUnknown: true;
    staleEvidenceIsHistoricalOnly: true;
    creditRequiresNewIssuanceTerms: true;
    totalDebtUpperBoundWhenRateShareUnknown: true;
    creditRefinancingUpperBound: true;
    maturityBasedRateShock: true;
    atlasResponsesDescriptive: true;
  };
  scenarios: MacroScenario[];
}
export interface MacroScenarioInput {
  dataMode?: "live" | "fixture";
  asOf: string;
  definitions: MacroScenarioDefinition[];
  macroSeries: Record<string, NormalizedMacroPoint[]>;
  pilot: PilotEvidence[];
  exposures: CompanyExposureRow[];
  exposureHistory?: ExposureFiling[];
  atlasRecords?: AtlasRecord[];
  atlasAsOf?: string;
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
function metricDetails(metric: ExposureMetric | ExposureEvidence, asOf: string): { concepts: string[]; periodStart: string | null; periodEnd: string | null; availableAt: string | null; stale: boolean } {
  const concepts = Array.isArray((metric as ExposureEvidence).concepts)
    ? (metric as ExposureEvidence).concepts!
    : "concept" in metric && metric.concept ? [metric.concept] : "concepts" in metric && Array.isArray(metric.concepts) ? metric.concepts : [];
  const availableAt = "availableAt" in metric ? metric.availableAt : "sourceFiled" in metric ? metric.sourceFiled : null;
  const periodStart = "periodStart" in metric ? metric.periodStart : null;
  return { concepts, periodStart, periodEnd: metric.periodEnd, availableAt, stale: metric.stale === true || stale(metric.periodEnd, asOf) };
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
  const variable = pilot.variableInterestShare ?? null;
  const debt = exposure.debt;
  if (fixed && !validShare(fixed.value)) return notComputable(pilot.ticker, ["fixed_interest_share_missing_or_invalid"]);
  if (variable && !validShare(variable.value)) return notComputable(pilot.ticker, ["variable_interest_share_missing_or_invalid"]);
  if (fixed && !availabilityDate(fixed, asOf)) return notComputable(pilot.ticker, ["fixed_interest_share_unavailable_asof"]);
  if (variable && !availabilityDate(variable, asOf)) return notComputable(pilot.ticker, ["variable_interest_share_unavailable_asof"]);
  if (debt.quality !== "available" || debt.value === null || !Number.isFinite(debt.value) || debt.value < 0) return notComputable(pilot.ticker, ["debt_missing_invalid_or_partial"]);
  if (!availabilityDate(debt, asOf)) return notComputable(pilot.ticker, ["debt_unavailable_asof"]);

  const share = [
    ...(fixed ? [{ kind: "fixed" as const, evidence: fixed }] : []),
    ...(variable ? [{ kind: "variable" as const, evidence: variable }] : []),
  ].sort((a, b) => (b.evidence.periodEnd ?? "").localeCompare(a.evidence.periodEnd ?? "")
    || (b.evidence.availableAt ?? "").localeCompare(a.evidence.availableAt ?? ""))[0] ?? null;
  const hedge = pilot.interestRateHedgeShare;
  if (hedge && !validShare(hedge.value)) return notComputable(pilot.ticker, ["interest_rate_hedge_share_invalid"]);
  const hedgeAvailable = hedge ? availabilityDate(hedge, asOf) : null;
  const hedgeValue = hedge && hedgeAvailable ? hedge.value! : 0;
  const exposedFraction = share?.kind === "fixed" ? 1 - share.evidence.value! : share?.kind === "variable" ? share.evidence.value! : 1;
  const exposedDebt = debt.value * exposedFraction * (1 - hedgeValue);
  // Without a directly reported fixed/floating split, total debt is a valid
  // conservative upper bound, never an estimate of rate-sensitive debt.
  const impactType = share && hedgeAvailable ? "estimate" : "upper_bound";
  const isHistorical = stale(share?.evidence.periodEnd ?? null, asOf)
    || stale(debt.periodEnd, asOf)
    || Boolean(hedge && stale(hedge.periodEnd, asOf));
  const details = metricDetails(debt, asOf);
  const evidenceInputs = [debt, share?.evidence, hedge].filter((item): item is ExposureMetric | ExposureEvidence => Boolean(item));
  details.concepts = [...new Set(evidenceInputs.flatMap((item) => metricDetails(item, asOf).concepts))];
  details.availableAt = evidenceInputs.map((item) => availabilityDate(item, asOf)).filter((item): item is string => Boolean(item)).sort().at(-1) ?? null;
  const reasons = [
    ...(!share ? ["fixed_floating_share_unknown_total_debt_upper_bound"] : []),
    ...(share?.kind === "variable" ? ["variable_interest_share_direct"] : []),
    ...(!hedgeAvailable ? ["hedge_share_unknown_upper_bound"] : []),
  ];
  return {
    ticker: pilot.ticker,
    status: isHistorical ? "historical_only" : "computable",
    reasons,
    metrics: [{
      name: impactType === "estimate" ? "interest_estimate" : "interest_upper_bound",
      value: exposedDebt * shock,
      unit: "USD/year",
      impactType,
      formula: share?.kind === "fixed"
        ? "debt × (1 − fixedInterestShare) × (1 − interestRateHedgeShare) × rateShock; assumes immediate full repricing of exposed debt"
        : share?.kind === "variable"
          ? "debt × variableInterestShare × (1 − interestRateHedgeShare) × rateShock; assumes immediate full repricing of exposed debt"
          : `debt${hedgeAvailable ? " × (1 − interestRateHedgeShare)" : ""} × rateShock; total-debt upper bound because the fixed/floating split is unknown, assumes immediate full repricing and is not an interest forecast`,
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

const NEXT_TWELVE_MONTH_MATURITY_CONCEPTS = new Set([
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextRollingTwelveMonths",
]);

function creditImpact(pilot: PilotEvidence | undefined, shock: number, asOf: string): CompanyScenarioImpact {
  if (!pilot) return notComputable("UNKNOWN", ["pilot_evidence_missing"]);
  const maturity = pilot.debtMaturities
    .filter((item) => item.concept && NEXT_TWELVE_MONTH_MATURITY_CONCEPTS.has(item.concept))
    .sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? "") || (b.availableAt ?? "").localeCompare(a.availableAt ?? ""))[0] ?? null;
  if (!maturity) return notComputable(pilot.ticker, ["next_twelve_month_debt_maturities_missing", "new_issuance_spread_maturity_and_rating_missing"]);
  if (maturity.value === null || !Number.isFinite(maturity.value) || maturity.value < 0 || maturity.unit !== "USD") {
    return notComputable(pilot.ticker, ["next_twelve_month_debt_maturities_invalid"]);
  }
  if (!availabilityDate(maturity, asOf)) return notComputable(pilot.ticker, ["next_twelve_month_debt_maturities_unavailable_asof"]);
  return {
    ticker: pilot.ticker,
    status: stale(maturity.periodEnd, asOf) ? "historical_only" : "computable",
    reasons: ["full_refinancing_and_spread_pass_through_upper_bound", "new_issuance_estimate_not_evaluated"],
    metrics: [{
      name: "credit_refinancing_upper_bound",
      value: maturity.value * shock,
      unit: "USD/year",
      impactType: "upper_bound",
      formula: "nextTwelveMonthDebtMaturities × creditSpreadShock; assumes all scheduled debt is refinanced immediately with full spread pass-through; not a new-issuance or earnings forecast",
      ...metricDetails(maturity, asOf),
    }],
  };
}

// "complete" means every company computes a current bound/estimate; "partial" means only a subset does.
// A stale FRED baseline moves the whole scenario to historical-only context.
function scenarioStatus(impacts: CompanyScenarioImpact[], baselineStale: boolean): MacroScenario["status"] {
  if (baselineStale) return "historical_only";
  const computable = impacts.filter((impact) => impact.status === "computable").length;
  const historical = impacts.filter((impact) => impact.status === "historical_only").length;
  if (computable === impacts.length && impacts.length > 0) return "complete";
  if (computable > 0) return "partial";
  if (historical > 0) return "historical_only";
  return "not_computable";
}
function shiftedRateBaseline(point: NormalizedMacroPoint, shock: number): number | null {
  const unit = point.unit.trim().toLowerCase();
  if (unit === "percent" || unit === "%") return point.value! + shock * 100;
  if (unit === "decimal" || unit === "ratio") return point.value! + shock;
  return null;
}

export function buildMacroScenarioReport(input: MacroScenarioInput): MacroScenarioReport {
  const exposures = new Map(input.exposures.map((company) => [company.ticker, company]));
  const historyByTicker = new Map<string, ExposureFiling[]>();
  for (const filing of input.exposureHistory ?? []) historyByTicker.set(filing.ticker, [...(historyByTicker.get(filing.ticker) ?? []), filing]);
  const scenarios = input.definitions.map((definition): MacroScenario => {
    if (!Number.isFinite(definition.shock) || Math.abs(definition.shock) > MAX_SHOCK[definition.channel]) {
      return { channel: definition.channel, shock: definition.shock, shockUnit: UNIT[definition.channel], baseline: null, status: "not_computable", reasons: ["shock_out_of_bounds"], impacts: [] };
    }
    const point = latestMacroPoint(input.macroSeries[SERIES[definition.channel]] ?? [], input.asOf);
    if (!point || point.value === null) {
      return { channel: definition.channel, shock: definition.shock, shockUnit: UNIT[definition.channel], baseline: null, status: "not_computable", reasons: ["fred_baseline_missing"], impacts: input.pilot.map((pilot) => notComputable(pilot.ticker, ["fred_baseline_missing"])) };
    }
    const baselineStale = stale(point.observationPeriod, input.asOf);
    const scenarioValue = definition.channel === "rates" || definition.channel === "credit" ? shiftedRateBaseline(point, definition.shock) : point.value * (1 + definition.shock);
    if (scenarioValue === null) {
      return { channel: definition.channel, shock: definition.shock, shockUnit: UNIT[definition.channel], baseline: null, status: "not_computable", reasons: ["unsupported_baseline_unit"], impacts: input.pilot.map((pilot) => notComputable(pilot.ticker, ["unsupported_baseline_unit"])) };
    }
    const baseline = {
      seriesId: point.seriesId,
      observationPeriod: point.observationPeriod,
      value: point.value,
      scenarioValue,
      unit: point.unit,
      availableAt: point.availableAt,
      researchEligibleAt: point.researchEligibleAt,
      vintageId: point.vintageId,
      frequency: point.frequency,
      releasedAt: null,
      availabilityBasis: point.availabilityBasis,
      supersededAt: point.supersededAt,
      ingestedAt: point.ingestedAt,
      sourceUrl: point.sourceUrl,
      sourceHash: point.sourceHash,
      ...(point.provenance ? { provenance: point.provenance } : {}),
      stale: baselineStale,
    };
    const atlasRecords = input.atlasAsOf && input.atlasAsOf > input.asOf ? undefined : input.atlasRecords;
    const impacts = input.pilot.map((pilot) => {
      const exposure = exposures.get(pilot.ticker);
      const history = historyByTicker.get(pilot.ticker);
      let impact: CompanyScenarioImpact;
      if (definition.channel === "rates") {
        const legacy = rateImpact(pilot, exposure, definition.shock, input.asOf);
        const annual = latestAnnualExposure(history, input.asOf);
        const current = exposure?.sector === "Financials" || annual ? maturityRateImpact(exposure, annual ?? undefined, definition.shock, input.asOf) : legacy;
        impact = current.status === "not_computable" && legacy.status !== "not_computable"
          ? { ...legacy, reasons: [...legacy.reasons, "latest_10k_maturity_unavailable_legacy_evidence_retained"] }
          : current;
      } else {
        const legacy = definition.channel === "oil" ? oilImpact(pilot, definition.shock, input.asOf) : definition.channel === "usd" ? usdImpact(pilot, definition.shock, input.asOf) : creditImpact(pilot, definition.shock, input.asOf);
        impact = mergeInlineExposure(legacy, definition.channel, history, definition.shock, input.asOf);
      }
      return attachMeasuredResponse(impact, definition.channel, atlasRecords, input.asOf);
    });
    return { channel: definition.channel, shock: definition.shock, shockUnit: UNIT[definition.channel], baseline, status: scenarioStatus(impacts, baselineStale), reasons: [], impacts };
  });
  return {
    schemaVersion: 1,
    ...(input.dataMode ? { dataMode: input.dataMode } : {}),
    generatedAt: new Date().toISOString(),
    asOf: input.asOf,
    policy: {
      noSectorInference: true,
      upperBoundWhenHedgeUnknown: true,
      staleEvidenceIsHistoricalOnly: true,
      creditRequiresNewIssuanceTerms: true,
      totalDebtUpperBoundWhenRateShareUnknown: true,
      creditRefinancingUpperBound: true,
      maturityBasedRateShock: true,
      atlasResponsesDescriptive: true,
    },
    scenarios,
  };
}
