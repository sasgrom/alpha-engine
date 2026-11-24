import { describe, expect, it } from "vitest";
import { buildDeskMacro, latestMacroVintage, type MacroVintageRow } from "./desk-macro";

const row = (observationPeriod: string, value: number | null, availableAt: string, supersededAt: string | null = null): MacroVintageRow => ({ observationPeriod, value, availableAt, supersededAt });

describe("the newest published macro value", () => {
  it("takes the latest period among the vintages in force", () => {
    const rows = [row("2026-11-17", 4.11, "2026-11-18T00:00:00.000Z"), row("2026-11-19", 4.2, "2026-11-20T00:00:00.000Z"), row("2026-11-18", 4.15, "2026-11-19T00:00:00.000Z")];
    expect(latestMacroVintage(rows)).toMatchObject({ observationPeriod: "2026-11-19", value: 4.2 });
  });

  it("ignores a superseded vintage and a vintage without a value", () => {
    const rows = [
      row("2026-10-01", 3.1, "2026-11-10T00:00:00.000Z", "2026-11-20T23:59:59.999Z"),
      row("2026-10-01", 3.2, "2026-11-21T00:00:00.000Z"),
      row("2026-11-01", null, "2026-11-22T00:00:00.000Z"),
    ];
    expect(latestMacroVintage(rows)).toMatchObject({ observationPeriod: "2026-10-01", value: 3.2 });
  });

  it("resolves two vintages in force for one period to the later publication", () => {
    const rows = [row("2026-10-01", 3.1, "2026-11-10T00:00:00.000Z"), row("2026-10-01", 3.3, "2026-11-21T00:00:00.000Z")];
    expect(latestMacroVintage(rows)?.value).toBe(3.3);
  });

  it("gives nothing for a series with no value in force", () => {
    expect(latestMacroVintage([])).toBeNull();
    expect(latestMacroVintage([row("2026-10-01", 3.1, "2026-11-10T00:00:00.000Z", "2026-11-20T23:59:59.999Z")])).toBeNull();
  });
});

describe("the macro card's file", () => {
  it("lists the series in the card's order and leaves out one without a value", () => {
    const rowsBySeries = new Map<string, MacroVintageRow[]>([
      ["VIXCLS", [row("2026-11-19", 18.4, "2026-11-20T00:00:00.000Z")]],
      ["DGS10", [row("2026-11-19", 4.2, "2026-11-20T00:00:00.000Z")]],
      ["UNRATE", []],
    ]);
    const file = buildDeskMacro({ rowsBySeries, archiveGeneratedAt: "2026-11-22T13:43:12.528Z", builtAt: "2026-11-24T10:00:00.000Z" });
    expect(file.series.map((point) => point.seriesId)).toEqual(["DGS10", "VIXCLS"]);
    expect(file.series[0]).toEqual({ seriesId: "DGS10", label: "10Y Treasury yield", unit: "pct", date: "2026-11-19", value: 4.2, availableAt: "2026-11-20T00:00:00.000Z" });
    expect(file.archiveGeneratedAt).toBe("2026-11-22T13:43:12.528Z");
  });
});
