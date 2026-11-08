import { describe, expect, it } from "vitest";
import { buildRevenueExclusionMap, quarterRangeForTtm } from "./revenue-pilot-exclusions";

const issue = (type: string, overrides: any = {}) => ({ severity: "error" as const, type: type as any, cik: 1, concept: "Assets", periodEnd: "2020-03-31", message: "test", ...overrides });

describe("Revenue pilot exclusion map", () => {
  it("expands each missing quarter only into affected TTM anchors", () => {
    expect(quarterRangeForTtm("2020Q1")).toEqual(["2020Q1", "2020Q2", "2020Q3", "2020Q4"]);
    expect(quarterRangeForTtm("2020Q2")).toEqual(["2020Q2", "2020Q3", "2020Q4", "2021Q1"]);
  });

  it("deduplicates expected/canonical grids and preserves hard fact exclusions", () => {
    const map = buildRevenueExclusionMap([
      issue("continuity_gap", { message: "2 missing quarters in expected grid: 2020Q2, 2021Q1" }),
      issue("continuity_gap", { message: "2 missing quarters in canonical grid: 2020Q2, 2021Q1" }),
      issue("availability_inversion", { message: "filed 2020-02-01 precedes periodEnd", accessionNo: "accn-1" }),
      issue("unit_conflict", { message: "Same concept/period has incompatible units: USD, pure" }),
      issue("missing_period", { message: "Flow concept requires startDate for duration" }),
      issue("cadence_expected_gap", { message: "annual-only cadence" }),
    ]);
    expect(map.hardExclusions).toHaveLength(3);
    expect(map.continuityExclusions).toHaveLength(2);
    expect(map.continuityExclusions[0].excludedAnchorQuarters).toEqual(["2020Q2", "2020Q3", "2020Q4", "2021Q1"]);
    expect(map.continuityExclusions[0].reportedAt).toEqual(["2020-03-31"]);
    expect(map.reviewRequired).toHaveLength(1);
    expect(map.status).toBe("draft_not_for_training");
  });
});
