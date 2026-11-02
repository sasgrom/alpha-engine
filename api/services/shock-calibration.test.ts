import { describe, expect, it } from "vitest";
import { calibrateShockSeries } from "./shock-calibration";
import type { NormalizedMacroPoint } from "../../worker/lib/fred";

const AS_OF = "2026-11-02T00:00:00Z";
const point = (index: number, value: number, availableAt = "2026-10-01T00:00:00.000Z"): NormalizedMacroPoint => ({
  seriesId: "DGS10",
  observationPeriod: `2020-${String(Math.floor(index / 30) + 1).padStart(2, "0")}-${String(index % 30 + 1).padStart(2, "0")}`,
  value,
  unit: "Percent",
  frequency: "Daily",
  releasedAt: null,
  availableAt,
  availablePrecision: "day",
  availabilityBasis: "fred_realtime_start",
  researchEligibleAt: availableAt,
  vintageId: `DGS10|${index}|${availableAt}`,
  supersededAt: null,
  ingestedAt: "2026-11-01T00:00:00Z",
  sourceUrl: "https://fred.stlouisfed.org/series/DGS10",
  sourceHash: "abc",
});
const sequence = (count: number, start = 1) => Array.from({ length: count }, (_, index) => point(index + 1, start + index));

describe("shock calibration", () => {
  it("converts FRED percent changes to decimal shocks and computes deterministic confidence intervals", () => {
    const result = calibrateShockSeries("DGS10", "rates", sequence(70), AS_OF);
    expect(result.status).toBe("ready");
    expect(result.distributions["1"]?.p50).toBeCloseTo(0.01);
    expect(result.distributions["1"]?.p90).toBeCloseTo(0.01);
    expect(result.distributions["1"]?.p99).toBeCloseTo(0.01);
    expect(result.distributions["63"]).toBeNull();
    expect(result.presets?.mild.shock).toBeCloseTo(0.01);
    expect(result.distributions["1"]?.ci95P50).not.toBeNull();
    expect(result.distributions["1"]?.ci95P90).not.toBeNull();
  });

  it("uses log returns for oil and excludes future availability", () => {
    const rows = sequence(40, 100).map((row, index) => index === 39 ? { ...row, availableAt: "2027-01-01T00:00:00.000Z", researchEligibleAt: "2027-01-01T00:00:00.000Z" } : row);
    const result = calibrateShockSeries("DCOILWTICO", "oil", rows, AS_OF);
    expect(result.observations).toBe(39);
    expect(result.distributions["1"]).not.toBeNull();
    expect(result.distributions["1"]?.p50).toBeGreaterThan(0);
  });

  it("fails closed when there are fewer than 30 changes", () => {
    const result = calibrateShockSeries("DGS10", "rates", sequence(10), AS_OF);
    expect(result.status).toBe("insufficient_history");
    expect(result.presets).toBeNull();
    expect(result.distributions["1"]).toBeNull();
  });

  it("rejects unsupported rate units instead of guessing a scale", () => {
    const rows = sequence(40).map((row) => ({ ...row, unit: "Basis points" }));
    expect(() => calibrateShockSeries("DGS10", "rates", rows, AS_OF)).toThrow("Unsupported rate unit");
  });

  it("does not use superseded observations from a later availability date", () => {
    const current = point(1, 4, "2026-09-01T00:00:00.000Z");
    const future = point(2, 9, "2027-01-01T00:00:00.000Z");
    const result = calibrateShockSeries("DGS10", "rates", [current, future], AS_OF);
    expect(result.observations).toBe(1);
  });
});
