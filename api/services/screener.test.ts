// Unit tests for the pure screener math (4a, D28).
import { describe, it, expect } from "vitest";
import { ttm4, fcfMargin, week52Pos } from "./screener";

describe("ttm4", () => {
  it("sums the latest 4 points (input is desc-sorted)", () => {
    const pts = [
      { periodEnd: "2026-06-30", val: 4 },
      { periodEnd: "2026-03-31", val: 3 },
      { periodEnd: "2025-12-31", val: 2 },
      { periodEnd: "2025-09-30", val: 1 },
      { periodEnd: "2025-06-30", val: 100 }, // older — excluded
    ];
    expect(ttm4(pts)).toBe(10);
  });
  it("returns null with fewer than 4 non-null points", () => {
    const pts = [
      { periodEnd: "2026-06-30", val: 4 },
      { periodEnd: "2026-03-31", val: null },
      { periodEnd: "2025-12-31", val: 2 },
      { periodEnd: "2025-09-30", val: 1 },
    ];
    expect(ttm4(pts)).toBeNull();
    expect(ttm4([])).toBeNull();
  });
});

describe("fcfMargin", () => {
  it("computes (CFO − capex) / revenue", () => {
    expect(fcfMargin(100, 25, 400)).toBeCloseTo(0.1875);
  });
  it("null on missing inputs or zero revenue — no optimistic fallbacks (3h rule)", () => {
    expect(fcfMargin(null, 25, 400)).toBeNull();
    expect(fcfMargin(100, null, 400)).toBeNull();
    expect(fcfMargin(100, 25, null)).toBeNull();
    expect(fcfMargin(100, 25, 0)).toBeNull();
  });
  it("handles negative CFO honestly", () => {
    expect(fcfMargin(-50, 25, 400)).toBeCloseTo(-0.1875);
  });
});

describe("week52Pos", () => {
  it("position inside the range, clamped 0..1", () => {
    expect(week52Pos(150, 200, 100)).toBeCloseTo(0.5);
    expect(week52Pos(100, 200, 100)).toBe(0);
    expect(week52Pos(200, 200, 100)).toBe(1);
  });
  it("null on degenerate or missing ranges", () => {
    expect(week52Pos(150, 100, 100)).toBeNull();
    expect(week52Pos(null, 200, 100)).toBeNull();
  });
});
