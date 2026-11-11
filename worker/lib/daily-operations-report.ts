import { OPERATION_JOBS, type OperationJob } from "../../contracts/operations";
import type { OperationConfig, OperationsState } from "./operations-scheduler";
import type { SchwabMarketSnapshot } from "./schwab-normalize";
import type { SchwabFeatureReport } from "./schwab-features";
import type { SchwabContextReport } from "./schwab-context";
import { buildMacroHealth, type MacroOperationsArtifacts, type MacroHealthSummary } from "./macro-operations-health";
import type { FactsManifestHealth } from "./facts-incremental";

export const DAILY_OPERATIONS_REPORT_JOB_ID = "daily-operations-report";
const SCHEDULER_COMMAND = "schtasks /Run /TN AlphaEngine-Operations-Scheduler";
const SCHWAB_FETCH_COMMAND = "npx tsx worker/schwab-fetch.mts --universe research-universe-50.json";
const SCHWAB_FEATURE_COMMAND = "npx tsx worker/build-schwab-market-data.mts && npx tsx worker/schwab-features.mts";
const SCHWAB_CONTEXT_COMMAND = "npx tsx worker/schwab-context.mts";
const HOURLY_JOBS = new Set(["stocktwits-hourly", "schwab-context-hourly"]);
const EMPTY_MACRO: MacroOperationsArtifacts = { fred: null, events: null, qa: null, scenarios: null, calibration: null, eventStudy: null };

export type DailyCheckStatus = "ok" | "warning" | "error" | "pending";
export interface DailyOperationCheck {
  id: string;
  label: string;
  status: DailyCheckStatus;
  observedAt: string | null;
  detail: string;
  action: string | null;
  jobId?: string;
}
export interface DailyOperationJobRow {
  jobId: string;
  name: string;
  group: OperationJob["group"];
  mode: OperationJob["mode"];
  enabled: boolean;
  cron: string | null;
  dependsOn: string[];
  nextRunAt: string | null;
  lastRun: {
    runId: string;
    status: OperationsState["lastRuns"][string]["status"];
    trigger: OperationsState["lastRuns"][string]["trigger"];
    startedAt: string;
    endedAt: string | null;
    exitCode: number | null;
    error: string | null;
  } | null;
}
export interface DailyOperationsReport {
  schemaVersion: 1;
  dataMode?: "live" | "fixture";
  generatedAt: string;
  date: string;
  dateBasis: "UTC";
  status: "ok" | "degraded" | "critical";
  scheduler: {
    status: "online" | "offline" | "missing";
    heartbeatAt: string | null;
    startedAt: string | null;
    currentJobId: string | null;
    queuedJobs: number;
    nextRunAt: string | null;
    enabledJobs: number;
    configurationSource: "file" | "registry_defaults";
  };
  schwab: {
    status: DailyCheckStatus;
    snapshotGeneratedAt: string | null;
    latestCapture: string | null;
    tickersExpected: number;
    tickersCompleted: number;
    tickersCapturedToday: number;
    contracts: number;
    manifestErrors: number;
    featuresGeneratedAt: string | null;
    featuresSourceCurrent: boolean;
    contextGeneratedAt: string | null;
    contextErrors: number;
  };
  macro: MacroHealthSummary;
  facts?: { sp500: FactsManifestHealth | null };
  summary: {
    checksOk: number;
    checksWarning: number;
    checksError: number;
    checksPending: number;
    jobsDoneToday: number;
    jobsFailedToday: number;
    jobsEnabled: number;
  };
  checks: DailyOperationCheck[];
  jobs: DailyOperationJobRow[];
  actions: string[];
}
export interface DailyOperationsInput {
  now: string;
  date?: string;
  state: OperationsState;
  config: OperationConfig;
  configurationSource: "file" | "registry_defaults";
  snapshot: SchwabMarketSnapshot | null;
  snapshotSha256: string | null;
  features: SchwabFeatureReport | null;
  context: SchwabContextReport | null;
  macro?: MacroOperationsArtifacts;
  facts?: { sp500: FactsManifestHealth | null };
  dataMode?: "live" | "fixture";
}

const timestamp = (value: string | null | undefined): number => value ? Date.parse(value) : Number.NaN;
const sameDay = (value: string | null | undefined, date: string): boolean => !!value && value.slice(0, 10) === date;
const ageText = (minutes: number): string => minutes < 120 ? `${Math.max(0, Math.round(minutes))} min` : `${(minutes / 60).toFixed(1)} h`;
const baseCheck = (id: string, label: string, status: DailyCheckStatus, observedAt: string | null, detail: string, action: string | null, jobId?: string): DailyOperationCheck => ({ id, label, status, observedAt, detail, action, ...(jobId ? { jobId } : {}) });

function jobCheck(job: OperationJob, input: DailyOperationsInput, nowMs: number, date: string): DailyOperationCheck {
  const { state } = input;
  const last = state.lastRuns[job.id];
  const observedAt = last?.endedAt ?? last?.startedAt ?? null;
  const nextRunAt = state.nextRuns[job.id] ?? null;
  if (state.current?.jobId === job.id) return baseCheck(job.id, job.name, "warning", state.current.startedAt, "Running now.", job.command, job.id);
  if (state.queue.some((row) => row.jobId === job.id)) return baseCheck(job.id, job.name, "warning", observedAt, "Queued in the scheduler.", job.command, job.id);
  if (last && ["error", "killed"].includes(last.status) && sameDay(last.endedAt ?? last.startedAt, date)) {
    return baseCheck(job.id, job.name, "error", observedAt, `Latest run ${last.status}: ${last.error ?? `exit ${last.exitCode ?? "unknown"}`}`, job.command, job.id);
  }
  if (last?.status === "done" && last.endedAt) {
    const ageMinutes = (nowMs - timestamp(last.endedAt)) / 60_000;
    if (HOURLY_JOBS.has(job.id)) {
      if (ageMinutes >= 0 && ageMinutes <= 120) return baseCheck(job.id, job.name, "ok", last.endedAt, `Last successful run ${ageText(ageMinutes)} ago.`, null, job.id);
      return baseCheck(job.id, job.name, "error", last.endedAt, `Hourly job is stale: last success ${ageText(ageMinutes)} ago.`, job.command, job.id);
    }
    if (job.id === "schwab-refresh-manual" && ageMinutes >= 0 && ageMinutes <= 49 * 60) {
      return baseCheck(job.id, job.name, "ok", last.endedAt, `Token keepalive succeeded ${ageText(ageMinutes)} ago.`, null, job.id);
    }
    if (sameDay(last.endedAt, date)) return baseCheck(job.id, job.name, "ok", last.endedAt, "Completed today.", null, job.id);
  }
  if (job.dependsOn.length) {
    const parents = job.dependsOn.map((id) => state.lastRuns[id]);
    if (parents.some((run) => run && ["error", "killed"].includes(run.status) && sameDay(run.endedAt ?? run.startedAt, date))) {
      return baseCheck(job.id, job.name, "error", observedAt, "A parent job failed today; this dependency is blocked.", job.command, job.id);
    }
    if (parents.some((run) => run?.status === "done" && sameDay(run.endedAt, date))) {
      return baseCheck(job.id, job.name, "warning", observedAt, "A parent completed today, but this dependency has not completed.", job.command, job.id);
    }
    return baseCheck(job.id, job.name, "pending", observedAt, "Waiting for today's parent run.", job.command, job.id);
  }
  if (nextRunAt && timestamp(nextRunAt) > nowMs) return baseCheck(job.id, job.name, "pending", observedAt, `Not due yet; next run ${nextRunAt}.`, null, job.id);
  return baseCheck(job.id, job.name, "error", observedAt, last ? `No successful run today; latest status ${last.status}.` : "No scheduler run recorded.", job.command, job.id);
}

export const SCHWAB_CAPTURE_GRACE_MS = 60 * 60_000;

function schwabChecks(input: DailyOperationsInput, nowMs: number, date: string): { checks: DailyOperationCheck[]; summary: DailyOperationsReport["schwab"] } {
  const { snapshot, features, context } = input;
  const files = snapshot?.files ?? [];
  const expected = snapshot?.coverage.tickersExpected ?? 0;
  const completed = snapshot?.coverage.tickersCompleted ?? 0;
  const capturedToday = files.filter((file) => file.status === "complete" && sameDay(file.capturedAt, date)).length;
  const manifestErrors = snapshot?.qa.manifestErrors ?? 0;
  const latestCapture = snapshot?.coverage.latestCapture ?? null;
  const nextRunAt = input.state.nextRuns["schwab-fetch-daily"] ?? null;
  const nextRunMs = timestamp(nextRunAt);
  const heartbeatAge = (nowMs - timestamp(input.state.heartbeatAt)) / 60_000;
  const schedulerOnline = heartbeatAge >= 0 && heartbeatAge <= 1.5;
  const previousCompleteSnapshot = expected > 0 && completed === expected && manifestErrors === 0;
  const nextRunToday = sameDay(nextRunAt, date) && Number.isFinite(nextRunMs);
  const awaitingCapture = schedulerOnline && previousCompleteSnapshot && nextRunToday && nowMs <= nextRunMs + SCHWAB_CAPTURE_GRACE_MS;
  const pastCaptureGrace = nextRunToday && nowMs > nextRunMs + SCHWAB_CAPTURE_GRACE_MS;
  let dailyStatus: DailyCheckStatus = "error";
  let dailyDetail = "No normalized Schwab snapshot is available.";
  if (snapshot) {
    dailyDetail = `${capturedToday}/${expected} tickers captured today · ${completed}/${expected} readable latest chains · ${snapshot.coverage.contracts} contracts · ${manifestErrors} manifest errors.`;
    if (expected > 0 && capturedToday === expected && completed === expected && manifestErrors === 0) dailyStatus = "ok";
    else if (pastCaptureGrace) {
      dailyStatus = "error";
      dailyDetail += ` · scheduled capture ${nextRunAt} is past the 60-minute grace period`;
    } else if (capturedToday > 0) dailyStatus = "warning";
    else if (awaitingCapture) {
      dailyStatus = "pending";
      dailyDetail = `awaiting_scheduled_capture · next full snapshot ${nextRunAt} with a 60-minute grace period · ${dailyDetail}`;
    } else if (sameDay(snapshot.generatedAt, date)) dailyStatus = "warning";
  }
  const dailyCheck = baseCheck("schwab-daily-evidence", "Schwab daily raw evidence", dailyStatus, latestCapture ?? snapshot?.generatedAt ?? null, dailyDetail, dailyStatus === "ok" || dailyStatus === "pending" ? null : SCHWAB_FETCH_COMMAND);

  const sourceCurrent = !!snapshot && !!features && !!input.snapshotSha256 && features.sourceSnapshotSha256 === input.snapshotSha256;
  let featureStatus: DailyCheckStatus = "error";
  let featureDetail = "Feature Lab output is missing.";
  if (features && snapshot) {
    featureDetail = sourceCurrent
      ? `Feature source hash matches the current normalized snapshot · ${features.coverage.tickers} tickers.`
      : "Feature source hash does not match the current normalized snapshot.";
    featureStatus = sourceCurrent && timestamp(features.generatedAt) >= timestamp(snapshot.generatedAt) ? "ok" : "error";
  }
  const featureCheck = baseCheck("schwab-feature-lineage", "Schwab Feature Lab lineage", featureStatus, features?.generatedAt ?? null, featureDetail, featureStatus === "ok" ? null : SCHWAB_FEATURE_COMMAND);

  let contextStatus: DailyCheckStatus = "error";
  let contextDetail = "Schwab hourly context is missing.";
  if (context) {
    const ageMinutes = (nowMs - timestamp(context.generatedAt)) / 60_000;
    const fresh = ageMinutes >= 0 && ageMinutes <= 120;
    contextDetail = `${context.coverage.complete}/${context.coverage.expected} context endpoints · ${context.coverage.errors} errors · generated ${ageText(ageMinutes)} ago.`;
    contextStatus = fresh ? context.coverage.errors > 0 ? "warning" : "ok" : "error";
  }
  const contextCheck = baseCheck("schwab-context-freshness", "Schwab hourly context", contextStatus, context?.generatedAt ?? null, contextDetail, contextStatus === "ok" ? null : SCHWAB_CONTEXT_COMMAND);
  return {
    checks: [dailyCheck, featureCheck, contextCheck],
    summary: {
      status: dailyStatus,
      snapshotGeneratedAt: snapshot?.generatedAt ?? null,
      latestCapture,
      tickersExpected: expected,
      tickersCompleted: completed,
      tickersCapturedToday: capturedToday,
      contracts: snapshot?.coverage.contracts ?? 0,
      manifestErrors,
      featuresGeneratedAt: features?.generatedAt ?? null,
      featuresSourceCurrent: sourceCurrent,
      contextGeneratedAt: context?.generatedAt ?? null,
      contextErrors: context?.coverage.errors ?? 0,
    },
  };
}

export function buildDailyOperationsReport(input: DailyOperationsInput): DailyOperationsReport {
  const nowMs = timestamp(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("Daily report now must be an ISO timestamp");
  const date = input.date ?? input.now.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Daily report date must be YYYY-MM-DD");
  const heartbeatAt = input.state.heartbeatAt ?? null;
  // The scheduler writes its heartbeat every 15 s, so one written after the report fixed `now` is up to a few
  // seconds in the future; that is a live scheduler, not a stale one. More than a minute ahead stays suspicious.
  const heartbeatAge = (nowMs - timestamp(heartbeatAt)) / 60_000;
  const schedulerStatus = !heartbeatAt ? "missing" : heartbeatAge >= -1 && heartbeatAge <= 1.5 ? "online" : "offline";
  const nextRunAt = Object.values(input.state.nextRuns).filter((value): value is string => !!value && Number.isFinite(timestamp(value))).sort()[0] ?? null;
  const enabledJobs = OPERATION_JOBS.filter((job) => input.config[job.id]?.enabled).length;
  const schedulerCheck = baseCheck(
    "scheduler-heartbeat",
    "Operations scheduler",
    schedulerStatus === "online" ? "ok" : "error",
    heartbeatAt,
    schedulerStatus === "online"
      ? `Heartbeat ${ageText(heartbeatAge)} ago · ${input.state.queue.length} queued · ${enabledJobs} enabled jobs.`
      : schedulerStatus === "missing" ? "No scheduler heartbeat has been recorded." : `Scheduler heartbeat is stale: ${ageText(heartbeatAge)} ago.`,
    schedulerStatus === "online" ? null : SCHEDULER_COMMAND,
  );
  const schwab = schwabChecks(input, nowMs, date);
  const macro = buildMacroHealth(input.macro ?? EMPTY_MACRO, nowMs);
  const factsChecks = input.facts?.sp500 ? [baseCheck(
    "sp500-facts-coverage",
    "S&P 500 companyfacts coverage",
    input.facts.sp500.failed > 0 || input.facts.sp500.missing > 0 ? "warning" : "ok",
    input.facts.sp500.lastCheckedAt,
    `${input.facts.sp500.uniqueCiks} unique CIKs · ${input.facts.sp500.refreshed} refreshed · ${input.facts.sp500.unchanged} unchanged · ${input.facts.sp500.failed} failed · ${input.facts.sp500.missing} missing`,
    input.facts.sp500.failed > 0 || input.facts.sp500.missing > 0 ? "npx tsx worker/facts-fetch.mts --universe edgar-universe.json" : null,
    "sp500-facts-daily",
  )] : [];
  const checks = [
    schedulerCheck,
    ...schwab.checks,
    ...macro.checks,
    ...factsChecks,
    ...OPERATION_JOBS.filter((job) => job.id !== DAILY_OPERATIONS_REPORT_JOB_ID && job.mode === "scheduled" && input.config[job.id]?.enabled).map((job) => jobCheck(job, input, nowMs, date)),
  ];
  const jobs = OPERATION_JOBS.map((job): DailyOperationJobRow => {
    const last = input.state.lastRuns[job.id];
    return {
      jobId: job.id,
      name: job.name,
      group: job.group,
      mode: job.mode,
      enabled: input.config[job.id]?.enabled ?? false,
      cron: input.config[job.id]?.cron ?? job.cron,
      dependsOn: job.dependsOn,
      nextRunAt: input.state.nextRuns[job.id] ?? null,
      lastRun: last ? {
        runId: last.runId,
        status: last.status,
        trigger: last.trigger,
        startedAt: last.startedAt,
        endedAt: last.endedAt,
        exitCode: last.exitCode,
        error: last.error,
      } : null,
    };
  });
  const summary = {
    checksOk: checks.filter((check) => check.status === "ok").length,
    checksWarning: checks.filter((check) => check.status === "warning").length,
    checksError: checks.filter((check) => check.status === "error").length,
    checksPending: checks.filter((check) => check.status === "pending").length,
    jobsDoneToday: jobs.filter((job) => job.lastRun?.status === "done" && sameDay(job.lastRun.endedAt, date)).length,
    jobsFailedToday: jobs.filter((job) => job.lastRun && ["error", "killed"].includes(job.lastRun.status) && sameDay(job.lastRun.endedAt ?? job.lastRun.startedAt, date)).length,
    jobsEnabled: enabledJobs,
  };
  return {
    schemaVersion: 1,
    ...(input.dataMode ? { dataMode: input.dataMode } : {}),
    generatedAt: input.now,
    date,
    dateBasis: "UTC",
    status: summary.checksError > 0 ? "critical" : summary.checksWarning > 0 || summary.checksPending > 0 ? "degraded" : "ok",
    scheduler: {
      status: schedulerStatus,
      heartbeatAt,
      startedAt: input.state.schedulerStartedAt ?? null,
      currentJobId: input.state.current?.jobId ?? null,
      queuedJobs: input.state.queue.length,
      nextRunAt,
      enabledJobs,
      configurationSource: input.configurationSource,
    },
    schwab: schwab.summary,
    macro: macro.summary,
    ...(input.facts ? { facts: input.facts } : {}),
    summary,
    checks,
    jobs,
    actions: [...new Set(checks.filter((check) => ["error", "warning"].includes(check.status) && check.action).map((check) => check.action!))],
  };
}

const md = (value: string): string => value.replaceAll("|", "\\|").replaceAll("\n", " ");
export function dailyOperationsMarkdown(report: DailyOperationsReport): string {
  const lines = [
    "# Daily operations report",
    "",
    `Date: ${report.date} (${report.dateBasis}) · Generated: ${report.generatedAt} · Status: ${report.status.toUpperCase()}`,
    "",
    "## Summary",
    "",
    `- Scheduler: ${report.scheduler.status}; heartbeat: ${report.scheduler.heartbeatAt ?? "missing"}`,
    `- Schwab: ${report.schwab.tickersCapturedToday}/${report.schwab.tickersExpected} tickers captured today; latest capture: ${report.schwab.latestCapture ?? "missing"}`,
    `- Macro QA: ${report.macro.qaStatus ?? "missing"}; derived reports current: ${report.macro.derivedCurrent}`,
    ...(report.facts?.sp500 ? [`- S&P 500 facts: ${report.facts.sp500.uniqueCiks} unique CIKs; refreshed ${report.facts.sp500.refreshed}; unchanged ${report.facts.sp500.unchanged}; failed ${report.facts.sp500.failed}; missing ${report.facts.sp500.missing}`] : []),
    `- Checks: ${report.summary.checksOk} ok, ${report.summary.checksWarning} warning, ${report.summary.checksError} error, ${report.summary.checksPending} pending`,
    `- Jobs: ${report.summary.jobsDoneToday} completed today, ${report.summary.jobsFailedToday} failed today, ${report.summary.jobsEnabled} enabled`,
    "",
    "## Checks",
    "",
    "| Check | Status | Observed | Detail |",
    "|---|---|---|---|",
    ...report.checks.map((check) => `| ${md(check.label)} | ${check.status} | ${check.observedAt ?? "—"} | ${md(check.detail)} |`),
    "",
    "## Actions",
    "",
  ];
  if (!report.actions.length) lines.push("No remediation actions are currently required.");
  for (const action of report.actions) lines.push(`- \`${action}\``);
  lines.push("", "The report records evidence only. Production collection and production apply remain disabled; reviewed delivery is a separate manual gate.", "");
  return lines.join("\n");
}
