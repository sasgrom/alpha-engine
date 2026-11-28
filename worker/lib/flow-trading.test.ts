import { describe, expect, it } from "vitest";
import { etfWeekFlows, groupVsNormal, normalBefore, sessionBefore, weeksOf, weekVolume } from "./flow-trading";

const sessions = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27"];

describe("trading volume", () => {
  it("groups sessions by calendar week, naming each week by its last session", () => {
    expect(weeksOf(sessions)).toEqual([
      { end: "2026-11-20", index: [0, 1, 2, 3, 4] },
      { end: "2026-11-27", index: [5, 6, 7, 8] },
    ]);
  });

  it("needs ten traded sessions before a week to call anything normal", () => {
    expect(normalBefore([1, 2, 3], 3)).toBeNull();
    const daily = Array.from({ length: 25 }, (_, i) => (i < 20 ? 100 : 300));
    expect(normalBefore(daily, 20)).toBe(100);
    expect(weekVolume(daily, [20, 21, 22, 23, 24])).toEqual({ dollars: 1500, vsNormal: 3 });
  });

  it("leaves a week the company did not trade empty instead of zero", () => {
    expect(weekVolume([null, null], [0, 1])).toEqual({ dollars: null, vsNormal: null });
  });

  it("weights a group by its members' own usual volume", () => {
    const big = { daily: [...Array(20).fill(1000), 2000] };
    const small = { daily: [...Array(20).fill(10), 10] };
    expect(groupVsNormal([big, small], [20])).toBeCloseTo(2010 / 1010, 10);
  });

  it("counts a capture after the session it follows", () => {
    expect(sessionBefore(sessions, "2026-11-20T20:59:00.000Z")).toBe("2026-11-19");
    expect(sessionBefore(sessions, "2026-11-21T00:38:00.000Z")).toBe("2026-11-20");
    expect(sessionBefore(sessions, "2026-11-28T09:41:00.000Z")).toBe("2026-11-27");
  });

  it("values each change in shares outstanding at the later price, in the week of its session", () => {
    const weeks = weeksOf(sessions);
    const flows = etfWeekFlows([
      { capturedAt: "2026-11-18T00:30:00.000Z", shares: 1_000_000, price: 100 },
      { capturedAt: "2026-11-19T00:30:00.000Z", shares: 1_050_000, price: 101 },
      { capturedAt: "2026-11-24T00:30:00.000Z", shares: 1_000_000, price: 99 },
    ], sessions, weeks);
    expect(flows.dollars).toEqual([50_000 * 101, -50_000 * 99]);
    expect(flows.from).toBe("2026-11-18T00:30:00.000Z");
  });
});
