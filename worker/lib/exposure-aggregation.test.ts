import { describe, expect, it } from "vitest";
import { aggregateXbrlExposure } from "./exposure-aggregation";
import { isForeignMember, isOilMember, parseXbrl } from "./xbrl-exposure";

function context(id: string, start: string | null, end: string | null, dimensions: Record<string, string> = {}): string {
  const members = Object.entries(dimensions).map(([axis, member]) => `<xbrli:explicitMember dimension="${axis}">${member}</xbrli:explicitMember>`).join("");
  return `<xbrli:context id="${id}"><xbrli:entity><xbrli:segment>${members}</xbrli:segment></xbrli:entity><xbrli:period>${start ? `<xbrli:startDate>${start}</xbrli:startDate>` : `<xbrli:instant>${end}</xbrli:instant>`}${start ? `<xbrli:endDate>${end}</xbrli:endDate>` : ""}</xbrli:period></xbrli:context>`;
}
function fact(contextRef: string, concept: string, value: string, unit = "usd", extra = ""): string {
  return `<ix:nonFraction unitRef="${unit}" contextRef="${contextRef}" name="${concept}" ${extra}>${value}</ix:nonFraction>`;
}
const filing = { cik: 320193, ticker: "AAPL", accessionNo: "0000320193-26-000026", form: "10-K", filingDate: "2026-11-03" };

function document(): string {
  return `${context("c-1", "2025-09-28", "2026-09-26")}${context("c-2", "2025-09-28", "2026-09-26", { "srt:StatementGeographicalAxis": "country:CN" })}${context("c-3", "2025-09-28", "2026-09-26", { "srt:StatementGeographicalAxis": "aapl:OtherCountriesMember" })}${context("c-4", "2025-09-28", "2026-09-26", { "srt:ProductOrServiceAxis": "us-gaap:CrudeOilMember" })}${context("c-5", "2025-09-28", "2026-09-26", { "srt:ProductOrServiceAxis": "us-gaap:RenewableEnergyMember" })}${context("c-6", null, "2026-09-26")}${context("c-7", null, "2026-09-26", { "us-gaap:LongtermDebtTypeAxis": "us-gaap:MunicipalBondsMember" })}
  <ix:nonNumeric contextRef="c-1" name="us-gaap:ScheduleOfRevenuesFromExternalCustomersAndLongLivedAssetsByGeographicalAreasTableTextBlock"><ix:continuation><div>
  ${fact("c-1", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "478,834", "usd", 'scale="6" id="f-70"')}
  ${fact("c-2", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "82,378", "usd", 'scale="6" id="f-1214"')}
  ${fact("c-3", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "228,710", "usd", 'scale="6" id="f-1217"')}
  </div></ix:continuation></ix:nonNumeric>
  ${fact("c-4", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "10", "usd", 'scale="6"')}
  ${fact("c-5", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "5", "usd", 'scale="6"')}
  ${fact("c-6", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths", "713", "usd", 'scale="6" id="f-884"')}
  ${fact("c-6", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo", "786", "usd", 'scale="6" id="f-886"')}
  ${fact("c-7", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths", "600", "usd", 'scale="6" id="f-885"')}
  ${fact("c-6", "us-gaap:CashAndCashEquivalentsAtCarryingValue", "8", "usd", 'scale="6"')}
  ${fact("c-6", "us-gaap:OperatingIncomeLoss", "20", "usd", 'scale="6"')}
  ${fact("c-6", "us-gaap:FuelCosts", "4", "usd", 'scale="6"')}
  ${fact("c-6", "us-gaap:DebtInstrumentInterestRateVariable", "0.5", "percent")}
  ${fact("c-6", "us-gaap:LongTermDebtPercentageBearingVariableInterestRate", "50", "percent")}
  ${context("c-8", null, "2026-09-26")}
  ${fact("c-8", "us-gaap:OperatingIncomeLoss", "20", "usd", 'scale="6"')}
  ${fact("c-8", "us-gaap:CashAndCashEquivalentsAtCarryingValue", "8", "usd", 'scale="6"')}`;
}

describe("inline XBRL exposure aggregation", () => {
  it("keeps nested segment facts, foreign share and undimensioned maturity totals", () => {
    const result = aggregateXbrlExposure(parseXbrl(document()), filing);
    expect(Object.fromEntries(result.measures.map(measure => [measure.kind, measure.value]))).toMatchObject({
      foreignRevenueShare: (82378000000 + 228710000000) / 478834000000,
      oilAndGasRevenue: 10000000,
      debtMaturingNext12: 713000000,
      debtMaturingYearTwo: 786000000,
      cashShortTerm: 8000000,
      operatingIncome: 20000000,
      fuelCost: 4000000,
      floatingRateShare: 0.5,
    });
    expect(result.measures.find(measure => measure.kind === "debtMaturingNext12")?.facts.map(fact => fact.id)).toEqual(["f-884"]);
    expect(result.measures.find(measure => measure.kind === "foreignRevenueShare")?.availableAt).toBe("2026-11-03");
    expect(result.measures.find(measure => measure.kind === "floatingRateShare")?.facts[0].concept).not.toContain("DebtInstrumentInterestRateVariable");
  });

  it("derives foreign share from a domestic total and rejects intersegment oil eliminations", () => {
    const html = `${context("c-1", "2025-01-01", "2025-12-31")}${context("c-2", "2025-01-01", "2025-12-31", { "srt:StatementGeographicalAxis": "country:US" })}${context("c-3", "2025-01-01", "2025-12-31", { "srt:ProductOrServiceAxis": "dal:SalesOfRefinedProductsToThirdPartiesMember", "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember" })}
      ${fact("c-1", "us-gaap:Revenues", "1000", "usd", 'scale="6"')}${fact("c-2", "us-gaap:Revenues", "400", "usd", 'scale="6"')}${fact("c-3", "us-gaap:Revenues", "-154", "usd", 'scale="6"')}`;
    const result = aggregateXbrlExposure(parseXbrl(html), filing);
    expect(result.measures.find(measure => measure.kind === "foreignRevenueShare")?.value).toBe(0.6);
    expect(result.measures.some(measure => measure.kind === "oilAndGasRevenue")).toBe(false);
  });

  it("classifies NonUs, other countries, Europe and Asia-Pacific as foreign, not North America", () => {
    expect(isForeignMember("us-gaap:NonUsMember")).toBe(true);
    expect(isForeignMember("aapl:OtherCountriesMember")).toBe(true);
    expect(isForeignMember("srt:EuropeMember")).toBe(true);
    expect(isForeignMember("srt:AsiaPacificMember")).toBe(true);
    expect(isForeignMember("srt:NorthAmericaMember")).toBe(false);
    expect(isForeignMember("country:US")).toBe(false);
    expect(isOilMember("us-gaap:CrudeOilMember")).toBe(true);
    expect(isOilMember("us-gaap:NaturalGasMember")).toBe(true);
    expect(isOilMember("us-gaap:RenewableEnergyMember")).toBe(false);
  });

  it("accepts U_USD, explicit geographic segment members and a reconciled same-period total concept", () => {
    const html = `${context("c-1", "2025-01-01", "2025-12-31")}${context("c-2", "2025-01-01", "2025-12-31", { "srt:StatementGeographicalAxis": "country:US" })}${context("c-3", "2025-01-01", "2025-12-31", { "us-gaap:StatementBusinessSegmentsAxis": "cost:CanadaMember" })}${context("c-4", "2025-01-01", "2025-12-31", { "us-gaap:StatementBusinessSegmentsAxis": "cost:OtherInternationalMember" })}
      ${fact("c-1", "us-gaap:Revenues", "1000", "U_USD", 'scale="6"')}${fact("c-2", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "400", "usd", 'scale="6"')}${fact("c-3", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "200", "usd", 'scale="6"')}${fact("c-4", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "400", "usd", 'scale="6"')}`;
    const result = aggregateXbrlExposure(parseXbrl(html), filing);
    expect(result.measures.find(measure => measure.kind === "foreignRevenueShare")?.value).toBe(0.6);
    expect(isForeignMember("cost:CanadaMember")).toBe(true);
    expect(isOilMember("cvx:UpstreamSegmentMember")).toBe(true);
    expect(isOilMember("kmi:NaturalGasPipelinesMember")).toBe(false);
    expect(isOilMember("kmi:ProductOtherThanNaturalGasMember")).toBe(false);
    expect(isOilMember("fcx:RefinedCopperProductsMember")).toBe(false);
  });

  it("sums secured and unsecured maturity aggregates without instrument duplicates", () => {
    const html = `${context("type-u", null, "2025-12-31", { "us-gaap:LongtermDebtTypeAxis": "us-gaap:UnsecuredDebtMember" })}${context("type-s", null, "2025-12-31", { "us-gaap:LongtermDebtTypeAxis": "us-gaap:SecuredDebtMember" })}${context("instrument", null, "2025-12-31", { "us-gaap:LongtermDebtTypeAxis": "us-gaap:UnsecuredDebtMember", "us-gaap:DebtInstrumentAxis": "aig:NotesAndBondsPayableMember" })}
      ${fact("type-u", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextRollingTwelveMonths", "29", "usd", 'scale="6" id="type-u-next"')}${fact("type-s", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextRollingTwelveMonths", "7", "usd", 'scale="6" id="type-s-next"')}${fact("instrument", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextRollingTwelveMonths", "29", "usd", 'scale="6" id="instrument-next"')}
      ${fact("type-u", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInRollingYearTwo", "963", "usd", 'scale="6" id="type-u-second"')}${fact("type-s", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInRollingYearTwo", "0", "usd", 'scale="6" id="type-s-second"')}`;
    const result = aggregateXbrlExposure(parseXbrl(html), filing);
    expect(result.measures.find(measure => measure.kind === "debtMaturingNext12")?.value).toBe(36000000);
    expect(result.measures.find(measure => measure.kind === "debtMaturingYearTwo")?.value).toBe(963000000);
    expect(result.measures.find(measure => measure.kind === "debtMaturingNext12")?.facts.map(fact => fact.id)).toEqual(["type-u-next", "type-s-next"]);
  });

  it("uses a current-debt aggregate only when the standard maturity total is absent", () => {
    const html = `${context("c-1", null, "2025-12-31")}${fact("c-1", "us-gaap:LongTermDebtCurrent", "1168", "usd", 'scale="6"')}${fact("c-1", "us-gaap:DebtCurrent", "1635", "usd", 'scale="6"')}${fact("c-1", "us-gaap:ShortTermBorrowings", "998.865", "usd", 'scale="6"')}`;
    const result = aggregateXbrlExposure(parseXbrl(html), filing);
    const next = result.measures.find(measure => measure.kind === "debtMaturingNext12");
    expect(next?.value).toBe(1168000000);
    expect(next?.facts.map(fact => fact.concept)).toEqual(["us-gaap:LongTermDebtCurrent"]);
    expect(next?.note).toContain("Current-debt aggregate");
  });

  it("prefers the more precise fact when a filing repeats a value rounded to millions", () => {
    const html = `${context("c-1", null, "2026-09-30")}${context("c-2", null, "2026-09-30")}${fact("c-1", "us-gaap:ShortTermBorrowings", "2,474,796", "usd", 'scale="3" decimals="-3"')}${fact("c-2", "us-gaap:ShortTermBorrowings", "2,475", "usd", 'scale="6" decimals="-6"')}`;
    const result = aggregateXbrlExposure(parseXbrl(html), filing);
    const next = result.measures.find(measure => measure.kind === "debtMaturingNext12");
    expect(next?.value).toBe(2474796000);
    expect(next?.facts).toHaveLength(1);
    expect(next?.facts[0].rawValue).toBe("2,474,796");
  });

  it("treats an inline fixed-zero em dash as a reported zero maturity", () => {
    const html = `${context("c-1", null, "2026-09-03")}${fact("c-1", "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths", "&#8212;", "usd", 'scale="6" format="ixt:fixed-zero"')}`;
    const result = aggregateXbrlExposure(parseXbrl(html), filing);
    expect(result.measures.find(measure => measure.kind === "debtMaturingNext12")?.value).toBe(0);
    expect(result.measures.find(measure => measure.kind === "debtMaturingNext12")?.facts[0].format).toBe("ixt:fixed-zero");
  });

  it("applies sign and scale to numeric facts", () => {
    const doc = parseXbrl(`${context("c-1", null, "2026-09-26")}${fact("c-1", "us-gaap:OperatingIncomeLoss", "123.4", "usd", 'sign="-" scale="2"')}`);
    expect(doc.facts[0].value).toBe(-12340);
  });
});
