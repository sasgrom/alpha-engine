import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, FileDown, RefreshCw, ShieldAlert } from "lucide-react";
import type { DailyCheckStatus, DailyOperationsReport } from "../../worker/lib/daily-operations-report";

type LoadState = "loading" | "ready" | "missing" | "error";
const BUILD_COMMAND = "npx tsx scripts/build-daily-operations-report.mts";
const statusClass = (status: DailyCheckStatus) => status === "ok" ? "done" : status === "error" ? "error" : status === "warning" ? "running" : "never";
const timeText = (value: string | null) => value ? value.slice(0, 19).replace("T", " ") + " UTC" : "—";

export default function DailyOperationsReportView({ onOpenJob }: { onOpenJob?: (jobId: string) => void }) {
  const [report, setReport] = useState<DailyOperationsReport | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/reports/daily-operations.json", { cache: "no-store" });
      if (response.status === 404) { setReport(null); setLoadState("missing"); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json() as DailyOperationsReport;
      if (value.schemaVersion !== 1 || !Array.isArray(value.checks) || !Array.isArray(value.jobs)) throw new Error("Unsupported report schema");
      setReport(value);
      setLoadState("ready");
    } catch { setReport(null); setLoadState("error"); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loadState !== "ready" || !report) {
    return (
      <section className="t-panel daily-report-empty">
        {loadState === "loading" ? <Activity size={22} /> : <AlertTriangle size={22} />}
        <h2>{loadState === "loading" ? "Loading daily operations evidence" : "No daily operations report"}</h2>
        <p>{loadState === "error" ? "The report could not be read. Rebuild it from actual local state; no health status is inferred." : "Build the local report to verify scheduler heartbeat, same-day Schwab coverage and failed jobs."}</p>
        <div className="ops-command"><code>{BUILD_COMMAND}</code></div>
        {loadState !== "loading" && <button type="button" className="ops-icon-button" onClick={() => { setLoadState("loading"); void load(); }}><RefreshCw size={13} />Retry</button>}
      </section>
    );
  }

  const failedChecks = report.checks.filter((check) => check.status === "error" || check.status === "warning");
  return (
    <div className="daily-report">
      <section className="t-panel daily-report-heading">
        <div>
          <span className="t-label"><ShieldAlert size={14} /> Daily operations · {report.date} {report.dateBasis}{report.dataMode === "fixture" ? " · fixture" : ""}</span>
          <h2>{report.status === "ok" ? "All required checks passed." : report.status === "degraded" ? "Attention required." : "Daily pipeline is not healthy."}</h2>
          <p>Generated {timeText(report.generatedAt)}. This is operational evidence, not the LLM morning brief.</p>
        </div>
        <div className="daily-report-actions">
          <span className={`daily-overall ${report.status}`}>{report.status}</span>
          <button type="button" className="ops-icon-button" onClick={() => void load()}><RefreshCw size={13} />Refresh</button>
          <a className="ops-icon-button" href="/reports/daily-operations.md" download><FileDown size={13} />Markdown</a>
        </div>
      </section>

      <section className="operations-metrics">
        <div className="t-panel"><span>Scheduler</span><strong>{report.scheduler.status}</strong><small>Heartbeat {timeText(report.scheduler.heartbeatAt)}</small></div>
        <div className="t-panel"><span>Schwab captured today</span><strong>{report.schwab.tickersCapturedToday}/{report.schwab.tickersExpected}</strong><small>Latest {timeText(report.schwab.latestCapture)}</small></div>
        <div className="t-panel"><span>Jobs completed today</span><strong>{report.summary.jobsDoneToday}</strong><small>{report.summary.jobsFailedToday} failed · {report.summary.jobsEnabled} enabled</small></div>
        <div className="t-panel"><span>Failed checks</span><strong>{report.summary.checksError}</strong><small>{report.summary.checksWarning} warnings · {report.summary.checksPending} pending</small></div>
      </section>

      {report.actions.length > 0 && (
        <section className="t-panel daily-remediation">
          <h3><AlertTriangle size={15} /> Required actions</h3>
          <ol>{report.actions.map((action) => <li key={action}><code>{action}</code></li>)}</ol>
        </section>
      )}

      <section className="t-panel daily-check-section">
        <div className="daily-section-title"><div><span className="t-label"><CheckCircle2 size={14} /> Evidence checks</span><h3>{failedChecks.length ? `${failedChecks.length} checks need attention` : "Every check passed"}</h3></div><span>{report.checks.length} total</span></div>
        <div className="daily-check-list">
          {report.checks.map((check) => (
            <article key={check.id} className={`daily-check ${check.status}`}>
              <span className={`ops-run-status ${statusClass(check.status)}`}>{check.status}</span>
              <div><strong>{check.label}</strong><p>{check.detail}</p><small>{timeText(check.observedAt)}</small></div>
              {check.jobId && onOpenJob && <button type="button" className="ops-icon-button" onClick={() => onOpenJob(check.jobId!)}>Inspect job</button>}
            </article>
          ))}
        </div>
      </section>

      <details className="t-panel daily-inventory">
        <summary><span><Clock3 size={14} /> Automation inventory</span><span>{report.jobs.length} registered jobs</span></summary>
        <div className="daily-job-list">
          {report.jobs.map((job) => (
            <article key={job.jobId}>
              <div><strong>{job.name}</strong><small>{job.jobId} · {job.mode}{job.enabled ? " · enabled" : " · disabled"}</small></div>
              <span>{job.cron ?? (job.dependsOn.length ? "after parents" : "manual")}</span>
              <span className={`ops-run-status ${job.lastRun?.status ?? "never"}`}>{job.lastRun?.status ?? "never"}</span>
              <small>{timeText(job.lastRun?.endedAt ?? job.lastRun?.startedAt ?? null)}</small>
            </article>
          ))}
        </div>
      </details>
    </div>
  );
}
