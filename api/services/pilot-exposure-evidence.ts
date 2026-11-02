import { endOfUtcDay, sha256Text } from "../../worker/lib/fred";

interface FactRecord { end: string; filed?: string; form?: string; accn?: string; val?: number; start?: string }
interface ConceptBody { units: Record<string, FactRecord[]> }
export interface EvidenceCompanyFacts { cik: number; facts: Record<string, Record<string, ConceptBody>> }
export interface ExposureEvidence {
  metric: string;
  concept: string | null;
  value: number | null;
  unit: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  availableAt: string | null;
  form: string | null;
  accessionNo: string | null;
  sourceUrl: string | null;
  sourceFactsSha256: string;
  stale: boolean;
  note: string | null;
}
export interface PilotEvidence {
  cik: number;
  ticker: string;
  sourceFactsSha256: string;
  fixedInterestShare: ExposureEvidence | null;
  weightedAverageInterestRate: ExposureEvidence | null;
  interestRateHedgeShare: ExposureEvidence | null;
  effectiveInterestRate: ExposureEvidence | null;
  debtMaturities: ExposureEvidence[];
  fuelCost: ExposureEvidence | null;
  oilRevenue: ExposureEvidence | null;
  oilCost: ExposureEvidence | null;
  foreignRevenueShare: ExposureEvidence | null;
  foreignDerivativeNotional: ExposureEvidence | null;
  missing: string[];
}
export interface PilotEvidenceReport { schemaVersion: 1; generatedAt: string; asOf: string; companies: PilotEvidence[] }

function latestRecord(payload: EvidenceCompanyFacts, concept: string, asOf: string): { record: FactRecord; unit: string } | null {
  const records: { record: FactRecord; unit: string }[] = [];
  for (const taxonomy of Object.values(payload.facts)) {
    const body = taxonomy[concept];
    for (const [unit, facts] of Object.entries(body?.units ?? {})) {
      for (const record of facts) if (record.end <= asOf.slice(0, 10) && (!record.filed || record.filed <= asOf)) records.push({ record, unit });
    }
  }
  records.sort((a, b) => b.record.end.localeCompare(a.record.end) || (b.record.filed ?? "").localeCompare(a.record.filed ?? "") || (b.record.accn ?? "").localeCompare(a.record.accn ?? ""));
  return records[0] ?? null;
}
function evidence(payload: EvidenceCompanyFacts, metric: string, concept: string, asOf: string, sourceFactsSha256: string, note: string | null = null): ExposureEvidence | null {
  const latest = latestRecord(payload, concept, asOf);
  if (!latest) return null;
  const { record, unit } = latest;
  const evidenceDate = record.end || record.filed;
  const ageDays = evidenceDate ? Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(evidenceDate)) / 86_400_000)) : 0;
  return {
    metric,
    concept,
    value: typeof record.val === "number" && Number.isFinite(record.val) ? record.val : null,
    unit,
    periodStart: record.start ?? null,
    periodEnd: record.end,
    availableAt: record.filed ? endOfUtcDay(record.filed) : null,
    form: record.form ?? null,
    accessionNo: record.accn ?? null,
    sourceUrl: record.accn ? `https://www.sec.gov/Archives/edgar/data/${payload.cik}/${record.accn.replace(/-/g, "")}/` : null,
    sourceFactsSha256,
    stale: ageDays > 550,
    note,
  };
}
function allMaturities(payload: EvidenceCompanyFacts, asOf: string, sourceFactsSha256: string): ExposureEvidence[] {
  const concepts = new Set<string>();
  for (const taxonomy of Object.values(payload.facts)) for (const concept of Object.keys(taxonomy)) if (concept.startsWith("LongTermDebtMaturitiesRepaymentsOfPrincipal")) concepts.add(concept);
  return [...concepts].sort().map((concept) => evidence(payload, "debt_maturity", concept, asOf, sourceFactsSha256)).filter((item): item is ExposureEvidence => Boolean(item));
}

export function buildPilotEvidence(payload: EvidenceCompanyFacts, ticker: string, asOf: string): PilotEvidence {
  const sourceFactsSha256 = sha256Text(JSON.stringify(payload));
  const fixedInterestShare = evidence(payload, "fixed_interest_share", "LongTermDebtPercentageBearingFixedInterestRate", asOf, sourceFactsSha256);
  const weightedAverageInterestRate = evidence(payload, "weighted_average_interest_rate", "DebtWeightedAverageInterestRate", asOf, sourceFactsSha256);
  const interestRateHedgeShare = evidence(payload, "interest_rate_hedge_share", "PercentageOfDebtHedgedByInterestRateDerivatives", asOf, sourceFactsSha256);
  const effectiveInterestRate = evidence(payload, "effective_interest_rate", "DebtInstrumentInterestRateEffectivePercentage", asOf, sourceFactsSha256);
  const debtMaturities = allMaturities(payload, asOf, sourceFactsSha256);
  const fuelCost = evidence(payload, "fuel_cost", "FuelCosts", asOf, sourceFactsSha256);
  const oilRevenue = evidence(payload, "oil_revenue", "OilAndGasRevenue", asOf, sourceFactsSha256);
  const oilCost = evidence(payload, "oil_cost", "CostOfPurchasedOilAndGas", asOf, sourceFactsSha256);
  const totalRevenue = latestRecord(payload, "RevenueFromContractWithCustomerExcludingAssessedTax", asOf);
  const domesticRevenue = latestRecord(payload, "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile", asOf);
  const foreignRevenueShare = totalRevenue && domesticRevenue && totalRevenue.unit === domesticRevenue.unit && totalRevenue.record.end === domesticRevenue.record.end && totalRevenue.record.val! > 0
    ? evidence(payload, "foreign_revenue_share", domesticRevenueUnitConcept(), asOf, sourceFactsSha256, "Computed as 1 − domicile revenue / total revenue for the same period")
    : null;
  if (foreignRevenueShare) {
    foreignRevenueShare.value = Math.max(0, 1 - domesticRevenue!.record.val! / totalRevenue!.record.val!);
    foreignRevenueShare.unit = "ratio";
  }
  const foreignDerivativeNotional = evidence(payload, "foreign_derivative_notional", "NotionalAmountOfForeignCurrencyDerivatives", asOf, sourceFactsSha256);
  const missing = [
    ...(!fixedInterestShare && !interestRateHedgeShare ? ["fixed/floating debt share or interest-rate hedge share"] : []),
    ...(!fuelCost && !oilRevenue && !oilCost ? ["direct fuel or oil exposure"] : []),
    ...(!foreignRevenueShare ? ["directly comparable foreign revenue share"] : []),
  ];
  return {
    cik: payload.cik,
    ticker,
    sourceFactsSha256,
    fixedInterestShare,
    weightedAverageInterestRate,
    interestRateHedgeShare,
    effectiveInterestRate,
    debtMaturities,
    fuelCost,
    oilRevenue,
    oilCost,
    foreignRevenueShare,
    foreignDerivativeNotional,
    missing,
  };
}
function domesticRevenueUnitConcept(): string { return "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile"; }

export function buildPilotEvidenceReport(payloads: EvidenceCompanyFacts[], tickers: string[], asOf: string, generatedAt: string): PilotEvidenceReport {
  return { schemaVersion: 1, generatedAt, asOf, companies: payloads.map((payload, index) => buildPilotEvidence(payload, tickers[index], asOf)) };
}
