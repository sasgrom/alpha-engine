/**
 * What the owner must see about the home operations (the desk's banner): the scheduler not running, scheduled jobs whose
 * own work failed, the weekday evening market run that did not complete, and, only while production pushes are enabled
 * (they are off since 2026-11-13), operational pushes that failed. Pure: it reads the scheduler state it is given.
 */
import { OPERATION_JOB_MAP } from "../../contracts/operations";
import { operationalPushEnabled } from "./operational-push-policy";
import type { OperationRun, OperationsState } from "./operations-scheduler";

export type OperationsAlertCode = "scheduler-down" | "job-failed" | "market-run-missing" | "push-failed";
export interface OperationsAlert { level: "error" | "warning"; code: OperationsAlertCode; text: string; jobs?: string[] }
export interface OperationsHealth { checkedAt: string; heartbeatAt: string | null; alerts: OperationsAlert[] }

/** The scheduler saves its heartbeat every 15 seconds. */
const SCHEDULER_SILENT_MS = 3 * 60_000;
const RECENT_MS = 26 * 3600_000;
/** The weekday market chain starts at 16:10 Pacific (contracts/operations.ts) and the desk is rebuilt by about 16:45. */
const MARKET_RUN_START = "16:10";
const MARKET_READY = "17:15";

/** A moment as a Pacific wall-clock stamp ("2026-11-12 17:15") with its weekday. */
export function pacific(date: Date): { stamp: string; day: string; time: string; weekday: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`, time = `${parts.hour}:${parts.minute}`;
  return { stamp: `${day} ${time}`, day, time, weekday: parts.weekday };
}

/** The most recent weekday whose market run should be finished by now (17:15 Pacific on that day). */
export function lastMarketDay(now: Date): string | null {
  for (let back = 0; back <= 7; back++) {
    const moment = pacific(new Date(now.getTime() - back * 86_400_000));
    if (moment.weekday === "Sat" || moment.weekday === "Sun") continue;
    if (back === 0 && pacific(now).time < MARKET_READY) continue;
    return moment.day;
  }
  return null;
}

/** The job's own work failed (a run that only failed its production push is not counted here). */
function failedLocally(run: OperationRun): boolean {
  if (run.localStatus) return run.localStatus === "error" || run.localStatus === "killed";
  return (run.status === "error" || run.status === "killed") && !(run.error ?? "").startsWith("Operational push failed");
}
function failedPush(run: OperationRun): boolean {
  return run.push?.status === "failed" || (!run.push && (run.error ?? "").startsWith("Operational push failed"));
}
const nameOf = (jobId: string) => OPERATION_JOB_MAP[jobId]?.name ?? jobId;

export function operationsHealth(state: OperationsState, now = new Date(), pushes = operationalPushEnabled()): OperationsHealth {
  const alerts: OperationsAlert[] = [];
  const heartbeat = Date.parse(state.heartbeatAt ?? "");
  if (!Number.isFinite(heartbeat) || now.getTime() - heartbeat > SCHEDULER_SILENT_MS) {
    alerts.push({ level: "error", code: "scheduler-down", text: `The scheduler is not running (last heartbeat ${Number.isFinite(heartbeat) ? `${pacific(new Date(heartbeat)).stamp} Pacific` : "never"}): nothing is collected until it runs again.` });
  }
  const recent = Object.values(state.lastRuns).filter((run) => run.trigger !== "manual" && run.endedAt && now.getTime() - Date.parse(run.endedAt) <= RECENT_MS);
  const failed = recent.filter(failedLocally).map((run) => run.jobId).sort();
  if (failed.length) {
    alerts.push({ level: "error", code: "job-failed", jobs: failed, text: `${failed.length === 1 ? "A scheduled job" : `${failed.length} scheduled jobs`} failed in the last day: ${failed.map(nameOf).join(", ")}.` });
  }
  const marketDay = lastMarketDay(now);
  const desk = state.lastRuns["desk-snapshot"];
  const deskDone = desk && (desk.status === "done" || desk.localStatus === "done") && desk.endedAt ? pacific(new Date(desk.endedAt)).stamp : null;
  if (marketDay && (!deskDone || deskDone < `${marketDay} ${MARKET_RUN_START}`)) {
    alerts.push({ level: "error", code: "market-run-missing", jobs: ["schwab-fetch-sp500", "schwab-fetch-daily", "schwab-daily-bars", "desk-snapshot"], text: `The market run of ${marketDay} has not completed: prices and the desk were last rebuilt ${deskDone ? `${deskDone} Pacific` : "never"}.` });
  }
  // with pushes off, a failure recorded before the decision is history, not a problem to show
  const pushFailed = pushes ? [...new Set(recent.filter(failedPush).map((run) => run.jobId))].sort() : [];
  if (pushFailed.length) {
    alerts.push({ level: "warning", code: "push-failed", jobs: pushFailed, text: `Production upload failed for ${pushFailed.map(nameOf).join(", ")}; local data is up to date.` });
  }
  return { checkedAt: now.toISOString(), heartbeatAt: state.heartbeatAt, alerts };
}
