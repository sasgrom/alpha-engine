import type { CompanyExposureRow } from "./company-exposure";
import type { CompanyScenarioImpact, ScenarioChannel, ScenarioMetric } from "./macro-scenarios";
import type { ExposureFiling, ExposureMeasure, ExposureMeasureKind } from "../../worker/lib/exposure-aggregation";

export interface AtlasRecord {
  ticker: string;
  channel: ScenarioChannel;
  exposureKind: string;
  horizon: string;
  shock: number;
  exposure: number;
  abnormalReturn: number;
  exposureSourceFiled?: string | null;
}
export interface MeasuredResponse {
  status: "available" | "unavailable";
  median?: number;
  interval?: [number, number];
  intervalBasis?: "empirical_p05_p95_not_confidence_interval";
  count?: number;
  horizons?: string[];
  exposureKinds?: string[];
  disagreement?: "aligned" | "sign_disagreement" | "market_unresponsive";
  reason?: string;
  note?: string;
}

function missing(ticker: string, reasons: string[]): CompanyScenarioImpact {
  return { ticker, status: "not_computable", reasons, metrics: [] };
}
function measureOf(filing: ExposureFiling, kind: ExposureMeasureKind): ExposureMeasure | null {
  return filing.measures.find(measure => measure.kind === kind) ?? null;
}
function available(measure: ExposureMeasure, asOf: string): boolean {
  return measure.availableAt.length === 10 ? measure.availableAt <= asOf.slice(0, 10) : measure.availableAt <= asOf;
}
function isStale(periodEnd: string | null, asOf: string): boolean {
  return periodEnd ? (Date.parse(asOf) - Date.parse(`${periodEnd}T00:00:00Z`)) / 86_400_000 > 550 : false;
}
function eligibleFilings(history: ExposureFiling[], asOf: string): ExposureFiling[] {
  return history.filter(filing => filing.filingDate <= asOf.slice(0, 10)).sort((a, b) => a.filingDate.localeCompare(b.filingDate) || a.accessionNo.localeCompare(b.accessionNo));
}
export function latestAnnualExposure(history: ExposureFiling[] | undefined, asOf: string): ExposureFiling | null {
  const byAccession = new Map<string, ExposureFiling>();
  for (const filing of eligibleFilings((history ?? []).filter(item => item.form === "10-K"), asOf)) {
    const prior = byAccession.get(filing.accessionNo);
    if (!prior) {
      byAccession.set(filing.accessionNo, filing);
      continue;
    }
    const measures = [...prior.measures];
    for (const measure of filing.measures) if (!measures.some(item => item.kind === measure.kind)) measures.push(measure);
    byAccession.set(filing.accessionNo, { ...prior, measures, missing: [...new Set([...prior.missing, ...filing.missing])] });
  }
  return [...byAccession.values()].sort((a, b) => a.filingDate.localeCompare(b.filingDate) || a.accessionNo.localeCompare(b.accessionNo)).at(-1) ?? null;
}
function latestWithMeasures(history: ExposureFiling[], kinds: ExposureMeasureKind[], asOf: string): ExposureFiling | null {
  return eligibleFilings(history, asOf).filter(filing => filing.measures.some(measure => kinds.includes(measure.kind) && available(measure, asOf))).at(-1) ?? null;
}
function metricFromMeasure(measure: ExposureMeasure, name: ScenarioMetric["name"], shock: number, asOf: string): ScenarioMetric | null {
  if (!available(measure, asOf) || !Number.isFinite(measure.value) || measure.value < 0) return null;
  if (name === "usd_translation_elasticity" && measure.value > 1) return null;
  return {
    name,
    value: name === "usd_translation_elasticity" ? -measure.value * shock : measure.value * shock,
    unit: name === "credit_refinancing_upper_bound" ? "USD/year" : measure.unit === "ratio" ? "ratio" : "USD",
    impactType: name === "credit_refinancing_upper_bound" ? "upper_bound" : "gross_exposure",
    formula: name === "usd_translation_elasticity"
      ? "−foreignRevenueShare × usdShockPct; dimensional inline-XBRL segment evidence; translation elasticity only"
      : `${name === "fuel_cost_gross" ? "fuelCost" : name === "oil_revenue_gross" ? "oilAndGasRevenue" : name === "oil_cost_gross" ? "oilCost" : "debtMaturingNext12"} × ${name === "credit_refinancing_upper_bound" ? "creditSpreadShock" : "oilShockPct"}; inline-XBRL evidence, before hedges, basis, pass-through and tax${name === "credit_refinancing_upper_bound" ? `; ${measure.note ?? "direct maturity evidence"}` : ""}`,
    concepts: [...new Set(measure.facts.map(fact => fact.concept))],
    periodStart: measure.periodStart,
    periodEnd: measure.periodEnd,
    availableAt: measure.availableAt,
    stale: isStale(measure.periodEnd, asOf),
  };
}
function metric(name: ScenarioMetric["name"], value: number, unit: ScenarioMetric["unit"], formula: string, evidence: ExposureMeasure[], periodStart: string | null, asOf: string): ScenarioMetric {
  return { name, value, unit, impactType: "upper_bound", formula, concepts: [...new Set(evidence.flatMap(measure => measure.facts.map(fact => fact.concept)))], periodStart, periodEnd: evidence.map(measure => measure.periodEnd).sort().at(-1) ?? null, availableAt: evidence.map(measure => measure.availableAt).sort().at(-1) ?? null, stale: evidence.some(measure => isStale(measure.periodEnd, asOf)) };
}

export function maturityRateImpact(exposure: CompanyExposureRow | undefined, history: ExposureFiling | undefined, shock: number, asOf: string): CompanyScenarioImpact {
  if (!exposure) return missing("UNKNOWN", ["pilot_or_exposure_evidence_missing"]);
  if (exposure.sector === "Financials") return { ticker: exposure.ticker, status: "not_applicable", reasons: ["rate_exposure_works_through_interest_margin"], metrics: [] };
  if (!history) return missing(exposure.ticker, ["latest_10k_unavailable_asof"]);
  const next = measureOf(history, "debtMaturingNext12");
  const second = measureOf(history, "debtMaturingYearTwo");
  const floating = measureOf(history, "floatingRateDebt");
  const floatingShare = measureOf(history, "floatingRateShare");
  const cash = measureOf(history, "cashShortTerm");
  const operating = measureOf(history, "operatingIncome");
  const required = [next, cash].filter((item): item is ExposureMeasure => item !== null);
  if (!next || !cash || required.some(measure => !available(measure, asOf)) || next.value < 0 || cash.value < 0) return missing(exposure.ticker, ["maturity_or_cash_missing_invalid_or_unavailable_asof", "latest_10k_maturity_table_incomplete"]);
  const optional = [second, floating, floatingShare, operating].filter((item): item is ExposureMeasure => item !== null && available(item, asOf));
  const secondValue = second && available(second, asOf) && second.value >= 0 ? second.value : 0;
  const floatingValue = floating && available(floating, asOf) && floating.value >= 0 ? floating.value : 0;
  const rawShare = floatingShare && available(floatingShare, asOf) ? floatingShare.value : null;
  const normalizedShare = rawShare !== null && rawShare >= 0 && rawShare <= 100 ? rawShare <= 1 ? rawShare : rawShare / 100 : null;
  const sharedDebt = normalizedShare !== null && exposure.debt.value !== null && exposure.debt.unit === "USD" && exposure.debt.value >= 0 && exposure.debt.quality === "available" ? exposure.debt.value * normalizedShare : 0;
  const exposedDebt = next.value + secondValue + floatingValue + sharedDebt;
  const evidence = [next, ...optional];
  const net = (exposedDebt - cash.value) * shock;
  const nextLabel = next.note?.startsWith("Current-debt aggregate") ? "currentDebtAggregate" : "nextTwelveMonthMaturities";
  const components = [`${nextLabel} ${next.value}`, ...(secondValue || second ? [`yearTwoMaturities ${secondValue}`] : []), ...(floatingValue || sharedDebt ? [`floatingRateDebt ${floatingValue + sharedDebt}`] : []), `cashAndShortTermInvestments ${cash.value}`];
  const formula = `(${components.join(" + ").replace(` + cashAndShortTermInvestments ${cash.value}`, ` − cashAndShortTermInvestments ${cash.value}`)}) × rateShock ${shock}; scheduled repricing plus directly tagged floating debt; assumes cash earns the same shock`;
  const metrics = [metric("interest_upper_bound", net, "USD/year", formula, evidence, operating?.periodStart ?? null, asOf)];
  const reasons = ["latest_10k_maturity_schedule", "cash_interest_offset_included", ...(nextLabel === "currentDebtAggregate" ? ["current_debt_aggregate_fallback"] : [])];
  if (!second) reasons.push("year_two_maturities_not_tagged");
  if (!floatingValue && !sharedDebt) reasons.push("floating_rate_share_unavailable_maturity_upper_bound");
  if (sharedDebt) reasons.push("floating_rate_share_applied_to_company_exposure_debt");
  if (floatingValue || sharedDebt) reasons.push("floating_rate_maturity_overlap_not_adjusted");
  if (operating && available(operating, asOf) && operating.value > 0) metrics.push(metric("interest_upper_bound", net / operating.value, "ratio", `${formula}; divided by operatingIncome ${operating.value}`, evidence, operating.periodStart, asOf));
  else reasons.push("positive_operating_income_unavailable_ratio_not_computable");
  return { ticker: exposure.ticker, status: metrics.some(item => item.stale) ? "historical_only" : "computable", reasons, metrics, exposureEvidence: [{ ...history, measures: evidence }] };
}

export function mergeInlineExposure(base: CompanyScenarioImpact, channel: Exclude<ScenarioChannel, "rates">, history: ExposureFiling[] | undefined, shock: number, asOf: string): CompanyScenarioImpact {
  const kinds: ExposureMeasureKind[] = channel === "usd" ? ["foreignRevenueShare"] : channel === "credit" ? ["debtMaturingNext12"] : ["fuelCost", "oilAndGasRevenue", "oilCost"];
  const replacements = new Map<ScenarioMetric["name"], ScenarioMetric>();
  const evidence = new Map<string, ExposureFiling>();
  for (const kind of kinds) {
    const filing = latestWithMeasures(history ?? [], [kind], asOf);
    const measure = filing && measureOf(filing, kind);
    if (!filing || !measure) continue;
    const name = kind === "foreignRevenueShare" ? "usd_translation_elasticity" : kind === "debtMaturingNext12" ? "credit_refinancing_upper_bound" : kind === "fuelCost" ? "fuel_cost_gross" : kind === "oilAndGasRevenue" ? "oil_revenue_gross" : "oil_cost_gross";
    const metric = metricFromMeasure(measure, name, shock, asOf);
    if (!metric) continue;
    replacements.set(name, metric);
    const key = `${filing.ticker}|${filing.accessionNo}`;
    const prior = evidence.get(key);
    evidence.set(key, prior ? { ...prior, measures: [...prior.measures, measure] } : { ...filing, measures: [measure] });
  }
  if (!replacements.size) return base;
  const omittedStale = base.metrics.some(metric => metric.stale && !replacements.has(metric.name));
  const metrics = [...base.metrics.filter(metric => !replacements.has(metric.name) && !metric.stale), ...replacements.values()];
  return { ...base, status: metrics.some(metric => metric.stale) ? "historical_only" : "computable", reasons: [...new Set([...base.reasons, "inline_xbrl_dimensional_evidence", ...(omittedStale ? ["stale_legacy_metrics_omitted_after_inline_update"] : [])])], metrics, exposureEvidence: [...(base.exposureEvidence ?? []), ...evidence.values()] };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function atlasKind(impact: CompanyScenarioImpact, channel: ScenarioChannel): string {
  if (channel === "rates" || channel === "credit") return "debt_burden";
  if (channel === "usd") return "foreign_revenue";
  return impact.metrics.some(metric => metric.name === "oil_revenue_gross") ? "oil_revenue" : impact.metrics.some(metric => metric.name === "oil_cost_gross") ? "oil_cost" : "fuel_cost";
}
function expectedSign(impact: CompanyScenarioImpact, channel: ScenarioChannel): -1 | 1 | null {
  if (impact.status === "not_applicable" || impact.status === "not_computable" || !impact.metrics.length) return null;
  if (channel === "oil" && impact.metrics.some(metric => metric.name === "oil_revenue_gross") && !impact.metrics.some(metric => metric.name === "fuel_cost_gross" || metric.name === "oil_cost_gross")) return 1;
  return -1;
}

export function attachMeasuredResponse(impact: CompanyScenarioImpact, channel: ScenarioChannel, records: AtlasRecord[] | undefined, asOf?: string): CompanyScenarioImpact {
  if (!records) return { ...impact, measuredResponse: { status: "unavailable", reason: "atlas_not_provided" } };
  const kind = atlasKind(impact, channel);
  const eligible = records.filter(record => record.ticker === impact.ticker && record.channel === channel && record.exposureKind === kind && Number.isFinite(record.exposure) && record.exposure !== 0 && Number.isFinite(record.shock) && record.shock !== 0 && Number.isFinite(record.abnormalReturn) && (!asOf || !record.exposureSourceFiled || record.exposureSourceFiled <= asOf));
  if (!eligible.length) return { ...impact, measuredResponse: { status: "unavailable", reason: "atlas_company_not_covered", exposureKinds: [kind] } };
  const values = eligible.map(record => record.abnormalReturn / record.shock);
  const medianValue = median(values);
  const expected = expectedSign(impact, channel);
  const disagreement = expected === null ? undefined : Math.abs(medianValue) < 0.01 ? "market_unresponsive" : expected === -1 && medianValue > 0 || expected === 1 && medianValue < 0 ? "sign_disagreement" : "aligned";
  return {
    ...impact,
    measuredResponse: {
      status: "available",
      median: medianValue,
      interval: [percentile(values, 0.05), percentile(values, 0.95)],
      intervalBasis: "empirical_p05_p95_not_confidence_interval",
      count: values.length,
      horizons: [...new Set(eligible.map(record => record.horizon))].sort((a, b) => Number(a) - Number(b)),
      exposureKinds: [kind],
      ...(disagreement ? { disagreement } : {}),
      note: "Median abnormal return divided by the observed macro shock; empirical event/horizon distribution, not a confidence interval or forecast. Atlas exposure is a debt burden or direct cost/revenue measure, not the maturity-based filing impact. |median| < 0.01 is labeled market_unresponsive.",
    },
  };
}
