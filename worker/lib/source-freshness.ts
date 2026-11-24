/**
 * How current each data source is, judged by the newest date in the data itself, not by whether its job ran. A job
 * can report "done" every night while a layer built on top of it stands still (2026-11-24: the filings list ended 12
 * days before the collector's newest filing). Each source names the newest day it holds and how old that may be
 * before it counts as late; the allowance covers weekends, a holiday and the source's own publication delay.
 */

export type SourceState = "current" | "late" | "failed" | "unknown";

export interface SourceInput {
  id: string;
  label: string;
  /** The newest day the data holds (a filing date, a session, a settlement date ...); null when it cannot be read. */
  newest: string | null;
  /** What that day is, in a few words ("newest filing", "last session"). */
  what: string;
  /** How the data arrives ("nightly 02:00", "twice a month, about seven business days after settlement"). */
  arrives: string;
  /** Calendar days the newest day may lie back before the source is late. */
  maxAgeDays: number;
  /** The last run of the job that refreshes it, when there is one. */
  run?: { status: string | null; endedAt: string | null; error?: string | null } | null;
  detail?: string | null;
}

export interface SourceRow extends SourceInput {
  ageDays: number | null;
  state: SourceState;
}

const DAY = 86_400_000;

export function sourceFreshness(inputs: SourceInput[], today: string): SourceRow[] {
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return inputs.map((input) => {
    const newest = input.newest && /^\d{4}-\d{2}-\d{2}/.test(input.newest) ? input.newest.slice(0, 10) : null;
    const ageDays = newest ? Math.max(0, Math.round((now - Date.parse(`${newest}T00:00:00Z`)) / DAY)) : null;
    const failed = Boolean(input.run && input.run.status && !/^(done|complete|unchanged|ok|built_not_published)$/i.test(input.run.status) && input.run.status !== "running");
    const state: SourceState = failed ? "failed" : ageDays === null ? "unknown" : ageDays > input.maxAgeDays ? "late" : "current";
    return { ...input, newest, ageDays, state };
  });
}

/** Worst first: failed, late, unknown, then current; within a state the oldest data first. */
export function sortSources(rows: SourceRow[]): SourceRow[] {
  const order: Record<SourceState, number> = { failed: 0, late: 1, unknown: 2, current: 3 };
  return [...rows].sort((a, b) => order[a.state] - order[b.state] || (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.label.localeCompare(b.label));
}
