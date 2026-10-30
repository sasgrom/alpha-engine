import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildVolTargetWeights,
  DEFAULT_VOL_TARGET_POLICY,
  expectedMoveReturn,
  normalizeExpectedReturn,
  simulateVolTarget,
  summarizeVolTarget,
  volatilityScalar,
  type VolTargetInput,
} from "./volatility-target";

const row = (overrides: Partial<VolTargetInput> = {}): VolTargetInput => ({
  cik: 1,
  ticker: "AAA",
  sector: "Technology",
  forecastVol: 0.40,
  forwardReturn: 0.10,
  advDollar: 100_000_000,
  ...overrides,
});

describe("volatility targeting", () => {
  it("scales name-level exposure and clamps both tails", () => {
    expect(volatilityScalar(0.40)).toBe(0.5);
    expect(volatilityScalar(0.10)).toBe(1);
    expect(volatilityScalar(1.00)).toBe(0.25);
    expect(volatilityScalar(0)).toBeNull();
    expect(volatilityScalar(Number.NaN)).toBeNull();
  });

  it("computes expected move in return units from actual DTE", () => {
    expect(expectedMoveReturn(0.30, 17)).toBeCloseTo(0.30 * Math.sqrt(17 / 365), 12);
    expect(expectedMoveReturn(0.30, 0)).toBeNull();
    expect(expectedMoveReturn(-0.30, 17)).toBeNull();
  });

  it("normalizes signed scenario return without treating it as probability", () => {
    expect(normalizeExpectedReturn(0.05, 0.08)).toBe(0.625);
    expect(normalizeExpectedReturn(-0.05, 0.08)).toBe(-0.625);
    expect(normalizeExpectedReturn(0.05, 0)).toBeNull();
  });

  it("applies sector caps without redistributing capped weight", () => {
    const weights = buildVolTargetWeights([
      row({ forecastVol: 0.20 }),
      row({ cik: 2, ticker: "BBB", forecastVol: 0.20 }),
    ], DEFAULT_VOL_TARGET_POLICY);
    expect(weights.map((x) => x.weight)).toEqual([0.125, 0.125]);
    expect(weights.every((x) => x.sectorCapped)).toBe(true);
    expect(weights.reduce((sum, x) => sum + x.weight, 0)).toBe(0.25);
  });

  it("fails closed when liquidity is missing and caps oversized participation", () => {
    const policy = { ...DEFAULT_VOL_TARGET_POLICY, portfolioNotional: 10_000_000, participationRate: 0.10 };
    const weights = buildVolTargetWeights([
      row({ sector: "A", forecastVol: 0.20, advDollar: 100_000 }),
      row({ cik: 2, ticker: "BBB", sector: "B", forecastVol: 0.20, advDollar: null }),
    ], policy);
    expect(weights[0].weight).toBeCloseTo(0.001, 12);
    expect(weights[0].liquidityCapped).toBe(true);
    expect(weights[1].weight).toBe(0);
    expect(weights[1].liquidityCapped).toBe(true);
  });

  it("charges costs for initial leverage and later leverage changes", () => {
    const periods = [{
      date: "2024-01",
      rows: [row({ forecastVol: 0.40, forwardReturn: 0.10, sector: "A" })],
    }];
    const result = simulateVolTarget(periods, { ...DEFAULT_VOL_TARGET_POLICY, sectorCap: 1 }, 20)[0];
    expect(result.grossExposure).toBe(0.5);
    expect(result.tradedNotional).toBe(0.5);
    expect(result.cost).toBeCloseTo(0.001, 12);
    expect(result.grossReturn).toBeCloseTo(0.05, 12);
    expect(result.netReturn).toBeCloseTo(0.049, 12);
  });

  it("liquidates disappeared names instead of silently dropping their exit cost", () => {
    const results = simulateVolTarget([
      { date: "2024-01", rows: [row({ ticker: "AAA" })] },
      { date: "2024-02", rows: [row({ cik: 2, ticker: "BBB", sector: "B" })] },
    ], { ...DEFAULT_VOL_TARGET_POLICY, sectorCap: 1 }, 20);
    expect(results[1].tradedNotional).toBe(1);
    expect(results[1].cost).toBeCloseTo(0.002, 12);
  });

  it("summarizes net performance, exposure, drawdown and cost", () => {
    const summary = summarizeVolTarget(simulateVolTarget([
      { date: "2024-01", rows: [row({ forwardReturn: 0.02 })] },
      { date: "2024-02", rows: [row({ forwardReturn: -0.01 })] },
    ], { ...DEFAULT_VOL_TARGET_POLICY, sectorCap: 1 }, 20));
    expect(summary.n).toBe(2);
    expect(summary.averageGrossExposure).toBe(0.5);
    expect(summary.totalCost).toBeCloseTo(0.001, 12);
    expect(summary.maxDrawdown).toBeGreaterThan(0);
    expect(summary.annualizedVol).not.toBeNull();
    expect(summary.hitRate).toBe(0.5);
  });

  it("keeps the frozen protocol aligned with executable defaults and its checksum", () => {
    const bytes = readFileSync("research/vol-target-protocol.json");
    const protocol = JSON.parse(bytes.toString("utf8"));
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(readFileSync("research/vol-target-protocol.sha256", "utf8")).toContain(digest);
    expect(protocol.policy).toEqual({ ...DEFAULT_VOL_TARGET_POLICY, baseCostBps: 20 });
    expect(protocol.frozenBeforeVolTargetResults).toBe(true);
    expect(protocol.oosUsedForTuning).toBe(false);
    expect(protocol.biasChecks.survivorship).toContain("Limited");
  });
});
