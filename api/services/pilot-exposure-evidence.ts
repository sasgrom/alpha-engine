import { endOfUtcDay, sha256Text } from "../../worker/lib/fred";

interface FactRecord { end: string; filed?: string; form?: string; accn?: string; val?: number; start?: string }
interface ConceptBody { units: Record<string, FactRecord[]> }
interface LocatedFact { record: FactRecord; unit: string }

export interface EvidenceCompanyFacts { cik: number; facts: Record<string, Record<string, ConceptBody>> }
export interface ExposureEvidence {
  metric: string;
  concept: string | null;
  /** Includes both inputs when the evidence is a derived ratio. */
  concepts?: string[];
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
  variableInterestShare?: ExposureEvidence | null;
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
export interface PilotEvidenceReport {
  schemaVersion: 1;
  generatedAt: string;
  asOf: string;
  source?: "database" | "sec_companyfacts";
  policy?: {
    noSectorInference: true;
    factsScope: "scenario_exposure_concepts";
    sourceHashBasis: "filtered_builder_input_not_raw_edgar_pack";
  };
  companies: PilotEvidence[];
}

export const DOMICILE_REVENUE_CONCEPT = "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile";
export const FOREIGN_REVENUE_CONCEPT = "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToForeignCountries";
export const TOTAL_REVENUE_CONCEPTS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"] as const;
export const EXPOSURE_MATURITY_PREFIX = "LongTermDebtMaturitiesRepaymentsOfPrincipal";
export const EXPOSURE_CONCEPTS = [
  "LongTermDebtPercentageBearingFixedInterestRate",
  "LongTermDebtPercentageBearingVariableInterestRate",
  "DebtWeightedAverageInterestRate",
  "LongtermDebtWeightedAverageInterestRate",
  "PercentageOfDebtHedgedByInterestRateDerivatives",
  "DebtInstrumentInterestRateEffectivePercentage",
  "FuelCosts",
  "OilAndGasRevenue",
  "CostOfPurchasedOilAndGas",
  "NotionalAmountOfForeignCurrencyDerivatives",
  DOMICILE_REVENUE_CONCEPT,
  FOREIGN_REVENUE_CONCEPT,
  ...TOTAL_REVENUE_CONCEPTS,
] as const;

function allRecords(payload: EvidenceCompanyFacts, concept: string, asOf: string): LocatedFact[] {
  const records: LocatedFact[] = [];
  for (const taxonomy of Object.values(payload.facts)) {
    const body = taxonomy[concept];
    for (const [unit, facts] of Object.entries(body?.units ?? {})) {
      for (const record of facts) {
        if (record.end <= asOf.slice(0, 10) && (!record.filed || record.filed <= asOf)) records.push({ record, unit });
      }
    }
  }
  return records.sort((a, b) => b.record.end.localeCompare(a.record.end)
    || (b.record.filed ?? "").localeCompare(a.record.filed ?? "")
    || (b.record.accn ?? "").localeCompare(a.record.accn ?? ""));
}

function latestRecord(payload: EvidenceCompanyFacts, concept: string, asOf: string): LocatedFact | null {
  return allRecords(payload, concept, asOf)[0] ?? null;
}

function toEvidence(
  payload: EvidenceCompanyFacts,
  metric: string,
  concept: string,
  latest: LocatedFact,
  asOf: string,
  sourceFactsSha256: string,
  note: string | null = null,
): ExposureEvidence {
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

function evidence(payload: EvidenceCompanyFacts, metric: string, concept: string, asOf: string, sourceFactsSha256: string, note: string | null = null): ExposureEvidence | null {
  const latest = latestRecord(payload, concept, asOf);
  return latest ? toEvidence(payload, metric, concept, latest, asOf, sourceFactsSha256, note) : null;
}

function latestEvidence(payload: EvidenceCompanyFacts, metric: string, concepts: readonly string[], asOf: string, sourceFactsSha256: string): ExposureEvidence | null {
  return concepts
    .map((concept) => evidence(payload, metric, concept, asOf, sourceFactsSha256))
    .filter((item): item is ExposureEvidence => Boolean(item))
    .sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? "")
      || (b.availableAt ?? "").localeCompare(a.availableAt ?? "")
      || (b.accessionNo ?? "").localeCompare(a.accessionNo ?? ""))[0] ?? null;
}

function allMaturities(payload: EvidenceCompanyFacts, asOf: string, sourceFactsSha256: string): ExposureEvidence[] {
  const concepts = new Set<string>();
  for (const taxonomy of Object.values(payload.facts)) {
    for (const concept of Object.keys(taxonomy)) if (concept.startsWith(EXPOSURE_MATURITY_PREFIX)) concepts.add(concept);
  }
  return [...concepts].sort()
    .map((concept) => evidence(payload, "debt_maturity", concept, asOf, sourceFactsSha256))
    .filter((item): item is ExposureEvidence => Boolean(item));
}

function buildForeignRevenueShare(payload: EvidenceCompanyFacts, asOf: string, sourceFactsSha256: string): ExposureEvidence | null {
  const candidates: { value: number; foreignConcept: string; totalConcept: string; foreign: LocatedFact; total: LocatedFact }[] = [];
  for (const foreignConcept of [DOMICILE_REVENUE_CONCEPT, FOREIGN_REVENUE_CONCEPT]) {
    for (const foreign of allRecords(payload, foreignConcept, asOf)) {
      if (foreign.record.val === undefined || !Number.isFinite(foreign.record.val) || foreign.record.val < 0 || !foreign.record.filed || !foreign.record.accn) continue;
      for (const totalConcept of TOTAL_REVENUE_CONCEPTS) {
        for (const total of allRecords(payload, totalConcept, asOf)) {
          if (total.record.val === undefined || !Number.isFinite(total.record.val) || total.record.val <= 0 || !total.record.filed) continue;
          // Never combine annual/YTD/quarterly values or different filings merely
          // because their period-end dates happen to match.
          if (foreign.unit !== total.unit
            || foreign.record.end !== total.record.end
            || (foreign.record.start ?? null) !== (total.record.start ?? null)
            || foreign.record.accn !== total.record.accn) continue;
          const rawShare = foreignConcept === DOMICILE_REVENUE_CONCEPT
            ? 1 - foreign.record.val / total.record.val
            : foreign.record.val / total.record.val;
          if (rawShare < -1e-9 || rawShare > 1 + 1e-9) continue;
          candidates.push({ value: Math.max(0, Math.min(1, rawShare)), foreignConcept, totalConcept, foreign, total });
        }
      }
    }
  }
  candidates.sort((a, b) => b.foreign.record.end.localeCompare(a.foreign.record.end)
    || (b.foreign.record.filed ?? "").localeCompare(a.foreign.record.filed ?? "")
    || (b.foreign.record.accn ?? "").localeCompare(a.foreign.record.accn ?? ""));
  const selected = candidates[0];
  if (!selected) return null;
  const result = toEvidence(
    payload,
    "foreign_revenue_share",
    selected.foreignConcept,
    selected.foreign,
    asOf,
    sourceFactsSha256,
    selected.foreignConcept === DOMICILE_REVENUE_CONCEPT
      ? "Computed as 1 − domicile revenue / total revenue for the same accession, period and unit"
      : "Computed as directly reported foreign revenue / total revenue for the same accession, period and unit",
  );
  result.concepts = [selected.foreignConcept, selected.totalConcept];
  result.value = selected.value;
  result.unit = "ratio";
  result.availableAt = endOfUtcDay([selected.foreign.record.filed!, selected.total.record.filed!].sort().at(-1)!);
  return result;
}

export function buildPilotEvidence(payload: EvidenceCompanyFacts, ticker: string, asOf: string): PilotEvidence {
  const sourceFactsSha256 = sha256Text(JSON.stringify(payload));
  const fixedInterestShare = evidence(payload, "fixed_interest_share", "LongTermDebtPercentageBearingFixedInterestRate", asOf, sourceFactsSha256);
  const variableInterestShare = evidence(payload, "variable_interest_share", "LongTermDebtPercentageBearingVariableInterestRate", asOf, sourceFactsSha256);
  const weightedAverageInterestRate = latestEvidence(payload, "weighted_average_interest_rate", ["DebtWeightedAverageInterestRate", "LongtermDebtWeightedAverageInterestRate"], asOf, sourceFactsSha256);
  const interestRateHedgeShare = evidence(payload, "interest_rate_hedge_share", "PercentageOfDebtHedgedByInterestRateDerivatives", asOf, sourceFactsSha256);
  const effectiveInterestRate = evidence(payload, "effective_interest_rate", "DebtInstrumentInterestRateEffectivePercentage", asOf, sourceFactsSha256);
  const debtMaturities = allMaturities(payload, asOf, sourceFactsSha256);
  const fuelCost = evidence(payload, "fuel_cost", "FuelCosts", asOf, sourceFactsSha256);
  const oilRevenue = evidence(payload, "oil_revenue", "OilAndGasRevenue", asOf, sourceFactsSha256);
  const oilCost = evidence(payload, "oil_cost", "CostOfPurchasedOilAndGas", asOf, sourceFactsSha256);
  const foreignRevenueShare = buildForeignRevenueShare(payload, asOf, sourceFactsSha256);
  const foreignDerivativeNotional = evidence(payload, "foreign_derivative_notional", "NotionalAmountOfForeignCurrencyDerivatives", asOf, sourceFactsSha256);
  const missing = [
    ...(!fixedInterestShare && !variableInterestShare && !interestRateHedgeShare ? ["fixed/floating debt share or interest-rate hedge share"] : []),
    ...(!debtMaturities.length ? ["debt maturity schedule"] : []),
    ...(!fuelCost && !oilRevenue && !oilCost ? ["direct fuel or oil exposure"] : []),
    ...(!foreignRevenueShare ? ["directly comparable foreign revenue share"] : []),
  ];
  return {
    cik: payload.cik,
    ticker,
    sourceFactsSha256,
    fixedInterestShare,
    variableInterestShare,
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

export function buildPilotEvidenceReport(payloads: EvidenceCompanyFacts[], tickers: string[], asOf: string, generatedAt: string): PilotEvidenceReport {
  if (payloads.length !== tickers.length) throw new Error("Evidence payload/ticker count mismatch");
  return {
    schemaVersion: 1,
    generatedAt,
    asOf,
    policy: {
      noSectorInference: true,
      factsScope: "scenario_exposure_concepts",
      sourceHashBasis: "filtered_builder_input_not_raw_edgar_pack",
    },
    companies: payloads.map((payload, index) => buildPilotEvidence(payload, tickers[index], asOf)),
  };
}
