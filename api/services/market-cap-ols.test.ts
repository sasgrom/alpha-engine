import { describe, expect, it } from "vitest";
import { expandingLogOls, expandingMetrics, type LogMarketRevenuePoint } from "./market-cap-ols";

const points = (n: number): LogMarketRevenuePoint[] => Array.from({ length: n }, (_, i) => ({
  cik: 1,
  anchor: `2020-01-${String(i + 1).padStart(2, "0")}`,
  previousAnchor: `2019-12-${String(i + 1).padStart(2, "0")}`,
  lnRevenue: i + 1,
  lnMarketCap: 1 + 2 * (i + 1),
  sector: "Tech",
}));

describe("log Market Cap / Revenue expanding window", () => {
  it("fits each one-step-ahead prediction using only prior observations", () => {
    const result = expandingLogOls(points(24), 20);
    expect(result.status).toBe("ok");
    expect(result.predictions).toHaveLength(4);
    expect(result.predictions[0].model.n).toBe(20);
    expect(result.predictions[1].model.n).toBe(21);
    expect(result.predictions[2].model.n).toBe(22);
    expect(result.predictions[3].model.n).toBe(23);
    for (const prediction of result.predictions) {
      expect(prediction.predicted).toBeCloseTo(prediction.actual, 8);
      expect(prediction.model.r2).toBeCloseTo(1);
    }
    const metrics = expandingMetrics(result.predictions);
    expect(metrics.r2).toBeCloseTo(1);
    expect(metrics.rmseLog).toBeCloseTo(0);
    expect(metrics.rmseUsdMillion).toBeCloseTo(0);
    expect(metrics.ePlus).toBeCloseTo(0);
    expect(metrics.eMinus).toBeCloseTo(0);
  });

  it("requires the minimum training history", () => {
    expect(expandingLogOls(points(20), 20).status).toBe("insufficient_data");
    expect(expandingLogOls(points(19), 20).status).toBe("insufficient_data");
  });

  it("separates wrong-up and wrong-down directional errors with correct denominators", () => {
    const custom = [
      { cik: 1, anchor: "a", previousAnchor: "p", actual: -0.1, predicted: 0.1, actualChange: -0.1, predictedChange: 0.2, model: { alpha: 0, beta: 1, r2: 1, n: 20 } },
      { cik: 1, anchor: "b", previousAnchor: "a", actual: 0.2, predicted: 0.1, actualChange: 0.2, predictedChange: -0.1, model: { alpha: 0, beta: 1, r2: 1, n: 21 } },
    ];
    const metrics = expandingMetrics(custom);
    expect(metrics.ePlus).toBeCloseTo(1);
    expect(metrics.eMinus).toBeCloseTo(1);
  });
});
