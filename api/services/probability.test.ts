import { describe, it, expect } from "vitest";
import { bayesPosterior, naiveBayesPUp, dedupFactors, reliabilityFromCalls, calibrationBins, macroPrior, clampReliability } from "./probability";

describe("naiveBayesPUp", () => {
  it("all reliable-up → high p", () => {
    const p = naiveBayesPUp([{ lpp: 0.9, lmm: 0.9 }, { lpp: 0.9, lmm: 0.9 }]);
    expect(p!).toBeGreaterThan(0.65);
  });
  it("all reliable-down → low p", () => {
    const p = naiveBayesPUp([{ lpp: 0.1, lmm: 0.1 }, { lpp: 0.1, lmm: 0.1 }]);
    expect(p!).toBeLessThan(0.35);
  });
  it("geometric mean: adding one more reliable factor must not overshoot to 1", () => {
    const one = naiveBayesPUp([{ lpp: 0.8, lmm: 0.8 }])!;
    const three = naiveBayesPUp(Array(3).fill({ lpp: 0.8, lmm: 0.8 }))!;
    expect(Math.abs(one - three)).toBeLessThan(1e-9); // same reliability ⇒ same p
  });
  it("empty → null", () => {
    expect(naiveBayesPUp([])).toBeNull();
  });
});

describe("dedupFactors", () => {
  it("keeps the strongest per correlation cluster, drops the rest", () => {
    const items = [
      { factor: "revenue", meanAbsIc: 0.5 },
      { factor: "rps", meanAbsIc: 0.4 },
      { factor: "grossMargin", meanAbsIc: 0.3 },
    ];
    const kept = dedupFactors(items, (a, b) => (a === "revenue" && b === "rps") || (a === "rps" && b === "revenue") ? 0.95 : 0.1);
    expect(kept.map((k) => k.factor)).toEqual(["revenue", "grossMargin"]);
  });
});

describe("reliabilityFromCalls", () => {
  it("computes e_plus/e_minus honestly and clamps", () => {
    const r = reliabilityFromCalls([
      { predictUp: true, realizedUp: true },
      { predictUp: true, realizedUp: false },
      { predictUp: false, realizedUp: true },
      { predictUp: false, realizedUp: false },
    ])!;
    expect(r.lpp).toBeCloseTo(0.5);
    expect(r.lmm).toBeCloseTo(0.5);
    expect(clampReliability(0)).toBe(0.1);
    expect(clampReliability(1)).toBe(0.9);
  });
  it("one wrong down call is Beta(1,1)-smoothed, not hard-clamped", () => {
    const r = reliabilityFromCalls([{ predictUp: false, realizedUp: true }])!;
    expect(r.lmm).toBeCloseTo(1 / 3); // (0 correct + 1) / (1 call + 2)
    expect(r.lpp).toBe(0.5); // no up calls → neutral side reliability
  });
});

describe("calibrationBins", () => {
  it("bins by predicted p with observed frequencies", () => {
    const pts = [
      { p: 0.1, realizedUp: false },
      { p: 0.2, realizedUp: false },
      { p: 0.8, realizedUp: true },
      { p: 0.9, realizedUp: true },
    ];
    const bins = calibrationBins(pts, 5);
    const last = bins[bins.length - 1];
    expect(last.n).toBe(2);
    expect(last.observedUp).toBe(1);
  });
});

describe("macroPrior", () => {
  it("stress lowers the prior, calm raises it slightly, all bounded", () => {
    expect(macroPrior({ vix: 30, hySpread: 600, t10y2y: -0.4 })).toBeLessThan(0.5);
    expect(macroPrior({ vix: 12, hySpread: 250, t10y2y: 1.2 })).toBeGreaterThan(0.5);
    expect(macroPrior({ vix: 200, hySpread: 2000, t10y2y: -5 })).toBe(0.35);
    expect(macroPrior({ vix: 1, hySpread: 1, t10y2y: 5 })).toBe(0.54);
  });
});

describe("bayesPosterior (PDF sign-aware + k-dependence)", () => {
  it("single up factor with reliable up: p = lpp (k=1)", () => {
    const p = bayesPosterior([{ x: 1, lpp: 0.9, lmm: 0.9 }], 0.5, 1)!;
    expect(p).toBeCloseTo(0.9);
  });
  it("single down factor with reliable down: p = 1 − lmm (k=1)", () => {
    const p = bayesPosterior([{ x: -1, lpp: 0.9, lmm: 0.9 }], 0.5, 1)!;
    expect(p).toBeCloseTo(0.1);
  });
  it("k=2 tempers confidence (sqrt of each side)", () => {
    const p = bayesPosterior([{ x: 1, lpp: 0.9, lmm: 0.9 }], 0.5, 2)!;
    expect(p).toBeCloseTo(Math.sqrt(0.45) / (Math.sqrt(0.45) + Math.sqrt(0.05)));
  });
  it("empty → null", () => {
    expect(bayesPosterior([])).toBeNull();
  });
});
