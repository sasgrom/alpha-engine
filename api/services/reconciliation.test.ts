import { describe, expect, it } from "vitest";
import { orphanCiks, reconcilePipeline, type PipelineCounts } from "./reconciliation";

const clean: PipelineCounts = { cik: 1, facts: 100, series: 80, factors: 20, prices: 50, registered: true };

describe("research pipeline reconciliation", () => {
  it("accepts a complete lineage with vintage doubling and independent factor cardinality", () => {
    expect(reconcilePipeline([clean, { ...clean, cik: 2, series: 200, factors: 500 }])).toEqual([]);
  });

  it("fails closed on count inversions and derived-only rows", () => {
    const issues = reconcilePipeline([
      { ...clean, series: 201 },
      { ...clean, cik: 2, facts: 0 },
      { ...clean, cik: 3, series: 0 },
    ]);
    expect(issues.some((i) => i.type === "count_inversion")).toBe(true);
    expect(issues.filter((i) => i.type === "orphan")).toHaveLength(2);
  });

  it("separates missing stages, coverage warnings and registry orphans", () => {
    const issues = reconcilePipeline([{ ...clean, series: 0, factors: 0, prices: 0, registered: false }]);
    expect(issues.map((i) => i.type)).toEqual(expect.arrayContaining(["orphan", "missing_stage", "coverage"]));
    expect(issues.find((i) => i.type === "coverage")?.severity).toBe("warning");
  });

  it("lists expected CIKs missing from the actual universe", () => {
    expect(orphanCiks([1, 2, 3, 4], [2, 4])).toEqual([1, 3]);
  });
});
