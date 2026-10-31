import type { NeutralizedPoint } from "./sector-neutral-ic";

export interface SpreadPoint { quarter: string; ret: number; longSet: Set<number>; shortSet: Set<number>; leverage?: number }
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);

export function legTurnover(previous: Set<number>, current: Set<number>): number {
  if (previous.size === 0 && current.size === 0) return 0;
  let intersection = 0;
  for (const x of previous) if (current.has(x)) intersection++;
  return 1 - intersection / Math.max(previous.size, current.size, 1);
}

/** Top-vs-bottom 20% by factor residual within one quarter. Direction=1 favors
 * high factor values; direction=-1 favors low values. */
export function quintileSpreads(rows: NeutralizedPoint[], direction: 1 | -1 = 1, fraction = 0.2): SpreadPoint[] {
  const quarters = new Map<string, NeutralizedPoint[]>();
  for (const r of rows) {
    if (!quarters.has(r.quarter)) quarters.set(r.quarter, []);
    quarters.get(r.quarter)!.push(r);
  }
  const out: SpreadPoint[] = [];
  for (const [quarter, pts] of [...quarters.entries()].sort()) {
    if (pts.length < 5) continue;
    const sorted = [...pts].sort((a, b) => direction * (a.x - b.x));
    const n = Math.max(1, Math.floor(pts.length * fraction));
    const high = sorted.slice(-n), low = sorted.slice(0, n);
    out.push({
      quarter,
      ret: mean(high.map((r) => r.y)) - mean(low.map((r) => r.y)),
      longSet: new Set(high.map((r) => r.cik)),
      shortSet: new Set(low.map((r) => r.cik)),
    });
  }
  return out;
}

/** Pre-registered 5% quarterly volatility target. Only past spreads are used;
 * leverage is clamped 0.25–1.00 (gross <=100% across both legs). */
export function applyVolTarget(spreads: SpreadPoint[], lookback = 4, targetVol = 0.05, minLeverage = 0.25, maxLeverage = 1.0): SpreadPoint[] {
  return spreads.map((s, i) => {
    const history = spreads.slice(Math.max(0, i - lookback), i).map((x) => x.ret);
    let leverage = maxLeverage;
    if (history.length >= 2) {
      const m = mean(history);
      const vol = Math.sqrt(history.reduce((a, r) => a + (r - m) ** 2, 0) / (history.length - 1));
      leverage = vol > 0 ? Math.min(maxLeverage, Math.max(minLeverage, targetVol / vol)) : maxLeverage;
    }
    return { ...s, leverage };
  });
}

export function strategyMetrics(spreads: SpreadPoint[], costBps = 15) {
  const rate = costBps / 10000;
  let turnover = 0, cost = 0, equity = 1, peak = 1, maxDD = 0;
  const rets: number[] = [];
  let previousLong = new Set<number>(), previousShort = new Set<number>(), previousLeverage = 1;
  for (const s of spreads) {
    const leverage = s.leverage ?? 1;
    const changed = Math.abs(leverage - previousLeverage) + leverage * (legTurnover(previousLong, s.longSet) + legTurnover(previousShort, s.shortSet));
    turnover += changed;
    cost += changed * rate;
    const r = leverage * s.ret - changed * rate;
    rets.push(r);
    equity *= Math.max(0, 1 + r);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak === 0 ? 0 : 1 - equity / peak);
    previousLong = s.longSet;
    previousShort = s.shortSet;
    previousLeverage = leverage;
  }
  const meanReturn = mean(rets);
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - meanReturn) ** 2, 0) / Math.max(rets.length - 1, 1));
  return { turnover, cost, sharpe: sd === 0 ? null : meanReturn / sd, maxDD, totalReturn: equity - 1, meanReturn, n: rets.length, returns: rets };
}
