import type { FundamentalSeriesRow } from "./fundamental-integrity";
import { sha256Text } from "../../worker/lib/fred";

export interface ExposureMetric {
  value: number | null;
  unit: string | null;
  concepts: string[];
  periodEnd: string | null;
  sourceFiled: string | null;
  quality: "available" | "partial" | "missing";
  note: string | null;
  evidenceAgeDays?: number | null;
  stale?: boolean;
}
export interface CompanyExposureInput {
  cik: number;
  ticker: string;
  name: string;
  sector: string | null;
  rows: FundamentalSeriesRow[];
}
export interface CompanyExposureRow {
  cik: number;
  ticker: string;
  name: string;
  sector: string | null;
  debt: ExposureMetric;
  debtToOperatingIncome: ExposureMetric;
  interestCoverage: ExposureMetric;
  cashToDebt: ExposureMetric;
  fuelCostToOperatingIncome: ExposureMetric;
  oilRevenue: ExposureMetric;
  oilCost: ExposureMetric;
  oilRevenueToOperatingIncome?: ExposureMetric;
  oilCostToOperatingIncome?: ExposureMetric;
  foreignRevenueShare: ExposureMetric;
  foreignDerivativeNotional: ExposureMetric;
  missing: string[];
}
export interface CompanyExposureReport {
  schemaVersion: 1;
  generatedAt: string;
  asOf: string;
  universeSha256: string;
  policy: {
    noSectorInference: true;
    noDirectionScore: true;
    missingFields: "floating rate share, debt maturity schedule, hedges and foreign revenue share are null unless directly supported";
  };
  coverage: {
    companies: number;
    debt: number;
    interestCoverage: number;
    fuelCost: number;
    oilRevenue: number;
    oilCost: number;
    foreignRevenueShare: number;
  };
  companies: CompanyExposureRow[];
}

const missing = (note: string): ExposureMetric => ({ value: null, unit: null, concepts: [], periodEnd: null, sourceFiled: null, quality: "missing", note });
const available = (value: number, unit: string, concepts: string[], periodEnd: string, sourceFiled: string, quality: ExposureMetric["quality"] = "available", note: string | null = null): ExposureMetric => ({ value, unit, concepts, periodEnd, sourceFiled, quality, note });
const metricUnit = (unit: string | null) => unit ?? "unknown";

// A derived metric cannot predate any required input; unknown availability fails closed.
function maxAvailability(inputs: Pick<ExposureMetric, "sourceFiled">[]): string | null {
  let latest: string | null = null;
  for (const input of inputs) {
    if (!input.sourceFiled) return null;
    if (!latest || input.sourceFiled > latest) latest = input.sourceFiled;
  }
  return latest;
}

function latestByConcept(rows: FundamentalSeriesRow[], concept: string, asOf: string): FundamentalSeriesRow[] {
  const eligible = rows.filter((row) => row.concept === concept && row.vintage === "latest" && row.val !== null && Number.isFinite(row.val) && row.periodEnd <= asOf.slice(0, 10) && row.sourceFiled && row.sourceFiled <= asOf);
  const byPeriod = new Map<string, FundamentalSeriesRow>();
  for (const row of eligible) {
    const prior = byPeriod.get(row.periodEnd);
    if (!prior || row.sourceFiled! > prior.sourceFiled! || (row.sourceFiled === prior.sourceFiled && row.id > prior.id)) byPeriod.set(row.periodEnd, row);
  }
  return [...byPeriod.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}
function quarterIndex(periodEnd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return null;
  return Number(periodEnd.slice(0, 4)) * 4 + Math.ceil(Number(periodEnd.slice(5, 7)) / 3) - 1;
}
// TTM uses four latest points, but gaps must remain visible as partial evidence
// rather than being presented as a complete contiguous window.
function flowMetric(rows: FundamentalSeriesRow[], concepts: string[], asOf: string): ExposureMetric {
  for (const concept of concepts) {
    const points = latestByConcept(rows, concept, asOf).slice(0, 4);
    if (!points.length) continue;
    const unit = metricUnit(points[0].unit);
    if (points.some((point) => metricUnit(point.unit) !== unit)) return missing(`${concept}: unit conflict`);
    const sourceFiled = maxAvailability(points);
    if (!sourceFiled) return missing(`${concept}: missing required sourceFiled`);
    const indices = points.map((point) => quarterIndex(point.periodEnd));
    const nonConsecutive = indices.some((value, index) => value === null || (index > 0 && indices[index - 1]! - value! !== 1));
    const value = points.reduce((total, point) => total + (point.val ?? 0), 0);
    const quality = points.length === 4 && !nonConsecutive ? "available" : "partial";
    const note = nonConsecutive ? "Non-consecutive quarterly points" : points.length < 4 ? `Only ${points.length} quarterly points` : null;
    return available(value, unit, [concept], points[0].periodEnd, sourceFiled, quality, note);
  }
  return missing(`No ${concepts.join(" or ")}`);
}
function stockMetric(rows: FundamentalSeriesRow[], concepts: string[], asOf: string): ExposureMetric {
  for (const concept of concepts) {
    const point = latestByConcept(rows, concept, asOf)[0];
    if (point) return available(point.val!, metricUnit(point.unit), [concept], point.periodEnd, point.sourceFiled!);
  }
  return missing(`No ${concepts.join(" or ")}`);
}
function debtMetric(rows: FundamentalSeriesRow[], asOf: string): ExposureMetric {
  const direct = stockMetric(rows, ["LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"], asOf);
  if (direct.quality !== "missing") return direct;
  const current = stockMetric(rows, ["LongTermDebtCurrent"], asOf);
  const noncurrent = stockMetric(rows, ["LongTermDebtNoncurrent"], asOf);
  if (current.quality !== "missing" && noncurrent.quality !== "missing") {
    if (current.periodEnd !== noncurrent.periodEnd || current.unit !== noncurrent.unit) return missing("LongTermDebtCurrent and LongTermDebtNoncurrent have incompatible periods or units");
    const sourceFiled = maxAvailability([current, noncurrent]);
    if (!sourceFiled) return missing("Current and noncurrent debt require known sourceFiled for both components");
    return available(current.value! + noncurrent.value!, current.unit!, ["LongTermDebtCurrent", "LongTermDebtNoncurrent"], current.periodEnd!, sourceFiled);
  }
  if (current.quality !== "missing" || noncurrent.quality !== "missing") {
    const partial = current.quality !== "missing" ? current : noncurrent;
    return { ...partial, quality: "partial", note: "Only one current/noncurrent debt component is available" };
  }
  return stockMetric(rows, ["DebtInstrumentCarryingAmount"], asOf);
}
function ratio(numerator: ExposureMetric, denominator: ExposureMetric, note: string): ExposureMetric {
  if (numerator.quality === "missing" || denominator.quality === "missing") return missing(note);
  if (numerator.periodEnd !== denominator.periodEnd) return missing(`${note}: incompatible periods ${numerator.periodEnd ?? "unknown"} vs ${denominator.periodEnd ?? "unknown"}`);
  if (numerator.unit !== denominator.unit) return missing(`${note}: incompatible units ${numerator.unit} vs ${denominator.unit}`);
  if (denominator.value === null || denominator.value <= 0 || numerator.value === null) return missing(`${note}: non-positive or missing denominator`);
  if (!Number.isFinite(numerator.value) || !Number.isFinite(denominator.value)) return missing(`${note}: non-finite numeric value`);
  const sourceFiled = maxAvailability([numerator, denominator]);
  if (!sourceFiled) return missing(`${note}: missing required sourceFiled`);
  const value = numerator.value / denominator.value;
  if (!Number.isFinite(value)) return missing(`${note}: non-finite ratio`);
  return {
    value,
    unit: "ratio",
    concepts: [...numerator.concepts, ...denominator.concepts],
    periodEnd: numerator.periodEnd,
    sourceFiled,
    quality: numerator.quality === "partial" || denominator.quality === "partial" ? "partial" : "available",
    note: numerator.note ?? denominator.note,
  };
}

function withEvidenceAge(metric: ExposureMetric, asOf: string): ExposureMetric {
  if (!metric.periodEnd) return { ...metric, evidenceAgeDays: null, stale: false };
  const evidenceAgeDays = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(`${metric.periodEnd}T00:00:00Z`)) / 86_400_000));
  return { ...metric, evidenceAgeDays, stale: evidenceAgeDays > 550 };
}

export function buildCompanyExposure(input: CompanyExposureInput, asOf: string): CompanyExposureRow {
  const debt = debtMetric(input.rows, asOf);
  const operatingIncome = flowMetric(input.rows, ["OperatingIncomeLoss"], asOf);
  const interest = flowMetric(input.rows, ["InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestIncomeExpenseNet"], asOf);
  const cash = stockMetric(input.rows, ["CashAndCashEquivalentsAtCarryingValue"], asOf);
  const fuel = flowMetric(input.rows, ["FuelCosts"], asOf);
  const oilRevenue = flowMetric(input.rows, ["OilAndGasRevenue"], asOf);
  const oilCost = flowMetric(input.rows, ["CostOfPurchasedOilAndGas"], asOf);
  const totalRevenue = stockMetric(input.rows, ["RevenueFromContractWithCustomerExcludingAssessedTax"], asOf);
  const domesticRevenue = stockMetric(input.rows, ["EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile"], asOf);
  const domicileToTotalRevenue = ratio(domesticRevenue, totalRevenue, "Domicile / total revenue is unavailable");
  const foreignRevenueShare = domicileToTotalRevenue.quality !== "missing"
    ? available(Math.max(0, 1 - domicileToTotalRevenue.value!), "ratio", domicileToTotalRevenue.concepts, domicileToTotalRevenue.periodEnd!, domicileToTotalRevenue.sourceFiled!, domicileToTotalRevenue.quality, "Computed as 1 − domicile revenue / total revenue for the same period")
    : missing(`No directly comparable domicile and total revenue: ${domicileToTotalRevenue.note}`);
  const foreignDerivativeNotional = stockMetric(input.rows, ["NotionalAmountOfForeignCurrencyDerivatives"], asOf);
  const missingFields = [
    "floating rate share",
    "debt maturity schedule",
    "interest-rate hedge ratio",
    "fuel hedge ratio",
    ...(foreignRevenueShare.quality === "missing" ? ["foreign revenue share"] : []),
  ];
  return {
    cik: input.cik,
    ticker: input.ticker,
    name: input.name,
    sector: input.sector,
    debt: withEvidenceAge(debt, asOf),
    debtToOperatingIncome: withEvidenceAge(ratio(debt, operatingIncome, "Debt / operating income is unavailable"), asOf),
    interestCoverage: withEvidenceAge(ratio(operatingIncome, interest, "Operating income / interest expense is unavailable"), asOf),
    cashToDebt: withEvidenceAge(ratio(cash, debt, "Cash / debt is unavailable"), asOf),
    fuelCostToOperatingIncome: withEvidenceAge(ratio(fuel, operatingIncome, "Fuel cost / operating income is unavailable"), asOf),
    oilRevenue: withEvidenceAge(oilRevenue, asOf),
    oilCost: withEvidenceAge(oilCost, asOf),
    oilRevenueToOperatingIncome: withEvidenceAge(ratio(oilRevenue, operatingIncome, "Oil revenue / operating income is unavailable"), asOf),
    oilCostToOperatingIncome: withEvidenceAge(ratio(oilCost, operatingIncome, "Oil cost / operating income is unavailable"), asOf),
    foreignRevenueShare: withEvidenceAge(foreignRevenueShare, asOf),
    foreignDerivativeNotional: withEvidenceAge(foreignDerivativeNotional, asOf),
    missing: missingFields,
  };
}

// Targeted rebuilds replace one ticker without dropping the others or changing
// the original universe provenance hash.
export function mergeCompanyExposureReports(previous: CompanyExposureReport, update: CompanyExposureReport): CompanyExposureReport {
  const companies = new Map(previous.companies.map((company) => [company.ticker, company]));
  for (const company of update.companies) companies.set(company.ticker, company);
  const merged = [...companies.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return {
    ...update,
    universeSha256: previous.universeSha256,
    companies: merged,
    coverage: {
      companies: merged.length,
      debt: merged.filter((company) => company.debt.quality !== "missing").length,
      interestCoverage: merged.filter((company) => company.interestCoverage.quality !== "missing").length,
      fuelCost: merged.filter((company) => company.fuelCostToOperatingIncome.quality !== "missing").length,
      oilRevenue: merged.filter((company) => company.oilRevenue.quality !== "missing").length,
      oilCost: merged.filter((company) => company.oilCost.quality !== "missing").length,
      foreignRevenueShare: merged.filter((company) => company.foreignRevenueShare.quality !== "missing").length,
    },
  };
}

export function buildCompanyExposureReport(inputs: CompanyExposureInput[], asOf: string, generatedAt: string): CompanyExposureReport {
  const companies = inputs.map((input) => buildCompanyExposure(input, asOf)).sort((a, b) => a.ticker.localeCompare(b.ticker));
  return {
    schemaVersion: 1,
    generatedAt,
    asOf,
    universeSha256: sha256Text(JSON.stringify(inputs.map((input) => input.cik).sort((a, b) => a - b))),
    policy: {
      noSectorInference: true,
      noDirectionScore: true,
      missingFields: "floating rate share, debt maturity schedule, hedges and foreign revenue share are null unless directly supported",
    },
    coverage: {
      companies: companies.length,
      debt: companies.filter((company) => company.debt.quality !== "missing").length,
      interestCoverage: companies.filter((company) => company.interestCoverage.quality !== "missing").length,
      fuelCost: companies.filter((company) => company.fuelCostToOperatingIncome.quality !== "missing").length,
      oilRevenue: companies.filter((company) => company.oilRevenue.quality !== "missing").length,
      oilCost: companies.filter((company) => company.oilCost.quality !== "missing").length,
      foreignRevenueShare: companies.filter((company) => company.foreignRevenueShare.quality !== "missing").length,
    },
    companies,
  };
}
