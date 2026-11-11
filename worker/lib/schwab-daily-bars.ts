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

/** Sessions of the calendar (dates of a benchmark series) between a series' first and last date that the series lacks. */
export function missingSessions(dates: string[], calendar: string[], from: string): string[] {
  const own = new Set(dates);
  const first = [...dates].sort()[0];
  const last = [...dates].sort().at(-1);
  if (!first || !last) return [];
  const start = first > from ? first : from;
  return [...new Set(calendar)].sort().filter((date) => date >= start && date <= last && !own.has(date));
}
