import { describe, expect, it } from "vitest";
import { buildMacroEventStudyReport, firstReleasePoints, movingBlockMeanCi } from "./macro-event-study";
import type { NormalizedMacroPoint } from "../../worker/lib/fred";
import type { PoliticalEvent } from "../../worker/lib/political-events";

const AS_OF = "2026-11-02T00:00:00.000Z";
const day = (index: number) => new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
const point = (index: number, value: number, seriesId = "DGS10", availableAt = `${day(index)}T18:00:00.000Z`): NormalizedMacroPoint => ({
  seriesId,
  observationPeriod: day(index),
  value,
  unit: seriesId === "DCOILWTICO" || seriesId === "DTWEXBGS" ? "Index" : "Percent",
  frequency: "Daily",
  releasedAt: null,
  availableAt,
  availablePrecision: "day",
  availabilityBasis: "fred_realtime_start",
  researchEligibleAt: `${availableAt.slice(0, 10)}T23:59:59.999Z`,
  vintageId: `${seriesId}|${day(index)}|${availableAt}`,
  supersededAt: null,
  ingestedAt: "2026-11-01T00:00:00.000Z",
  sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
  sourceHash: "abc",
});
const event = (index: number): PoliticalEvent => ({
  eventId: `ofac:${String(index).padStart(8, "0")}`,
  source: "OFAC",
  title: `Event ${index}`,
  publishedAt: `${day(index)}T00:00:00.000Z`,
  availablePrecision: "day",
  researchEligibleAt: `${day(index)}T23:59:59.999Z`,
  effectiveAt: null,
  sourceUrl: `https://ofac.treasury.gov/recent-actions/${index}`,
  ingestedAt: "2026-11-01T00:00:00.000Z",
  sourceHash: "event",
});
const rows = (seriesId: string, start: number) => Array.from({ length: 140 }, (_, index) => point(index, start + index / 100, seriesId));
const series = () => [
  { seriesId: "DGS10", channel: "rates" as const, rows: rows("DGS10", 2) },
  { seriesId: "DCOILWTICO", channel: "oil" as const, rows: rows("DCOILWTICO", 100) },
  { seriesId: "DTWEXBGS", channel: "usd" as const, rows: rows("DTWEXBGS", 100) },
  { seriesId: "BAMLH0A0HYM2", channel: "credit" as const, rows: rows("BAMLH0A0HYM2", 3) },
];
const events = (count = 20) => Array.from({ length: count }, (_, index) => event(10 + index * 3));

describe("macro event study", () => {
  it("uses first-release observations, next-day outcomes and chronological OOS", () => {
    const inputSeries = series();
    inputSeries[0].rows.push(point(10, 99, "DGS10", "2020-02-01T00:00:00.000Z"));
    const report = buildMacroEventStudyReport({ events: events(), series: inputSeries, asOf: AS_OF, generatedAt: AS_OF });
    expect(report.events.discovery).toBe(14);
    expect(report.events.outOfSample).toBe(6);
    expect(report.status).toBe("ready");
    const first = report.observations.find((observation) => observation.eventId === "ofac:00000010" && observation.seriesId === "DGS10")!;
    expect(first.baseline.value).toBe(2.1);
    expect(first.outcomes["1"]?.observationPeriod).toBe(day(11));
    expect(first.outcomes["1"]?.change).toBeCloseTo(0.0001);
    expect(first.split).toBe("discovery");
    expect(report.observations.at(-1)?.split).toBe("out_of_sample");
  });

  it("excludes future availability and events collected after the report as-of", () => {
    const current = point(1, 2.5);
    const futureRevision = point(1, 9, "DGS10", "2027-01-01T00:00:00.000Z");
    expect(firstReleasePoints([current, futureRevision], AS_OF)).toHaveLength(1);
    expect(firstReleasePoints([current, futureRevision], AS_OF)[0].value).toBe(2.5);
    const futureEvent = { ...event(12), ingestedAt: "2027-01-01T00:00:00.000Z" };
    const report = buildMacroEventStudyReport({ events: [futureEvent], series: series().slice(0, 1), asOf: AS_OF, generatedAt: AS_OF });
    expect(report.events.eligible).toBe(0);
    expect(report.observations).toHaveLength(0);
  });

  it("keeps confidence intervals deterministic and fails closed below five events per split", () => {
    const values = [0.01, 0.02, -0.01, 0.03, 0.00, 0.01];
    expect(movingBlockMeanCi(values, 42)).toEqual(movingBlockMeanCi(values, 42));
    const report = buildMacroEventStudyReport({ events: events(4), series: series(), asOf: AS_OF, generatedAt: AS_OF });
    expect(report.status).toBe("insufficient_events");
    expect(report.studies[0].horizons["1"].discovery).toBeNull();
    expect(report.studies[0].horizons["1"].outOfSample).toBeNull();
  });

  it("rejects duplicate event IDs instead of double-counting them", () => {
    expect(() => buildMacroEventStudyReport({ events: [event(10), event(10)], series: series(), asOf: AS_OF, generatedAt: AS_OF })).toThrow("Duplicate macro event");
  });
});
