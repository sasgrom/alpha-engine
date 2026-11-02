import { describe, expect, it } from "vitest";
import { auditMacroEvents, auditNormalizedMacroSeries } from "./macro-manifest-qa";
import type { NormalizedMacroPoint } from "./fred";
import type { PoliticalEvent } from "./political-events";

const point: NormalizedMacroPoint = {
  seriesId: "DGS10", observationPeriod: "2020-01-01", value: 2, unit: "Percent", frequency: "Daily", releasedAt: null,
  availableAt: "2020-01-02T00:00:00.000Z", availablePrecision: "day", availabilityBasis: "fred_realtime_start",
  researchEligibleAt: "2020-01-02T23:59:59.999Z", vintageId: "DGS10|2020-01-01|2020-01-02", supersededAt: null,
  ingestedAt: "2020-01-03T00:00:00.000Z", sourceUrl: "https://fred.stlouisfed.org/series/DGS10", sourceHash: "abc",
};
const event: PoliticalEvent = { eventId: "ofac:20200102", source: "OFAC", title: "Test", publishedAt: "2020-01-02T00:00:00.000Z", availablePrecision: "day", researchEligibleAt: "2020-01-02T23:59:59.999Z", effectiveAt: null, sourceUrl: "https://ofac.treasury.gov/recent-actions/20200102", ingestedAt: "2020-01-03T00:00:00.000Z", sourceHash: "abc" };

describe("macro manifest QA", () => {
  it("accepts valid availability and rejects duplicates and pre-2000 observations", () => {
    expect(auditNormalizedMacroSeries("DGS10", [point], 1)).toEqual([]);
    expect(auditNormalizedMacroSeries("DGS10", [point, point], 2).some((issue) => issue.code === "duplicate_vintage")).toBe(true);
    expect(auditNormalizedMacroSeries("DGS10", [{ ...point, observationPeriod: "1999-12-31" }], 1).some((issue) => issue.code === "pre2000")).toBe(true);
  });

  it("rejects duplicate events and events published after ingestion", () => {
    expect(auditMacroEvents([event])).toEqual([]);
    expect(auditMacroEvents([event, event]).some((issue) => issue.code === "duplicate_event")).toBe(true);
    expect(auditMacroEvents([{ ...event, publishedAt: "2020-01-04T00:00:00.000Z" }]).some((issue) => issue.code === "event_after_ingestion")).toBe(true);
  });
});
