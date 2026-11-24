/**
 * Shapes and small rules of the operations console: the job registry (contracts/operations.ts) joined with the
 * scheduler's own state and switches, as the local worker procedures return them. Nothing here talks to the server.
 */
import { Cron } from "croner";
import { OPERATION_JOBS, type OperationJob } from "@contracts/operations";

export interface ConsoleRun {
  runId: string;
  jobId: string;
  status: "running" | "done" | "error" | "killed";
  trigger: "cron" | "dependency" | "manual";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  error: string | null;
  localStatus?: "running" | "done" | "error" | "killed";
}

export interface ConsoleState {
  schedulerStartedAt: string | null;
  heartbeatAt: string | null;
  current: ConsoleRun | null;
  queue: { jobId: string; trigger: ConsoleRun["trigger"] }[];
  nextRuns: Record<string, string | null>;
  lastRuns: Record<string, ConsoleRun>;
}

export type ConsoleConfig = Record<string, { enabled: boolean; cron: string | null }>;

export interface ConsoleJob {
  job: OperationJob;
  enabled: boolean;
  cron: string | null;
  last: ConsoleRun | null;
  next: string | null;
  running: boolean;
  queued: boolean;
  /** The switch and the schedule can be changed (scheduled and paused jobs); others are run by hand or not at all. */
  editable: boolean;
  /** The scheduler can start it: it has a command and is neither frozen nor blocked, and so is every job before it. */
  runnable: boolean;
}

export const GROUP_LABEL: Record<OperationJob["group"], string> = {
  live: "Live market data",
  sec: "SEC filings",
  fundamentals: "Fundamentals",
  options: "Options",
  expectations: "Expectations",
  research: "Research",
  delivery: "Delivery",
  maintenance: "Maintenance",
};

const BY_ID = new Map(OPERATION_JOBS.map((job) => [job.id, job]));

/** The jobs a run of this one starts first: everything it depends on, parents before children, itself last. */
export function chainOf(jobId: string): OperationJob[] {
  const out: OperationJob[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    const job = BY_ID.get(id);
    if (!job || seen.has(id)) return;
    seen.add(id);
    for (const parent of job.dependsOn) visit(parent);
    out.push(job);
  };
  visit(jobId);
  return out;
}

/** The jobs that follow this one when it ends well: its direct dependents, then theirs. */
export function followersOf(jobId: string): OperationJob[] {
  const out: OperationJob[] = [];
  const seen = new Set<string>([jobId]);
  const visit = (id: string) => {
    for (const job of OPERATION_JOBS) {
      if (!job.dependsOn.includes(id) || seen.has(job.id)) continue;
      seen.add(job.id);
      out.push(job);
      visit(job.id);
    }
  };
  visit(jobId);
  return out;
}

export function consoleJobs(config: ConsoleConfig | undefined, state: ConsoleState | undefined): ConsoleJob[] {
  return OPERATION_JOBS.map((job) => {
    const row = config?.[job.id];
    return {
      job,
      enabled: row?.enabled ?? job.defaultEnabled,
      cron: row?.cron ?? job.cron,
      last: state?.lastRuns[job.id] ?? null,
      next: state?.nextRuns[job.id] ?? null,
      running: state?.current?.jobId === job.id,
      queued: !!state?.queue.some((entry) => entry.jobId === job.id),
      editable: job.mode === "scheduled" || job.mode === "paused",
      runnable: chainOf(job.id).every((item) => !!item.executable && item.mode !== "frozen" && item.mode !== "blocked"),
    };
  });
}

/** A schedule is one cron expression or several separated by ";". The next `count` runs after `after`, or the error. */
export function cronPreview(expression: string, after: Date, count = 3): { runs: Date[]; error: string | null } {
  const parts = expression.split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { runs: [], error: "Enter a schedule, for example 30 6 * * 1-5" };
  try {
    const crons = parts.map((part) => new Cron(part));
    const runs: Date[] = [];
    let from = after;
    while (runs.length < count) {
      const next = crons.map((cron) => cron.nextRun(from)).filter((date): date is Date => date !== null).sort((a, b) => a.getTime() - b.getTime())[0];
      if (!next) break;
      runs.push(next);
      from = next;
    }
    return { runs, error: runs.length ? null : "This schedule never runs" };
  } catch (error) {
    return { runs: [], error: error instanceof Error ? error.message : "Not a valid schedule" };
  }
}

/** How a job comes to run, in words. */
export function scheduleText(row: ConsoleJob): string {
  const { job } = row;
  if (job.mode === "frozen") return "Frozen";
  if (job.mode === "blocked") return "Needs a review at the terminal";
  if (job.mode === "manual") return "By hand";
  if (row.cron) return row.cron;
  if (job.dependsOn.length) return `After ${job.dependsOn.map((id) => BY_ID.get(id)?.name ?? id).join(" and ")}`;
  return "No schedule";
}

export function took(start: string | null | undefined, end: string | null | undefined, now: number = Date.now()): string {
  if (!start) return "—";
  const seconds = Math.max(0, ((end ? Date.parse(end) : now) - Date.parse(start)) / 1000);
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/** Jobs that need a look first: failed, then running or queued, then the rest by name. */
export function attentionOrder(a: ConsoleJob, b: ConsoleJob): number {
  const rank = (row: ConsoleJob) => (row.last?.status === "error" || row.last?.status === "killed" ? 0 : row.running ? 1 : row.queued ? 2 : 3);
  return rank(a) - rank(b) || a.job.name.localeCompare(b.job.name);
}
