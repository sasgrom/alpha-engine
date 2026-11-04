import { describe, expect, it } from "vitest";
import { buildCompanyExposure, buildCompanyExposureReport, mergeCompanyExposureReports } from "./company-exposure";
import type { FundamentalSeriesRow } from "./fundamental-integrity";

let nextId = 1;
const point = (cik: number, concept: string, periodEnd: string, val: number, vintage: "first" | "latest" = "latest"): FundamentalSeriesRow => ({
  id: nextId++, cik, concept, kind: concept.includes("Revenue") || ["OperatingIncomeLoss", "InterestExpense", "FuelCosts", "OilAndGasRevenue", "CostOfPurchasedOilAndGas"].includes(concept) ? "flow" : "stock",
  periodEnd, vintage, val, unit: "USD", derivation: "reported", sourceAccn: "accn", sourceFiled: `${periodEnd.slice(0, 4)}-12-01`,
});
const quarters = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
const flows = (cik: number, concept: string, value: number) => quarters.map((periodEnd) => point(cik, concept, periodEnd, value));

describe("company macro exposure evidence", () => {
  it("computes debt, coverage and fuel ratios without inferring missing oil or USD exposure", () => {
    const rows = [
      point(1, "LongTermDebtCurrent", "2025-12-31", 50),
      point(1, "LongTermDebtNoncurrent", "2025-12-31", 100),
      point(1, "CashAndCashEquivalentsAtCarryingValue", "2025-12-31", 75),
      ...flows(1, "OperatingIncomeLoss", 20),
      ...flows(1, "InterestExpense", 5),
      ...flows(1, "FuelCosts", 10),
    ];
    const company = buildCompanyExposure({ cik: 1, ticker: "DAL", name: "Delta", sector: "Transportation", rows }, "2026-01-31T00:00:00Z");
    expect(company.debt.value).toBe(150);
    expect(company.debtToOperatingIncome.value).toBeCloseTo(1.875);
    expect(company.interestCoverage.value).toBe(4);
    expect(company.cashToDebt.value).toBe(0.5);
    expect(company.fuelCostToOperatingIncome.value).toBe(0.5);
    expect(company.oilRevenue.quality).toBe("missing");
    expect(company.foreignRevenueShare.quality).toBe("missing");
  });

  it("marks a TTM built from non-consecutive quarters as partial", () => {
    const rows = [
      ...flows(1, "OperatingIncomeLoss", 20).slice(0, 2),
      point(1, "OperatingIncomeLoss", "2025-12-31", 20),
      point(1, "OperatingIncomeLoss", "2026-06-30", 20),
      point(1, "LongTermDebt", "2025-12-31", 100),
    ];
    const company = buildCompanyExposure({ cik: 1, ticker: "GAP", name: "Gap", sector: null, rows }, "2026-08-31T00:00:00Z");
    expect(company.debtToOperatingIncome.quality).toBe("partial");
    expect(company.debtToOperatingIncome.note).toContain("Non-consecutive");
  });

  it("derives foreign revenue share only from comparable domicile and total revenue", () => {
    const rows = [
      point(2, "RevenueFromContractWithCustomerExcludingAssessedTax", "2025-12-31", 100),
      point(2, "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile", "2025-12-31", 40),
      point(2, "NotionalAmountOfForeignCurrencyDerivatives", "2025-12-31", 5),
    ];
    const company = buildCompanyExposure({ cik: 2, ticker: "PFE", name: "Pfizer", sector: "Health Care", rows }, "2026-01-31T00:00:00Z");
    expect(company.foreignRevenueShare.value).toBeCloseTo(0.6);
    expect(company.foreignRevenueShare.note).toContain("1 − domicile revenue");
    expect(company.foreignDerivativeNotional.value).toBe(5);
  });

  it("rejects foreign revenue ratios from different periods", () => {
    const rows = [
      point(2, "RevenueFromContractWithCustomerExcludingAssessedTax", "2025-12-31", 100),
      point(2, "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile", "2011-04-03", 40),
    ];
    const company = buildCompanyExposure({ cik: 2, ticker: "PFE", name: "Pfizer", sector: "Health Care", rows }, "2026-01-31T00:00:00Z");
    expect(company.foreignRevenueShare.quality).toBe("missing");
  });

  it("fails closed on negative operating income and excludes future periods", () => {
    const rows = [
      point(1, "LongTermDebt", "2025-12-31", 100),
      ...flows(1, "OperatingIncomeLoss", -5),
      point(1, "LongTermDebt", "2027-12-31", 999),
    ];
    const company = buildCompanyExposure({ cik: 1, ticker: "TEST", name: "Test", sector: null, rows }, "2026-01-31T00:00:00Z");
    expect(company.debt.value).toBe(100);
    expect(company.debtToOperatingIncome.quality).toBe("missing");
  });

  it("marks old evidence as stale instead of presenting it as current", () => {
    const company = buildCompanyExposure({ cik: 1, ticker: "OLD", name: "Old", sector: null, rows: [point(1, "LongTermDebt", "2020-12-31", 100)] }, "2026-01-31T00:00:00Z");
    expect(company.debt.stale).toBe(true);
    expect(company.debt.evidenceAgeDays).toBeGreaterThan(550);
  });

  it("merges targeted updates without dropping other companies", () => {
    const base = buildCompanyExposureReport([
      { cik: 1, ticker: "AAA", name: "A", sector: null, rows: [point(1, "LongTermDebt", "2025-12-31", 100)] },
      { cik: 2, ticker: "PFE", name: "Old PFE", sector: null, rows: [point(2, "LongTermDebt", "2025-12-31", 100)] },
    ], "2026-01-31T00:00:00Z", "2026-02-01T00:00:00Z");
    const update = buildCompanyExposureReport([{ cik: 2, ticker: "PFE", name: "New PFE", sector: null, rows: [] }], "2026-01-31T00:00:00Z", "2026-02-02T00:00:00Z");
    const merged = mergeCompanyExposureReports(base, update);
    expect(merged.companies).toHaveLength(2);
    expect(merged.companies.find((company) => company.ticker === "AAA")?.debt.value).toBe(100);
    expect(merged.companies.find((company) => company.ticker === "PFE")?.name).toBe("New PFE");
    expect(merged.universeSha256).toBe(base.universeSha256);
  });

  it("reports only actual coverage and never creates a direction score", () => {
    const report = buildCompanyExposureReport([{ cik: 1, ticker: "TEST", name: "Test", sector: null, rows: [point(1, "LongTermDebt", "2025-12-31", 100)] }], "2026-01-31T00:00:00Z", "2026-02-01T00:00:00Z");
    expect(report.coverage.debt).toBe(1);
    expect(report.coverage.foreignRevenueShare).toBe(0);
    expect(report.policy.noDirectionScore).toBe(true);
    expect(report.policy.noSectorInference).toBe(true);
  });

  const revision = (row: FundamentalSeriesRow, sourceFiled: string | null): FundamentalSeriesRow => ({ ...row, id: nextId++, sourceFiled });
  const exposureAt = (rows: FundamentalSeriesRow[], asOf = "2026-03-01T00:00:00Z") => buildCompanyExposure({ cik: 99, ticker: "F05", name: "Availability", sector: null, rows }, asOf);

  it("uses MAX TTM availability and ignores a later revision before its actual filing", () => {
    const rows = [...flows(1, "OperatingIncomeLoss", 20), point(1, "LongTermDebt", "2025-12-31", 100)];
    const lateRevision = revision(point(1, "OperatingIncomeLoss", "2025-03-31", 25), "2026-02-20");
    const before = exposureAt([...rows, lateRevision], "2026-02-15T00:00:00Z");
    expect(before.debtToOperatingIncome.value).toBe(1.25);
    expect(before.debtToOperatingIncome.sourceFiled).toBe("2025-12-01");
    const after = exposureAt([...rows, lateRevision]);
    expect(after.debtToOperatingIncome.value).toBeCloseTo(100 / 85);
    expect(after.debtToOperatingIncome.sourceFiled).toBe("2026-02-20");
    expect(after.debtToOperatingIncome.quality).toBe("available");
  });

  it("uses MAX availability for current plus noncurrent debt and rejects incompatible components", () => {
    const current = revision(point(1, "LongTermDebtCurrent", "2025-12-31", 50), "2026-01-15");
    const noncurrent = revision(point(1, "LongTermDebtNoncurrent", "2025-12-31", 100), "2026-02-01");
    const company = exposureAt([current, noncurrent]);
    expect(company.debt.value).toBe(150);
    expect(company.debt.sourceFiled).toBe("2026-02-01");
    const wrongPeriod = exposureAt([current, revision(point(1, "LongTermDebtNoncurrent", "2025-09-30", 100), "2026-02-01")]);
    expect(wrongPeriod.debt).toMatchObject({ value: null, quality: "missing" });
    const wrongUnit = exposureAt([current, { ...noncurrent, unit: "EUR" }]);
    expect(wrongUnit.debt).toMatchObject({ value: null, quality: "missing" });
  });

  it("uses MAX numerator and denominator availability for every ratio", () => {
    const debt = revision(point(1, "LongTermDebt", "2025-12-31", 100), "2026-02-15");
    const rows = [...flows(1, "OperatingIncomeLoss", 20), revision(point(1, "OperatingIncomeLoss", "2025-12-31", 20), "2026-02-10"), debt];
    const company = exposureAt(rows);
    expect(company.debtToOperatingIncome.sourceFiled).toBe("2026-02-15");
    expect(company.debtToOperatingIncome.quality).toBe("available");
  });

  it("rejects stock Q4 debt against TTM operating income ending in Q3", () => {
    const rows = ["2024-12-31", ...quarters.slice(0, 3)].map((periodEnd) => point(1, "OperatingIncomeLoss", periodEnd, 20));
    rows.push(point(1, "LongTermDebt", "2025-12-31", 100));
    const company = exposureAt(rows);
    expect(company.debtToOperatingIncome).toMatchObject({ value: null, quality: "missing" });
    expect(company.debtToOperatingIncome.note).toContain("incompatible periods 2025-12-31 vs 2025-09-30");
  });

  it("uses MAX availability for foreign revenue and rejects a period mismatch", () => {
    const total = revision(point(2, "RevenueFromContractWithCustomerExcludingAssessedTax", "2025-12-31", 100), "2026-02-10");
    const domestic = revision(point(2, "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile", "2025-12-31", 40), "2026-01-15");
    const company = exposureAt([total, domestic]);
    expect(company.foreignRevenueShare.value).toBeCloseTo(0.6);
    expect(company.foreignRevenueShare.sourceFiled).toBe("2026-02-10");
    const wrongPeriod = exposureAt([total, { ...domestic, periodEnd: "2025-09-30" }]);
    expect(wrongPeriod.foreignRevenueShare).toMatchObject({ value: null, quality: "missing" });
    expect(wrongPeriod.foreignRevenueShare.note).toContain("incompatible periods");
  });

  it("does not let null sourceFiled displace a known eligible vintage or create an available metric", () => {
    const known = revision(point(1, "LongTermDebt", "2025-12-31", 100), "2026-01-15");
    const unknown = revision(point(1, "LongTermDebt", "2025-12-31", 999), null);
    const company = exposureAt([known, unknown]);
    expect(company.debt).toMatchObject({ value: 100, sourceFiled: "2026-01-15", quality: "available" });
    expect(exposureAt([unknown]).debt).toMatchObject({ value: null, sourceFiled: null, quality: "missing" });
  });

  it("preserves fail-closed unit mismatch and non-positive denominator behavior", () => {
    const wrongUnit = point(1, "LongTermDebt", "2025-12-31", 100);
    wrongUnit.unit = "EUR";
    const incompatible = exposureAt([wrongUnit, ...flows(1, "OperatingIncomeLoss", 20)]);
    expect(incompatible.debtToOperatingIncome).toMatchObject({ value: null, quality: "missing" });
    expect(incompatible.debtToOperatingIncome.note).toContain("incompatible units");
    const zero = exposureAt([point(1, "LongTermDebt", "2025-12-31", 100), ...flows(1, "OperatingIncomeLoss", 0)]);
    expect(zero.debtToOperatingIncome).toMatchObject({ value: null, quality: "missing" });
  });
});
