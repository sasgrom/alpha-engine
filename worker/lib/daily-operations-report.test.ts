import { describe, expect, it } from "vitest";
import { OPERATION_JOBS } from "../../contracts/operations";
import { MACRO_SERIES } from "./macro-sources";
import { buildDailyOperationsReport, dailyOperationsMarkdown, type DailyOperationsInput } from "./daily-operations-report";
import { defaultOperationConfig, type OperationRun, type OperationsState } from "./operations-scheduler";
import type { SchwabMarketSnapshot } from "./schwab-normalize";
import type { SchwabFeatureReport } from "./schwab-features";
import type { SchwabContextReport } from "./schwab-context";

const NOW = "2026-11-03T07:20:00.000Z";
const run = (jobId: string): OperationRun => ({
  runId: `run-${jobId}`, jobId, status: "done", trigger: "cron",
  startedAt: "2026-11-03T07:10:00.000Z", endedAt: "2026-11-03T07:15:00.000Z",
  exitCode: 0, logFile: "", error: null,
});
const state = (): OperationsState => ({
  schemaVersion: 1,
  schedulerStartedAt: "2026-11-03T00:00:00.000Z",
  heartbeatAt: "2026-11-03T07:19:55.000Z",
  current: null,
  queue: [],
  nextRuns: Object.fromEntries(OPERATION_JOBS.filter((job) => job.cron).map((job) => [job.id, "2026-11-04T04:00:00.000Z"])),
  configuredCrons: {},
  commandOffset: 0,
  lastRuns: Object.fromEntries(OPERATION_JOBS.filter((job) => job.defaultEnabled && job.mode === "scheduled").map((job) => [job.id, run(job.id)])),
});
const snapshot = (): SchwabMarketSnapshot => ({
  schemaVersion: 1,
  generatedAt: "2026-11-03T07:16:00.000Z",
  provider: "schwab",
  files: ["AAPL", "MSFT"].map((ticker) => ({ ticker, file: `chains/${ticker}.json`, sourceHash: "abc", status: "complete", capturedAt: "2026-11-03T07:14:00.000Z" })),
  coverage: { tickersExpected: 2, tickersCompleted: 2, endpointsComplete: 8, errors: 0, contracts: 100, expirations: 4, latestCapture: "2026-11-03T07:14:00.000Z", tokenExpiresAt: null, lastRefreshAt: null },
  options: [],
  qa: { duplicateOsi: 0, zeroBid: 0, zeroAsk: 0, crossed: 0, invalidGreeks: 0, invalidIv: 0, manifestErrors: 0 },
});
const features = (): SchwabFeatureReport => ({
  schemaVersion: 1, generatedAt: "2026-11-03T07:17:00.000Z", provider: "schwab", sourceSnapshotSha256: "snapshot-hash",
  coverage: { tickers: 2, contracts: 100, rv20Available: 2 }, tickers: [],
});
const context = (): SchwabContextReport => ({
  schemaVersion: 1, generatedAt: "2026-11-03T07:18:00.000Z", provider: "schwab",
  coverage: { expected: 58, complete: 58, errors: 0 }, hours: {}, movers: [], instruments: [], intraday: [], files: [],
});
const input = (): DailyOperationsInput => ({
  now: NOW,
  state: state(),
  config: defaultOperationConfig(),
  configurationSource: "file",
  snapshot: snapshot(),
  snapshotSha256: "snapshot-hash",
  features: features(),
  context: context(),
  macro: {
    fred: { generatedAt: "2026-11-03T05:30:00.000Z", entries: MACRO_SERIES.map((series) => ({ seriesId: series.seriesId, status: "complete" })) },
    events: { generatedAt: "2026-11-03T05:40:00.000Z", events: 47 },
    qa: { generatedAt: "2026-11-03T05:55:00.000Z", status: "pass", errors: 0, warnings: 0 },
    scenarios: { generatedAt: "2026-11-03T06:10:00.000Z" },
    calibration: { generatedAt: "2026-11-03T06:11:00.000Z", calibrations: [{ status: "ready" }] },
    eventStudy: { generatedAt: "2026-11-03T06:12:00.000Z", status: "ready", events: { eligible: 47, withAnyObservation: 40 } },
    atlas: { generatedAt: "2026-11-03T06:13:00.000Z", status: "estimated", coverage: { records: 3840 } },
  },
});

describe("daily operations report", () => {
  it("proves scheduler, same-day Schwab coverage and feature lineage", () => {
    const report = buildDailyOperationsReport(input());
    expect(report.status).toBe("ok");
    expect(report.scheduler.status).toBe("online");
    expect(report.schwab.tickersCapturedToday).toBe(2);
    expect(report.schwab.featuresSourceCurrent).toBe(true);
    expect(report.summary.checksError).toBe(0);
    expect(dailyOperationsMarkdown(report)).toContain("Status: OK");
  });

  it("does not let one current ticker mask another ticker's stale chain", () => {
    const value = input();
    value.snapshot!.files[1].capturedAt = "2026-11-02T21:00:00.000Z";
    const report = buildDailyOperationsReport(value);
    const check = report.checks.find((item) => item.id === "schwab-daily-evidence");
    expect(check?.status).toBe("warning");
    expect(check?.detail).toContain("1/2 tickers captured today");
    expect(check?.action).toContain("schwab-fetch.mts");
    expect(report.status).toBe("degraded");
  });

  it("fails closed when the scheduler and current Schwab evidence are unavailable", () => {
    const value = input();
    value.state.heartbeatAt = "2026-11-03T04:00:00.000Z";
    value.snapshot = null;
    value.features = null;
    value.context = null;
    const report = buildDailyOperationsReport(value);
    expect(report.status).toBe("critical");
    expect(report.scheduler.status).toBe("offline");
    expect(report.checks.find((item) => item.id === "schwab-daily-evidence")?.status).toBe("error");
    expect(report.actions.some((action) => action.includes("schwab-fetch.mts"))).toBe(true);
  });

  it("rejects fresh-looking features derived from a different snapshot", () => {
    const value = input();
    value.features!.sourceSnapshotSha256 = "older-hash";
    const report = buildDailyOperationsReport(value);
    expect(report.schwab.featuresSourceCurrent).toBe(false);
    expect(report.checks.find((item) => item.id === "schwab-feature-lineage")?.status).toBe("error");
  });

  it("reports manifest-backed S&P companyfacts coverage independently of research-50", () => {
    const value = input();
    value.facts = { sp500: { universeHash: "universe-hash", uniqueCiks: 499, refreshed: 480, unchanged: 10, failed: 2, missing: 7, lastCheckedAt: NOW } };
    const report = buildDailyOperationsReport(value);
    const check = report.checks.find((item) => item.id === "sp500-facts-coverage");
    expect(report.facts?.sp500?.uniqueCiks).toBe(499);
    expect(check?.status).toBe("warning");
    expect(check?.detail).toContain("480 refreshed");
    expect(check?.detail).toContain("7 missing");
    expect(check?.jobId).toBe("sp500-facts-daily");
  });
});

describe("schedule-aware Schwab evidence", () => {
  const scheduledInput = (now: string): DailyOperationsInput => {
    const value = input();
    value.now = now;
    value.state.heartbeatAt = new Date(Date.parse(now) - 5000).toISOString();
    value.state.nextRuns["schwab-fetch-daily"] = "2026-11-04T12:00:00.000Z";
    value.state.lastRuns = Object.fromEntries(OPERATION_JOBS.filter((job) => job.defaultEnabled && job.mode === "scheduled").map((job) => [job.id, {
      ...run(job.id), startedAt: "2026-11-04T07:10:00.000Z", endedAt: "2026-11-04T07:15:00.000Z",
    }]));
    value.state.lastRuns["schwab-fetch-daily"] = {
      ...run("schwab-fetch-daily"), startedAt: "2026-11-03T12:00:14.096Z", endedAt: "2026-11-03T12:00:16.171Z",
    };
    value.snapshot!.generatedAt = "2026-11-03T12:00:45.440Z";
    for (const file of value.snapshot!.files) file.capturedAt = "2026-11-03T00:10:50.992Z";
    value.snapshot!.coverage.latestCapture = "2026-11-03T00:10:50.992Z";
    value.features!.generatedAt = "2026-11-03T12:01:00.904Z";
    value.context!.generatedAt = new Date(Date.parse(now) - 15 * 60_000).toISOString();
    return value;
  };

  it("keeps a pre-schedule missing capture pending with a readable previous complete snapshot", () => {
    const report = buildDailyOperationsReport(scheduledInput("2026-11-04T08:32:00.000Z"));
    const check = report.checks.find((item) => item.id === "schwab-daily-evidence");
    expect(check?.status).toBe("pending");
    expect(check?.detail).toContain("awaiting_scheduled_capture");
    expect(check?.detail).toContain("2026-11-04T12:00:00.000Z");
    expect(report.schwab.tickersCapturedToday).toBe(0);
    expect(report.status).not.toBe("critical");
    expect(report.status).toBe("degraded");
  });

  it("turns a missed scheduled slot into an error after the documented grace period", () => {
    const report = buildDailyOperationsReport(scheduledInput("2026-11-04T13:01:00.000Z"));
    const check = report.checks.find((item) => item.id === "schwab-daily-evidence");
    expect(check?.status).toBe("error");
    expect(check?.detail).toContain("60-minute grace period");
    expect(report.status).toBe("critical");
  });

  it("marks full current-day coverage ok", () => {
    const value = scheduledInput("2026-11-04T08:32:00.000Z");
    for (const file of value.snapshot!.files) file.capturedAt = "2026-11-04T08:00:00.000Z";
    value.snapshot!.generatedAt = "2026-11-04T08:30:00.000Z";
    value.snapshot!.coverage.latestCapture = "2026-11-04T08:00:00.000Z";
    value.features!.generatedAt = "2026-11-04T08:31:00.000Z";
    value.state.nextRuns["schwab-fetch-daily"] = "2026-11-05T12:00:00.000Z";
    const report = buildDailyOperationsReport(value);
    expect(report.checks.find((item) => item.id === "schwab-daily-evidence")?.status).toBe("ok");
    expect(report.schwab.tickersCapturedToday).toBe(2);
  });

  it("does not let readable previous chains or same-day normalization hide a missed current capture", () => {
    const value = scheduledInput("2026-11-04T13:01:00.000Z");
    value.snapshot!.generatedAt = "2026-11-04T12:30:00.000Z";
    const report = buildDailyOperationsReport(value);
    expect(report.schwab.tickersCompleted).toBe(2);
    expect(report.schwab.tickersCapturedToday).toBe(0);
    expect(report.checks.find((item) => item.id === "schwab-daily-evidence")?.status).toBe("error");
  });

  it("keeps hourly context success independent from daily pending or missed evidence", () => {
    const before = buildDailyOperationsReport(scheduledInput("2026-11-04T08:32:00.000Z"));
    expect(before.checks.find((item) => item.id === "schwab-context-freshness")?.status).toBe("ok");
    expect(before.checks.find((item) => item.id === "schwab-daily-evidence")?.status).toBe("pending");
    const after = buildDailyOperationsReport(scheduledInput("2026-11-04T13:01:00.000Z"));
    expect(after.checks.find((item) => item.id === "schwab-context-freshness")?.status).toBe("ok");
    expect(after.checks.find((item) => item.id === "schwab-daily-evidence")?.status).toBe("error");
  });
});
