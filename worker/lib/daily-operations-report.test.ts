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
});
