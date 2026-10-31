import { describe, expect, it } from "vitest";
import { createSpotLookup, featureFromRows, FEATURE_SCHEMA_VERSION, isFeatureManifestCurrent, parseDoltRow, rowToContract, type DoltCsvRow } from "./dolthub-features";

function row(overrides: Partial<DoltCsvRow> = {}): DoltCsvRow {
  return {
    date: "2026-10-28", act_symbol: "AAPL", expiration: "2026-11-20", strike: "100", call_put: "call",
    bid: "1", ask: "1.2", vol: "0.2", delta: "0.25", gamma: "0.01", theta: "-0.02", vega: "0.1", rho: "0.03",
    ...overrides,
  };
}

describe("DoltHub feature materialization", () => {
  it("invalidates legacy manifests without the current feature schema", () => {
    expect(isFeatureManifestCurrent({})).toBe(false);
    expect(isFeatureManifestCurrent({ schemaVersion: FEATURE_SCHEMA_VERSION })).toBe(true);
    expect(isFeatureManifestCurrent({ schemaVersion: 1 })).toBe(false);
  });

  it("parses rows and builds valid OSI contracts without inventing volume/OI", () => {
    const parsed = parseDoltRow("2026-10-28,AAPL,2026-11-20,100,call,1,1.2,0.2,0.25,0.01,-0.02,0.1,0.03");
    const contract = rowToContract(parsed);
    expect(contract.contractId).toBe("AAPL261120C00100000");
    expect(contract.volume).toBeNull();
    expect(contract.openInterest).toBeNull();
    expect(() => rowToContract(row({ strike: "0" }))).toThrow();
  });

  it("uses only spot available on or before the snapshot date", () => {
    const lookup = createSpotLookup([
      { date: "2026-10-26", close: 98, adjClose: null },
      { date: "2026-10-27", close: 100, adjClose: 99 },
      { date: "2026-10-28", close: 101, adjClose: 100 },
    ]);
    expect(lookup("2026-10-27")).toEqual({ price: 99, date: "2026-10-27" });
    expect(lookup("2026-10-25")).toBeNull();
  });

  it("reuses DTE features with spot, slope and skew while preserving honest nulls", () => {
    const features = featureFromRows([
      row(), row({ call_put: "put", vol: "0.3", delta: "-0.25", bid: "2", ask: "2.2" }),
      row({ expiration: "2027-02-19", vol: "0.3", delta: "0.5" }),
    ], { price: 100, date: "2026-10-27" }, "2026-10-29T00:00:00Z");
    const near = features.buckets[0];
    expect(features.provider).toBe("dolthub");
    expect(features.spotDate).toBe("2026-10-27");
    expect(near.atmIv).toBeCloseTo(0.25);
    expect(near.termSlope).toBeCloseTo(0.05);
    expect(near.skew25Delta).toBeCloseTo(0.1);
    expect(near.putCallVolumeRatio).toBeNull();
    expect(near.putCallOiRatio).toBeNull();
    expect(near.volOiRatio).toBeNull();
    expect(near.earningsIvCrush).toBeNull();
    expect(features.warnings[0]).toContain("no volume, open interest or underlying spot");
  });
});
