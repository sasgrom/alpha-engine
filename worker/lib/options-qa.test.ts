import { describe, expect, it } from "vitest";
import { finalizeSnapshot, type OptionChainSnapshot, type OptionContract, type OptionProvider } from "./options";
import { auditOptionSnapshot, buildOptionQaReport, compareOptionSnapshots } from "./options-qa";

function contract(id: string, overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    contractId: id, underlying: "AAPL", expiration: "2026-11-20", strike: 100,
    right: "call", exchange: null, providerRowId: null,
    bid: 1, ask: 2, bidSize: 2, askSize: 3, last: 1.5, volume: 5, openInterest: 10,
    impliedVolatility: 0.3, delta: 0.5, gamma: 0.01, theta: -0.02, vega: 0.1, rho: 0.03,
    theoretical: 1.4, midpoint: 1.5, tradeDate: "2026-10-28", ...overrides,
  };
}
function snapshot(provider: OptionProvider, tradeDate: string, contracts: OptionContract[], availableAt = `${tradeDate}T15:00:00Z`): OptionChainSnapshot {
  return finalizeSnapshot({
    provider, underlying: "AAPL", tradeDate, availableAt, ingestedAt: `${tradeDate}T15:10:00Z`,
    providerTimeLabel: null, underlyingData: { current_price: 100 }, warnings: [], contracts,
  });
}

describe("offline option snapshot QA", () => {
  it("recomputes coverage, quote anomalies, integrity and timestamps", () => {
    const s = snapshot("cboe", "2026-10-28", [
      contract("a"),
      contract("b", { right: "put", bid: 0, ask: 0, impliedVolatility: null, delta: null, gamma: null, theta: null, vega: null, rho: null, openInterest: 0, volume: 0 }),
      contract("c", { bid: 5, ask: 4, impliedVolatility: 6, delta: 1.2, expiration: "2026-10-27", tradeDate: "2026-10-27" }),
    ], "2026-10-28 15:00:00");
    const qa = auditOptionSnapshot(s);
    expect(qa.present).toMatchObject({ iv: 2, openInterest: 3, volume: 3, delta: 2, allGreeks: 2, rho: 2 });
    expect(qa.quotes).toMatchObject({ zeroBid: 1, zeroAsk: 1, crossed: 1, locked: 0, twoSided: 1 });
    expect(qa.integrity).toMatchObject({ expired: 1, tradeDateMismatch: 1, invalidDelta: 1, ivAbove500Percent: 1, zeroOpenInterest: 1, zeroVolume: 1, qualityMismatch: 0 });
    expect(qa.coverage.iv).toBeCloseTo(2 / 3);
    expect(qa.spreadPct.median).toBeCloseTo(2 / 3);
    expect(qa.timing).toMatchObject({ lagMinutes: 10, timezonePresent: false, oiTimestampPresent: false });
  });

  it("ignores floating-point delta roundoff but flags real range violations", () => {
    const s = snapshot("orats_intraday", "2026-10-28", [
      contract("a", { delta: 1 + Number.EPSILON }),
      contract("b", { right: "put", delta: Number.EPSILON }),
      contract("c", { delta: 1.001 }),
    ]);
    expect(auditOptionSnapshot(s).integrity.invalidDelta).toBe(1);
  });

  it("compares providers only on identical contract IDs without date shifting", () => {
    const a = snapshot("cboe", "2026-10-28", [contract("a"), contract("b")]);
    const b = snapshot("orats", "2026-10-28", [contract("a", { impliedVolatility: 0.33, delta: 0.52, bid: 1.1, ask: 2.1 })], "2026-10-28T15:05:00Z");
    const diff = compareOptionSnapshots(a, b);
    expect(diff.matchedContracts).toBe(1);
    expect(diff.matchRate).toBe(1);
    expect(diff.leftContracts).toBe(2);
    expect(diff.coverageOfLeft).toBe(0.5);
    expect(diff.coverageOfRight).toBe(1);
    expect(diff.iv.mae).toBeCloseTo(0.03);
    expect(diff.nearAtmIv.mae).toBeCloseTo(0.03);
    expect(diff.delta.mae).toBeCloseTo(0.02);
    expect(diff.bid.mae).toBeCloseTo(0.1);
    expect(diff.availabilityDeltaMinutes).toBe(5);
    expect(() => compareOptionSnapshots(a, snapshot("orats", "2026-10-29", [contract("a")]))).toThrow();
  });

  it("aggregates provider coverage and builds same-date cross-provider pairs", () => {
    const a = snapshot("cboe", "2026-10-28", [contract("a")]);
    const b = snapshot("orats", "2026-10-28", [contract("a")]);
    const otherDate = snapshot("orats", "2026-10-29", [contract("a")]);
    const report = buildOptionQaReport([a, b, otherDate], "2026-10-30T00:00:00Z");
    expect(report.summary.snapshots).toBe(3);
    expect(report.summary.contracts).toBe(3);
    expect(report.summary.underlyings).toBe(1);
    expect(report.summary.providerUnderlyingPairs).toBe(2);
    expect(report.summary.coverage.iv).toBe(1);
    expect(report.crossProvider).toHaveLength(1);
    expect(report.history.find((h) => h.provider === "orats")?.snapshots).toBe(2);
    expect(report.generatedAt).toBe("2026-10-30T00:00:00Z");
  });
});
