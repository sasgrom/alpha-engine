import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowRight, CalendarClock, ChevronDown, Clipboard, Database, FileText,
  Layers3, Network, Play, RefreshCw, Search, Server, ShieldCheck, Square, Terminal, Workflow,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import {
  OPERATION_GROUPS, OPERATION_JOBS, OPERATION_JOB_MAP, OPERATION_MODULES,
  type OperationGroup, type OperationJob, type OperationModule,
} from "@contracts/operations";

type Tab = "stack" | "jobs" | "runbook" | "activity";
type Selection = { kind: "job" | "module"; id: string };
type Config = Record<string, { enabled: boolean; cron: string | null }>;
const DEFAULT_CONFIG: Config = Object.fromEntries(OPERATION_JOBS.map((job) => [job.id, { enabled: job.defaultEnabled, cron: job.cron }]));
const DAILY_FLOW = [
  "edgar-fetch-daily", "edgar-exhibits-daily", "facts-fetch-daily", "research-series", "research-factors", "analytics-snapshot",
  "schwab-fetch-daily", "schwab-snapshot", "expectations-report", "ui-production-build", "daily-digest",
];
const laneNames = { service: "Services", collect: "Collect", research: "Research", review: "Review", delivery: "Deliver" };
const modeCopy = { scheduled: "Scheduled", paused: "Paused", manual: "Manual", frozen: "Frozen", blocked: "Review gate" };
const chainSize = (job: OperationJob) => {
  const seen = new Set<string>();
  const visit = (id: string) => { if (seen.has(id)) return; seen.add(id); for (const parent of OPERATION_JOB_MAP[id]?.dependsOn ?? []) visit(parent); };
  visit(job.id);
  return seen.size;
};

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="ops-icon-button" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }}><Clipboard size={13} />{copied ? "Copied" : label}</button>
  );
}

function ModeBadge({ job }: { job: OperationJob }) {
  return <span className={`ops-mode ${job.mode}`}>{modeCopy[job.mode]}</span>;
}

function StatusBadge({ status }: { status?: string }) {
  return <span className={`ops-run-status ${status ?? "never"}`}>{status ?? "never"}</span>;
}

export default function Workers() {
  const enabled = trpc.workersLocal.enabled.useQuery();
  const local = enabled.data?.enabled === true;
  const operations = trpc.workersLocal.operations.useQuery(undefined, { enabled: local, refetchInterval: 5000 });
  const utils = trpc.useUtils();
  const invalidate = () => utils.workersLocal.operations.invalidate();
  const setOperation = trpc.workersLocal.setOperation.useMutation({ onSuccess: invalidate });
  const runOperation = trpc.workersLocal.runOperation.useMutation({ onSuccess: invalidate });
  const killOperation = trpc.workersLocal.killOperation.useMutation({ onSuccess: invalidate });
  const [tab, setTab] = useState<Tab>("stack");
  const [selection, setSelection] = useState<Selection>({ kind: "module", id: "production-server" });
  const [group, setGroup] = useState<OperationGroup | "all">("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cronDraft, setCronDraft] = useState<Record<string, string>>({});
  const [logJob, setLogJob] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const log = trpc.workersLocal.operationLog.useQuery({ jobId: logJob!, lines: 200 }, { enabled: local && !!logJob, refetchInterval: 3000 });

  const config = operations.data?.config ?? DEFAULT_CONFIG;
  const state = operations.data?.state;
  const selectedJob = selection.kind === "job" ? OPERATION_JOB_MAP[selection.id] : null;
  const selectedModule = selection.kind === "module" ? OPERATION_MODULES.find((item) => item.id === selection.id) : null;
  const filtered = useMemo(() => OPERATION_JOBS.filter((job) => {
    const haystack = `${job.name} ${job.id} ${job.purpose} ${job.command}`.toLowerCase();
    return (group === "all" || job.group === group) && (!query || haystack.includes(query.toLowerCase()));
  }), [group, query]);
  const lastRuns = useMemo(() => Object.values(state?.lastRuns ?? {}).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [state]);
  const enabledCount = OPERATION_JOBS.filter((job) => config[job.id]?.enabled).length;
  const nextRun = Object.values(state?.nextRuns ?? {}).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const schedulerOnline = !!state?.heartbeatAt && now - Date.parse(state.heartbeatAt) < 60_000;

  const selectJob = (jobId: string, nextTab?: Tab) => {
    setSelection({ kind: "job", id: jobId });
    if (nextTab) setTab(nextTab);
  };
  const openLog = (jobId: string) => {
    setLogJob(jobId);
    setTab("activity");
  };
  const runChain = (job: OperationJob) => {
    if (!local || !job.executable || ["frozen", "blocked"].includes(job.mode)) return;
    runOperation.mutate({ jobId: job.id });
  };

  const jobDetails = (job: OperationJob, compact = false) => {
    const last = state?.lastRuns[job.id];
    const cron = cronDraft[job.id] ?? config[job.id]?.cron ?? "";
    return (
      <div className="ops-job-detail">
        <div className="ops-detail-actions">
          <ModeBadge job={job} /><StatusBadge status={last?.status} />
          {last && <button type="button" className="ops-icon-button" onClick={() => openLog(job.id)}><FileText size={13} />Log</button>}
          {state?.current?.jobId === job.id && <button type="button" className="ops-icon-button danger" onClick={() => killOperation.mutate({ jobId: job.id })}><Square size={12} />Stop</button>}
        </div>
        <dl className="ops-fact-grid">
          <div><dt>Purpose</dt><dd>{job.purpose}</dd></div>
          <div><dt>Input</dt><dd>{job.input}</dd></div>
          <div><dt>Output</dt><dd>{job.output}</dd></div>
          <div><dt>Destination</dt><dd>{job.destination}</dd></div>
          <div><dt>Dependencies</dt><dd>{job.dependsOn.length ? job.dependsOn.map((id) => <button type="button" className="ops-inline-link" key={id} onClick={() => selectJob(id)}>{OPERATION_JOB_MAP[id].name}</button>) : "Independent root job"}</dd></div>
          <div><dt>Requirements</dt><dd>{job.requirements.length ? job.requirements.join(" · ") : "Offline computation only"}</dd></div>
        </dl>
        <div className="ops-note">{job.notes}</div>
        <div className="ops-command"><code>{job.command}</code><CopyButton text={job.command} /></div>
        {!compact && ["scheduled", "paused"].includes(job.mode) && (
          <div className="ops-schedule-editor">
            <label className="ops-switch"><input type="checkbox" disabled={!local || setOperation.isPending} checked={config[job.id]?.enabled ?? false} onChange={(event) => setOperation.mutate({ jobId: job.id, enabled: event.target.checked, cron: config[job.id]?.cron ?? null })} /><span>Enabled</span></label>
            {job.cron !== null && <><input aria-label={`Cron for ${job.name}`} value={cron} disabled={!local} onChange={(event) => setCronDraft((draft) => ({ ...draft, [job.id]: event.target.value }))} placeholder="0 2 * * *" /><button type="button" className="ops-icon-button" disabled={!local || !cron || setOperation.isPending} onClick={() => setOperation.mutate({ jobId: job.id, enabled: config[job.id]?.enabled ?? false, cron })}><CalendarClock size={13} />Save cron</button></>}
            {job.cron === null && <span>Triggered after: {job.dependsOn.map((id) => OPERATION_JOB_MAP[id].name).join(" + ")}</span>}
          </div>
        )}
        {!compact && job.executable && !["frozen", "blocked"].includes(job.mode) && (
          <button type="button" className="ops-run-button" disabled={!local || !schedulerOnline || runOperation.isPending} onClick={() => runChain(job)}><Play size={14} />Run chain{job.dependsOn.length ? ` (${chainSize(job)} steps)` : " now"}</button>
        )}
        {last && <div className="ops-last-run">Last: {last.startedAt.slice(0, 19).replace("T", " ")} UTC · trigger {last.trigger}{last.error ? ` · ${last.error}` : ""}</div>}
      </div>
    );
  };

  const moduleDetails = (module: OperationModule) => (
    <div className="ops-job-detail">
      <div className="ops-detail-actions"><span className="ops-mode scheduled">{laneNames[module.lane]}</span></div>
      <dl className="ops-fact-grid">
        <div><dt>Purpose</dt><dd>{module.purpose}</dd></div>
        <div><dt>When</dt><dd>{module.when}</dd></div>
        <div><dt>Input</dt><dd>{module.input}</dd></div>
        <div><dt>Output</dt><dd>{module.output}</dd></div>
      </dl>
      <div className="ops-command"><code>{module.normalCommand}</code><CopyButton text={module.normalCommand} /></div>
      {module.jobId && <button type="button" className="ops-run-button" onClick={() => selectJob(module.jobId!, "jobs")}>Open registered job<ArrowRight size={14} /></button>}
    </div>
  );

  return (
    <AppLayout title="Operations">
      <div className="operations-page">
        <section className="operations-hero t-panel">
          <div><div className="t-label"><Workflow size={14} /> Home run stack · cron · dependencies · runbook</div><h1>One operating picture.</h1><p>Every recurring collector, research builder and reviewed delivery step in one registry. The scheduler runs one job at a time; production apply remains manual.</p></div>
          <div className="operations-hero-stats">
            <span className={schedulerOnline ? "ops-online" : "ops-offline"}>{local ? schedulerOnline ? "Scheduler online" : "Scheduler offline" : "Documentation mode"}</span>
            <strong>{state?.current ? "1" : "0"}</strong><span>running · {state?.queue.length ?? 0} queued</span>
            <span>{nextRun ? `next ${nextRun.slice(0, 16).replace("T", " ")} UTC` : "No cron heartbeat"}</span>
          </div>
        </section>

        {!local && <section className="operations-local-note"><ShieldCheck size={17} /><div><strong>Read-only outside the home console.</strong><span>On home, set LOCAL_WORKER_UI=1 and restart exactly one server. Cloud cannot spawn jobs or change cron.</span></div></section>}

        <section className="operations-metrics">
          <div className="t-panel"><span>Registered jobs</span><strong>{OPERATION_JOBS.length}</strong><small>Recurring, manual and blocked</small></div>
          <div className="t-panel"><span>Enabled</span><strong>{enabledCount}</strong><small>Includes dependency-triggered steps</small></div>
          <div className="t-panel"><span>GPU lanes</span><strong>1</strong><small>Tone and extraction cannot overlap</small></div>
          <div className="t-panel"><span>Production cron</span><strong>0</strong><small>Reviewed terminal apply only</small></div>
        </section>

        <div className="operations-layout">
          <aside className="operations-index t-panel">
            <div className="ops-search"><Search size={14} /><input aria-label="Search operations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a job or command" /></div>
            <div className="ops-group-list">
              {OPERATION_GROUPS.map((item) => <button type="button" key={item.id} className={group === item.id ? "active" : ""} onClick={() => setGroup(item.id)}>{item.name}<span>{item.id === "all" ? OPERATION_JOBS.length : OPERATION_JOBS.filter((job) => job.group === item.id).length}</span></button>)}
            </div>
            <div className="ops-quick-list">
              {filtered.map((job) => <button type="button" key={job.id} className={selectedJob?.id === job.id ? "active" : ""} onClick={() => selectJob(job.id)}><span>{job.name}</span><StatusBadge status={state?.lastRuns[job.id]?.status} /></button>)}
            </div>
          </aside>

          <main className="operations-main">
            <div className="operations-tabs" role="tablist" aria-label="Operations views">
              {([{ id: "stack", name: "Run stack", icon: Layers3 }, { id: "jobs", name: "Jobs & schedules", icon: CalendarClock }, { id: "runbook", name: "Runbook", icon: FileText }, { id: "activity", name: "Activity", icon: Activity }] as const).map((item) => <button type="button" role="tab" aria-selected={tab === item.id} key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><item.icon size={14} />{item.name}</button>)}
            </div>

            {tab === "stack" && (
              <section className="ops-stack">
                {(["service", "collect", "research", "review", "delivery"] as const).map((lane, index) => (
                  <div key={lane}>
                    {index > 0 && <div className="ops-stack-connector"><span /><ArrowRight size={15} /></div>}
                    <div className={`ops-stack-lane lane-${lane}`}>
                      <div className="ops-lane-label">{laneNames[lane]}<span>{OPERATION_MODULES.filter((module) => module.lane === lane).length} modules</span></div>
                      <div className="ops-stack-nodes">
                        {OPERATION_MODULES.filter((module) => module.lane === lane).map((module) => (
                          <button type="button" key={module.id} className={`ops-stack-node ${selectedModule?.id === module.id ? "active" : ""}`} onClick={() => setSelection({ kind: "module", id: module.id })}>
                            {module.lane === "service" ? <Server size={16} /> : module.lane === "collect" ? <Network size={16} /> : module.lane === "research" ? <Database size={16} /> : module.lane === "review" ? <ShieldCheck size={16} /> : <Terminal size={16} />}
                            <strong>{module.name}</strong><span>{module.purpose}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="ops-server-rule"><Server size={17} /><div><strong>Use one web server, not both.</strong><span>Production for normal operation; development only while coding. The scheduler is a separate process. MySQL and Ollama are independent services.</span></div></div>
              </section>
            )}

            {tab === "jobs" && (
              <section className="ops-job-list">
                {filtered.map((job) => (
                  <article className={`ops-job-row ${expanded === job.id ? "expanded" : ""}`} key={job.id}>
                    <button type="button" className="ops-job-summary" onClick={() => { setExpanded(expanded === job.id ? null : job.id); selectJob(job.id); }}>
                      <span className="ops-job-title"><strong>{job.name}</strong><small>{job.id}</small></span>
                      <span className="ops-job-cron">{job.cron ? config[job.id]?.cron : job.dependsOn.length ? "after parents" : "manual"}</span>
                      <ModeBadge job={job} /><StatusBadge status={state?.lastRuns[job.id]?.status} /><ChevronDown size={15} />
                    </button>
                    {expanded === job.id && jobDetails(job)}
                  </article>
                ))}
                {!filtered.length && <div className="ops-empty">No jobs match these filters.</div>}
              </section>
            )}

            {tab === "runbook" && (
              <section className="ops-runbook">
                <article className="t-panel ops-doc-section">
                  <span className="t-label">01 · Normal daily start</span><h2>One UI server plus one scheduler.</h2>
                  <ol className="ops-steps">
                    <li><strong>Use the production server for normal work.</strong><code>npm run build{`\n`}$env:NODE_ENV = "production"{`\n`}node dist/boot.js</code><CopyButton text={'npm run build\n$env:NODE_ENV = "production"\nnode dist/boot.js'} /></li>
                    <li><strong>Use dev only while coding.</strong><code>npm run dev</code><CopyButton text="npm run dev" /><p>Stop the production server first. Both use port 3000; localhost and 127.0.0.1 can otherwise lead to different processes.</p></li>
                    <li><strong>Install the single scheduler once.</strong><code>powershell -ExecutionPolicy Bypass -File worker\operations-scheduler-install.ps1 -DisableLegacyTasks{`\n`}schtasks /Run /TN AlphaEngine-Operations-Scheduler</code><CopyButton text={'powershell -ExecutionPolicy Bypass -File worker\\operations-scheduler-install.ps1 -DisableLegacyTasks\nschtasks /Run /TN AlphaEngine-Operations-Scheduler'} /><p>The installer creates one ONLOGON task, disables legacy Stocktwits/GDELT/Digest tasks when present and skips tasks that do not exist. GDELT remains frozen.</p></li>
                  </ol>
                </article>
                <article className="t-panel ops-doc-section">
                  <span className="t-label">02 · Dependency-aware daily flow</span><h2>Parents trigger children after success.</h2>
                  <div className="ops-daily-flow">{DAILY_FLOW.map((id, index) => { const job = OPERATION_JOB_MAP[id]; return <button type="button" key={id} onClick={() => selectJob(id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{job.name}</strong><small>{job.cron ? config[id]?.cron : `after ${job.dependsOn.map((parent) => OPERATION_JOB_MAP[parent].name).join(" + ")}`}</small></button>; })}</div>
                  <p>Stocktwits runs hourly at minute 30. 13F checks run Monday and Thursday. Tone, cohort extraction and legacy Cboe remain paused until explicitly enabled. Research evaluations and production apply are not cron jobs.</p>
                </article>
                <article className="t-panel ops-doc-section">
                  <span className="t-label">03 · Full registry documentation</span><h2>What runs, why, and where the data goes.</h2>
                  <div className="ops-runbook-jobs">{OPERATION_JOBS.map((job) => <details key={job.id} id={`runbook-${job.id}`}><summary><span>{job.name}</span><ModeBadge job={job} /></summary>{jobDetails(job, true)}</details>)}</div>
                </article>
              </section>
            )}

            {tab === "activity" && (
              <section className="ops-activity">
                <div className="ops-activity-heading"><div><span className="t-label">Persistent scheduler state</span><h2>Runs and logs</h2></div><button type="button" className="ops-icon-button" disabled={!local} onClick={() => operations.refetch()}><RefreshCw size={13} />Refresh</button></div>
                {state?.current && <div className="ops-current"><Activity size={16} /><strong>{OPERATION_JOB_MAP[state.current.jobId].name}</strong><span>started {state.current.startedAt.slice(0, 19).replace("T", " ")} UTC</span><button type="button" className="ops-icon-button danger" onClick={() => killOperation.mutate({ jobId: state.current!.jobId })}><Square size={12} />Stop</button></div>}
                {!!state?.queue.length && <div className="ops-queue">Queue: {state.queue.map((row) => OPERATION_JOB_MAP[row.jobId].name).join(" → ")}</div>}
                <div className="ops-run-list">{lastRuns.map((run) => <button type="button" key={run.runId} onClick={() => { setLogJob(run.jobId); selectJob(run.jobId); }}><StatusBadge status={run.status} /><strong>{OPERATION_JOB_MAP[run.jobId]?.name ?? run.jobId}</strong><span>{run.startedAt.slice(0, 19).replace("T", " ")}</span><small>{run.trigger} · exit {run.exitCode ?? "—"}</small></button>)}</div>
                {!lastRuns.length && <div className="ops-empty">No scheduler runs yet. Install/start the scheduler or use Run chain on a job.</div>}
                {logJob && <div className="ops-log"><div><strong>{OPERATION_JOB_MAP[logJob]?.name ?? logJob}</strong><button type="button" className="ops-icon-button" onClick={() => setLogJob(null)}>Close</button></div><pre>{(log.data?.lines ?? []).join("\n") || "No log lines yet."}</pre></div>}
              </section>
            )}
          </main>

          <aside className="operations-details t-panel">
            <span className="t-label">Selected detail</span>
            <h2>{selectedJob?.name ?? selectedModule?.name ?? "Select a node"}</h2>
            {selectedJob ? jobDetails(selectedJob) : selectedModule ? moduleDetails(selectedModule) : null}
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}
