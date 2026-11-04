import { describe, expect, it, vi } from "vitest";
import { backfillMacroVintageSeries, MacroVintageConflictError, parseMacroSeriesList, prepareMacroVintageBackfill, type NormalizedMacroVintageRow } from "./macro-vintage-backfill";

const NOW = "2026-11-04T12:30:00.000Z";
const row = (overrides: Partial<NormalizedMacroVintageRow> = {}): NormalizedMacroVintageRow => ({
  seriesId: "DGS10",
  observationPeriod: "2020-01-02",
  value: 1.5,
  availableAt: "2020-01-03T00:00:00.000Z",
  supersededAt: "2020-02-01T23:59:59.999Z",
  ingestedAt: "2026-11-03T22:00:00.000Z",
  researchEligibleAt: "2020-01-03T23:59:59.999Z",
  sourceHash: "official-raw-sha",
  ...overrides,
});

describe("normalized FRED to macro_points backfill", () => {
  it("preserves original and revised vintages and open-ended availability", () => {
    const original = row({ value: 1.5 });
    const revised = row({ value: 1.7, availableAt: "2020-02-02T00:00:00.000Z", supersededAt: null });
    const plan = prepareMacroVintageBackfill("DGS10", [original, revised], [], NOW);
    expect(plan.points).toEqual([
      { date: "2020-01-02", value: 1.5, realtimeStart: "2020-01-03", realtimeEnd: "2020-02-01", fetchedAt: NOW },
      { date: "2020-01-02", value: 1.7, realtimeStart: "2020-02-02", realtimeEnd: null, fetchedAt: NOW },
    ]);
  });

  it("skips missing availableAt without substituting ingestion time", () => {
    const plan = prepareMacroVintageBackfill("DGS10", [row({ availableAt: null })], [], NOW);
    expect(plan.points).toEqual([]);
    expect(plan.missingAvailability).toEqual([{ observationPeriod: "2020-01-02", reason: "missing_availableAt" }]);
  });

  it("deduplicates only an identical archive key", () => {
    const plan = prepareMacroVintageBackfill("DGS10", [row(), row()], [], NOW);
    expect(plan.points).toHaveLength(1);
    expect(plan.duplicateArchiveRows).toBe(1);
  });

  it("rejects conflicting values for the same archive key without writing", async () => {
    const ingest = vi.fn();
    expect(() => prepareMacroVintageBackfill("DGS10", [row(), row({ value: 2 })], [], NOW)).toThrow(MacroVintageConflictError);
    const existing = [{ seriesId: "DGS10", date: "2020-01-02", value: 1.5, realtimeStart: "2020-01-03", realtimeEnd: "2020-01-03" }];
    expect(() => prepareMacroVintageBackfill("DGS10", [row()], existing, NOW)).toThrow(MacroVintageConflictError);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("preserves null values", () => {
    const plan = prepareMacroVintageBackfill("DGS10", [row({ value: null })], [], NOW);
    expect(plan.points[0]?.value).toBeNull();
  });

  it("uses actual new fetchedAt without treating source timestamps as availability", async () => {
    const source = row({ availableAt: "2020-01-03T00:00:00.000Z", supersededAt: null, ingestedAt: "2026-11-03T22:00:00.000Z", researchEligibleAt: "2020-01-03T23:59:59.999Z" });
    const plan = prepareMacroVintageBackfill("DGS10", [source], [], NOW);
    const ingest = vi.fn().mockResolvedValue(1);
    await backfillMacroVintageSeries(plan, ingest);
    expect(ingest).toHaveBeenCalledWith("DGS10", [{ date: "2020-01-02", value: 1.5, realtimeStart: "2020-01-03", realtimeEnd: null, fetchedAt: NOW }]);
    expect(plan.points[0]?.realtimeStart).not.toBe(source.ingestedAt?.slice(0, 10));
    expect(plan.points[0]?.realtimeEnd).not.toBe(source.researchEligibleAt?.slice(0, 10));
  });

  it("is idempotent against existing rows and never updates their fetchedAt", async () => {
    const first = prepareMacroVintageBackfill("DGS10", [row(), row({ supersededAt: null, availableAt: "2020-02-02T00:00:00.000Z" })], [], NOW);
    const ingest = vi.fn().mockResolvedValue(first.points.length);
    await backfillMacroVintageSeries(first, ingest);
    const existing = first.points.map((point, index) => ({ id: index + 1, seriesId: "DGS10", ...point, fetchedAt: "2000-01-01T00:00:00.000Z" }));
    const second = prepareMacroVintageBackfill("DGS10", [row(), row({ supersededAt: null, availableAt: "2020-02-02T00:00:00.000Z" })], existing, "2026-11-05T00:00:00.000Z");
    expect(second.points).toEqual([]);
    expect(second.unchangedExistingRows).toBe(2);
    const secondIngest = vi.fn();
    expect(await backfillMacroVintageSeries(second, secondIngest)).toMatchObject({ insertedRows: 0 });
    expect(secondIngest).not.toHaveBeenCalled();
  });

  it("parses a reviewed comma-separated series list without duplicates", () => {
    expect(parseMacroSeriesList("DGS10,DGS2,T10Y2Y,FEDFUNDS,CPIAUCSL,UNRATE")).toEqual(["DGS10", "DGS2", "T10Y2Y", "FEDFUNDS", "CPIAUCSL", "UNRATE"]);
    expect(parseMacroSeriesList("dgs10, dgs2")).toEqual(["DGS10", "DGS2"]);
    expect(parseMacroSeriesList("DGS10")).toEqual(["DGS10"]);
    expect(() => parseMacroSeriesList("DGS10,DGS10")).toThrow("duplicate");
    expect(() => parseMacroSeriesList("DGS10,")).toThrow("empty");
    expect(() => parseMacroSeriesList("DGS10,UNKNOWN")).toThrow("Unsupported curated series");
  });
});
