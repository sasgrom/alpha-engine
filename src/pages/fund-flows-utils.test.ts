import { describe, expect, it } from "vitest";
import { flowEdgeText, groupCompaniesBySector, groupFundsByTier, selectFlowEdges, signed, supportsWebGL } from "./fund-flows-utils";

const edge = (deltaShares: number) => ({ fundCik: 1, cik: 2, curUsd: 100, deltaUsd: 20, curShares: 100, deltaShares, deltaWeightPp: null });

describe("fund flow view utilities", () => {
  it("keeps only the strongest share changes with deterministic ordering", () => {
    const rows = selectFlowEdges([edge(2), edge(-50), edge(10)], 2);
    expect(rows.map((row) => row.deltaShares)).toEqual([-50, 10]);
    expect(selectFlowEdges([edge(1)], 10)).toHaveLength(1);
    expect(() => selectFlowEdges([], 0)).toThrow("positive integer");
  });

  it("groups funds and companies without inventing metadata", () => {
    const tiers = groupFundsByTier([{ cik: 1, name: "A", tier: "quant" }, { cik: 2, name: "B", tier: null }]);
    expect(tiers.get("quant")?.map((fund) => fund.cik)).toEqual([1]);
    expect(tiers.get("institutional")?.map((fund) => fund.cik)).toEqual([2]);
    const sectors = groupCompaniesBySector([{ cik: 2, ticker: "A", sector: "Financials" }, { cik: 3, ticker: "B", sector: null }]);
    expect(sectors.get("Financials")?.map((company) => company.cik)).toEqual([2]);
    expect(sectors.get("Unclassified")?.map((company) => company.cik)).toEqual([3]);
  });

  it("fails closed when WebGL is unavailable", () => {
    expect(supportsWebGL()).toBe(false);
  });

  it("formats signs and searchable evidence without hiding nulls", () => {
    expect(signed(10)).toBe("+10");
    expect(signed(-2_000_000)).toBe("-2.0M");
    expect(flowEdgeText(edge(1), { cik: 1, name: "Fund A", tier: "quant" }, { cik: 2, ticker: "AAA", sector: "Financials" })).toContain("fund a");
  });
});
