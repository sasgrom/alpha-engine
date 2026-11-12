import { exposurePeriod, GEOGRAPHY_AXES, isDomesticMember, isForeignMember, isOilMember, isUsd, members, PRODUCT_AXES, REVENUE_CONCEPTS, type XbrlDocument, type XbrlFact } from "./xbrl-exposure";

export type ExposureMeasureKind = "foreignRevenueShare" | "oilAndGasRevenue" | "oilCost" | "debtMaturingNext12" | "debtMaturingYearTwo" | "floatingRateDebt" | "floatingRateShare" | "cashShortTerm" | "operatingIncome" | "fuelCost" | "interestExpense";
export interface ExposureMeasure {
  kind: ExposureMeasureKind;
  value: number;
  unit: "USD" | "ratio";
  periodStart: string | null;
  periodEnd: string;
  availableAt: string;
  facts: XbrlFact[];
  note?: string;
}
export interface ExposureFiling {
  cik: number;
  ticker: string;
  accessionNo: string;
  form: string;
  filingDate: string;
  sourceUrl?: string;
  sourceHash?: string;
  measures: ExposureMeasure[];
  missing: string[];
}

export interface ExposureAggregationInput {
  cik: number;
  ticker: string;
  accessionNo: string;
  form: string;
  filingDate: string;
  sourceUrl?: string;
  sourceHash?: string;
}

const maturityNext = new Set([
  "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths",
  "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextRollingTwelveMonths",
]);
const maturityTwo = new Set([
  "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo",
  "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInRollingYearTwo",
]);
const floatingDebtConcepts = new Set(["us-gaap:VariableInterestRateDebt", "us-gaap:FloatingRateDebt", "us-gaap:LongTermDebtVariableInterestRate"]);
const floatingShareConcepts = new Set(["us-gaap:LongTermDebtPercentageBearingVariableInterestRate", "us-gaap:LongTermDebtPercentageBearingFloatingInterestRate", "us-gaap:DebtPercentageBearingVariableInterestRate"]);
const shortTermInvestmentConcepts = ["us-gaap:ShortTermInvestments", "us-gaap:MarketableSecuritiesCurrent", "us-gaap:ShortTermInvestmentsInDebtSecurities", "us-gaap:AvailableForSaleSecuritiesDebtSecuritiesCurrent"];
const fuelConcepts = new Set(["us-gaap:FuelCosts", "us-gaap:AircraftFuelAndRelatedTaxes", "us-gaap:AircraftFuelExpense", "us-gaap:FuelExpense", "us-gaap:CruiseFuelExpense"]);
const oilRevenueConcepts = new Set(["us-gaap:OilAndGasRevenue", "us-gaap:OilAndGasSales", "us-gaap:NaturalGasRevenue", "us-gaap:GasUtilityRevenue"]);
const costConcepts = new Set(["us-gaap:CostOfGoodsAndServicesSold", "us-gaap:CostOfGoodsSold", "us-gaap:CostOfRevenue", "us-gaap:OperatingCostsAndExpenses"]);
const directForeignConcept = "us-gaap:EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToForeignCountries";
const directDomesticConcept = "us-gaap:EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile";

function dimensionKey(fact: XbrlFact, excludeGeography = false): string {
  return JSON.stringify(Object.entries(fact.context.dimensions).filter(([axis]) => !excludeGeography || !GEOGRAPHY_AXES.has(axis)).sort(([a], [b]) => a.localeCompare(b)));
}
function unique(facts: XbrlFact[]): XbrlFact[] {
  const selected = new Map<string, XbrlFact>();
  const precision = (fact: XbrlFact): number => fact.decimals === "INF" ? Number.POSITIVE_INFINITY : fact.decimals && Number.isFinite(Number(fact.decimals)) ? Number(fact.decimals) : Number.NEGATIVE_INFINITY;
  for (const fact of facts) {
    const key = `${fact.concept}|${fact.context.startDate}|${fact.context.endDate}|${fact.context.instant}|${dimensionKey(fact)}|${fact.unitRef?.toLowerCase()}`;
    const prior = selected.get(key);
    if (!prior || precision(fact) > precision(prior) || precision(fact) === precision(prior) && Number(fact.scale ?? 0) < Number(prior.scale ?? 0)) selected.set(key, fact);
  }
  return [...selected.values()];
}
function period(fact: XbrlFact): string {
  return exposurePeriod(fact).end ?? "";
}
function latest(facts: XbrlFact[], preferredPeriod?: "FY" | "Q" | "instant"): XbrlFact[] {
  const preferred = preferredPeriod ? facts.filter(fact => exposurePeriod(fact).kind === preferredPeriod) : facts;
  const eligible = preferred.length ? preferred : facts;
  const latestPeriod = eligible.map(period).sort().at(-1);
  return latestPeriod ? unique(eligible.filter(fact => period(fact) === latestPeriod)) : [];
}
function sum(facts: XbrlFact[]): number {
  return unique(facts).reduce((total, fact) => total + (fact.value ?? 0), 0);
}
function max(facts: XbrlFact[]): number | null {
  const values = unique(facts).map(fact => fact.value).filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}
function measure(kind: ExposureMeasureKind, value: number, unit: "USD" | "ratio", facts: XbrlFact[], filingDate: string, note?: string): ExposureMeasure {
  const evidence = unique(facts);
  return { kind, value, unit, periodStart: evidence[0]?.context.startDate ?? null, periodEnd: evidence.map(period).sort().at(-1) ?? "", availableAt: filingDate, facts: evidence, ...(note ? { note } : {}) };
}
function numericUsd(fact: XbrlFact): boolean {
  return isUsd(fact) && fact.value !== null && Number.isFinite(fact.value);
}
function undimensioned(fact: XbrlFact): boolean {
  return Object.keys(fact.context.dimensions).length === 0;
}
function flow(doc: XbrlDocument, concepts: Set<string>, form: string): XbrlFact[] {
  for (const concept of concepts) {
    const facts = latest(doc.facts.filter(fact => fact.concept === concept && numericUsd(fact) && undimensioned(fact)), form === "10-K" ? "FY" : "Q");
    if (facts.length) return facts;
  }
  return [];
}

interface RevenueGroup {
  concept: string;
  startDate: string | null;
  endDate: string;
  kind: ReturnType<typeof exposurePeriod>["kind"];
  total: XbrlFact[];
  facts: XbrlFact[];
}
function revenueGroups(doc: XbrlDocument): RevenueGroup[] {
  const facts = doc.facts.filter(fact => REVENUE_CONCEPTS.has(fact.concept) && numericUsd(fact));
  const groups = new Map<string, XbrlFact[]>();
  for (const fact of facts) {
    const p = exposurePeriod(fact);
    if (!p.end) continue;
    const key = `${fact.concept}|${p.start}|${p.end}|${p.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [concept, start, endDate, kind] = key.split("|");
    return { concept, startDate: start === "null" ? null : start, endDate, kind: kind as RevenueGroup["kind"], total: unique(rows.filter(undimensioned)), facts: rows };
  }).sort((a, b) => b.endDate.localeCompare(a.endDate) || (a.kind === "FY" ? -1 : 0) - (b.kind === "FY" ? -1 : 0));
}
function geographicMembers(fact: XbrlFact): string[] {
  return Object.entries(fact.context.dimensions).filter(([axis, member]) => GEOGRAPHY_AXES.has(axis) || /StatementBusinessSegmentsAxis$/i.test(axis) && (isForeignMember(member) || isDomesticMember(member))).map(([, member]) => member);
}
function nonConsolidated(fact: XbrlFact): boolean {
  return fact.context.dimensions["srt:ConsolidationItemsAxis"] === "us-gaap:IntersegmentEliminationMember" || Object.keys(fact.context.dimensions).some(axis => /(?:LegalEntityAxis|EquityMethodInvestmentNonconsolidatedInvesteeAxis|InvestmentIssuerAffiliationAxis|RelatedPartyTransactionsByRelatedPartyAxis|ConsolidatedEntitiesAxis)$/i.test(axis));
}
interface GeographicCandidate { foreign: XbrlFact[]; domestic: XbrlFact[]; other: XbrlFact[] }
function geographicCandidate(facts: XbrlFact[]): GeographicCandidate {
  const allForeign = unique(facts.filter(fact => geographicMembers(fact).some(isForeignMember)));
  const aggregate = allForeign.filter(fact => geographicMembers(fact).some(member => /(?:NonUs|NonUS|NonUnitedStates|ForeignCountries|OtherForeignCountries|InternationalMarkets)Member$/i.test(member)));
  return {
    foreign: aggregate.length ? aggregate : allForeign,
    domestic: unique(facts.filter(fact => geographicMembers(fact).some(isDomesticMember))),
    other: unique(facts.filter(fact => geographicMembers(fact).length > 0 && !geographicMembers(fact).some(isForeignMember) && !geographicMembers(fact).some(isDomesticMember))),
  };
}
function geographyExposure(group: RevenueGroup, groups: RevenueGroup[]): { value: number; facts: XbrlFact[]; note: string } | null {
  const rows = group.facts.filter(fact => geographicMembers(fact).length > 0 && !nonConsolidated(fact));
  if (!rows.length) return null;
  const layers = new Map<string, XbrlFact[]>();
  for (const fact of rows) layers.set(dimensionKey(fact, true), [...(layers.get(dimensionKey(fact, true)) ?? []), fact]);
  const candidates = [rows, ...layers.values()].map(geographicCandidate);
  const totals = [group, ...groups.filter(other => other !== group && other.startDate === group.startDate && other.endDate === group.endDate)].filter(other => other.total.length > 0);
  for (const candidate of candidates) {
    for (const totalGroup of totals) {
      const total = max(totalGroup.total);
      if (total === null || total <= 0) continue;
      const foreign = sum(candidate.foreign), domestic = sum(candidate.domestic), other = sum(candidate.other);
      const residual = total - foreign - domestic - other;
      const otherSegment = group.facts.filter(fact => !geographicMembers(fact).length && !nonConsolidated(fact) && Object.values(fact.context.dimensions).includes("us-gaap:AllOtherSegmentsMember"));
      const allocated = otherSegment.find(fact => Math.abs((fact.value ?? 0) - residual) <= Math.max(1, total * 1e-6));
      if (Math.abs(residual) > Math.max(1, total * 1e-6) && !allocated) continue;
      const evidence = unique([...totalGroup.total, ...candidate.foreign, ...candidate.domestic, ...candidate.other, ...(allocated ? [allocated] : [])]);
      if (candidate.foreign.length && foreign >= 0 && foreign <= total * (1 + 1e-6)) return { value: foreign / total, facts: evidence, note: `Foreign geographic revenue ${foreign} / same-period total revenue ${total}; reconciled non-overlapping dimensions${totalGroup.concept === group.concept ? "" : " and same-period revenue concept"}` };
      if (!candidate.foreign.length && !candidate.other.length && candidate.domestic.length && domestic >= 0 && domestic <= total * (1 + 1e-6)) return { value: 1 - domestic / total, facts: evidence, note: `1 − domestic geographic revenue ${domestic} / same-period total revenue ${total}` };
    }
  }
  const individual = [...layers.values()].map(geographicCandidate);
  const candidate = layers.size === 1 ? individual[0] : individual.find(item => item.foreign.some(fact => geographicMembers(fact).some(member => /(?:NonUs|NonUS|ForeignCountries|InternationalMarkets)Member$/i.test(member))));
  if (!candidate) return null;
  for (const totalGroup of totals) {
    const total = max(totalGroup.total);
    if (total === null || total <= 0) continue;
    const foreign = sum(candidate.foreign), domestic = sum(candidate.domestic);
    if (candidate.foreign.length && foreign >= 0 && foreign <= total) return { value: foreign / total, facts: unique([...totalGroup.total, ...candidate.foreign]), note: `Reported foreign geographic revenue ${foreign} / same-period total ${total}; full geographic reconciliation unavailable` };
    if (layers.size === 1 && !candidate.foreign.length && !candidate.other.length && candidate.domestic.length && domestic >= 0 && domestic <= total) return { value: 1 - domestic / total, facts: unique([...totalGroup.total, ...candidate.domestic]), note: `1 − reported domestic geographic revenue ${domestic} / total ${total}` };
  }
  return null;
}
function directCountryExposure(doc: XbrlDocument, group: RevenueGroup, form: string): { value: number; facts: XbrlFact[]; note: string } | null {
  const total = max(group.total);
  if (total === null || total <= 0) return null;
  const periodsMatch = (fact: XbrlFact) => fact.context.startDate === group.startDate && period(fact) === group.endDate && undimensioned(fact);
  const foreign = latest(doc.facts.filter(fact => fact.concept === directForeignConcept && numericUsd(fact) && periodsMatch(fact)), form === "10-K" ? "FY" : "Q");
  if (foreign.length && sum(foreign) >= 0 && sum(foreign) <= total * (1 + 1e-6)) return { value: sum(foreign) / total, facts: [...group.total, ...foreign], note: "Directly reported foreign-country revenue / same-period total revenue" };
  const domestic = latest(doc.facts.filter(fact => fact.concept === directDomesticConcept && numericUsd(fact) && periodsMatch(fact)), form === "10-K" ? "FY" : "Q");
  if (domestic.length && sum(domestic) >= 0 && sum(domestic) <= total * (1 + 1e-6)) return { value: 1 - sum(domestic) / total, facts: [...group.total, ...domestic], note: "1 − directly reported country-of-domicile revenue / same-period total revenue" };
  return null;
}
function floatingShareValue(fact: XbrlFact): number | null {
  if (fact.value === null || fact.value < 0) return null;
  const unit = fact.unitRef?.toLowerCase();
  if (unit === "percent" || unit === "%") return fact.value <= 100 ? fact.value / 100 : null;
  if (unit === "pure" || unit === "number" || unit === "ratio") return fact.value <= 1 ? fact.value : fact.value <= 100 ? fact.value / 100 : null;
  return null;
}

function maturityEvidence(doc: XbrlDocument, concepts: Set<string>, currentDebtFallback: boolean): { facts: XbrlFact[]; note?: string } | null {
  const total = latest(doc.facts.filter(fact => concepts.has(fact.concept) && numericUsd(fact) && undimensioned(fact)), "instant");
  if (total.length) return { facts: total };
  const typeFacts = latest(doc.facts.filter(fact => {
    const dimensions = Object.entries(fact.context.dimensions);
    return concepts.has(fact.concept) && numericUsd(fact) && dimensions.length === 1 && dimensions[0][0] === "us-gaap:LongtermDebtTypeAxis" && ["us-gaap:SecuredDebtMember", "us-gaap:UnsecuredDebtMember"].includes(dimensions[0][1]);
  }), "instant");
  if (typeFacts.length) return { facts: typeFacts, note: "Sum of secured/unsecured debt-type aggregate totals; instrument-level rows and overlapping dimensions excluded" };
  if (currentDebtFallback) {
    for (const concept of ["us-gaap:LongTermDebtCurrent", "us-gaap:DebtCurrent", "us-gaap:ShortTermBorrowings"]) {
      const current = latest(doc.facts.filter(fact => fact.concept === concept && numericUsd(fact) && undimensioned(fact)), "instant");
      if (current.length) return { facts: current, note: `Current-debt aggregate ${concept} used as a next-12-month refinancing proxy because the standard maturity total is not tagged` };
    }
  }
  return null;
}
function maturityValue(facts: XbrlFact[]): number {
  const groups = new Map<string, XbrlFact[]>();
  for (const fact of facts) {
    const key = fact.context.dimensions["us-gaap:LongtermDebtTypeAxis"] ?? "total";
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  return [...groups.values()].reduce((total, group) => total + (max(group) ?? 0), 0);
}

export function aggregateXbrlExposure(doc: XbrlDocument, input: ExposureAggregationInput): ExposureFiling {
  const { cik, ticker, accessionNo, form, filingDate } = input;
  const measures: ExposureMeasure[] = [];
  const missing: string[] = [];
  const groups = revenueGroups(doc);
  const preferredKind = form === "10-K" ? "FY" : "Q";
  const foreignCandidate = groups.map(group => {
    if (group.kind !== preferredKind && groups.some(other => other.kind === preferredKind)) return null;
    return geographyExposure(group, groups) ?? directCountryExposure(doc, group, form);
  }).find(Boolean);
  if (foreignCandidate) measures.push(measure("foreignRevenueShare", foreignCandidate.value, "ratio", foreignCandidate.facts, filingDate, foreignCandidate.note));
  else missing.push("foreign revenue share or comparable geographic total");

  const oilAxes = new Set([...PRODUCT_AXES, "srt:EnergyAxis", "srt:ReserveQuantitiesByTypeOfReserveAxis", "us-gaap:StatementBusinessSegmentsAxis", "srt:StatementBusinessSegmentsAxis"]);
  let oil: XbrlFact[] = [];
  for (const concept of REVENUE_CONCEPTS) {
    oil = latest(doc.facts.filter(fact => fact.concept === concept && numericUsd(fact) && members(fact, oilAxes).some(isOilMember) && !nonConsolidated(fact) && fact.context.dimensions["srt:ConsolidationItemsAxis"] !== "us-gaap:OperatingSegmentsMember" && fact.value! >= 0), preferredKind);
    if (oil.length) break;
  }
  const directOil = flow(doc, oilRevenueConcepts, form);
  if (directOil.length) measures.push(measure("oilAndGasRevenue", sum(directOil), "USD", directOil, filingDate, "Directly tagged oil and gas revenue"));
  else if (oil.length) measures.push(measure("oilAndGasRevenue", sum(oil), "USD", oil, filingDate, `Explicitly tagged oil/gas product, energy or oil-and-gas segment revenue (${[...new Set(oil.map(fact => fact.concept))].join(", ")}); intersegment eliminations excluded`));
  else missing.push("oil and gas revenue");
  const oilCost = flow(doc, new Set(["us-gaap:CostOfPurchasedOilAndGas"]), form);
  if (oilCost.length) measures.push(measure("oilCost", sum(oilCost), "USD", oilCost, filingDate, "Directly tagged purchased oil and gas cost"));

  const next = maturityEvidence(doc, maturityNext, true);
  if (next) measures.push(measure("debtMaturingNext12", maturityValue(next.facts), "USD", next.facts, filingDate, next.note ?? "Undimensioned next-twelve-month maturity total; instrument rows excluded"));
  else missing.push("debt maturing within 12 months");
  const second = maturityEvidence(doc, maturityTwo, false);
  if (second) measures.push(measure("debtMaturingYearTwo", maturityValue(second.facts), "USD", second.facts, filingDate, second.note ?? "Undimensioned year-two maturity total; instrument rows excluded"));
  else missing.push("debt maturing in year two");

  const floating = latest(doc.facts.filter(fact => numericUsd(fact) && (floatingDebtConcepts.has(fact.concept) || fact.concept === "us-gaap:DebtInstrumentCarryingAmount" && /variable|floating/i.test(Object.entries(fact.context.dimensions).filter(([axis]) => /InterestRateTypeAxis$/i.test(axis)).map(([, member]) => member).join(" ")))), "instant");
  if (floating.length) measures.push(measure("floatingRateDebt", sum(floating), "USD", floating, filingDate, "Directly tagged variable/floating-rate debt; a variable coupon rate is not a debt share"));
  const share = latest(doc.facts.filter(fact => floatingShareConcepts.has(fact.concept) && undimensioned(fact) && floatingShareValue(fact) !== null), "instant").map(fact => ({ fact, value: floatingShareValue(fact)! }));
  if (share.length) {
    const selected = share[0];
    measures.push(measure("floatingRateShare", selected.value, "ratio", share.map(item => item.fact), filingDate, "Directly tagged floating/variable debt share; percent units converted to ratios"));
  }

  const cashAggregate = latest(doc.facts.filter(fact => fact.concept === "us-gaap:CashAndShortTermInvestments" && numericUsd(fact) && undimensioned(fact)), "instant");
  const cash = latest(doc.facts.filter(fact => fact.concept === "us-gaap:CashAndCashEquivalentsAtCarryingValue" && numericUsd(fact) && undimensioned(fact)), "instant");
  const cashEnd = cash[0] ? period(cash[0]) : null;
  const investments = shortTermInvestmentConcepts.map(concept => latest(doc.facts.filter(fact => fact.concept === concept && numericUsd(fact) && undimensioned(fact) && period(fact) === cashEnd), "instant")).find(rows => rows.length > 0) ?? [];
  if (cashAggregate.length) measures.push(measure("cashShortTerm", max(cashAggregate)!, "USD", cashAggregate, filingDate, "Aggregate cash and short-term investments"));
  else if (cash.length) measures.push(measure("cashShortTerm", sum([...cash, ...investments]), "USD", [...cash, ...investments], filingDate, "Cash plus one short-term-investment aggregate; duplicate investment concepts excluded"));
  else missing.push("cash and short-term investments");

  const operating = flow(doc, new Set(["us-gaap:OperatingIncomeLoss"]), form);
  if (operating.length) measures.push(measure("operatingIncome", sum(operating), "USD", operating, filingDate));
  else missing.push("operating income");
  const directFuel = flow(doc, fuelConcepts, form);
  const fuelProducts = latest(doc.facts.filter(fact => costConcepts.has(fact.concept) && numericUsd(fact) && members(fact, PRODUCT_AXES).some(member => /^[\w-]+:(?:Fuel|FuelCosts|FuelExpense|BunkerFuel|AircraftFuel)Member$/i.test(member))), form === "10-K" ? "FY" : "Q");
  if (directFuel.length) measures.push(measure("fuelCost", sum(directFuel), "USD", directFuel, filingDate, "Directly tagged fuel cost"));
  else if (fuelProducts.length) measures.push(measure("fuelCost", sum(fuelProducts), "USD", fuelProducts, filingDate, "Fuel product/service member of a directly tagged cost concept"));
  else missing.push("fuel cost");
  for (const concept of ["us-gaap:InterestExpense", "us-gaap:InterestExpenseDebt", "us-gaap:InterestExpenseNonoperating", "us-gaap:InterestIncomeExpenseNet"]) {
    const interest = flow(doc, new Set([concept]), form);
    if (interest.length) {
      measures.push(measure("interestExpense", sum(interest), "USD", interest, filingDate));
      break;
    }
  }
  return { cik, ticker, accessionNo, form, filingDate, ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}), ...(input.sourceHash ? { sourceHash: input.sourceHash } : {}), measures, missing };
}
