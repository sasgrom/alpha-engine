import { describe, expect, it } from "vitest";
import { curveRegime, hyRegime, splitByCikParity, spyTrendRegime, valueAtOrBefore, vixRegime } from "./macro-regime";

describe("macro regime classification", () => {
  it("uses only macro data known by the anchor date", () => {
    const points = [{ date: "2026-01-01", value: 10 }, { date: "2026-02-01", value: 20 }, { date: "2026-03-01", value: 30 }];
    expect(valueAtOrBefore(points, "2026-02-15")).toBe(20);
    expect(valueAtOrBefore(points, "2025-01-01")).toBeNull();
  });

  it("applies pre-registered thresholds without fitting", () => {
    expect(vixRegime(19.9)).toBe("low");
    expect(vixRegime(20)).toBe("mid");
    expect(vixRegime(28.1)).toBe("high");
    expect(curveRegime(-0.01)).toBe("inversion");
    expect(curveRegime(0.2)).toBe("normal");
    expect(hyRegime(3.9)).toBe("tight");
    expect(hyRegime(4)).toBe("mid");
    expect(hyRegime(6.1)).toBe("wide");
  });

  it("classifies SPY trend only with 200 available bars", () => {
    const bars = Array.from({ length: 200 }, (_, i) => ({ date: `2026-${String(1 + Math.floor(i / 20)).padStart(2, "0")}-01`, close: i < 199 ? 50 : 100 }));
    expect(spyTrendRegime(bars, "2026-12-01")).toBe("above200dma");
    expect(spyTrendRegime(bars.slice(0, 100), "2026-12-01")).toBe("unknown");
  });

  it("splits the universe deterministically without overlap", () => {
    const { odd, even } = splitByCikParity([3, 1, 2]);
    expect(odd).toEqual([1, 3]);
    expect(even).toEqual([2]);
    expect(new Set([...odd, ...even]).size).toBe(3);
  });
});
