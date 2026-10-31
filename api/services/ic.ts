/**
 * Stage 5-alpha (6a) — factor IC: information coefficient of a factor against
 * FORWARD returns, anchored on sourceFiled (never a calendar proxy).
 * Legacy-model lesson applied: no selection on full history; IC is measured
 * per window and reported with n, so a 2-point IC never looks meaningful.
 *
 * Pure statistics live here (unit-tested).
 */

/** Pearson r of x,y (paired, nulls dropped by caller). Returns null if <3 pairs or zero variance. */
export function pearson(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Ranks with average ties (1..n). */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation = Pearson of ranks. */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  return pearson(ranks(x), ranks(y));
}

export interface IcPair { x: number; y: number }
export function icStats(pairs: IcPair[]): { n: number; pearson: number | null; spearman: number | null } {
  const xs = pairs.map((p) => p.x), ys = pairs.map((p) => p.y);
  return { n: pairs.length, pearson: pearson(xs, ys), spearman: spearman(xs, ys) };
}

/** Forward return entry: first available close STRICTLY after the anchor date (no lookahead). */
export function entryCloseAfter(bars: { date: string; close: number }[], anchorDate: string): { date: string; close: number } | null {
  const after = bars.filter((b) => b.date > anchorDate).sort((a, b) => a.date.localeCompare(b.date))[0];
  return after ?? null;
}

/** Median close of the last `w` bars of the horizon (endpoint-noise smoothing). */
function medianClose(bars: { date: string; close: number }[], fromIdx: number, toIdx: number): number | null {
  const w = bars.slice(Math.max(0, fromIdx), toIdx + 1).map((b) => b.close);
  if (w.length === 0) return null;
  const s = [...w].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export interface ForwardReturnInfo {
  ret: number;
  entryDate: string;
  /** Date on which the last price used by the exit window became available. */
  exitDate: string;
}

/**
 * Forward return with its information-availability dates. Entry is the first
 * close STRICTLY after the anchor; exit is the MEDIAN of the last ~10 trading
 * days of the horizon. `exitDate` is essential for walk-forward training: a
 * past anchor whose exit is later than the prediction date is not a known
 * training label yet and must be excluded.
 */
export function forwardReturnInfo(
  bars: { date: string; close: number }[],
  anchorDate: string,
  hTradingDays: number
): ForwardReturnInfo | null {
  const entry = entryCloseAfter(bars, anchorDate);
  if (!entry) return null;
  const startIdx = bars.findIndex((b) => b.date === entry.date);
  if (startIdx < 0) return null;
  const exitIdx = startIdx + hTradingDays;
  if (exitIdx >= bars.length) return null;
  const exit = medianClose(bars, Math.max(startIdx, exitIdx - 9), exitIdx);
  if (exit === null || exit === 0) return null;
  return { ret: exit / entry.close - 1, entryDate: entry.date, exitDate: bars[exitIdx].date };
}

export function forwardReturn(bars: { date: string; close: number }[], anchorDate: string, hTradingDays: number): number | null {
  return forwardReturnInfo(bars, anchorDate, hTradingDays)?.ret ?? null;
}

/** Excess return of the stock over SPY, including the label availability date. */
export function excessForwardReturnInfo(
  stockBars: { date: string; close: number }[],
  spyBars: { date: string; close: number }[],
  anchorDate: string,
  hTradingDays: number
): ForwardReturnInfo | null {
  const stock = forwardReturnInfo(stockBars, anchorDate, hTradingDays);
  const spy = forwardReturnInfo(spyBars, anchorDate, hTradingDays);
  if (!stock || !spy) return null;
  return {
    ret: stock.ret - spy.ret,
    entryDate: stock.entryDate > spy.entryDate ? stock.entryDate : spy.entryDate,
    exitDate: stock.exitDate > spy.exitDate ? stock.exitDate : spy.exitDate,
  };
}

export function excessForwardReturn(
  stockBars: { date: string; close: number }[],
  spyBars: { date: string; close: number }[],
  anchorDate: string,
  hTradingDays: number
): number | null {
  return excessForwardReturnInfo(stockBars, spyBars, anchorDate, hTradingDays)?.ret ?? null;
}
