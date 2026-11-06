import { describe, expect, it } from "vitest";
import { errorMetrics, evaluateFactorOls, evaluateLeaveGroupOut, fitOls, predictOls, wilsonInterval, type OlsAnchorPoint } from "./factor-ols";

const point = (x: number, ret: number, cik = 1, anchor = "2020-01-01", sector: string | null = "Tech"): OlsAnchorPoint => ({
  cik, anchor, ret, exitDate: anchor, features: [], rawP: 0.5, x, sector,
});

describe("OLS factor evaluation", () => {
  it("fits intercept and slope exactly for a linear relation", () => {
    const model = fitOls([point(1, 3), point(2, 5), point(3, 7), point(4, 9)])!;
    expect(model.alpha).toBeCloseTo(1);
    expect(model.beta).toBeCloseTo(2);
    expect(model.r2).toBeCloseTo(1);
    expect(predictOls(model, point(5, 0))).toBe(true);
    expect(predictOls(model, point(-5, 0))).toBe(false);
  });

  it("returns null for insufficient or degenerate data", () => {
    expect(fitOls([point(1, 2)])).toBeNull();
    expect(fitOls([point(1, 2), point(1, 4)])).toBeNull();
  });

  it("computes ei+ on actual down and ei- on actual up with their real denominators", () => {
    const points = [point(1, -1), point(2, -1), point(3, 1), point(4, 1)];
    const result = errorMetrics(points, (p) => p.x % 2 === 1);
    expect(result.ePlus).toBeCloseTo(0.5);
    expect(result.eMinus).toBeCloseTo(0.5);
    expect(result.falsePositiveCount).toBe(1);
    expect(result.falseNegativeCount).toBe(1);
    expect(result.ePlusCi).not.toBeNull();
    expect(result.eMinusCi).not.toBeNull();
  });

  it("evaluates a chronological nested split with a sealed holdout", () => {
    const points = Array.from({ length: 32 }, (_, i) => point(i + 1, 2 * (i + 1) + 0.5, 1, `2020-01-${String(i + 1).padStart(2, "0")}`));
    const result = evaluateFactorOls(points);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.direction).toBe("direct");
    expect(result.model.beta).toBeCloseTo(2);
    expect(result.overall.acc).toBeCloseTo(1);
    expect(result.holdout.acc).toBeCloseTo(1);
    expect(result.segments.holdout.n).toBe(4);
  });

  it("refuses to compute when the factor has no variance", () => {
    const points = Array.from({ length: 32 }, (_, i) => point(1, i % 2 === 0 ? 1 : -1, 1, `2020-01-${String(i + 1).padStart(2, "0")}`));
    expect(evaluateFactorOls(points).status).toBe("not_computable");
  });

  it("holds out companies rather than fitting and evaluating on the same company", () => {
    const a = [point(-2, -4, 1), point(-1, -2, 1), point(1, 2, 1), point(2, 4, 1)];
    const b = [point(-2, 4, 2), point(-1, 2, 2), point(1, -2, 2), point(2, -4, 2)];
    const result = evaluateLeaveGroupOut([...a, ...b], "cik");
    expect(result).toHaveLength(2);
    expect(result.every((row) => row.status === "ok")).toBe(true);
    expect(result[0].model!.beta).toBeLessThan(0);
    expect(result[1].model!.beta).toBeGreaterThan(0);
  });

  it("keeps Wilson bounds within zero and one and handles an empty denominator", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const interval = wilsonInterval(5, 10)!;
    expect(interval[0]).toBeGreaterThanOrEqual(0);
    expect(interval[1]).toBeLessThanOrEqual(1);
  });
});
