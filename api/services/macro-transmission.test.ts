import { describe, expect, it } from "vitest";
import { buildMacroTransmissionAtlas, evaluateTransmissionModel, fitTransmissionModel, withInlineExposureHistory, type AtlasRecord } from "./macro-transmission";
import { buildMacroEventStudyReport } from "./macro-event-study";
import { buildCompanyExposure } from "./company-exposure";
import type { FundamentalSeriesRow } from "./fundamental-integrity";
import type { NormalizedMacroPoint } from "../../worker/lib/fred";
import type { PoliticalEvent } from "../../worker/lib/political-events";
import type { EventBar } from "./event-study";

const AS_OF = "2026-11-02T00:00:00.000Z";
const day = (index: number) => new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
const records = (split: AtlasRecord["split"], eventCount: number, companyCount: number, beta = 0.5): AtlasRecord[] => Array.from({ length: eventCount }, (_, event) => Array.from({ length: companyCount }, (_, company) => {
  const exposure = 1 + company * 0.2;
  const shock = (event % 3 - 1) * 0.01;
  const sector = company % 2 ? "Industrial" : "Technology";
  return {
    eventId: `${split}-${event}`,
    ticker: `C${company}`,
    sector,
    split,
    seriesId: "DGS10",
    channel: "rates" as const,
    exposureKind: "debt_burden" as const,
    horizon: "1" as const,
    shock,
    exposure,
    abnormalReturn: 0.001 + 0.2 * shock + 0.01 * exposure + beta * shock * exposure + (sector === "Industrial" ? 0.002 : -0.001),
    concepts: ["LongTermDebt"],
    exposurePeriodEnd: "2019-12-31",
    exposureSourceFiled: "2020-01-10",
  };
})).flat();

describe("macro transmission model", () => {
  it("recovers the interaction and applies frozen discovery coefficients to OOS", () => {
    const discovery = records("discovery", 14, 6);
    const fit = fitTransmissionModel(discovery, 7)!;
    expect(fit.betaInteraction).toBeCloseTo(0.5, 6);
    expect(fit.ci95Interaction).not.toBeNull();
    const evaluation = evaluateTransmissionModel(fit, records("out_of_sample", 12, 6))!;
    expect(evaluation.r2AgainstDiscoveryMean).toBeGreaterThan(0.99);
    expect(evaluation.rmse).toBeLessThan(1e-8);
  });

  it("fails closed for inadequate or singular evidence", () => {
    expect(fitTransmissionModel(records("discovery", 3, 2))).toBeNull();
    const singular = records("discovery", 14, 6).map((record) => ({ ...record, shock: 0.01, exposure: 1 }));
    expect(fitTransmissionModel(singular)).toBeNull();
  });
});

const macroPoint = (index: number, value: number, seriesId: string): NormalizedMacroPoint => ({
  seriesId,
  observationPeriod: day(index),
  value,
  unit: seriesId === "DGS10" ? "Percent" : "Dollars per Barrel",
  frequency: "Daily",
  releasedAt: null,
  availableAt: `${day(index)}T18:00:00.000Z`,
  availablePrecision: "day",
  availabilityBasis: "fred_realtime_start",
  researchEligibleAt: `${day(index)}T23:59:59.999Z`,
  vintageId: `${seriesId}|${day(index)}|${day(index)}`,
  supersededAt: null,
  ingestedAt: "2026-11-01T00:00:00.000Z",
  sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
  sourceHash: "fixture",
});
const macroEvent = (index: number): PoliticalEvent => ({
  eventId: `ofac:${String(index).padStart(8, "0")}`,
  source: "OFAC",
  title: `Event ${index}`,
  publishedAt: `${day(index)}T00:00:00.000Z`,
  availablePrecision: "day",
  researchEligibleAt: `${day(index)}T23:59:59.999Z`,
  effectiveAt: null,
  sourceUrl: `https://ofac.treasury.gov/recent-actions/${index}`,
  ingestedAt: "2026-11-01T00:00:00.000Z",
  sourceHash: "fixture",
});
const macroRows = (seriesId: string, start: number) => Array.from({ length: 190 }, (_, index) => macroPoint(index, start + index / 100 + Math.sin(index * 0.37) * 0.02, seriesId));
const fundamentals = (cik: number): FundamentalSeriesRow[] => {
  const rows: FundamentalSeriesRow[] = [];
  let id = 1;
  const add = (concept: string, kind: "flow" | "stock", periodEnd: string, val: number) => rows.push({ id: id++, cik, concept, kind, periodEnd, vintage: "latest", val, unit: "USD", derivation: "reported", sourceAccn: "fixture", sourceFiled: "2020-01-10" });
  add("LongTermDebt", "stock", "2019-12-31", 100 + cik);
  for (const periodEnd of ["2019-03-31", "2019-06-30", "2019-09-30", "2019-12-31"]) {
    add("OperatingIncomeLoss", "flow", periodEnd, 50);
    add("FuelCosts", "flow", periodEnd, 20 + cik);
    add("OilAndGasRevenue", "flow", periodEnd, 30 + cik * 2);
    add("CostOfPurchasedOilAndGas", "flow", periodEnd, 10 + cik);
  }
  return rows;
};
const bars = (cik: number): EventBar[] => Array.from({ length: 400 }, (_, index) => ({ date: day(index - 150), close: 50 + cik + index * 0.1 }));
const spyBars: EventBar[] = Array.from({ length: 400 }, (_, index) => ({ date: day(index - 150), close: 100 + index * 0.05 }));

describe("macro transmission atlas", () => {
  it("builds aligned exposure ratios and full discovery/OOS studies", () => {
    const macro = buildMacroEventStudyReport({
      events: Array.from({ length: 40 }, (_, index) => macroEvent(10 + index * 2)),
      series: [
        { seriesId: "DGS10", channel: "rates", rows: macroRows("DGS10", 2) },
        { seriesId: "DCOILWTICO", channel: "oil", rows: macroRows("DCOILWTICO", 100) },
      ],
      asOf: AS_OF,
      generatedAt: AS_OF,
    });
    const report = buildMacroTransmissionAtlas({
      macroObservations: macro.observations,
      companies: Array.from({ length: 6 }, (_, index) => ({ cik: index + 1, ticker: `C${index + 1}`, sector: index % 2 ? "Industrial" : "Technology", rows: fundamentals(index + 1), bars: bars(index + 1) })),
      spyBars,
      asOf: AS_OF,
      generatedAt: AS_OF,
      dataMode: "fixture",
    });
    expect(report.records).toHaveLength(3840);
    expect(report.coverage.exposureMissing).toBe(0);
    expect(report.coverage.exposurePartial).toBe(0);
    expect(report.coverage.exposureStale).toBe(0);
    expect(report.coverage.shockMissing).toBe(0);
    expect(report.status).toBe("estimated");
    expect(report.studies.every((study) => study.discovery && study.outOfSample)).toBe(true);
    const oil = report.records.find((record) => record.exposureKind === "oil_revenue")!;
    expect(oil.exposure).toBeCloseTo(0.64);
    expect(oil.concepts).toContain("OilAndGasRevenue");
  });

  it("keeps non-consecutive TTM partial for diagnostics but out of research records", () => {
    const macro = buildMacroEventStudyReport({
      events: Array.from({ length: 40 }, (_, index) => macroEvent(10 + index * 2)),
      series: [{ seriesId: "DGS10", channel: "rates", rows: macroRows("DGS10", 2) }],
      asOf: AS_OF,
      generatedAt: AS_OF,
    });
    const rows = fundamentals(1).filter((row) => row.concept !== "OperatingIncomeLoss" || row.periodEnd !== "2019-09-30");
    const report = buildMacroTransmissionAtlas({
      macroObservations: macro.observations,
      companies: [{ cik: 1, ticker: "GAP", sector: null, rows, bars: bars(1) }],
      spyBars,
      asOf: AS_OF,
      generatedAt: AS_OF,
      dataMode: "fixture",
    });
    expect(report.coverage.candidatePairs).toBeGreaterThan(0);
    expect(report.coverage.exposurePartial).toBe(report.coverage.candidatePairs);
    expect(report.records).toEqual([]);
    expect(report.studies.every((study) => study.status === "insufficient_coverage")).toBe(true);
  });

  it("uses inline exposure only when available and divides flows by matching-period operating income", () => {
    const legacy = buildCompanyExposure({ cik: 1, ticker: "C1", name: "C1", sector: "Technology", rows: fundamentals(1) }, AS_OF);
    const history: import("../../worker/lib/exposure-aggregation").ExposureFiling[] = [{
      cik: 1, ticker: "C1", accessionNo: "annual", form: "10-K", filingDate: "2020-01-10", sourceUrl: "https://sec.gov/annual", sourceHash: "hash", missing: [],
      measures: [
        { kind: "foreignRevenueShare", value: 0.6, unit: "ratio", periodStart: "2019-01-01", periodEnd: "2019-12-31", availableAt: "2020-01-10", facts: [] },
        { kind: "fuelCost", value: 100, unit: "USD", periodStart: "2019-01-01", periodEnd: "2019-12-31", availableAt: "2020-01-10", facts: [] },
        { kind: "operatingIncome", value: 200, unit: "USD", periodStart: "2019-01-01", periodEnd: "2019-12-31", availableAt: "2020-01-10", facts: [] },
      ],
    }];
    const before = withInlineExposureHistory(legacy, history, "2020-01-09T23:59:59.999Z");
    expect(before.foreignRevenueShare.value).toBe(legacy.foreignRevenueShare.value);
    expect(before.fuelCostToOperatingIncome.value).not.toBe(0.5);
    const current = withInlineExposureHistory(legacy, history, "2020-03-01T00:00:00Z");
    expect(current.foreignRevenueShare.value).toBe(0.6);
    expect(current.fuelCostToOperatingIncome.value).toBe(0.5);
    expect(current.fuelCostToOperatingIncome.sourceFiled).toBe("2020-01-10");
    const mismatched: import("../../worker/lib/exposure-aggregation").ExposureFiling[] = [{ ...history[0], accessionNo: "mismatch", form: "10-Q", filingDate: "2020-02-01", measures: history[0].measures.map(measure => measure.kind === "operatingIncome" ? { ...measure, periodStart: "2019-10-01" } : measure.kind === "fuelCost" ? { ...measure, value: 120 } : measure) }];
    expect(withInlineExposureHistory(legacy, mismatched, "2020-03-01T00:00:00Z").fuelCostToOperatingIncome.value).not.toBe(0.6);
  });
});
