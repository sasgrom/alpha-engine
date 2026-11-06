import { classificationMetrics, knownBefore, splitNested, type AnchorPoint, type ClassificationMetrics } from "./nested-eval";
import { reliabilityFromCalls, type Reliability } from "./probability";
import { blockBootstrapAccuracyCI } from "./logistic";

export interface OlsAnchorPoint extends AnchorPoint {
  x: number;
  sector: string | null;
}

export interface OlsModel {
  alpha: number;
  beta: number;
  r2: number;
  n: number;
}

export interface ErrorMetrics extends ClassificationMetrics {
  ePlus: number | null;
  eMinus: number | null;
  falsePositiveCount: number;
  falseNegativeCount: number;
  reliability: Reliability | null;
  ePlusCi: [number, number] | null;
  eMinusCi: [number, number] | null;
}

export function fitOls(points: OlsAnchorPoint[]): OlsModel | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.ret, 0) / n;
  let xx = 0, xy = 0, yy = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.ret - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  if (xx === 0 || yy === 0) return null;
  const beta = xy / xx;
  const alpha = meanY - beta * meanX;
  const residual = points.reduce((sum, point) => sum + (point.ret - (alpha + beta * point.x)) ** 2, 0);
  return { alpha, beta, r2: 1 - residual / yy, n };
}

export function predictOls(model: OlsModel, point: OlsAnchorPoint): boolean {
  return model.alpha + model.beta * point.x > 0;
}

export function wilsonInterval(successes: number, total: number, z = 1.96): [number, number] | null {
  if (total === 0) return null;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function errorMetrics(points: OlsAnchorPoint[], predict: (point: OlsAnchorPoint) => boolean): ErrorMetrics {
  const actualDown = points.filter((point) => point.ret <= 0);
  const actualUp = points.filter((point) => point.ret > 0);
  const falsePositive = actualDown.filter(predict).length;
  const falseNegative = actualUp.filter((point) => !predict(point)).length;
  return {
    ...classificationMetrics(points as unknown as AnchorPoint[], (pt) => predict(pt as OlsAnchorPoint)),
    ePlus: actualDown.length ? falsePositive / actualDown.length : null,
    eMinus: actualUp.length ? falseNegative / actualUp.length : null,
    falsePositiveCount: falsePositive,
    falseNegativeCount: falseNegative,
    reliability: reliabilityFromCalls(points.map((point) => ({ predictUp: predict(point), realizedUp: point.ret > 0 }))),
    ePlusCi: wilsonInterval(falsePositive, actualDown.length),
    eMinusCi: wilsonInterval(falseNegative, actualUp.length),
  };
}

export function evaluateFactorOls(points: OlsAnchorPoint[]) {
  const split = splitNested(points);
  if (!split) return { status: "insufficient_data" as const };
  const { fit, cal, evaluation, holdout } = split;
  const fitKnown = knownBefore(fit, fit[fit.length - 1].anchor);
  const calKnown = knownBefore(cal, cal[cal.length - 1].anchor);
  if (fitKnown.length < 8 || calKnown.length < 2) return { status: "insufficient_data" as const };
  const model = fitOls(fitKnown);
  if (!model || model.beta === 0) return { status: "not_computable" as const };
  const predict = (point: OlsAnchorPoint) => predictOls(model, point);
  return {
    status: "ok" as const,
    model,
    direction: model.beta > 0 ? "direct" as const : "inverse" as const,
    segments: {
      fit: { n: fit.length, knownN: fitKnown.length, from: fit[0].anchor, to: fit[fit.length - 1].anchor },
      calibration: { n: cal.length, knownN: calKnown.length, from: cal[0].anchor, to: cal[cal.length - 1].anchor },
      evaluation: { n: evaluation.length, from: evaluation[0].anchor, to: evaluation[evaluation.length - 1].anchor },
      holdout: { n: holdout.length, from: holdout[0].anchor, to: holdout[holdout.length - 1].anchor },
    },
    overall: errorMetrics(evaluation, predict),
    overallAccuracyCi: blockBootstrapAccuracyCI(evaluation.map((point) => ({ correct: predict(point) === (point.ret > 0) }))),
    holdout: errorMetrics(holdout, predict),
    holdoutAccuracyCi: blockBootstrapAccuracyCI(holdout.map((point) => ({ correct: predict(point) === (point.ret > 0) }))),
  };
}

export function evaluateLeaveGroupOut(points: OlsAnchorPoint[], groupKey: "cik" | "sector") {
  const groups = [...new Set(points.map((point) => groupKey === "cik" ? point.cik : point.sector ?? "unknown"))].sort((a, b) => String(a).localeCompare(String(b)));
  const results = [];
  for (const group of groups) {
    const train = points.filter((point) => (groupKey === "cik" ? point.cik : point.sector ?? "unknown") !== group);
    const test = points.filter((point) => (groupKey === "cik" ? point.cik : point.sector ?? "unknown") === group);
    const model = fitOls(train);
    if (!model || model.beta === 0 || test.length < 2) {
      results.push({ group, status: "not_computable" as const, testN: test.length });
      continue;
    }
    const predict = (point: OlsAnchorPoint) => predictOls(model, point);
    results.push({ group, status: "ok" as const, testN: test.length, model, direction: model.beta > 0 ? "direct" as const : "inverse" as const, metrics: errorMetrics(test, predict) });
  }
  return results;
}
