import { describe, expect, it } from "vitest";
import { lastMarketDay, operationsHealth, pacific } from "./operations-health";
import type { OperationRun, OperationsState } from "./operations-scheduler";

const run = (jobId: string, endedAt: string, extra: Partial<OperationRun> = {}): OperationRun => ({
  runId: `${jobId}-1`, jobId, status: "done", trigger: "cron", startedAt: endedAt, endedAt, exitCode: 0, logFile: "", error: null, ...extra,
});
const state = (heartbeatAt: string, runs: OperationRun[]): OperationsState => ({
  schemaVersion: 1, schedulerStartedAt: null, heartbeatAt, current: null, queue: [], nextRuns: {}, configuredCrons: {}, commandOffset: 0,
  lastRuns: Object.fromEntries(runs.map((r) => [r.jobId, r])),
});
// Thursday 2026-11-12, 19:25 Pacific (the evening the owner found the desk at the Nov 11 close)
const thursdayEvening = new Date("2026-11-13T03:25:00Z");
const deskAfterClose = run("desk-snapshot", "2026-11-13T00:40:00Z"); // Thursday 16:40 Pacific

describe("the market day the evening run should have covered", () => {
  it("is today after 17:15 Pacific on a weekday, else the previous weekday", () => {
    expect(pacific(thursdayEvening)).toMatchObject({ stamp: "2026-11-12 19:25", weekday: "Thu" });
    expect(lastMarketDay(thursdayEvening)).toBe("2026-11-12");
    expect(lastMarketDay(new Date("2026-11-12T20:00:00Z"))).toBe("2026-11-11"); // Thursday 12:00 Pacific
    expect(lastMarketDay(new Date("2026-11-14T20:00:00Z"))).toBe("2026-11-13"); // Saturday -> Friday
    expect(lastMarketDay(new Date("2026-11-16T15:00:00Z"))).toBe("2026-11-13"); // Monday 07:00 -> Friday
  });
});

describe("operations health", () => {
  it("is quiet when the scheduler beats, nothing failed and the desk was rebuilt after the close", () => {
    expect(operationsHealth(state("2026-11-13T03:24:30Z", [deskAfterClose]), thursdayEvening).alerts).toEqual([]);
  });

  it("reports the stale desk of 2026-11-12: rebuilt only in the morning, from the previous close", () => {
    const morningDesk = run("desk-snapshot", "2026-11-12T13:00:04Z"); // Thursday 05:00 Pacific
    const health = operationsHealth(state("2026-11-13T03:24:30Z", [morningDesk]), thursdayEvening);
    expect(health.alerts).toEqual([expect.objectContaining({ level: "error", code: "market-run-missing" })]);
    expect(health.alerts[0].text).toContain("The market run of 2026-11-12 has not completed");
    expect(health.alerts[0].text).toContain("2026-11-12 05:00 Pacific");
  });

  it("reports a stopped scheduler", () => {
    const health = operationsHealth(state("2026-11-13T03:10:00Z", [deskAfterClose]), thursdayEvening);
    expect(health.alerts.map((a) => a.code)).toEqual(["scheduler-down"]);
    expect(health.alerts[0].text).toContain("2026-11-12 19:10 Pacific");
  });

  it("separates a job's own failure (error) from a failed production upload (warning)", () => {
    const pushOnly = run("schwab-fetch-daily", "2026-11-13T00:50:00Z", { status: "error", localStatus: "done", push: { status: "failed", at: "2026-11-13T00:50:00Z", error: "Operational push failed: HTTP 200 answered with text/html instead of JSON" }, error: "Operational push failed: HTTP 200 answered with text/html instead of JSON" });
    const ownFailure = run("schwab-daily-bars", "2026-11-13T00:35:00Z", { status: "error", localStatus: "error", exitCode: 1, error: "Process exited with code 1" });
    const health = operationsHealth(state("2026-11-13T03:24:30Z", [deskAfterClose, pushOnly, ownFailure]), thursdayEvening);
    expect(health.alerts.map((a) => [a.level, a.code, a.jobs])).toEqual([
      ["error", "job-failed", ["schwab-daily-bars"]],
      ["warning", "push-failed", ["schwab-fetch-daily"]],
    ]);
  });

  it("reads runs recorded before the local status existed: a push-failed run counts as an upload problem only", () => {
    const legacy = run("schwab-fetch-daily", "2026-11-12T12:03:37Z", { status: "error", error: "Operational push failed: Unexpected token '<'" });
    const health = operationsHealth(state("2026-11-13T03:24:30Z", [deskAfterClose, legacy]), thursdayEvening);
    expect(health.alerts.map((a) => a.code)).toEqual(["push-failed"]);
  });

  it("ignores failures of runs the owner started by hand, and failures older than a day", () => {
    const manual = run("schwab-daily-bars", "2026-11-13T00:35:00Z", { status: "error", localStatus: "error", trigger: "manual" });
    const old = run("13f-refresh", "2026-11-11T00:00:00Z", { status: "error", localStatus: "error" });
    expect(operationsHealth(state("2026-11-13T03:24:30Z", [deskAfterClose, manual, old]), thursdayEvening).alerts).toEqual([]);
  });
});
