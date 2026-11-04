import { describe, expect, it } from "vitest";
import { buildEngineData, buildSmartMoneyFlowPoints, type FundFlowBookAvailability } from "./probability-engine";

const book = (fundCik: number, quarterDate: string, shares: number, filingDate: string): FundFlowBookAvailability => ({ fundCik, quarterDate, shares, filingDate });

describe("aggregate 13F flow availability", () => {
  it("uses the latest required fund/book and both quarter availabilities", () => {
    const points = buildSmartMoneyFlowPoints(320193, [
      book(1, "2024-12-31", 100, "2025-02-10"),
      book(1, "2025-03-31", 150, "2025-05-10"),
      book(2, "2024-12-31", 100, "2025-02-20"),
      book(2, "2025-03-31", 50, "2025-06-01"),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ factor: "smartMoneyFlow", periodEnd: "2025-03-31", filedAt: "2025-06-01", value: 0 });
    expect(points[0].filedAt).not.toBe("2025-05-15");
  });

  it("keeps original-only evidence unavailable before its actual original filing", () => {
    const points = buildSmartMoneyFlowPoints(320193, [
      book(1, "2024-12-31", 100, "2025-02-10"),
      book(1, "2025-03-31", 200, "2025-05-10"),
    ]);
    expect(points[0].filedAt).toBe("2025-05-10");
    expect(points[0].value).toBe(1);
    expect(buildEngineData(320193, "2025-05-09", points, [], [], async () => 0.5).anchors).toHaveLength(0);
    expect(buildEngineData(320193, "2025-05-10", points, [], [], async () => 0.5).anchors).toEqual(["2025-05-10"]);
  });

  it("makes an amended merged book ineligible before the amendment date", () => {
    const points = buildSmartMoneyFlowPoints(320193, [
      book(1, "2024-12-31", 100, "2025-02-10"),
      book(1, "2025-03-31", 150, "2025-05-10"),
      book(2, "2025-03-31", 50, "2025-06-01"),
    ]);
    expect(buildEngineData(320193, "2025-05-31", points, [], [], async () => 0.5).anchors).toHaveLength(0);
    expect(buildEngineData(320193, "2025-06-01", points, [], [], async () => 0.5).anchors).toEqual(["2025-06-01"]);
  });

  it("skips the aggregate flow with an explicit reason when any required book lacks availability", () => {
    const skips: { quarterDate: string; missingFundCiks: number[] }[] = [];
    const points = buildSmartMoneyFlowPoints(320193, [
      book(1, "2024-12-31", 100, "2025-02-10"),
      book(1, "2025-03-31", 150, "2025-05-10"),
      book(2, "2025-03-31", 50, ""),
    ], (issue) => skips.push(issue));
    expect(points).toHaveLength(0);
    expect(skips).toEqual([{ quarterDate: "2025-03-31", missingFundCiks: [2] }]);
  });
});
