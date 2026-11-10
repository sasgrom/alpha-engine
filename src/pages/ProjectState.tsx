import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Activity, AlertTriangle, ArrowRight, BookOpen, CheckCircle2, CircleDashed, CloudOff, Database, RefreshCw, Workflow } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { PROJECT_STATE_REVIEW, type ProjectPhaseStatus } from "@/data/project-state";
import type { DailyOperationsReport } from "../../worker/lib/daily-operations-report";

const timeText = (value: string | null | undefined) => value ? `${value.slice(0, 19).replace("T", " ")} UTC` : "—";
const jobName = (jobId: string | null | undefined) => jobId || "No active job";

type LoadState = "loading" | "ready" | "missing" | "error";
type RunView = { status: string; startedAt: string; endedAt: string | null; trigger: string; error: string | null } | null;

function StatePill({ status, children }: { status: ProjectPhaseStatus | "running" | "done" | "error" | "warning"; children: ReactNode }) {
  return <span className={`project-state-pill ${status}`}>{children}</span>;
}

function PhaseRail({ collection, finalEvidence }: { collection: ProjectPhaseStatus; finalEvidence: ProjectPhaseStatus }) {
  const phases: { label: string; status: ProjectPhaseStatus }[] = [
    { label: "Code", status: "done" },
    { label: "Smoke", status: "done" },
    { label: "Scheduler", status: "done" },
    { label: "Backfill", status: collection },
    { label: "Evidence", status: finalEvidence },
  ];
  return (
    <ol className="project-phase-rail" aria-label="Approximate S&P 500 block phases">
      {phases.map((phase, index) => (
        <li key={phase.label} className={phase.status}>
          <span className="project-phase-index">0{index + 1}</span>
          <strong>{phase.label}</strong>
          <small>{phase.status}</small>
        </li>
      ))}
    </ol>
  );
}

function Lane({ label, status, title, children }: { label: string; status: ProjectPhaseStatus; title: string; children: ReactNode }) {
  return (
    <article className="project-lane-row">
      <span className="project-lane-label">{label}</span>
      <div><StatePill status={status}>{status}</StatePill></div>
      <div className="project-lane-copy"><strong>{title}</strong><p>{children}</p></div>
    </article>
  );
}

export default function ProjectState() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const localEnabled = trpc.workersLocal.enabled.useQuery(undefined, { enabled: isAdmin, retry: false });
  const local = localEnabled.data?.enabled === true;
  const operations = trpc.workersLocal.operations.useQuery(undefined, { enabled: local, refetchInterval: 15_000, retry: false });
  const liveState = operations.data?.state;
  const [report, setReport] = useState<DailyOperationsReport | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/reports/daily-operations.json", { cache: "no-store" });
      if (response.status === 404) { setReport(null); setLoadState("missing"); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json() as DailyOperationsReport;
      if (value.schemaVersion !== 1 || !Array.isArray(value.jobs)) throw new Error("Unsupported report schema");
      setReport(value);
      setLoadState("ready");
    } catch { setReport(null); setLoadState("error"); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const reportRun = (jobId: string): RunView => report?.jobs.find((job) => job.jobId === jobId)?.lastRun ?? null;
  const liveRun = (jobId: string): RunView => liveState?.lastRuns[jobId] ?? null;
  const run = (jobId: string): RunView => liveRun(jobId) ?? reportRun(jobId);
  const sp500Run = run("sp500-facts-daily");
  const sp500Running = liveState?.current?.jobId === "sp500-facts-daily" || (!liveState && report?.scheduler?.currentJobId === "sp500-facts-daily");
  const sp500Status = sp500Running ? "running" : sp500Run?.status ?? "unknown";
  const finalEvidenceReady = Boolean(PROJECT_STATE_REVIEW.implementation.sp500FinalEvidenceCommit);
  const mappingVerified = Boolean(PROJECT_STATE_REVIEW.implementation.sp500CikMappingsVerifiedOn);
  const sp500DisplayStatus = sp500Status === "error" && finalEvidenceReady ? (mappingVerified ? "remediated" : "completed_with_failures") : sp500Status;
  const sp500PillTone = sp500DisplayStatus === "running" ? "running" : ["done", "remediated"].includes(sp500DisplayStatus) ? "done" : sp500DisplayStatus === "completed_with_failures" ? "warning" : sp500DisplayStatus === "unknown" ? "unknown" : "error";
  const collectionPhase: ProjectPhaseStatus = finalEvidenceReady || sp500Status === "done" ? "done" : ["error", "killed"].includes(sp500Status) ? "attention" : sp500Status === "running" ? "current" : "unknown";
  const evidenceMode = liveState ? "home scheduler" : report ? "dated Daily Operations" : "reviewed snapshot";
  const sp500Health = report?.facts?.sp500;
  const activeJob = liveState?.current?.jobId ?? report?.scheduler?.currentJobId ?? null;
  const queuedJobs = liveState?.queue.length ?? report?.scheduler?.queuedJobs ?? null;
  const macroEvent = report?.checks?.find((check) => check.id === "macro-event-study-lineage");
  const macroAtlas = report?.checks?.find((check) => check.id === "macro-atlas-lineage");

  return (
    <AppLayout title="Project State">
      <div className="project-state-page">
        <header className="project-state-header">
          <div>
            <span className="t-label"><Workflow size={14} /> Project state · read-only workflow</span>
            <h1>One project. Four different kinds of progress.</h1>
            <p>Code can be finished while collection is still running and research evidence is stale. These states are deliberately separated.</p>
          </div>
          <div className="project-evidence-source">
            <span>{evidenceMode}</span>
            <small>{liveState ? `Heartbeat ${timeText(liveState.heartbeatAt)}` : report ? `Report ${timeText(report.generatedAt)}` : `Reviewed ${PROJECT_STATE_REVIEW.reviewedOn}`}</small>
            <button type="button" className="ops-icon-button" onClick={() => void load()}><RefreshCw size={13} />Refresh report</button>
          </div>
        </header>

        <section className="project-system-flow" aria-label="Reviewed-only data workflow">
          {[
            ["01", "External sources", "SEC · Schwab · FRED · OFAC"],
            ["02", "Home collection", "Raw archive + local MySQL"],
            ["03", "Evidence & QA", "Availability · vintages · coverage"],
            ["04", "Owner review", "Local research and dry-runs"],
            ["05", "Production", "Separate reviewed decision only"],
          ].map(([index, title, copy], position) => (
            <div key={index} className={position === 4 ? "review-gate" : ""}>
              <span>{index}</span><strong>{title}</strong><small>{copy}</small>
              {position < 4 && <ArrowRight size={14} aria-hidden="true" />}
            </div>
          ))}
        </section>

        <section className="project-current-block">
          <div className="project-section-heading">
            <div><span className="t-label">{finalEvidenceReady ? "Latest collection block" : "Current implementation block"}</span><h2>S&P 500 incremental companyfacts</h2></div>
            <StatePill status={sp500PillTone}>{sp500DisplayStatus}</StatePill>
          </div>
          <p className="project-current-lead">
            {sp500Status === "running" && "Collection is running in the single home scheduler. The code commit does not mean the backfill is complete."}
            {sp500Status === "error" && finalEvidenceReady && mappingVerified && "The initial backfill processed all 499 CIKs. Six HTTP 404 failures were traced to incorrect ticker/CIK mappings and corrected against the official SEC directory; the next daily run will collect the corrected CIKs."}
            {sp500Status === "error" && finalEvidenceReady && !mappingVerified && "The initial backfill processed all 499 CIKs with six failed CIKs. Final evidence is published; the failures remain separate from task completion."}
            {sp500Status === "done" && "The latest registered collection run completed. Missing and failed CIKs remain separate coverage findings, not a hidden success percentage."}
            {["error", "killed"].includes(sp500Status) && !finalEvidenceReady && "The latest registered run needs attention. Do not start a duplicate collector; inspect its log and manifest first."}
            {sp500Status === "killed" && "The latest registered run was killed. Do not start a duplicate collector; inspect its log and manifest first."}
            {sp500Status === "unknown" && "Implementation is committed, but this view cannot verify the live collection state. No completion is inferred."}
          </p>
          <PhaseRail collection={collectionPhase} finalEvidence={finalEvidenceReady ? "done" : "current"} />
          <div className="project-current-facts">
            <div><span>Scope</span><strong>499 unique CIKs</strong><small>Current collection snapshot, not historical index membership</small></div>
            <div><span>Schedule</span><strong>23:30 home local</strong><small>Independent of the research-50 dependency chain</small></div>
            <div><span>Manifest evidence</span><strong>{sp500Health ? `${sp500Health.refreshed + sp500Health.unchanged + sp500Health.failed} entries` : "Unavailable"}</strong><small>{sp500Health ? `${sp500Health.refreshed} refreshed · ${sp500Health.unchanged} unchanged · ${sp500Health.failed} failed · ${sp500Health.missing} missing${mappingVerified ? " · six ticker/CIK mappings corrected for the next daily run" : ""}` : "Build Daily Operations after the run"}</small></div>
            <div><span>Scheduler now</span><strong>{jobName(activeJob)}</strong><small>{queuedJobs === null ? "Queue unavailable" : `${queuedJobs} queued · no duplicate run inferred`}</small></div>
          </div>
        </section>

        <section className="project-state-section">
          <div className="project-section-heading"><div><span className="t-label">Orientation</span><h2>Where the project stands</h2></div></div>
          <div className="project-lanes">
            <Lane label="01 · Code" status="done" title="Correctness, fiscal forms, documents and Scenario Lab are complete">
              S&P 500 collection code and real smoke are confirmed. Completed implementation still does not prove fresh historical evidence or model validity.
            </Lane>
            <Lane label="02 · Data" status={sp500Status === "running" ? "current" : sp500Status === "unknown" ? "unknown" : "done"} title="Home collection and scoring stay local">
              SEC companyfacts, Schwab, FRED and OFAC update different artifacts on different schedules. Each row below has its own evidence time.
            </Lane>
            <Lane label="03 · Research" status="attention" title="Research-50 and Scenario Lab are materialized; Atlas and IC are not promoted">
              {PROJECT_STATE_REVIEW.research.factorCoverage} · {PROJECT_STATE_REVIEW.research.factorPoints.toLocaleString("en-US")} factor points. {PROJECT_STATE_REVIEW.research.ic}.
            </Lane>
            <Lane label="04 · Delivery" status="pending" title="Production remains a separate owner decision">
              No automatic direct-to-production collection, apply, deploy or factor/model/regime promotion is implied by this page.
            </Lane>
          </div>
        </section>

        <section className="project-state-section">
          <div className="project-section-heading"><div><span className="t-label"><Database size={14} /> Data and evidence</span><h2>What is downloading or updating</h2></div></div>
          <div className="project-data-table" role="table" aria-label="Current data workflows">
            <div className="project-data-header" role="row"><span>Workflow</span><span>Evidence</span><span>Destination</span><span>Current meaning</span></div>
            <div className="project-data-row" role="row">
              <strong>S&P 500 companyfacts</strong><span>{sp500Status}{sp500Health ? ` · ${sp500Health.missing} missing` : ""}</span><span>Raw cache + local MySQL</span><p>{mappingVerified ? "The six historical 404s were CIK mapping errors, now corrected. " : ""}Collection only. Research-51, IC, Atlas and production are not expanded automatically.</p>
            </div>
            <div className="project-data-row" role="row">
              <strong>Research-51 companyfacts</strong><span>{run("facts-fetch-daily")?.status ?? "unknown"}</span><span>Local MySQL → Series → Factors</span><p>Independent 03:00 home-local chain; its coverage remains 51/51.</p>
            </div>
            <div className="project-data-row" role="row">
              <strong>Schwab options and context</strong><span>{report?.schwab ? `${report.schwab.tickersCapturedToday}/${report.schwab.tickersExpected} today` : "No dated report"}</span><span>Local snapshots + Feature Lab</span><p>{report?.schwab ? `${report.schwab.contracts.toLocaleString("en-US")} contracts · latest capture ${timeText(report.schwab.latestCapture)}` : "Live coverage is not inferred."}</p>
            </div>
            <div className="project-data-row" role="row">
              <strong>FRED + OFAC</strong><span>{report?.macro?.qaStatus ? `QA ${report.macro.qaStatus}` : "No dated report"}</span><span>Local macro archive</span><p>{report?.macro ? `FRED ${timeText(report.macro.fredGeneratedAt)} · OFAC ${timeText(report.macro.ofacGeneratedAt)}` : "Availability and vintage QA are required before derived research."}</p>
            </div>
            <div className="project-data-row" role="row">
              <strong>Fund Flows + Revenue draft</strong><span>3D restored · protocol draft</span><span>Reviewer presentation</span><p>{PROJECT_STATE_REVIEW.research.revenuePilot}. Fund flows include a searchable evidence table and a no-WebGL fallback; the Revenue target remains unselected.</p>
            </div>
            <div className="project-data-row" role="row">
              <strong>Fundamentals Data QA</strong><span>Partial · active anchors clean</span><span>Research exclusions</span><p>{PROJECT_STATE_REVIEW.research.fundamentalsReadiness}. This is a data-quality gate, not IC, OLS or probability-model promotion.</p>
            </div>
            <div className="project-data-row" role="row">
              <strong>EDGAR tone</strong><span>50/50 companies · post-check pass</span><span>Reviewed production signals</span><p>{PROJECT_STATE_REVIEW.research.edgarTone}. Legacy rows outside the reviewed package and all other signal sources were preserved.</p>
            </div>
            <div className="project-data-row" role="row">
              <strong>Scenario Lab</strong><span>50 companies · reviewed</span><span>Production presentation</span><p>{PROJECT_STATE_REVIEW.research.scenarioLab}. Upper bounds are not earnings forecasts; new issuance, Event Study, Atlas and Bayes were not rebuilt.</p>
            </div>
            <div className="project-data-row" role="row">
              <strong>Event Study + Atlas</strong><span>{macroAtlas?.status ?? macroEvent?.status ?? "unknown"}</span><span>Local research artifacts</span><p>{macroAtlas?.detail ?? PROJECT_STATE_REVIEW.research.atlas} {macroEvent ? `Event Study: ${macroEvent.detail}` : ""}</p>
            </div>
          </div>
        </section>

        <div className="project-bottom-grid">
          <section className="project-state-section">
            <div className="project-section-heading"><div><span className="t-label">Queue</span><h2>What comes next</h2></div></div>
            <ol className="project-next-list">
              {PROJECT_STATE_REVIEW.nextQueue.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}
            </ol>
          </section>
          <section className="project-state-section project-owner-gates">
            <div className="project-section-heading"><div><span className="t-label"><CloudOff size={14} /> Owner gates</span><h2>What is not authorized</h2></div></div>
            <ul>
              <li>Production apply, deploy or sync.</li>
              <li>Automatic expansion of the full S&P 500 into research.</li>
              <li>Historical 13F/macro/exposure rebuilds without review.</li>
              <li>Factor, model or regime promotion from changed IC alone.</li>
            </ul>
            <nav><Link to="/workers">Open Operations <ArrowRight size={13} /></Link><Link to="/wiki">Open manuals <BookOpen size={13} /></Link></nav>
          </section>
        </div>

        <footer className="project-state-footer">
          {loadState === "error" ? <AlertTriangle size={14} /> : loadState === "ready" ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
          <span>{liveState ? "Live scheduler evidence is active on the home console." : "Live home scheduler state is unavailable here; dated report and reviewed snapshot only."}</span>
          {report && <span>Daily health: {report.status} · {report.summary?.checksError ?? 0} errors · {report.summary?.checksWarning ?? 0} warnings · {report.summary?.checksPending ?? 0} pending.</span>}
          {!report && <Activity size={14} />}
        </footer>
      </div>
    </AppLayout>
  );
}
