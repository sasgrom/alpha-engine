/**
 * What a run of daily closes says about risk: the return over the run, how much the price moved day to day, how far
 * it fell from a peak, and how the daily returns were spread. Pure: the Company page feeds it the closes of the range
 * chosen on the price chart.
 */
export interface ClosePoint { date: string; close: number }

export interface ReturnBin {
  /** Bin edges as daily returns; the first and last bins are open-ended and also hold everything beyond them. */
  from: number;
  to: number;
  count: number;
  openLow: boolean;
  openHigh: boolean;
}

export interface PriceRisk {
  sessions: number;
  from: string;
  to: string;
  totalReturn: number;
  /** Standard deviation of the daily returns times the square root of 252. */
  annualVolatility: number | null;
  /** The largest fall from a peak inside the run, with the day of the peak and the day of the low. */
  maxDrawdown: number;
  peakDate: string;
  troughDate: string;
  /** How far the last close is below the highest close of the run (0 at a new high). */
  currentDrawdown: number;
  best: { date: string; value: number } | null;
  worst: { date: string; value: number } | null;
  /** Share of sessions that closed above the one before. */
  upShare: number | null;
  /** Per session, the distance below the highest close so far (0 or negative). */
  drawdown: Array<{ date: string; value: number }>;
  bins: ReturnBin[];
}

const BIN_STEPS = [0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1];

/**
 * Bins of one round width, symmetric around zero, wide enough to hold all but the most extreme 1% of days on each
 * side; those extremes are counted in the two end bins, so one wild day does not flatten the picture.
 */
export function returnBins(returns: number[], target = 24): ReturnBin[] {
  if (!returns.length) return [];
  const sorted = returns.map(Math.abs).sort((a, b) => a - b);
  const reach = Math.max(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))], 0.0025);
  const step = BIN_STEPS.find((candidate) => (2 * reach) / candidate <= target) ?? BIN_STEPS[BIN_STEPS.length - 1];
  const half = Math.max(1, Math.ceil(reach / step - 1e-9));
  const bins: ReturnBin[] = Array.from({ length: half * 2 }, (_, index) => ({
    from: (index - half) * step, to: (index - half + 1) * step, count: 0, openLow: index === 0, openHigh: index === half * 2 - 1,
  }));
  for (const value of returns) {
    // a day exactly at zero belongs with the days that did not rise
    const index = Math.min(bins.length - 1, Math.max(0, value === 0 ? half - 1 : Math.floor(value / step + 1e-9) + half));
    bins[index].count++;
  }
  return bins;
}

export function priceRisk(points: ClosePoint[]): PriceRisk | null {
  const clean = points.filter((point) => Number.isFinite(point.close) && point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length < 3) return null;
  const returns = clean.slice(1).map((point, index) => ({ date: point.date, value: point.close / clean[index].close - 1 }));
  const mean = returns.reduce((sum, row) => sum + row.value, 0) / returns.length;
  const variance = returns.length > 1 ? returns.reduce((sum, row) => sum + (row.value - mean) ** 2, 0) / (returns.length - 1) : null;
  let peak = clean[0], maxDrawdown = 0, peakDate = clean[0].date, troughDate = clean[0].date;
  const drawdown = clean.map((point) => {
    if (point.close > peak.close) peak = point;
    const value = point.close / peak.close - 1;
    if (value < maxDrawdown) {
      maxDrawdown = value;
      peakDate = peak.date;
      troughDate = point.date;
    }
    return { date: point.date, value };
  });
  const best = returns.reduce((a, b) => (b.value > a.value ? b : a));
  const worst = returns.reduce((a, b) => (b.value < a.value ? b : a));
  return {
    sessions: clean.length, from: clean[0].date, to: clean[clean.length - 1].date,
    totalReturn: clean[clean.length - 1].close / clean[0].close - 1,
    annualVolatility: variance === null ? null : Math.sqrt(variance) * Math.sqrt(252),
    maxDrawdown, peakDate, troughDate, currentDrawdown: drawdown[drawdown.length - 1].value,
    best, worst, upShare: returns.filter((row) => row.value > 0).length / returns.length,
    drawdown, bins: returnBins(returns.map((row) => row.value)),
  };
}
