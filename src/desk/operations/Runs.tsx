/**
 * The Runs tab: what the scheduler is doing now, what waits, the last run of every job, and a job's log. The log
 * follows a running job and stops asking when the job has ended or the page is hidden.
 */
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Card, Segmented, StatusLabel } from "../components";
import { fmtDateTime, readable } from "../format";
import { took, type ConsoleJob, type ConsoleState } from "./console-data";

type Shown = "all" | "failed" | "today";

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{took(since, null, now)}</>;
}

export function LogViewer({ jobId, name, running, enabled, onClose }: { jobId: string; name: string; running: boolean; enabled: boolean; onClose: () => void }) {
  const log = trpc.workersLocal.operationLog.useQuery({ jobId, lines: 300 }, { enabled, refetchInterval: running ? 3000 : false, refetchOnWindowFocus: false });
  const lines = log.data?.lines ?? [];
  return (
    <Card className="desk-span-12" title={`Log of ${name}`} subtitle={running ? "Following the running job" : "The last run, newest lines at the bottom"} action={<button type="button" className="desk-icon-button" aria-label="Close the log" onClick={onClose}><X size={16} aria-hidden="true" /></button>}>
      {!enabled ? (
        <div className="desk-empty">Logs are read through the local worker console, which is off on this server.</div>
      ) : log.isLoading ? (
        <div className="desk-empty">Reading the log…</div>
      ) : log.error ? (
        <div className="desk-empty">The log could not be read: {log.error.message}</div>
      ) : lines.filter(Boolean).length ? (
        <pre className="desk-ops-log" aria-label={`Log of ${name}`}>{lines.join("\n")}</pre>
      ) : (
        <div className="desk-empty">This run wrote no log, or its log is no longer kept.</div>
      )}
    </Card>
  );
}

export function Runs({ rows, state, canAct, logJob, openLog }: { rows: ConsoleJob[]; state: ConsoleState | undefined; canAct: boolean; logJob: string | null; openLog: (jobId: string | null) => void }) {
  const [shown, setShown] = useState<Shown>("all");
  const byId = useMemo(() => new Map(rows.map((row) => [row.job.id, row])), [rows]);
  const today = new Date().toISOString().slice(0, 10);
  const runs = useMemo(() => rows
    .filter((row) => row.last)
    .filter((row) => (shown === "failed" ? row.last!.status === "error" || row.last!.status === "killed" : shown === "today" ? (row.last!.endedAt ?? row.last!.startedAt).slice(0, 10) === today : true))
    .sort((a, b) => b.last!.startedAt.localeCompare(a.last!.startedAt)), [rows, shown, today]);
  const current = state?.current ?? null;
  const logRow = logJob ? byId.get(logJob) : undefined;

  return (
    <div className="desk-grid">
      <Card className="desk-span-12" title="Now" subtitle={state?.heartbeatAt ? `Scheduler heartbeat ${fmtDateTime(state.heartbeatAt)} · started ${fmtDateTime(state.schedulerStartedAt)}` : "No scheduler state"}>
        {current ? (
          <div className="desk-list-row">
            <span style={{ display: "grid", gap: 3 }}>
              <span style={{ fontWeight: 560 }}>{byId.get(current.jobId)?.job.name ?? current.jobId}</span>
              <span className="desk-ink-2" style={{ fontSize: 12.5 }}>started {fmtDateTime(current.startedAt)} · {current.trigger === "cron" ? "on its schedule" : current.trigger === "dependency" ? "after the job before it" : "by hand"} · running for <Elapsed since={current.startedAt} /></span>
            </span>
            <button type="button" className="desk-button" onClick={() => openLog(current.jobId)}>Follow the log</button>
          </div>
        ) : (
          <div className="desk-empty">Nothing is running.</div>
        )}
        {(state?.queue.length ?? 0) > 0 && (
          <p className="desk-ink-2" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
            <strong style={{ fontWeight: 620 }}>Waiting, in this order:</strong> {state!.queue.map((entry) => byId.get(entry.jobId)?.job.name ?? entry.jobId).join(" → ")}
          </p>
        )}
      </Card>

      {logJob && <LogViewer jobId={logJob} name={logRow?.job.name ?? logJob} running={!!logRow?.running} enabled={canAct} onClose={() => openLog(null)} />}

      <Card className="desk-span-12" flush title="Last run of each job" subtitle="Newest first" action={<Segmented<Shown> label="Runs shown" options={[{ value: "all", label: "All" }, { value: "today", label: "Today" }, { value: "failed", label: "Failed" }]} value={shown} onChange={setShown} />}>
        {runs.length ? (
          <div className="desk-table-wrap">
            <table className="desk-table" style={{ fontSize: 12.5 }}>
              <thead>
                <tr><th>Job</th><th>Started</th><th>Why</th><th className="num">Took</th><th>Result</th><th /></tr>
              </thead>
              <tbody>
                {runs.map((row) => (
                  <tr key={row.job.id} style={{ cursor: "default" }}>
                    <td>
                      <span style={{ fontWeight: 560 }}>{row.job.name}</span>
                      {row.last!.error && <span className="desk-muted" style={{ display: "block", whiteSpace: "normal", maxWidth: 520 }}>{readable(row.last!.error).slice(0, 200)}</span>}
                    </td>
                    <td className="desk-ink-2">{fmtDateTime(row.last!.startedAt)}</td>
                    <td className="desk-ink-2">{row.last!.trigger === "cron" ? "schedule" : row.last!.trigger === "dependency" ? "follows" : "by hand"}</td>
                    <td className="num desk-ink-2">{row.running ? <Elapsed since={row.last!.startedAt} /> : took(row.last!.startedAt, row.last!.endedAt)}</td>
                    <td>{row.running ? <StatusLabel status="pending" label="running" /> : <StatusLabel status={row.last!.status} label={row.last!.status === "done" ? "done" : row.last!.status === "killed" ? "stopped" : row.last!.status} />}{row.last!.exitCode !== null && row.last!.exitCode !== 0 && <span className="desk-muted"> · exit {row.last!.exitCode}</span>}</td>
                    <td style={{ textAlign: "right" }}><button type="button" className="desk-button" onClick={() => openLog(row.job.id)}>Log</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="desk-empty" style={{ padding: 20 }}>{shown === "failed" ? "No job's last run failed." : shown === "today" ? "No job has run today." : "No run is recorded yet."}</div>
        )}
      </Card>
    </div>
  );
}
