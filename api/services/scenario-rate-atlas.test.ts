import { describe, expect, it } from "vitest";
import { attachMeasuredResponse, latestAnnualExposure, maturityRateImpact } from "./scenario-rate-atlas";
import type { CompanyExposureRow, ExposureMetric } from "./company-exposure";
import type { ExposureFiling, ExposureMeasure, ExposureMeasureKind } from "../../worker/lib/exposure-aggregation";

const AS_OF = "2026-11-02T00:00:00Z";
function measure(kind: ExposureMeasureKind, value: number, availableAt = "2026-10-30"): ExposureMeasure {
  return {
    kind, value, unit: kind === "foreignRevenueShare" || kind === "floatingRateShare" ? "ratio" : "USD",
    periodStart: kind === "operatingIncome" ? "2026-01-01" : null, periodEnd: "2026-09-26", availableAt,
    facts: [{ id: `fact-${kind}`, concept: `us-gaap:${kind}`, contextRef: "c-1", value, rawValue: String(value), unitRef: "usd", scale: null, sign: null, decimals: "-3", context: { id: "c-1", startDate: null, endDate: null, instant: "2026-09-26", dimensions: {} }, excerpt: `<ix:nonFraction name="us-gaap:${kind}" contextRef="c-1">${value}</ix:nonFraction>` }],
  };
}
function filing(measures: ExposureMeasure[], filingDate = "2026-10-30"): ExposureFiling {
  return { cik: 1, ticker: "AAA", accessionNo: "0000000001-26-000010", form: "10-K", filingDate, sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000126000010/a.htm", sourceHash: "abc", measures, missing: [] };
}
function exposure(sector = "Industrials", debt = 200): CompanyExposureRow {
  const metric: ExposureMetric = { value: debt, unit: "USD", concepts: ["LongTermDebt"], periodEnd: "2026-09-26", sourceFiled: "2026-10-30", quality: "available", note: null };
  const missing: ExposureMetric = { value: null, unit: null, concepts: [], periodEnd: null, sourceFiled: null, quality: "missing", note: null };
  return { cik: 1, ticker: "AAA", name: "Example", sector, debt: metric, debtToOperatingIncome: missing, interestCoverage: missing, cashToDebt: missing, fuelCostToOperatingIncome: missing, oilRevenue: missing, oilCost: missing, foreignRevenueShare: missing, foreignDerivativeNotional: missing, missing: [] };
}

describe("maturity-based rate impact", () => {
  it("uses next-year and year-two maturities, floating debt and the cash offset", () => {
    const result = maturityRateImpact(exposure(), filing([measure("debtMaturingNext12", 100), measure("debtMaturingYearTwo", 50), measure("floatingRateDebt", 25), measure("cashShortTerm", 50), measure("operatingIncome", 500)]), 0.01, AS_OF);
    expect(result.metrics.map(metric => metric.value)).toEqual([1.25, 0.0025]);
    expect(result.metrics.map(metric => metric.unit)).toEqual(["USD/year", "ratio"]);
    expect(result.status).toBe("computable");
    expect(result.exposureEvidence?.[0].accessionNo).toBe("0000000001-26-000010");
    expect(result.exposureEvidence?.[0].measures[0].facts[0].excerpt).toContain("ix:nonFraction");
    expect(result.reasons).toContain("floating_rate_maturity_overlap_not_adjusted");
  });

  it("normalizes a percentage-shaped floating share before applying it to debt", () => {
    const result = maturityRateImpact(exposure(), filing([measure("debtMaturingNext12", 100), measure("floatingRateShare", 50), measure("cashShortTerm", 0), measure("operatingIncome", 500)]), 0.01, AS_OF);
    expect(result.metrics[0].value).toBe(2);
    expect(result.reasons).toContain("floating_rate_share_applied_to_company_exposure_debt");
  });

  it("labels a current-debt proxy in the rate formula and reasons", () => {
    const current = filing([measure("debtMaturingNext12", 100), measure("cashShortTerm", 0), measure("operatingIncome", 500)]);
    current.measures[0].note = "Current-debt aggregate us-gaap:LongTermDebtCurrent used as a next-12-month refinancing proxy";
    const result = maturityRateImpact(exposure(), current, 0.01, AS_OF);
    expect(result.metrics[0].formula).toContain("currentDebtAggregate 100");
    expect(result.reasons).toContain("current_debt_aggregate_fallback");
  });

  it("marks banks and insurers not applicable rather than treating debt as an industrial liability", () => {
    const result = maturityRateImpact(exposure("Financials"), undefined, 0.01, AS_OF);
    expect(result.status).toBe("not_applicable");
    expect(result.reasons).toEqual(["rate_exposure_works_through_interest_margin"]);
    expect(result.metrics).toEqual([]);
  });

  it("does not use a latest 10-K or measure that was unavailable at the as-of date", () => {
    expect(latestAnnualExposure([filing([], "2025-11-01"), filing([], "2026-11-03")], AS_OF)?.filingDate).toBe("2025-11-01");
    const result = maturityRateImpact(exposure(), filing([measure("debtMaturingNext12", 100, "2026-11-03"), measure("cashShortTerm", 50)]), 0.01, AS_OF);
    expect(result.status).toBe("not_computable");
    expect(result.reasons).toContain("maturity_or_cash_missing_invalid_or_unavailable_asof");
    expect(maturityRateImpact(exposure(), undefined, 0.01, AS_OF).reasons).toContain("latest_10k_unavailable_asof");
  });
});

describe("measured macro response", () => {
  it("computes a median and empirical p05/p95 interval and marks opposite signs", () => {
    const impact = maturityRateImpact(exposure(), filing([measure("debtMaturingNext12", 100), measure("cashShortTerm", 0)]), 0.01, AS_OF);
    const result = attachMeasuredResponse(impact, "rates", [
      { ticker: "AAA", channel: "rates", exposureKind: "debt_burden", horizon: "1", shock: 0.01, exposure: 5, abnormalReturn: 0.02 },
      { ticker: "AAA", channel: "rates", exposureKind: "debt_burden", horizon: "5", shock: 0.02, exposure: 5, abnormalReturn: 0.02 },
      { ticker: "AAA", channel: "rates", exposureKind: "debt_burden", horizon: "21", shock: 0.01, exposure: 5, abnormalReturn: -0.02 },
    ], AS_OF);
    expect(result.measuredResponse).toMatchObject({ status: "available", median: 1, interval: [-1.7, 1.9], count: 3, disagreement: "sign_disagreement", intervalBasis: "empirical_p05_p95_not_confidence_interval" });
    expect(result.measuredResponse?.horizons).toEqual(["1", "5", "21"]);
  });

  it("distinguishes no market response from sign disagreement and unavailable company coverage", () => {
    const impact = maturityRateImpact(exposure(), filing([measure("debtMaturingNext12", 100), measure("cashShortTerm", 0)]), 0.01, AS_OF);
    const quiet = attachMeasuredResponse(impact, "rates", [{ ticker: "AAA", channel: "rates", exposureKind: "debt_burden", horizon: "1", shock: 0.01, exposure: 1, abnormalReturn: 0.000001 }], AS_OF);
    expect(quiet.measuredResponse?.disagreement).toBe("market_unresponsive");
    expect(attachMeasuredResponse(impact, "usd", [], AS_OF).measuredResponse).toMatchObject({ status: "unavailable", reason: "atlas_company_not_covered" });
    expect(attachMeasuredResponse(impact, "rates", undefined, AS_OF).measuredResponse?.reason).toBe("atlas_not_provided");
  });

  it("does not use exposure evidence filed after the comparison date", () => {
    const impact = maturityRateImpact(exposure(), filing([measure("debtMaturingNext12", 100), measure("cashShortTerm", 0)]), 0.01, AS_OF);
    const result = attachMeasuredResponse(impact, "rates", [{ ticker: "AAA", channel: "rates", exposureKind: "debt_burden", horizon: "1", shock: 0.01, exposure: 1, abnormalReturn: -0.01, exposureSourceFiled: "2026-11-03" }], AS_OF);
    expect(result.measuredResponse?.status).toBe("unavailable");
  });
});
