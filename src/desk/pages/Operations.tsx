/**
 * Owner-only health view of the home pipeline, read from the daily operations report the scheduler already
 * writes (public/reports/daily-operations.json). Read-only: the controls stay in the classic operations console.
 */
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Card, Kpi, Notice, Segmented, Shimmer, StatusLabel } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { fmtDateTime, readable, statusKind } from "../format";

interface OpsCheck {
  id: string;
  label: string;
  status: string;
  observedAt: string | null;
  detail: string;
  action: string | null;
}

interface OpsJob {
  jobId: string;
  name: string;
  group: string;
  mode: string;
  enabled: boolean;
  cron: string | null;
  nextRunAt: string | null;
  lastRun: { status: string; startedAt: string | null; endedAt: string | null; exitCode: number | null; error: string | null } | null;
}

interface OpsReport {
  generatedAt: string;
  date: string;
  status: string;
  scheduler: { status: string; heartbeatAt: string | null; currentJobId: string | null; queuedJobs: number; nextRunAt: string | null; enabledJobs: number };
  schwab: { status: string; tickersExpected: number; tickersCompleted: number; tickersCapturedToday: number; manifestErrors: number; latestCapture: string | null };
  summary: { checksOk: number; checksWarning: number; checksError: number; checksPending: number; jobsDoneToday: number; jobsFailedToday: number; jobsEnabled: number };
  checks: OpsCheck[];
  jobs: OpsJob[];
}

async function fetchReport(): Promise<OpsReport | null> {
  const response = await fetch("/reports/daily-operations.json", { cache: "no-store", credentials: "include" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The operations report answered ${response.status}`);
  return (await response.json()) as OpsReport;
}

const ORDER: Record<string, number> = { critical: 0, error: 0, warning: 1, pending: 2, unknown: 3, ok: 4 };

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const seconds = Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export default function Operations() {
  useDocumentTitle("Operations");
  const { isAdmin } = useDesk();
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const report = useQuery({ queryKey: ["desk", "daily-operations"], queryFn: fetchReport, enabled: isAdmin, refetchInterval: 60_000 });
  const checks = useMemo(() => {
    const rows = [...(report.data?.checks ?? [])].sort((a, b) => (ORDER[statusKind(a.status)] ?? 3) - (ORDER[statusKind(b.status)] ?? 3));
    return filter === "attention" ? rows.filter((row) => statusKind(row.status) !== "ok") : rows;
  }, [report.data, filter]);
  const jobs = useMemo(() => [...(report.data?.jobs ?? [])].filter((job) => job.enabled).sort((a, b) => (ORDER[statusKind(a.lastRun?.status)] ?? 3) - (ORDER[statusKind(b.lastRun?.status)] ?? 3) || a.name.localeCompare(b.name)), [report.data]);

  if (!isAdmin) return <Navigate to="/desk" replace />;
  if (report.isLoading) return <Shimmer height={480} />;
  if (report.error) return <Notice title="The operations report could not be read">{(report.error as Error).message}</Notice>;
  if (!report.data) return <Notice title="No operations report yet">Build it with <code>npx tsx scripts/build-daily-operations-report.mts</code>.</Notice>;
  const data = report.data;

  return (
    <div>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Home pipeline · report of {fmtDateTime(data.generatedAt)}</span>
          <h1>Operations</h1>
          <p className="desk-lede">Health of the scheduler, the collectors and the data they deliver. Read-only here; run or stop jobs from the operations console.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" className="desk-button" onClick={() => void report.refetch()}>
            <RefreshCw size={14} aria-hidden="true" /> Reload
          </button>
          <Link className="desk-button primary" to="/workers">Operations console <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      </div>

      <div className="desk-kpis">
        <Kpi label="Overall" value={<StatusLabel status={data.status} label={data.status === "ok" ? "Healthy" : data.status[0].toUpperCase() + data.status.slice(1)} />} note={`${data.summary.checksError} errors · ${data.summary.checksWarning} warnings`} />
        <Kpi label="Scheduler" value={<StatusLabel status={data.scheduler.status} label={data.scheduler.status} />} note={`Heartbeat ${fmtDateTime(data.scheduler.heartbeatAt)} · ${data.scheduler.queuedJobs} queued`} />
        <Kpi label="Schwab capture today" value={`${data.schwab.tickersCapturedToday} / ${data.schwab.tickersExpected}`} note={`${data.schwab.manifestErrors} manifest errors · latest ${fmtDateTime(data.schwab.latestCapture)}`} />
        <Kpi label="Jobs today" value={`${data.summary.jobsDoneToday} done`} note={`${data.summary.jobsFailedToday} failed · ${data.summary.jobsEnabled} enabled`} />
        <Kpi label="Checks passing" value={`${data.summary.checksOk} / ${data.checks.length}`} note={`${data.summary.checksPending} pending`} />
      </div>

      <div className="desk-grid">
        <Card
          className="desk-span-12"
          title="Checks"
          subtitle={filter === "attention" ? "Only the checks that need attention" : "Every check of the report"}
          action={<Segmented label="Checks shown" options={[{ value: "attention", label: "Needs attention" }, { value: "all", label: "All" }]} value={filter} onChange={setFilter} />}
        >
          {checks.length ? (
            <div>
              {checks.map((check) => (
                <div key={check.id} className="desk-list-row" style={{ alignItems: "flex-start" }}>
                  <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                    <span style={{ fontWeight: 560 }}>{check.label}</span>
                    <span className="desk-ink-2" style={{ fontSize: 12.5, whiteSpace: "normal" }}>{readable(check.detail)}</span>
                    {check.action && <code style={{ fontSize: 12, color: "var(--d-muted)", whiteSpace: "normal", wordBreak: "break-all" }}>{check.action}</code>}
                  </span>
                  <span style={{ display: "grid", justifyItems: "end", gap: 3 }}>
                    <StatusLabel status={check.status} />
                    <span className="desk-muted" style={{ fontSize: 12 }}>{fmtDateTime(check.observedAt)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="desk-empty">Every check passes.</div>
          )}
        </Card>

        <Card className="desk-span-12" flush title="Scheduled jobs" subtitle="Enabled jobs, problems first">
          <div className="desk-table-wrap">
            <table className="desk-table" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Group</th>
                  <th>Last run</th>
                  <th>Ended</th>
                  <th className="num">Took</th>
                  <th>Next run</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.jobId} style={{ cursor: "default" }}>
                    <td>
                      <span style={{ fontWeight: 560 }}>{job.name}</span>
                      {job.lastRun?.error && <span className="desk-muted" style={{ display: "block", whiteSpace: "normal", maxWidth: 420 }}>{readable(job.lastRun.error).slice(0, 160)}</span>}
                    </td>
                    <td className="desk-ink-2">{job.group}</td>
                    <td>{job.lastRun ? <StatusLabel status={job.lastRun.status} label={job.lastRun.status} /> : <span className="desk-muted">not run yet</span>}</td>
                    <td className="desk-ink-2">{fmtDateTime(job.lastRun?.endedAt ?? null)}</td>
                    <td className="num desk-ink-2">{duration(job.lastRun?.startedAt ?? null, job.lastRun?.endedAt ?? null)}</td>
                    <td className="desk-ink-2">{job.mode === "scheduled" ? fmtDateTime(job.nextRunAt) : job.mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
