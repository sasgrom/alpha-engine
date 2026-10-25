/**
 * 6c — chronological fit → calibrate → evaluate → final-holdout protocol.
 * Bayes and panel ridge-logistic are compared on the SAME anchors. The final
 * holdout is never used for fitting, calibration, thresholding, or selection.
 */
import { engineData, usedForAnchor, voteAt, type Bar, type EngineData } from "./probability-engine";
import { bayesPosterior, FACTOR_FAMILIES } from "./probability";
import {
  fitLogisticRidge,
  sigmoid,
  partialPooledIntercept,
  isotonicFit,
  blockBootstrapAccuracyCI,
  costMetrics,
} from "./logistic";
import { forwardReturn } from "./ic";

const HOLDOUT_N = 4;
const COOL_OFF = 8;
const LOGIT_PRIOR = "macroPriorLogit";
export const LOGISTIC_FEATURES = [...Object.keys(FACTOR_FAMILIES).sort(), LOGIT_PRIOR];

export interface AnchorPoint {
  cik: number;
  anchor: string;
  ret: number;
  exitDate: string;
  features: number[];
  rawP: number;
}

export interface AnchorDataset {
  cik: number;
  points: AnchorPoint[];
  spyBars: Bar[];
}

export type DatasetCache = Map<number, Promise<AnchorDataset>>;

async function buildAnchorDataset(cik: number): Promise<AnchorDataset> {
  const data: EngineData = await engineData(cik);
  const points: AnchorPoint[] = [];
  for (let i = COOL_OFF; i < data.anchors.length; i++) {
    const outcome = data.outcomes[i];
    if (!outcome) continue;
    const items = usedForAnchor(data, i).map((u) => voteAt(data, u, i))
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (items.length === 0) continue;
    const prior = await data.macroPriorAt(data.anchors[i]);
    const rawP = bayesPosterior(items, prior);
    if (rawP === null) continue;
    const features = LOGISTIC_FEATURES.map((name) => {
      if (name === LOGIT_PRIOR) return Math.log(prior / (1 - prior));
      // Zero is the robust-z median/neutral value. A fixed schema is required
      // for panel logistic; missing values are not selected using future data.
      return data.zValues.get(name)?.[i] ?? 0;
    });
    points.push({
      cik, anchor: data.anchors[i], ret: outcome.ret, exitDate: outcome.exitDate,
      features, rawP,
    });
  }
  return { cik, points, spyBars: data.spyBars };
}

function loadDataset(cik: number, cache?: DatasetCache): Promise<AnchorDataset> {
  if (!cache) return buildAnchorDataset(cik);
  if (!cache.has(cik)) cache.set(cik, buildAnchorDataset(cik));
  return cache.get(cik)!;
}

export interface ClassificationMetrics {
  n: number;
  acc: number | null;
  upAcc: number | null;
  downAcc: number | null;
  upRecall: number | null;
  downRecall: number | null;
  balancedAcc: number | null;
  callsUp: number;
  callsDown: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  baselineExcess: number | null;
  majorityBaseline: number | null;
}

export function classificationMetrics(
  points: AnchorPoint[],
  predict: (pt: AnchorPoint) => boolean
): ClassificationMetrics {
  let tp = 0, tn = 0, fp = 0, fn = 0, callsUp = 0;
  for (const pt of points) {
    const up = predict(pt), realized = pt.ret > 0;
    if (up) callsUp++;
    if (up && realized) tp++;
    else if (up && !realized) fp++;
    else if (!up && !realized) tn++;
    else fn++;
  }
  const n = points.length, callsDown = n - callsUp;
  const upRate = n ? (tp + fn) / n : null;
  const upRecall = tp + fn ? tp / (tp + fn) : null;
  const downRecall = tn + fp ? tn / (tn + fp) : null;
  return {
    n,
    acc: n ? (tp + tn) / n : null,
    upAcc: tp + fp ? tp / (tp + fp) : null,
    downAcc: tn + fn ? tn / (tn + fn) : null,
    upRecall,
    downRecall,
    balancedAcc: upRecall !== null && downRecall !== null ? (upRecall + downRecall) / 2 : null,
    callsUp, callsDown, tp, tn, fp, fn,
    baselineExcess: upRate,
    majorityBaseline: upRate === null ? null : Math.max(upRate, 1 - upRate),
  };
}

interface Split {
  fit: AnchorPoint[];
  cal: AnchorPoint[];
  evaluation: AnchorPoint[];
  holdout: AnchorPoint[];
}

export function splitNested(points: AnchorPoint[]): Split | null {
  if (points.length < 24) return null;
  const holdout = points.slice(-HOLDOUT_N);
  const development = points.slice(0, -HOLDOUT_N);
  const fitN = Math.floor(development.length * 0.5);
  const calN = Math.floor(development.length * 0.25);
  const fit = development.slice(0, fitN);
  const cal = development.slice(fitN, fitN + calN);
  const evaluation = development.slice(fitN + calN);
  if (fit.length < 8 || cal.length < 4 || evaluation.length < 4) return null;
  return { fit, cal, evaluation, holdout };
}

function knownBefore(points: AnchorPoint[], cutoff: string): AnchorPoint[] {
  return points.filter((p) => p.exitDate < cutoff);
}

function regimeMetrics(
  points: AnchorPoint[],
  predict: (pt: AnchorPoint) => boolean,
  spyBars: Bar[]
): { bull: ClassificationMetrics; bear: ClassificationMetrics } {
  const bull = points.filter((p) => (forwardReturn(spyBars, p.anchor, 63) ?? 0) > 0);
  const bullSet = new Set(bull);
  const bear = points.filter((p) => !bullSet.has(p) && forwardReturn(spyBars, p.anchor, 63) !== null);
  return { bull: classificationMetrics(bull, predict), bear: classificationMetrics(bear, predict) };
}

/** Keep only windows whose 63-session return intervals do not overlap. */
export function nonOverlapping(points: AnchorPoint[]): AnchorPoint[] {
  const out: AnchorPoint[] = [];
  let previousExit = "";
  for (const p of points) {
    if (out.length > 0 && p.anchor < previousExit) continue;
    out.push(p);
    previousExit = p.exitDate;
  }
  return out;
}

function segmentCost(
  segment: AnchorPoint[],
  predict: (pt: AnchorPoint) => boolean
): ReturnType<typeof costMetrics> {
  // Accuracy may use every overlapping observation; money performance may not.
  // Start each independent evaluation sleeve in cash and charge initial entry.
  const rows = nonOverlapping(segment);
  return costMetrics(rows.map((p) => ({ ret: p.ret, position: predict(p) ? 1 : 0 })), { initialPosition: 0 });
}

export interface NestedReport {
  cik: number;
  model: "bayes" | "logistic";
  panelCiks: number[];
  features: string[];
  segments: Record<"fit" | "calibration" | "evaluation" | "holdout", { n: number; knownN?: number; from: string; to: string }>;
  /** Out-of-sample evaluation segment only — never fit/calibration rows. */
  overall: ClassificationMetrics;
  upDown: { upAcc: number | null; downAcc: number | null };
  baselineExcess: number | null;
  majorityBaseline: number | null;
  cost: ReturnType<typeof costMetrics>;
  baselineCost: ReturnType<typeof costMetrics>;
  regime: { bull: ClassificationMetrics; bear: ClassificationMetrics };
  ci: { low: number; high: number };
  holdout: ClassificationMetrics;
  holdoutCost: ReturnType<typeof costMetrics>;
  holdoutBaselineCost: ReturnType<typeof costMetrics>;
  holdoutCi: { low: number; high: number };
  pooling: { panelRows: number; targetRows: number; companies: number; intercept: number } | null;
  predictions: { segment: "evaluation" | "holdout"; anchor: string; rawP: number; calibratedP: number; call: "UP" | "DOWN"; ret: number; correct: boolean }[];
}

export interface NestedOptions {
  panelCiks?: number[];
  datasetCache?: DatasetCache;
}

function pooledLogistic(
  targetTrain: AnchorPoint[],
  panelTrain: AnchorPoint[]
): { rawP: (pt: AnchorPoint) => number; intercept: number } {
  const rows = panelTrain.length >= 8 ? panelTrain : targetTrain;
  const X = rows.map((p) => [1, ...p.features]);
  const y = rows.map((p) => p.ret > 0 ? 1 : 0);
  const b = fitLogisticRidge(X, y, 1);
  const globalIntercept = b[0] ?? 0;
  const coefficients = b.slice(1);
  const linear = (pt: AnchorPoint, intercept: number) => intercept + pt.features.reduce((a, v, j) => a + v * (coefficients[j] ?? 0), 0);

  // Target-company intercept refit with global slopes fixed, then shrunk to
  // the pooled intercept. With multiple companies this is genuine partial
  // pooling, not shrinking a one-company intercept toward itself.
  let companyIntercept = globalIntercept;
  for (let it = 0; it < 20; it++) {
    const probabilities = targetTrain.map((p) => sigmoid(linear(p, companyIntercept)));
    const gradient = targetTrain.reduce((a, p, i) => a + ((p.ret > 0 ? 1 : 0) - probabilities[i]), 0);
    const hessian = targetTrain.reduce((a, _, i) => a + probabilities[i] * (1 - probabilities[i]), 0) + 1e-6;
    const step = Math.max(-2, Math.min(2, gradient / hessian));
    companyIntercept = Math.max(-20, Math.min(20, companyIntercept + step));
    if (Math.abs(step) < 1e-7) break;
  }
  const intercept = partialPooledIntercept(globalIntercept, companyIntercept, targetTrain.length, 8);
  return { rawP: (pt) => sigmoid(linear(pt, intercept)), intercept };
}

function segmentInfo(rows: AnchorPoint[], knownN?: number) {
  return { n: rows.length, ...(knownN === undefined ? {} : { knownN }), from: rows[0].anchor, to: rows[rows.length - 1].anchor };
}

export async function nestedEvaluate(
  cik: number,
  model: "bayes" | "logistic",
  opts: NestedOptions = {}
): Promise<NestedReport | null> {
  const target = await loadDataset(cik, opts.datasetCache);
  const split = splitNested(target.points);
  if (!split) return null;
  const { fit, cal, evaluation, holdout } = split;
  const fitCutoff = fit[fit.length - 1].anchor;
  const calCutoff = cal[cal.length - 1].anchor;
  const fitKnown = knownBefore(fit, fitCutoff);
  const calKnown = knownBefore(cal, calCutoff);
  if (fitKnown.length < 4 || calKnown.length < 2) return null;

  let rawProbability: (pt: AnchorPoint) => number;
  let pooling: NestedReport["pooling"] = null;
  const panelCiks = model === "logistic" ? [...new Set(opts.panelCiks ?? [cik])] : [cik];
  if (model === "bayes") {
    rawProbability = (pt) => pt.rawP;
  } else {
    const otherPanels = await Promise.all(panelCiks.filter((id) => id !== cik).map((id) => loadDataset(id, opts.datasetCache)));
    const otherTrain = otherPanels.flatMap((panel) => knownBefore(panel.points.filter((p) => p.anchor <= fitCutoff), fitCutoff));
    const panelTrain = [...fitKnown, ...otherTrain];
    const logistic = pooledLogistic(fitKnown, panelTrain);
    rawProbability = logistic.rawP;
    pooling = { panelRows: panelTrain.length, targetRows: fitKnown.length, companies: panelCiks.length, intercept: logistic.intercept };
  }

  // Only calibration labels known before the calibration cutoff are used.
  // With too few rows isotonicFit deliberately remains the identity.
  const calibrate = isotonicFit(calKnown.map((pt) => ({ p: rawProbability(pt), y: pt.ret > 0 ? 1 : 0 })));
  const calibratedP = (pt: AnchorPoint) => calibrate(rawProbability(pt));
  const predict = (pt: AnchorPoint) => calibratedP(pt) >= 0.5;
  const overall = classificationMetrics(evaluation, predict);
  const holdoutMetrics = classificationMetrics(holdout, predict);
  const evaluated = [...evaluation.map((p) => ({ p, segment: "evaluation" as const })), ...holdout.map((p) => ({ p, segment: "holdout" as const }))];

  return {
    cik,
    model,
    panelCiks,
    features: model === "logistic" ? LOGISTIC_FEATURES : [],
    segments: {
      fit: segmentInfo(fit, fitKnown.length),
      calibration: segmentInfo(cal, calKnown.length),
      evaluation: segmentInfo(evaluation),
      holdout: segmentInfo(holdout),
    },
    overall,
    upDown: { upAcc: overall.upAcc, downAcc: overall.downAcc },
    baselineExcess: overall.baselineExcess,
    majorityBaseline: overall.majorityBaseline,
    cost: segmentCost(evaluation, predict),
    baselineCost: segmentCost(evaluation, () => true),
    regime: regimeMetrics(evaluation, predict, target.spyBars),
    ci: blockBootstrapAccuracyCI(evaluation.map((p) => ({ correct: predict(p) === (p.ret > 0) }))),
    holdout: holdoutMetrics,
    holdoutCost: segmentCost(holdout, predict),
    holdoutBaselineCost: segmentCost(holdout, () => true),
    holdoutCi: blockBootstrapAccuracyCI(holdout.map((p) => ({ correct: predict(p) === (p.ret > 0) }))),
    pooling,
    predictions: evaluated.map(({ p, segment }) => ({
      segment, anchor: p.anchor, rawP: rawProbability(p), calibratedP: calibratedP(p),
      call: predict(p) ? "UP" : "DOWN", ret: p.ret, correct: predict(p) === (p.ret > 0),
    })),
  };
}
