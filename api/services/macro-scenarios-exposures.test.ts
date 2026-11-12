import { describe, expect, it } from "vitest";
import { buildMacroScenarioReport } from "./macro-scenarios";
import type { PilotEvidence } from "./pilot-exposure-evidence";
import type { CompanyExposureRow, ExposureMetric } from "./company-exposure";
import type { ExposureFiling, ExposureMeasureKind } from "../../worker/lib/exposure-aggregation";
import type { NormalizedMacroPoint } from "../../worker/lib/fred";

const AS_OF = "2026-11-02T00:00:00Z";
const metric: ExposureMetric = { value: 1000, unit: "USD", concepts: ["LongTermDebt"], periodEnd: "2026-09-30", sourceFiled: "2026-10-30", quality: "available", note: null };
const missing: ExposureMetric = { value: null, unit: null, concepts: [], periodEnd: null, sourceFiled: null, quality: "missing", note: null };
const company: CompanyExposureRow = { cik: 1, ticker: "RCL", name: "Example", sector: "Industrials", debt: metric, debtToOperatingIncome: missing, interestCoverage: missing, cashToDebt: missing, fuelCostToOperatingIncome: missing, oilRevenue: missing, oilCost: missing, foreignRevenueShare: missing, foreignDerivativeNotional: missing, missing: [] };
const pilot: PilotEvidence = { cik: 1, ticker: "RCL", sourceFactsSha256: "abc", fixedInterestShare: null, weightedAverageInterestRate: null, interestRateHedgeShare: null, effectiveInterestRate: null, debtMaturities: [], fuelCost: null, oilRevenue: null, oilCost: null, foreignRevenueShare: null, foreignDerivativeNotional: null, missing: [] };
function macro(seriesId: string): NormalizedMacroPoint {
  return { seriesId, observationPeriod: "2026-10-29", value: 4, unit: "Percent", frequency: "Daily", releasedAt: null, availableAt: "2026-10-30T00:00:00Z", availablePrecision: "day", availabilityBasis: "fred_realtime_start", researchEligibleAt: "2026-10-30T00:00:00Z", vintageId: seriesId, supersededAt: null, ingestedAt: "2026-10-30T00:00:00Z", sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`, sourceHash: "abc" };
}
function filing(measures: ExposureMeasureKind[]): ExposureFiling {
  return { cik: 1, ticker: "RCL", accessionNo: "0000000001-26-000010", form: "10-K", filingDate: "2026-10-30", sourceUrl: "https://www.sec.gov/filing.htm", sourceHash: "abc", measures: measures.map(kind => ({ kind, value: kind === "foreignRevenueShare" ? 0.6 : kind === "debtMaturingNext12" ? 200 : kind === "cashShortTerm" || kind === "fuelCost" ? 100 : 1000, unit: kind === "foreignRevenueShare" ? "ratio" : "USD", periodStart: null, periodEnd: "2026-09-26", availableAt: "2026-10-30", facts: [{ id: kind, concept: `us-gaap:${kind}`, contextRef: "c-1", value: 100, rawValue: "100", unitRef: "usd", scale: "6", sign: null, decimals: "-6", context: { id: "c-1", startDate: null, endDate: null, instant: "2026-09-26", dimensions: {} }, excerpt: `<ix:nonFraction name="us-gaap:${kind}" scale="6">100</ix:nonFraction>` }] })), missing: [] };
}
const macroSeries = Object.fromEntries(["DGS10", "DCOILWTICO", "DTWEXBGS", "BAMLH0A0HYM2"].map(seriesId => [seriesId, [macro(seriesId)]]));
const atlasRecords = (["rates", "credit", "oil", "usd"] as const).map(channel => ({ ticker: "RCL", channel, exposureKind: channel === "rates" || channel === "credit" ? "debt_burden" : channel === "oil" ? "fuel_cost" : "foreign_revenue", horizon: "1", shock: 0.01, exposure: 1, abnormalReturn: -0.01 }));

describe("inline-XBRL scenario integration", () => {
  it("uses new maturity, segment and cost evidence and attaches atlas responses for every channel", () => {
    const report = buildMacroScenarioReport({ asOf: AS_OF, definitions: [{ channel: "rates", shock: 0.01 }, { channel: "oil", shock: 0.2 }, { channel: "usd", shock: 0.05 }, { channel: "credit", shock: 0.01 }], macroSeries, pilot: [pilot], exposures: [company], exposureHistory: [filing(["debtMaturingNext12", "cashShortTerm", "operatingIncome", "fuelCost", "foreignRevenueShare"]), filing(["foreignRevenueShare"])], atlasRecords, atlasAsOf: AS_OF });
    expect(report.scenarios.map(scenario => scenario.impacts[0].metrics[0].value)).toEqual([1, 20, -0.03, 2]);
    expect(report.scenarios[3].impacts[0].metrics[0].unit).toBe("USD/year");
    expect(report.scenarios.map(scenario => scenario.impacts[0].measuredResponse?.status)).toEqual(["available", "available", "available", "available"]);
    expect(report.scenarios.map(scenario => scenario.impacts[0].measuredResponse?.disagreement)).toEqual(["aligned", "aligned", "aligned", "aligned"]);
    expect(report.scenarios[0].impacts[0].exposureEvidence?.[0].measures[0].facts[0].excerpt).toContain("ix:nonFraction");
  });

  it("applies the interest-margin status to financial companies", () => {
    const report = buildMacroScenarioReport({ asOf: AS_OF, definitions: [{ channel: "rates", shock: 0.01 }], macroSeries, pilot: [{ ...pilot, ticker: "JPM" }], exposures: [{ ...company, ticker: "JPM", sector: "Financials" }], exposureHistory: [{ ...filing(["debtMaturingNext12", "cashShortTerm"]), ticker: "JPM" }] });
    expect(report.scenarios[0].impacts[0].status).toBe("not_applicable");
    expect(report.scenarios[0].impacts[0].reasons).toContain("rate_exposure_works_through_interest_margin");
  });

  it("retains a valid legacy bound only when the latest annual filing lacks maturity evidence", () => {
    const fixed = { metric: "fixed", concept: "fixed", value: 0.5, unit: "ratio", periodStart: null, periodEnd: "2026-09-30", availableAt: "2026-10-30T23:59:59.999Z", form: "10-Q", accessionNo: "accn", sourceUrl: "https://sec.gov/", sourceFactsSha256: "abc", stale: false, note: null };
    const report = buildMacroScenarioReport({ asOf: AS_OF, definitions: [{ channel: "rates", shock: 0.01 }], macroSeries, pilot: [{ ...pilot, fixedInterestShare: fixed }], exposures: [company], exposureHistory: [filing([])] });
    const impact = report.scenarios[0].impacts[0];
    expect(impact.status).toBe("computable");
    expect(impact.metrics[0].value).toBe(5);
    expect(impact.reasons).toContain("latest_10k_maturity_unavailable_legacy_evidence_retained");
  });

  it("does not keep a stale legacy oil cost beside a new current oil revenue", () => {
    const oldCost = { metric: "oil_cost", concept: "CostOfPurchasedOilAndGas", value: 50, unit: "USD", periodStart: null, periodEnd: "2020-01-01", availableAt: "2021-02-01T23:59:59.999Z", form: "10-K", accessionNo: "old", sourceUrl: "https://sec.gov/", sourceFactsSha256: "abc", stale: true, note: null };
    const report = buildMacroScenarioReport({ asOf: AS_OF, definitions: [{ channel: "oil", shock: 0.2 }], macroSeries, pilot: [{ ...pilot, oilCost: oldCost }], exposures: [company], exposureHistory: [filing(["oilAndGasRevenue", "operatingIncome"])] });
    const impact = report.scenarios[0].impacts[0];
    expect(impact.status).toBe("computable");
    expect(impact.metrics.map(metric => metric.name)).toEqual(["oil_revenue_gross"]);
    expect(impact.metrics[0].value).toBe(200);
    expect(impact.reasons).toContain("stale_legacy_metrics_omitted_after_inline_update");
  });
});
