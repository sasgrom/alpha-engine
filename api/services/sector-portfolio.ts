import type { NeutralizedPoint } from "./sector-neutral-ic";

export interface SpreadPoint { quarter: string; ret: number; longSet: Set<number>; shortSet: Set<number> }
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

export function strategyMetrics(spreads: SpreadPoint[], costBps = 15) {
  const rate = costBps / 10000;
  let turnover = 0, cost = 0, equity = 1, peak = 1, maxDD = 0;
  const rets: number[] = [];
  let previousLong = new Set<number>(), previousShort = new Set<number>();
  for (const s of spreads) {
    const changed = legTurnover(previousLong, s.longSet) + legTurnover(previousShort, s.shortSet);
    turnover += changed;
    cost += changed * rate;
    const r = s.ret - changed * rate;
    rets.push(r);
    equity *= Math.max(0, 1 + r);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak === 0 ? 0 : 1 - equity / peak);
    previousLong = s.longSet;
    previousShort = s.shortSet;
  }
  const meanReturn = mean(rets);
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - meanReturn) ** 2, 0) / Math.max(rets.length - 1, 1));
  return { turnover, cost, sharpe: sd === 0 ? null : meanReturn / sd, maxDD, totalReturn: equity - 1, meanReturn, n: rets.length, returns: rets };
}
