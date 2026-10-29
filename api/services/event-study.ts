import { meanTStat } from "./research-metrics";

export interface EventBar { date: string; close: number }
export type EventSession = "pre_open" | "post_close";
export interface AbnormalPoint { relativeDay: number; date: string; abnormalReturn: number; car: number }
export interface EventStudyResult { startDate: string; alpha: number; beta: number; estimationN: number; points: AbnormalPoint[] }

function alignedReturns(stockBars: EventBar[], marketBars: EventBar[]) {
  const returns = (bars: EventBar[]) => bars.slice(1).map((bar, i) => ({ date: bar.date, ret: bar.close / bars[i].close - 1 }))
    .filter((r) => Number.isFinite(r.ret));
  const market = new Map(returns(marketBars).map((r) => [r.date, r.ret]));
  return returns(stockBars).flatMap((r) => market.has(r.date) ? [{ date: r.date, stock: r.ret, market: market.get(r.date)! }] : []);
}

function ols(rows: { stock: number; market: number }[]) {
  const n = rows.length;
  const mx = rows.reduce((s, r) => s + r.market, 0) / n, my = rows.reduce((s, r) => s + r.stock, 0) / n;
  let xx = 0, xy = 0;
  for (const r of rows) { const x = r.market - mx; xx += x * x; xy += x * (r.stock - my); }
  if (xx === 0) return null;
  const beta = xy / xx, alpha = my - beta * mx;
  return { alpha, beta };
}

/** Market-model abnormal returns. post_close starts next session by default. */
export function marketModelEventStudy(
  stockBars: EventBar[], marketBars: EventBar[], eventDate: string,
  opts: { session?: EventSession; horizon?: number; estimationDays?: number; minEstimationDays?: number } = {},
): EventStudyResult | null {
  const session = opts.session ?? "post_close", horizon = opts.horizon ?? 63;
  const estimationDays = opts.estimationDays ?? 120, minEstimationDays = opts.minEstimationDays ?? 60;
  const rows = alignedReturns(stockBars, marketBars);
  const startIdx = rows.findIndex((r) => session === "pre_open" ? r.date >= eventDate : r.date > eventDate);
  if (startIdx < 0) return null;
  const estimation = rows.slice(Math.max(0, startIdx - estimationDays), startIdx);
  if (estimation.length < minEstimationDays) return null;
  const fit = ols(estimation);
  if (!fit) return null;
  let car = 0;
  const points = rows.slice(startIdx, startIdx + horizon + 1).map((r, relativeDay) => {
    const abnormalReturn = r.stock - (fit.alpha + fit.beta * r.market);
    car += abnormalReturn;
    return { relativeDay, date: r.date, abnormalReturn, car };
  });
  return { startDate: rows[startIdx].date, ...fit, estimationN: estimation.length, points };
}

export function carAt(result: EventStudyResult, relativeDay: number): number | null {
  return result.points.find((p) => p.relativeDay === relativeDay)?.car ?? null;
}

export function summarizeEventStudies(results: EventStudyResult[], relativeDay: number) {
  const cars = results.map((r) => carAt(r, relativeDay)).filter((x): x is number => x !== null && Number.isFinite(x));
  const sorted = [...cars].sort((a, b) => a - b);
  return {
    n: cars.length,
    meanCar: cars.length ? cars.reduce((a, b) => a + b, 0) / cars.length : null,
    medianCar: cars.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null,
    tStatNaive: meanTStat(cars),
  };
}
