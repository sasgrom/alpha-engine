import { describe, expect, it } from "vitest";
import {
  bucketedReturnSpread,
  conditionalMoments,
  crossSectionalRankIC,
  expectedExcess,
  fitMagnitudeBaseline,
  magnitudeErrors,
  meanPinballLoss,
  pinballLoss,
  predictMagnitude,
  quantile,
  returnCalibrationBins,
} from "./magnitude";

describe("6d distribution primitives", () => {
  it("computes interpolated quantiles and rejects invalid input", () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(quantile([0.2], 0.9)).toBe(0.2);
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1, 2], 1.5)).toBeNull();
  });

  it("splits conditional means by side and keeps missing classes null", () => {
    const m = conditionalMoments([0.1, -0.05, 0.2, -0.1]);
    expect(m.nUp).toBe(2);
    expect(m.nDown).toBe(2);
    expect(m.muPlus).toBeCloseTo(0.15);
    expect(m.muMinus).toBeCloseTo(-0.075);
    expect(m.q50).toBeCloseTo(0.025);
    expect(conditionalMoments([0.1, 0.2]).muMinus).toBeNull();
  });

  it("ranks by expected excess, not by probability alone", () => {
    expect(expectedExcess(0.75, 0.02, -0.08)).toBeCloseTo(-0.005);
    expect(expectedExcess(0.60, 0.10, -0.02)).toBeCloseTo(0.052);
    expect(expectedExcess(1.2, 0.1, -0.02)).toBeNull();
    expect(expectedExcess(0.5, null, -0.02)).toBeNull();
  });

  it("shrinks company means toward panel means using side counts", () => {
    const model = fitMagnitudeBaseline([
      { cik: "A", anchor: "d1", ret: 0.1, pUp: 0.5 },
      { cik: "A", anchor: "d2", ret: -0.04, pUp: 0.5 },
      { cik: "B", anchor: "d1", ret: 0.2, pUp: 0.5 },
      { cik: "B", anchor: "d2", ret: -0.04, pUp: 0.5 },
    ], 8)!;
    expect(model.panel.muPlus).toBeCloseTo(0.15);
    expect(model.companies.A.muPlus!).toBeCloseTo((1 / 9) * 0.1 + (8 / 9) * 0.15);
    expect(model.companies.A.muMinus!).toBeCloseTo(-0.04);
    expect(predictMagnitude({ cik: "missing", pUp: 0.5 }, model)).toBeCloseTo(0.055);
  });

  it("does not invent a prediction when one return class is absent", () => {
    const model = fitMagnitudeBaseline([{ cik: "A", anchor: "d", ret: 0.1, pUp: 0.8 }])!;
    expect(predictMagnitude({ cik: "A", pUp: 0.8 }, model)).toBeNull();
  });
});

describe("6d errors and quantile loss", () => {
  it("reports MAE, median AE, RMSE and signed bias", () => {
    const m = magnitudeErrors([{ actual: 0.1, predicted: 0.05 }, { actual: -0.1, predicted: -0.05 }])!;
    expect(m.mae).toBeCloseTo(0.05);
    expect(m.medianAe).toBeCloseTo(0.05);
    expect(m.rmse).toBeCloseTo(0.05);
    expect(m.bias).toBeCloseTo(0);
  });

  it("computes asymmetric pinball loss", () => {
    expect(pinballLoss(10, 8, 0.9)).toBeCloseTo(1.8);
    expect(pinballLoss(8, 10, 0.9)).toBeCloseTo(0.2);
    expect(meanPinballLoss([
      { actual: 10, predicted: 8, q: 0.9 },
      { actual: 8, predicted: 10, q: 0.9 },
    ])).toBeCloseTo(1);
  });
});

describe("6d cross-sectional metrics", () => {
  it("computes per-anchor rank IC and rejects a small cross-section", () => {
    const points = [1, 2, 3, 4, 5].map((i) => ({ cik: i, anchor: "d1", score: i, ret: i / 100 }));
    const result = crossSectionalRankIC(points);
    expect(result.status).toBe("ok");
    expect(result.values[0].ic).toBeCloseTo(1);
    expect(crossSectionalRankIC(points.slice(0, 4)).status).toBe("insufficient");
  });

  it("deduplicates a company within one anchor by keeping the last row", () => {
    const points = [
      { cik: "A", anchor: "d", score: 1, ret: 0.01 },
      { cik: "A", anchor: "d", score: 5, ret: 0.05 },
      { cik: "B", anchor: "d", score: 2, ret: 0.02 },
      { cik: "C", anchor: "d", score: 3, ret: 0.03 },
      { cik: "D", anchor: "d", score: 4, ret: 0.04 },
      { cik: "E", anchor: "d", score: 5, ret: 0.05 },
    ];
    const result = crossSectionalRankIC(points);
    expect(result.status).toBe("ok");
    expect(result.values[0].n).toBe(5);
  });

  it("computes top-minus-bottom bucket spread independently per anchor", () => {
    const points = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ cik: i, anchor: "d", score: i, ret: i / 100 }));
    const result = bucketedReturnSpread(points, 4, 8);
    expect(result.status).toBe("ok");
    expect(result.values[0].spread).toBeCloseTo(0.06);
    expect(result.positiveFraction).toBe(1);
    expect(bucketedReturnSpread(points.slice(0, 4), 4, 8).status).toBe("insufficient");
  });

  it("builds equal-count calibration bins without outcome-based row selection", () => {
    const points = [1, 2, 3, 4, 5].map((i) => ({ predicted: i / 100, actual: (i + 1) / 100 }));
    const bins = returnCalibrationBins(points, 2);
    expect(bins.map((b) => b.n)).toEqual([3, 2]);
    expect(bins[0].predictedMean).toBeCloseTo(0.02);
    expect(bins[0].actualMean).toBeCloseTo(0.03);
    expect(bins[1].actualMedian).toBeCloseTo(0.05);
  });
});
