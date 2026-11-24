/**
 * The owner's operations console for the home pipeline. Health is read from the daily operations report the scheduler
 * writes (public/reports/daily-operations.json); Jobs and Runs read the scheduler's own state and switches through the
 * local worker procedures and send it requests (switch, schedule, Run, Stop); Coverage reads the weekly coverage
 * report; Reference draws the flow from the job registry.
 */
import { useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight, BookOpen, HeartPulse, ListChecks, RefreshCw, Table2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Card, Kpi, Notice, Segmented, Shimmer, StatusLabel } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { useDeskSnapshot } from "../data";
import { libraryDestinations } from "../destinations";
import { DevNotes } from "../DevNotes";
import { fmtDate, fmtDateTime, readable, statusKind } from "../format";
import { consoleJobs, type ConsoleConfig, type ConsoleState } from "../operations/console-data";
import { Coverage } from "../operations/Coverage";
import { Jobs } from "../operations/Jobs";
import { Reference } from "../operations/Reference";
import { Runs } from "../operations/Runs";

type OpsTab = "health" | "jobs" | "runs" | "coverage" | "reference";
const TABS: { id: OpsTab; label: string; icon: typeof Activity }[] = [
  { id: "health", label: "Health", icon: HeartPulse },
  { id: "jobs", label: "Jobs", icon: ListChecks },
  { id: "runs", label: "Runs", icon: Activity },
  { id: "coverage", label: "Coverage", icon: Table2 },
  { id: "reference", label: "Reference", icon: BookOpen },
];

interface OpsCheck {
  id: string;
  label: string;
  status: string;
  observedAt: string | null;
  detail: string;
  action: string | null;
}

interface OpsReport {
  generatedAt: string;
  date: string;
  status: string;
  scheduler: { status: string; heartbeatAt: string | null; currentJobId: string | null; queuedJobs: number; nextRunAt: string | null; enabledJobs: number };
  schwab: { status: string; tickersExpected: number; tickersCompleted: number; tickersCapturedToday: number; manifestErrors: number; latestCapture: string | null };
  summary: { checksOk: number; checksWarning: number; checksError: number; checksPending: number; jobsDoneToday: number; jobsFailedToday: number; jobsEnabled: number };
  checks: OpsCheck[];
}

interface DataHealthReport {
  generatedAt: string;
  status: string;
  health: string;
  summary: { checks: number; findings: number; info: number; review: number; quarantine: number };
}

async function fetchReport(): Promise<OpsReport | null> {
  const response = await fetch("/reports/daily-operations.json", { cache: "no-store", credentials: "include" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The operations report answered ${response.status}`);
  return (await response.json()) as OpsReport;
}

async function fetchDataHealth(): Promise<DataHealthReport | null> {
  const response = await fetch("/reports/data-health.json", { cache: "no-store", credentials: "include" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The data-health report answered ${response.status}`);
  return (await response.json()) as DataHealthReport;
}

const OWNER_TOOL_TEXT: Record<string, string> = {
  "/desk/admin": "People, reviewers, manuals, logs and monitors.",
  "/database": "Stored tables, filings and concept series.",
  "/lab": "Sentiment scoring of filing sections.",
};

const ORDER: Record<string, number> = { critical: 0, error: 0, warning: 1, pending: 2, unknown: 3, ok: 4 };

const SOURCE_STATUS = { current: "ok", late: "warning", failed: "error", unknown: "warning" } as const;
const SOURCE_LABEL = { current: "Current", late: "Late", failed: "Refresh failed", unknown: "Unknown" } as const;

export default function Operations() {
  useDocumentTitle("Operations");
  const { isAdmin } = useDesk();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: OpsTab = TABS.some((item) => item.id === requested) ? (requested as OpsTab) : "health";
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [logJob, setLogJob] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // the scheduler's switches and state: asked for only by the owner, faster while a job runs, never while hidden
  const local = trpc.workersLocal.enabled.useQuery(undefined, { enabled: isAdmin, staleTime: 5 * 60_000, retry: false });
  const canAct = local.data?.enabled === true;
  const operations = trpc.workersLocal.operations.useQuery(undefined, {
    enabled: isAdmin && canAct,
    refetchInterval: (query) => ((query.state.data as { state?: ConsoleState } | undefined)?.state?.current ? 10_000 : 60_000),
  });
  const rows = useMemo(() => consoleJobs(operations.data?.config as ConsoleConfig | undefined, operations.data?.state as ConsoleState | undefined), [operations.data]);
  const utils = trpc.useUtils();
  const after = (text: string) => { setMessage(text); void utils.workersLocal.operations.invalidate(); };
  const failed = (error: { message: string }) => setMessage(`The scheduler refused: ${error.message}`);
  const setOperation = trpc.workersLocal.setOperation.useMutation({ onSuccess: () => after("Saved. The scheduler reads it at its next tick."), onError: failed });
  const runOperation = trpc.workersLocal.runOperation.useMutation({ onSuccess: (result) => after(`Queued: ${result.chain.join(" → ")}`), onError: failed });
  const killOperation = trpc.workersLocal.killOperation.useMutation({ onSuccess: () => after("Stop requested."), onError: failed });
  const openLog = (jobId: string | null) => { setLogJob(jobId); if (jobId && tab !== "runs") setParams({ tab: "runs" }); };
  const report = useQuery({ queryKey: ["desk", "daily-operations"], queryFn: fetchReport, enabled: isAdmin, refetchInterval: 60_000 });
  const health = useQuery({ queryKey: ["desk", "data-health"], queryFn: fetchDataHealth, enabled: isAdmin, refetchInterval: 60_000 });
  const snapshot = useDeskSnapshot();
  const sources = trpc.desk.sourceFreshness.useQuery(undefined, { enabled: isAdmin, refetchInterval: 5 * 60_000, staleTime: 60_000 });
  const checks = useMemo(() => {
    const rows = [...(report.data?.checks ?? [])].sort((a, b) => (ORDER[statusKind(a.status)] ?? 3) - (ORDER[statusKind(b.status)] ?? 3));
    return filter === "attention" ? rows.filter((row) => statusKind(row.status) !== "ok") : rows;
  }, [report.data, filter]);

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
          <p className="desk-lede">Health of the scheduler, the collectors and the data they deliver; every job with its switch, schedule, Run and Stop; the runs and their logs.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" className="desk-button" onClick={() => { void report.refetch(); void operations.refetch(); }}>
            <RefreshCw size={14} aria-hidden="true" /> Reload
          </button>
        </div>
      </div>

      <div className="desk-tabs" role="tablist" aria-label="Operations">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setParams(id === "health" ? {} : { tab: id })}><Icon size={14} aria-hidden="true" /> {label}</button>
        ))}
      </div>

      {tab === "jobs" && <Jobs rows={rows} message={message} actions={{ canAct, busy: setOperation.isPending || runOperation.isPending || killOperation.isPending, setJob: (jobId, enabled, cron) => setOperation.mutate({ jobId, enabled, cron }), run: (jobId) => runOperation.mutate({ jobId }), stop: (jobId) => killOperation.mutate({ jobId }), openLog }} />}
      {tab === "runs" && <Runs rows={rows} state={operations.data?.state as ConsoleState | undefined} canAct={canAct} logJob={logJob} openLog={openLog} />}
      {tab === "coverage" && <Coverage />}
      {tab === "reference" && <Reference rows={rows} />}
      {tab === "health" && (<>

      <div className="desk-kpis">
        <Kpi label="Overall" value={<StatusLabel status={data.status} label={data.status === "ok" ? "Healthy" : data.status[0].toUpperCase() + data.status.slice(1)} />} note={`${data.summary.checksError} errors · ${data.summary.checksWarning} warnings`} />
        <Kpi label="Scheduler" value={<StatusLabel status={data.scheduler.status} label={data.scheduler.status} />} note={`Heartbeat ${fmtDateTime(data.scheduler.heartbeatAt)} · ${data.scheduler.queuedJobs} queued`} />
        <Kpi label="Schwab capture today" value={`${data.schwab.tickersCapturedToday} / ${data.schwab.tickersExpected}`} note={`${data.schwab.manifestErrors} manifest errors · latest ${fmtDateTime(data.schwab.latestCapture)}`} />
        <Kpi label="Jobs today" value={`${data.summary.jobsDoneToday} done`} note={`${data.summary.jobsFailedToday} failed · ${data.summary.jobsEnabled} enabled`} />
        <Kpi label="Checks passing" value={`${data.summary.checksOk} / ${data.checks.length}`} note={`${data.summary.checksPending} pending`} />
      </div>

      {snapshot.data && (
        <div className="desk-card" style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: "8px 28px", alignItems: "center", fontSize: 13 }}>
          <strong style={{ fontWeight: 620 }}>Desk snapshot</strong>
          <span className="desk-ink-2">built {fmtDateTime(snapshot.data.generatedAt)} · closes through {snapshot.data.session} · {snapshot.data.companies.length} companies · {snapshot.data.inputs.optionTickers} with option features</span>
          {(snapshot.data.inputs.registryIssues?.length ?? 0) > 0 ? (
            <StatusLabel status="error" label={`Registry: ${snapshot.data.inputs.registryIssues!.length} tickers differ from the index (${snapshot.data.inputs.registryIssues!.slice(0, 3).join("; ")})`} />
          ) : (
            <StatusLabel status="ok" label="Registry tickers agree with the index" />
          )}
          {snapshot.data.inputs.companiesWithoutPrices.length > 0 && <StatusLabel status="warning" label={`${snapshot.data.inputs.companiesWithoutPrices.length} companies without prices`} />}
        </div>
      )}

      {(health.data || health.error) && (
        <div className="desk-card" style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: "8px 28px", alignItems: "center", fontSize: 13 }}>
          <strong style={{ fontWeight: 620 }}>Data health</strong>
          {health.data ? (
            <>
              <span className="desk-ink-2">built {fmtDateTime(health.data.generatedAt)} · {health.data.summary.checks} checks · {health.data.summary.findings} findings · {health.data.summary.quarantine} quarantine · {health.data.summary.review} review · {health.data.summary.info} reviewed/info</span>
              <StatusLabel status={health.data.health === "ok" ? "ok" : "warning"} label={health.data.health} />
              <a className="desk-button" href="/reports/data-health.md" target="_blank" rel="noreferrer">Report <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a className="desk-button" href="/reports/data-health.json" target="_blank" rel="noreferrer">JSON <ArrowUpRight size={13} aria-hidden="true" /></a>
            </>
          ) : (
            <StatusLabel status="warning" label={(health.error as Error).message} />
          )}
        </div>
      )}

      <div className="desk-grid">
        <Card className="desk-span-12" title="Sources" subtitle="How current each source is, by the newest day in its own data. A refresh that ran is not the same as data that moved.">
          {sources.isLoading ? <Shimmer height={220} /> : sources.data?.sources.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead><tr><th>Source</th><th>Newest data</th><th className="num">Age</th><th>State</th><th>Arrives</th><th>Last refresh</th></tr></thead>
                <tbody>
                  {sources.data.sources.map((source) => (
                    <tr key={source.id}>
                      <td>{source.label}{source.detail ? <span className="desk-muted"> · {source.detail}</span> : null}</td>
                      <td>{source.newest ? <>{fmtDate(source.newest, "short")} <span className="desk-muted">· {source.what}</span></> : <span className="desk-muted">not readable</span>}</td>
                      <td className="num">{source.ageDays === null ? "—" : source.ageDays === 0 ? "today" : `${source.ageDays} d`}</td>
                      <td><StatusLabel status={SOURCE_STATUS[source.state]} label={SOURCE_LABEL[source.state]} /></td>
                      <td className="desk-ink-2">{source.arrives}</td>
                      <td className="desk-ink-2">{source.run ? <>{source.run.status ?? "—"}{source.run.endedAt ? ` · ${fmtDateTime(source.run.endedAt)}` : ""}{source.state === "failed" && source.run.error ? <span style={{ display: "block", whiteSpace: "normal", fontSize: 12 }}>{source.run.error}</span> : null}</> : <span className="desk-muted">no job</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty">The sources could not be read.</div>
          )}
        </Card>

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

      </div>
      <h2 className="desk-section-title">Owner tools</h2>
      <div className="desk-grid">
        {libraryDestinations(true, true)
          .filter((destination) => destination.group === "Owner tools" && !destination.path.startsWith("/desk/operations"))
          .map((destination) => (
            <Link key={destination.path} to={destination.path} className="desk-card desk-span-3" style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontWeight: 620 }}>{destination.label}</strong>
              <span className="desk-ink-2" style={{ fontSize: 13 }}>{OWNER_TOOL_TEXT[destination.path] ?? ""}</span>
              <span className="desk-link desk-nowrap" style={{ fontSize: 12.5 }}>Open <ArrowUpRight size={13} aria-hidden="true" /></span>
            </Link>
          ))}
      </div>
      </>)}
      <DevNotes page="operations" />
    </div>
  );
}
