import { readdirSync } from "node:fs";
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

/** Relative paths (forward slashes) of every Stooq daily text file under an extracted dump folder. */
export function listStooqTextFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((entry) => entry.toLowerCase().endsWith(".us.txt"))
    .sort();
}

/**
 * How a newer Stooq archive relates to the bars already stored for one series.
 * Stooq adjusts its whole history for every later split and dividend, so a newer archive legitimately
 * rescales all earlier bars of a company by one factor. Anything else is a revision and is held for review.
 */
export type ArchiveComparisonKind = "new" | "identical" | "readjusted" | "corrected" | "revised";

export interface ArchiveComparison {
  kind: ArchiveComparisonKind;
  /** readjusted only: one factor (a split or dividend after the stored archive's date) or dividend steps (dividends the stored archive had not applied) */
  pattern: "one factor" | "dividend steps" | null;
  overlap: number;
  newDates: number;
  storedOnlyDates: string[];
  differing: number;
  factor: number | null;
  /** archive close / stored close at the earliest common date, and the largest one-day rise of that ratio */
  earliestRatio: number | null;
  largestStep: number;
  closeViolations: number;
  /** revised only: whether the new dates were appended because the latest common closes agree */
  newDatesAppended?: boolean;
  firstDiffering: string | null;
  lastDiffering: string | null;
  rows: PriceBar[];
}

/** The largest one-day change of the archive/stored close ratio that a dividend can explain; a larger step looks like a split mismatch. */
export const MAX_DIVIDEND_STEP = 0.15;

const sameValue = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
const sameBar = (a: PriceBar, b: PriceBar) => (["open", "high", "low", "close", "adjClose", "volume"] as const).every((field) => sameValue(a[field], b[field]));

/** Prices in the archive carry at most four decimals, so a ratio of two cheap prices is only known to about 1e-4 / price. */
const closeTolerance = (stored: number, archive: number) => 2e-4 + 2e-4 / Math.min(stored, archive);

export function compareArchiveBars(stored: PriceBar[], archive: PriceBar[]): ArchiveComparison {
  const storedByDate = new Map(stored.map((bar) => [bar.date, bar]));
  const archiveDates = new Set(archive.map((bar) => bar.date));
  const storedOnlyDates = stored.filter((bar) => !archiveDates.has(bar.date)).map((bar) => bar.date).sort();
  const fresh: PriceBar[] = [], differingBars: PriceBar[] = [], pairs: { date: string; before: number; after: number }[] = [];
  let overlap = 0;
  for (const bar of archive) {
    const before = storedByDate.get(bar.date);
    if (!before) { fresh.push(bar); continue; }
    overlap++;
    if (!sameBar(before, bar)) differingBars.push(bar);
    if (before.close !== null && bar.close !== null && before.close > 0 && bar.close > 0) pairs.push({ date: bar.date, before: before.close, after: bar.close });
  }
  pairs.sort((a, b) => a.date.localeCompare(b.date));
  const sortedDiffering = differingBars.map((bar) => bar.date).sort();
  const base = { overlap, newDates: fresh.length, storedOnlyDates, differing: differingBars.length, firstDiffering: sortedDiffering[0] ?? null, lastDiffering: sortedDiffering.at(-1) ?? null, earliestRatio: pairs.length ? pairs[0].after / pairs[0].before : null };
  if (!overlap) return { ...base, kind: "new", pattern: null, factor: null, largestStep: 0, closeViolations: 0, rows: [...archive] };
  if (!differingBars.length) return { ...base, kind: "identical", pattern: null, factor: 1, largestStep: 0, closeViolations: 0, rows: fresh };
  const factor = pairs.map((pair) => pair.after / pair.before).sort((a, b) => a - b)[Math.floor(pairs.length / 2)] ?? 1;
  const closeViolations = pairs.filter((pair) => Math.abs(pair.after / (factor * pair.before) - 1) > closeTolerance(pair.before, pair.after)).length;
  const allowed = Math.max(3, Math.floor(overlap * 0.001));
  const rows = [...fresh, ...differingBars];
  if (closeViolations <= allowed) {
    const kind: ArchiveComparisonKind = Math.abs(factor - 1) > 1e-6 ? "readjusted" : "corrected";
    return { ...base, kind, pattern: kind === "readjusted" ? "one factor" : null, factor, largestStep: 0, closeViolations, rows };
  }
  // Dividend steps: the archive price is never above the stored one, and the ratio only rises towards the present,
  // in steps no larger than a dividend. Anything else (a ratio above one, a falling ratio, a split-sized step) is held.
  let dividendPattern = true, largestStep = 0;
  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index], ratio = pair.after / pair.before, tolerance = closeTolerance(pair.before, pair.after);
    if (ratio > 1 + tolerance) { dividendPattern = false; break; }
    if (!index) continue;
    const previous = pairs[index - 1], previousRatio = previous.after / previous.before, slack = tolerance + closeTolerance(previous.before, previous.after);
    if (ratio < previousRatio - slack) { dividendPattern = false; break; }
    largestStep = Math.max(largestStep, ratio / previousRatio - 1);
  }
  if (largestStep > MAX_DIVIDEND_STEP) dividendPattern = false;
  if (dividendPattern) return { ...base, kind: "readjusted", pattern: "dividend steps", factor, largestStep, closeViolations, rows };
  // Held: the stored history stays. New dates are still added when the latest common closes agree, so no seam appears.
  const recent = pairs.slice(-RECENT_AGREEMENT);
  const recentAgree = recent.length === RECENT_AGREEMENT && recent.every((pair) => Math.abs(pair.after / pair.before - 1) <= closeTolerance(pair.before, pair.after));
  return { ...base, kind: "revised", pattern: null, factor, largestStep, closeViolations, newDatesAppended: recentAgree, rows: recentAgree ? fresh : [] };
}

/** Common closes at the end of a held series that must agree before its new dates are appended. */
export const RECENT_AGREEMENT = 20;

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
