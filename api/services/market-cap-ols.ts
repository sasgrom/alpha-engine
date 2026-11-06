import { fitOls, errorMetrics, wilsonInterval, type OlsAnchorPoint, type ErrorMetrics } from "./factor-ols";

export interface LogMarketRevenuePoint {
  cik: number;
  anchor: string;
  previousAnchor: string;
  lnRevenue: number;
  lnMarketCap: number;
  sector: string | null;
}

export interface ExpandingPrediction {
  cik: number;
  anchor: string;
  previousAnchor: string;
  actual: number;
  predicted: number;
  actualChange: number;
  predictedChange: number;
  model: { alpha: number; beta: number; r2: number; n: number };
}

export interface ExpandingMetrics {
  n: number;
  r2: number | null;
  rmseLog: number | null;
  rmseUsdMillion: number | null;
  ePlus: number | null;
  eMinus: number | null;
  ePlusCi: [number, number] | null;
  eMinusCi: [number, number] | null;
  balancedAcc: number | null;
  majorityBaseline: number | null;
  reliability: ErrorMetrics["reliability"];
}

const toOlsPoint = (point: LogMarketRevenuePoint): OlsAnchorPoint => ({
  cik: point.cik,
  anchor: point.anchor,
  ret: point.lnMarketCap,
  exitDate: point.anchor,
  features: [],
  rawP: 0.5,
  x: point.lnRevenue,
  sector: point.sector,
});

export function expandingLogOls(points: LogMarketRevenuePoint[], minTrainSize = 20): { status: "insufficient_data" | "ok"; predictions: ExpandingPrediction[] } {
  const sorted = [...points].sort((a, b) => a.anchor.localeCompare(b.anchor) || a.cik - b.cik);
  if (sorted.length <= minTrainSize) return { status: "insufficient_data", predictions: [] };
  const predictions: ExpandingPrediction[] = [];
  for (let i = minTrainSize; i < sorted.length; i++) {
    const train = sorted.slice(0, i).map(toOlsPoint);
    const model = fitOls(train);
    if (!model || model.beta === 0) continue;
    const current = sorted[i];
    const predicted = model.alpha + model.beta * current.lnRevenue;
    const previous = sorted[i - 1];
    predictions.push({
      cik: current.cik,
      anchor: current.anchor,
      previousAnchor: current.previousAnchor,
      actual: current.lnMarketCap,
      predicted,
      actualChange: current.lnMarketCap - previous.lnMarketCap,
      predictedChange: predicted - previous.lnMarketCap,
      model,
    });
  }
  return { status: "ok", predictions };
}

export function expandingMetrics(predictions: ExpandingPrediction[]): ExpandingMetrics {
  const n = predictions.length;
  if (!n) return { n: 0, r2: null, rmseLog: null, rmseUsdMillion: null, ePlus: null, eMinus: null, ePlusCi: null, eMinusCi: null, balancedAcc: null, majorityBaseline: null, reliability: null };
  const actual = predictions.map((row) => row.actual);
  const mean = actual.reduce((sum, value) => sum + value, 0) / n;
  const sse = predictions.reduce((sum, row) => sum + (row.actual - row.predicted) ** 2, 0);
  const sst = actual.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const rmseLog = Math.sqrt(sse / n);
  const rmseUsdMillion = Math.sqrt(predictions.reduce((sum, row) => sum + (Math.exp(row.actual) - Math.exp(row.predicted)) ** 2, 0) / n) / 1e6;
  const classificationPoints: OlsAnchorPoint[] = predictions.map((row) => ({
    cik: row.cik,
    anchor: row.anchor,
    ret: row.actualChange,
    exitDate: row.anchor,
    features: [],
    rawP: 0.5,
    x: row.predictedChange,
    sector: null,
  }));
  const metrics = errorMetrics(classificationPoints, (point) => point.x > 0);
  return {
    n,
    r2: sst === 0 ? null : 1 - sse / sst,
    rmseLog,
    rmseUsdMillion,
    ePlus: metrics.ePlus,
    eMinus: metrics.eMinus,
    ePlusCi: wilsonInterval(metrics.falsePositiveCount, classificationPoints.filter((point) => point.ret <= 0).length),
    eMinusCi: wilsonInterval(metrics.falseNegativeCount, classificationPoints.filter((point) => point.ret > 0).length),
    balancedAcc: metrics.balancedAcc,
    majorityBaseline: metrics.majorityBaseline,
    reliability: metrics.reliability,
  };
}
