export interface TerminalPriceBar {
  date: string;
  close: number;
  volume?: number | null;
}

export interface ReturnBin {
  min: number;
  max: number;
  count: number;
  label: string;
}

export interface PriceAnalytics {
  totalReturn: number | null;
  annualizedVolatility: number | null;
  maxDrawdown: number | null;
  bestDay: number | null;
  worstDay: number | null;
  positiveShare: number | null;
  returns: Array<{ date: string; value: number }>;
  drawdown: Array<{ date: string; value: number }>;
  histogram: ReturnBin[];
}

export function calculatePriceAnalytics(bars: TerminalPriceBar[]): PriceAnalytics {
  const clean = bars.filter((bar) => Number.isFinite(bar.close) && bar.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const returns = clean.slice(1).map((bar, index) => ({ date: bar.date, value: bar.close / clean[index].close - 1 }));
  const totalReturn = clean.length > 1 ? clean.at(-1)!.close / clean[0].close - 1 : null;
  const mean = returns.length ? returns.reduce((sum, row) => sum + row.value, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((sum, row) => sum + (row.value - mean) ** 2, 0) / (returns.length - 1) : null;
  const annualizedVolatility = variance === null ? null : Math.sqrt(variance) * Math.sqrt(252);
  let peak = clean[0]?.close ?? 0;
  let maxDrawdown = 0;
  const drawdown = clean.map((bar) => {
    peak = Math.max(peak, bar.close);
    const value = peak > 0 ? bar.close / peak - 1 : 0;
    maxDrawdown = Math.min(maxDrawdown, value);
    return { date: bar.date, value };
  });
  const values = returns.map((row) => row.value);
  const bestDay = values.length ? Math.max(...values) : null;
  const worstDay = values.length ? Math.min(...values) : null;
  const positiveShare = values.length ? values.filter((value) => value > 0).length / values.length : null;
  const histogram = buildHistogram(values);
  return { totalReturn, annualizedVolatility, maxDrawdown: clean.length ? maxDrawdown : null, bestDay, worstDay, positiveShare, returns, drawdown, histogram };
}

function buildHistogram(values: number[]): ReturnBin[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ min, max, count: values.length, label: percentLabel(min) }];
  const count = Math.min(9, Math.max(5, Math.ceil(Math.sqrt(values.length))));
  const step = (max - min) / count;
  const bins = Array.from({ length: count }, (_, index) => {
    const from = min + index * step;
    const to = index === count - 1 ? max : from + step;
    return { min: from, max: to, count: 0, label: `${percentLabel(from)}…${percentLabel(to)}` };
  });
  for (const value of values) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - min) / step)));
    bins[index].count += 1;
  }
  return bins;
}

function percentLabel(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function movingAverage(bars: TerminalPriceBar[], window = 20) {
  return bars.map((bar, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = bars.slice(start, index + 1);
    return { date: bar.date, value: slice.reduce((sum, row) => sum + row.close, 0) / slice.length };
  });
}

export function formatTerminalMoney(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatTerminalCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (absolute >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatTerminalPct(value: number | null | undefined, digits = 1, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function terminalChangePct(quote: { available: boolean; changePct?: number | null } | undefined, screenerChangePct: number | null | undefined): number | null {
  return quote?.available ? quote.changePct ?? null : screenerChangePct ?? null;
}
