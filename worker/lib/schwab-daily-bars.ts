import type { PriceBar } from "../../api/services/prices";

export interface SchwabBarPlan {
  insert: PriceBar[];
  enrich: { date: string; patch: Partial<Pick<PriceBar, "open" | "high" | "low" | "volume">> }[];
  unchanged: number;
  closeConflicts: { date: string; stored: number | null; candidate: number | null }[];
  fieldDifferences: { date: string; field: "open" | "high" | "low" | "volume"; stored: number; candidate: number }[];
}

const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));

/**
 * What to write for one series: new dates are inserted; a stored bar keeps its values. A missing open/high/low/volume
 * is filled when the close agrees; a different close is a conflict and a different non-missing field is listed,
 * both left as stored (the same rule as officialBarEnrichment).
 */
export function planSchwabBars(stored: PriceBar[], candidates: PriceBar[]): SchwabBarPlan {
  const byDate = new Map(stored.map((bar) => [bar.date, bar]));
  const plan: SchwabBarPlan = { insert: [], enrich: [], unchanged: 0, closeConflicts: [], fieldDifferences: [] };
  for (const candidate of candidates) {
    const before = byDate.get(candidate.date);
    if (!before) { plan.insert.push(candidate); continue; }
    if (!same(before.close, candidate.close)) { plan.closeConflicts.push({ date: candidate.date, stored: before.close, candidate: candidate.close }); continue; }
    const patch: SchwabBarPlan["enrich"][number]["patch"] = {};
    for (const field of ["open", "high", "low", "volume"] as const) {
      const was = before[field], now = candidate[field];
      if (was === null && now !== null) patch[field] = now;
      else if (was !== null && now !== null && !same(was, now)) plan.fieldDifferences.push({ date: candidate.date, field, stored: was, candidate: now });
    }
    if (Object.keys(patch).length) plan.enrich.push({ date: candidate.date, patch });
    else plan.unchanged++;
  }
  return plan;
}

export interface BasisChange {
  /** new candle ÷ stored close on every re-based date: the factor the stored history before firstNewBasisDate needs */
  ratio: number;
  /** the first session on the new basis: the first date whose stored close agrees, else the first new date */
  firstNewBasisDate: string;
  /** stored dates whose close moved by the ratio */
  dates: number;
}

/**
 * Schwab re-bases a series' whole history after a split (and after some spin-offs and special dividends): every stored
 * close before one date differs from the new candle by one factor, and from that date on they agree. Three such dates
 * at least, so that a one-day correction stays a conflict; mixed factors or a moved date after an agreeing one are no
 * basis change either (they stay conflicts, as before).
 */
export function basisChange(stored: PriceBar[], candidates: PriceBar[]): BasisChange | null {
  const byDate = new Map(stored.map((bar) => [bar.date, bar]));
  const pairs = candidates
    .filter((bar) => bar.close && byDate.get(bar.date)?.close)
    .map((bar) => ({ date: bar.date, ratio: bar.close! / byDate.get(bar.date)!.close!, same: same(bar.close, byDate.get(bar.date)!.close) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const moved = pairs.filter((pair) => !pair.same);
  if (moved.length < 3) return null;
  const ratio = [...moved.map((pair) => pair.ratio)].sort((a, b) => a - b)[Math.floor(moved.length / 2)];
  if (Math.abs(Math.log(ratio)) < Math.log(1.01) || moved.some((pair) => Math.abs(Math.log(pair.ratio / ratio)) > 0.002)) return null;
  const lastMoved = moved.at(-1)!.date;
  if (pairs.some((pair) => pair.same && pair.date < lastMoved)) return null;
  // the first session on the new basis: an agreeing stored date, else the first new date, else (an adjustment Schwab
  // applied with no new session yet) the day after the last re-based date
  const dayAfter = new Date(Date.parse(`${lastMoved}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const firstNewBasisDate = pairs.find((pair) => pair.same && pair.date > lastMoved)?.date
    ?? candidates.map((bar) => bar.date).filter((date) => date > lastMoved && !byDate.has(date)).sort()[0]
    ?? dayAfter;
  return { ratio, firstNewBasisDate, dates: moved.length };
}

/**
 * Where a Schwab bar is stored. The app merges sources with Schwab winning on its dates, so a raw Schwab bar on a date
 * the dividend-adjusted Stooq history already covers would put a false step into that history. Such bars go to
 * "schwab-hist" (kept for reconciliation and for linking the two sources); only dates after the series' last
 * Stooq bar go to "schwab".
 */
export function splitAtStooqEnd<T extends { date: string }>(bars: T[], lastStooqDate: string | null): { history: T[]; current: T[] } {
  if (!lastStooqDate) return { history: [], current: bars };
  return { history: bars.filter((bar) => bar.date <= lastStooqDate), current: bars.filter((bar) => bar.date > lastStooqDate) };
}

/** Sessions of the calendar (dates of a benchmark series) between a series' first and last date that the series lacks. */
export function missingSessions(dates: string[], calendar: string[], from: string): string[] {
  const own = new Set(dates);
  const first = [...dates].sort()[0];
  const last = [...dates].sort().at(-1);
  if (!first || !last) return [];
  const start = first > from ? first : from;
  return [...new Set(calendar)].sort().filter((date) => date >= start && date <= last && !own.has(date));
}
