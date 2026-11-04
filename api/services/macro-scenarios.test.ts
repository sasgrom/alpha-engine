import { describe, expect, it } from "vitest";
import { buildMacroScenarioReport, latestMacroPoint } from "./macro-scenarios";
import type { NormalizedMacroPoint } from "../../worker/lib/fred";
import type { ExposureEvidence, PilotEvidence } from "./pilot-exposure-evidence";
import type { CompanyExposureRow, ExposureMetric } from "./company-exposure";

const AS_OF = "2026-11-02T00:00:00Z";
const evidence = (metric: string, value: number, stale = false): ExposureEvidence => ({
  metric, concept: metric, value, unit: "USD", periodStart: null, periodEnd: stale ? "2020-12-31" : "2026-09-30", availableAt: stale ? "2021-01-30T23:59:59.999Z" : "2026-10-30T23:59:59.999Z",
  form: "10-Q", accessionNo: "accn", sourceUrl: "https://sec.gov/", sourceFactsSha256: "abc", stale, note: null,
});
const metric = (value: number | null, stale = false): ExposureMetric => ({ value, unit: "USD", concepts: ["LongTermDebt"], periodEnd: stale ? "2020-12-31" : "2026-09-30", sourceFiled: stale ? "2021-01-30" : "2026-10-30", quality: value === null ? "missing" : "available", note: null, stale });
const exposure = (ticker: string, debt: number | null): CompanyExposureRow => ({
  cik: 1, ticker, name: ticker, sector: null,
  debt: metric(debt), debtToOperatingIncome: metric(null), interestCoverage: metric(null), cashToDebt: metric(null), fuelCostToOperatingIncome: metric(null), oilRevenue: metric(null), oilCost: metric(null), foreignRevenueShare: metric(null), foreignDerivativeNotional: metric(null), missing: [],
});
const pilot = (ticker: string, overrides: Partial<PilotEvidence> = {}): PilotEvidence => ({
  cik: 1, ticker, sourceFactsSha256: "abc", fixedInterestShare: null, weightedAverageInterestRate: null, interestRateHedgeShare: null, effectiveInterestRate: null,
  debtMaturities: [], fuelCost: null, oilRevenue: null, oilCost: null, foreignRevenueShare: null, foreignDerivativeNotional: null, missing: [], ...overrides,
});
const macro = (value: number, availableAt = "2026-10-30T00:00:00.000Z", seriesId = "DGS10"): NormalizedMacroPoint => ({
  seriesId, observationPeriod: "2026-10-29", value, unit: "Percent", frequency: "Daily", releasedAt: null, availableAt,
  availablePrecision: "day", availabilityBasis: "fred_realtime_start", researchEligibleAt: availableAt, vintageId: `${seriesId}|${value}|${availableAt}`,
  supersededAt: null, ingestedAt: "2026-11-01T00:00:00Z", sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`, sourceHash: "abc",
});
const input = (pilotRows: PilotEvidence[], exposureRows: CompanyExposureRow[], shock = 0.01) => ({
  asOf: AS_OF,
  definitions: [{ channel: "rates" as const, shock }],
  macroSeries: {
    DGS10: [macro(4)],
    DCOILWTICO: [macro(80, "2026-10-30T00:00:00.000Z", "DCOILWTICO")],
    DTWEXBGS: [macro(100, "2026-10-30T00:00:00.000Z", "DTWEXBGS")],
    BAMLH0A0HYM2: [macro(3, "2026-10-30T00:00:00.000Z", "BAMLH0A0HYM2")],
  },
  pilot: pilotRows,
  exposures: exposureRows,
});

describe("macro scenarios", () => {
  it("computes an exposed-debt upper bound when hedge share is unknown", () => {
    const report = buildMacroScenarioReport(input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) })], [exposure("RCL", 22_872_000_000)]));
    const impact = report.scenarios[0].impacts[0];
    expect(impact.status).toBe("computable");
    expect(impact.metrics[0].impactType).toBe("upper_bound");
    expect(impact.metrics[0].value).toBeCloseTo(6_861_600);
    expect(impact.metrics[0].unit).toBe("USD/year");
    expect(report.scenarios[0].status).toBe("complete");
    expect(report.scenarios[0].baseline?.scenarioValue).toBeCloseTo(5);
  });

  it("marks a scenario partial when only a subset of companies computes", () => {
    const report = buildMacroScenarioReport(input([
      pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) }),
      pilot("PFE"),
    ], [exposure("RCL", 22_872_000_000), exposure("PFE", 4_000_000_000)]));
    expect(report.scenarios[0].status).toBe("partial");
  });

  it("uses a known current hedge share instead of an upper bound", () => {
    const report = buildMacroScenarioReport(input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97), interestRateHedgeShare: evidence("hedge", 0.5) })], [exposure("RCL", 22_872_000_000)]));
    expect(report.scenarios[0].impacts[0].metrics[0].impactType).toBe("estimate");
    expect(report.scenarios[0].impacts[0].metrics[0].value).toBeCloseTo(3_430_800);
  });

  it("computes gross fuel exposure and marks stale fuel historical only", () => {
    const current = buildMacroScenarioReport({ ...input([pilot("DAL", { fuelCost: evidence("FuelCosts", 11_202_000_000) })], []), definitions: [{ channel: "oil", shock: 0.2 }] });
    expect(current.scenarios[0].impacts[0].status).toBe("computable");
    expect(current.scenarios[0].impacts[0].metrics[0].value).toBeCloseTo(2_240_400_000);
    expect(current.scenarios[0].impacts[0].metrics[0].impactType).toBe("gross_exposure");
    const stale = buildMacroScenarioReport({ ...input([pilot("RCL", { fuelCost: evidence("FuelCosts", 385_322_000, true) })], []), definitions: [{ channel: "oil", shock: 0.2 }] });
    expect(stale.scenarios[0].impacts[0].status).toBe("historical_only");
    expect(stale.scenarios[0].impacts[0].metrics[0].value).toBeCloseTo(77_064_400);
  });

  it("does not compute USD exposure without a valid foreign revenue share", () => {
    const report = buildMacroScenarioReport({ ...input([pilot("PFE")], []), definitions: [{ channel: "usd", shock: 0.05 }] });
    expect(report.scenarios[0].impacts[0].status).toBe("not_computable");
    expect(report.scenarios[0].impacts[0].metrics).toEqual([]);
  });

  it("fails closed for credit scenarios without new issuance terms", () => {
    const report = buildMacroScenarioReport({ ...input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) })], [exposure("RCL", 22_872_000_000)]), definitions: [{ channel: "credit", shock: 0.01 }] });
    expect(report.scenarios[0].impacts[0].status).toBe("not_computable");
    expect(report.scenarios[0].impacts[0].reasons).toContain("new_issuance_spread_maturity_and_rating_missing");
  });

  it("excludes future FRED observations from the baseline", () => {
    const rows = [macro(0.04), macro(0.09, "2027-01-01T00:00:00.000Z")];
    expect(latestMacroPoint(rows, AS_OF)?.value).toBe(0.04);
    expect(latestMacroPoint(rows, "2026-10-01T00:00:00Z")).toBeNull();
  });

  it("rejects SEC evidence that was unavailable at the scenario as-of date", () => {
    const future = evidence("fixed", 0.97);
    future.availableAt = "2027-01-01T00:00:00.000Z";
    const report = buildMacroScenarioReport(input([pilot("RCL", { fixedInterestShare: future })], [exposure("RCL", 22_872_000_000)]));
    expect(report.scenarios[0].impacts[0].status).toBe("not_computable");
    expect(report.scenarios[0].impacts[0].reasons).toContain("fixed_interest_share_unavailable_asof");
  });

  it("marks the scenario historical when the FRED baseline is stale", () => {
    const old = macro(0.04);
    old.observationPeriod = "2020-01-01";
    const report = buildMacroScenarioReport({ ...input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) })], [exposure("RCL", 22_872_000_000)]), macroSeries: { DGS10: [old] } });
    expect(report.scenarios[0].status).toBe("historical_only");
  });

  it("fails closed for an unsupported rate baseline unit", () => {
    const unsupported = macro(4);
    unsupported.unit = "Basis points";
    const report = buildMacroScenarioReport({ ...input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) })], [exposure("RCL", 22_872_000_000)]), macroSeries: { DGS10: [unsupported] } });
    expect(report.scenarios[0].status).toBe("not_computable");
    expect(report.scenarios[0].reasons).toContain("unsupported_baseline_unit");
  });

  it("rejects out-of-range shocks and missing baselines", () => {
    const out = buildMacroScenarioReport({ ...input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) })], [exposure("RCL", 22_872_000_000)], 0.5) });
    expect(out.scenarios[0].status).toBe("not_computable");
    expect(out.scenarios[0].reasons).toContain("shock_out_of_bounds");
    const missing = buildMacroScenarioReport({ ...input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) })], [exposure("RCL", 22_872_000_000)]), macroSeries: {} });
    expect(missing.scenarios[0].status).toBe("not_computable");
    expect(missing.scenarios[0].reasons).toContain("fred_baseline_missing");
  });

  it("rejects partial debt and unknown availability instead of turning display evidence into a scenario", () => {
    const partial = exposure("RCL", 100);
    partial.debt.quality = "partial";
    const partialReport = buildMacroScenarioReport(input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) })], [partial]));
    expect(partialReport.scenarios[0].impacts[0].status).toBe("not_computable");
    expect(partialReport.scenarios[0].impacts[0].reasons).toContain("debt_missing_invalid_or_partial");
    expect(partialReport.scenarios[0].impacts[0].metrics).toEqual([]);

    const unknown = exposure("RCL", 100);
    unknown.debt.sourceFiled = null;
    const unknownReport = buildMacroScenarioReport(input([pilot("RCL", { fixedInterestShare: evidence("fixed", 0.97) })], [unknown]));
    expect(unknownReport.scenarios[0].impacts[0].status).toBe("not_computable");
    expect(unknownReport.scenarios[0].impacts[0].reasons).toContain("debt_unavailable_asof");
  });
});
