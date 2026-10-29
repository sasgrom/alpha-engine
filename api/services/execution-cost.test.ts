import { describe, expect, it } from "vitest";
import { daysToExit, equityCostBps, netReturnBps, optionExecutionCost } from "./execution-cost";

describe("execution cost and liquidity scenarios", () => {
  it("itemizes spread, commission and square-root impact", () => {
    const result = equityCostBps({ notional: 50_000, advNotional: 1_000_000, participation: 0.05, spreadBps: 10, commissionBps: 2, impactCoefficient: 20 });
    expect(result).toMatchObject({ spread: 5, commission: 2 });
    expect(result.impact).toBeCloseTo(20 * Math.sqrt(0.05));
    expect(result.total).toBeCloseTo(7 + 20 * Math.sqrt(0.05));
    expect(() => equityCostBps({ notional: 0, advNotional: 1, participation: 1, spreadBps: 0, commissionBps: 0, impactCoefficient: 0 })).toThrow();
  });

  it("computes honest days-to-exit and rejects zero ADV", () => {
    expect(daysToExit(10_000, 1_000_000, 0.1)).toBe(0.1);
    expect(daysToExit(10_000, 0, 0.1)).toBeNull();
  });

  it("costs option legs with multipliers and per-contract commissions", () => {
    const result = optionExecutionCost([
      { bid: 4, ask: 4.2, multiplier: 100, contracts: 2, commissionPerContract: 0.5 },
      { bid: 2, ask: 2.1, multiplier: 100, contracts: 2, commissionPerContract: 0.5 },
    ]);
    expect(result.spreadCost).toBeCloseTo(30);
    expect(result.commissions).toBe(2);
    expect(result.total).toBeCloseTo(32);
    expect(netReturnBps(100, 32)).toBe(68);
  });
});
