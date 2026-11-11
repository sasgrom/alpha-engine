import type { PriceBar } from "../../api/services/prices";

export const ETF_CIK_BY_TICKER: Readonly<Record<string, number>> = Object.freeze({
  XLB: -1001,
  XLC: -1002,
  XLE: -1003,
  XLF: -1004,
  XLI: -1005,
  XLK: -1006,
  XLP: -1007,
  XLRE: -1008,
  XLU: -1009,
  XLV: -1010,
  XLY: -1011,
});

export const SECTOR_ETF_TICKERS = Object.freeze(Object.keys(ETF_CIK_BY_TICKER));

/** Local price-series keys: (cik,date,source) cannot hold two listings under one SEC CIK. */
export const STOOQ_SECOND_LISTING_CIK_BY_TICKER: Readonly<Record<string, number>> = Object.freeze({
  GOOG: -2001,
  FOX: -2002,
  NWS: -2003,
});

export function stooqPriceCik(cik: number, ticker: string): number {
  return STOOQ_SECOND_LISTING_CIK_BY_TICKER[ticker] ?? cik;
}

export interface SessionGap {
  ticker: string;
  from: string;
  to: string;
  missingSessions: number;
}

export function findSessionGaps(ticker: string, bars: PriceBar[], spyDates: string[]): SessionGap[] {
  const calendar = [...new Set(spyDates)].sort();
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const gaps: SessionGap[] = [];
  let calendarIndex = 0;
  let previousCalendarIndex = 0;
  let previousDate: string | null = null;
  for (const bar of sorted) {
    while (calendarIndex < calendar.length && calendar[calendarIndex] <= bar.date) calendarIndex++;
    if (previousDate !== null) {
      const missingSessions = Math.max(0, calendarIndex - previousCalendarIndex - Number(calendar[calendarIndex - 1] === bar.date));
      if (missingSessions > 5) gaps.push({ ticker, from: previousDate, to: bar.date, missingSessions });
    }
    previousCalendarIndex = calendarIndex;
    previousDate = bar.date;
  }
  return gaps;
}

export function findDailyMoveOutliers(ticker: string, bars: PriceBar[], threshold = 0.5) {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const outliers: { ticker: string; from: string; to: string; move: number }[] = [];
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1].close, current = sorted[index].close;
    if (previous === null || current === null || previous === 0) continue;
    const move = current / previous - 1;
    if (Math.abs(move) > threshold) outliers.push({ ticker, from: sorted[index - 1].date, to: sorted[index].date, move });
  }
  return outliers;
}

export function findBarQualityIssues(ticker: string, bars: PriceBar[]) {
  const nonPositive: { date: string; field: string; value: number }[] = [];
  const highLow: { date: string; high: number; low: number }[] = [];
  const seen = new Set<string>();
  const duplicateDates: string[] = [];
  for (const bar of bars) {
    if (seen.has(bar.date)) duplicateDates.push(bar.date);
    seen.add(bar.date);
    for (const field of ["open", "high", "low", "close"] as const) {
      const value = bar[field];
      if (value !== null && value <= 0) nonPositive.push({ date: bar.date, field, value });
    }
    if (bar.high !== null && bar.low !== null && bar.high < bar.low) highLow.push({ date: bar.date, high: bar.high, low: bar.low });
  }
  return { ticker, nonPositive, highLow, duplicateDates: [...new Set(duplicateDates)].sort() };
}
