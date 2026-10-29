import { describe, expect, it } from "vitest";
import { buildOptionFeatures, dteBucket, earningsIvCrush } from "./option-features";
import type { OptionChainSnapshot, OptionContract } from "./options";

function contract(overrides: Partial<OptionContract>): OptionContract {
  return {
    contractId: `${overrides.underlying ?? "NVDA"}${overrides.expiration ?? "2026-11-20"}${overrides.right ?? "call"}${overrides.strike ?? 100}`,
    underlying: overrides.underlying ?? "NVDA", expiration: overrides.expiration ?? "2026-11-20",
    strike: overrides.strike ?? 100, right: overrides.right ?? "call", exchange: null, providerRowId: null,
    bid: overrides.bid ?? 1, ask: overrides.ask ?? 1.2, bidSize: null, askSize: null, last: null,
    volume: overrides.volume ?? 10, openInterest: overrides.openInterest ?? 100,
    impliedVolatility: overrides.impliedVolatility ?? 0.2, delta: overrides.delta ?? 0.5,
    gamma: null, theta: null, vega: null, rho: null, theoretical: null, midpoint: null, tradeDate: "2026-10-28",
  };
}

function snapshot(contracts: OptionContract[]): OptionChainSnapshot {
  return {
    provider: "cboe", underlying: "NVDA", tradeDate: "2026-10-28", availableAt: "2026-10-28T10:00:00Z",
    providerTimeLabel: null, underlyingData: { current_price: 100 }, warnings: [],
    quality: { rows: contracts.length, contracts: contracts.length, calls: 1, puts: 1, expirations: 1, duplicates: 0, invalidRows: 0, zeroBid: 0, crossedQuotes: 0 },
    contracts,
  };
}

describe("DTE option features", () => {
  it("buckets expirations by DTE", () => {
    expect(dteBucket(0)).toBe("0DTE");
    expect(dteBucket(7)).toBe("1-7D");
    expect(dteBucket(30)).toBe("8-30D");
    expect(dteBucket(90)).toBe("31-90D");
    expect(dteBucket(365)).toBe("91-365D");
    expect(dteBucket(366)).toBe("365+D");
  });

  it("computes ATM IV, slope, skew, ratios and honest earnings crush null", () => {
    const s = buildOptionFeatures(snapshot([
      contract({ strike: 100, impliedVolatility: 0.2, delta: 0.25, volume: 10, openInterest: 100 }),
      contract({ strike: 100, right: "put", impliedVolatility: 0.3, delta: -0.25, volume: 30, openInterest: 200 }),
      contract({ expiration: "2027-02-19", impliedVolatility: 0.3, delta: 0.5, volume: 5, openInterest: 50 }),
    ]));
    const near = s.buckets[0];
    expect(near.dteMedian).toBe(23);
    expect(near.atmIv).toBeCloseTo(0.25);
    expect(near.skew25Delta).toBeCloseTo(0.1);
    expect(near.putCallVolumeRatio).toBe(3);
    expect(near.putCallOiRatio).toBe(2);
    expect(near.volOiRatio).toBeCloseTo(45 / 350);
    expect(near.earningsIvCrush).toBeNull();
    expect(near.termSlope).toBeCloseTo(0.05);
    expect(s.buckets[1].termSlope).toBeNull();
  });

  it("computes earnings IV crush only when both IVs exist", () => {
    expect(earningsIvCrush(0.4, 0.2)).toBe(-0.5);
    expect(earningsIvCrush(null, 0.2)).toBeNull();
    expect(earningsIvCrush(0.4, null)).toBeNull();
  });
});
