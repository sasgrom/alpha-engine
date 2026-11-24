/**
 * The Jobs tab of the operations console: every job of the registry with its schedule, last and next run, its switch,
 * Run and Stop, and on demand what it is for. The scheduler stays the only thing that starts a job: Run and Stop are
 * requests it answers, one job at a time.
 */
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Play, Search, Square } from "lucide-react";
import { Card, Segmented, StatusLabel } from "../components";
import { DeskDialog } from "../DeskDialog";
import { fmtDateTime, readable } from "../format";
import { GROUP_LABEL, attentionOrder, chainOf, cronPreview, followersOf, scheduleText, took, type ConsoleJob } from "./console-data";

type Shown = "scheduled" | "all";

export interface JobActions {
  /** False when the server keeps the worker controls off: everything is shown, nothing can be changed. */
  canAct: boolean;
  busy: boolean;
  setJob: (jobId: string, enabled: boolean, cron: string | null) => void;
  run: (jobId: string) => void;
  stop: (jobId: string) => void;
  openLog: (jobId: string) => void;
}

function CronEditor({ row, actions }: { row: ConsoleJob; actions: JobActions }) {
  const [draft, setDraft] = useState(row.cron ?? "");
  const preview = useMemo(() => cronPreview(draft, new Date()), [draft]);
  const changed = draft.trim() !== (row.cron ?? "");
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label className="desk-muted" style={{ fontSize: 12 }} htmlFor={`cron-${row.job.id}`}>Schedule (minute hour day month weekday; several separated by a semicolon)</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input id={`cron-${row.job.id}`} className="desk-input" style={{ width: 260, fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace' }} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!actions.canAct} spellCheck={false} />
        <button type="button" className="desk-button primary" disabled={!actions.canAct || actions.busy || !changed || !!preview.error} onClick={() => actions.setJob(row.job.id, row.enabled, draft.trim())}>Save schedule</button>
        {changed && <button type="button" className="desk-button" onClick={() => setDraft(row.cron ?? "")}>Reset</button>}
      </div>
      <span className={preview.error ? "desk-down" : "desk-ink-2"} style={{ fontSize: 12.5 }} role={preview.error ? "alert" : undefined}>
        {preview.error ? `Not a valid schedule: ${preview.error}` : `Next runs: ${preview.runs.map((date) => fmtDateTime(date.toISOString())).join(" · ")}`}
      </span>
    </div>
  );
}

function Details({ row, actions }: { row: ConsoleJob; actions: JobActions }) {
  const { job } = row;
  const before = chainOf(job.id).filter((item) => item.id !== job.id);
  const after = followersOf(job.id);
  const fact = (label: string, value: string) => (value ? <div><dt>{label}</dt><dd>{value}</dd></div> : null);
  return (
    <div className="desk-ops-details">
      <dl>
        {fact("What it is for", job.purpose)}
        {fact("Reads", job.input)}
        {fact("Writes", job.output)}
        {fact("Goes to", job.destination)}
        {fact("Needs", job.requirements.join(", "))}
        {fact("Notes", job.notes)}
        {fact("Runs first", before.map((item) => item.name).join(" → "))}
        {fact("Then follow", after.map((item) => item.name).join(", "))}
        <div><dt>Command</dt><dd><code>{job.command}</code></dd></div>
      </dl>
      {row.editable && job.cron !== null && <CronEditor row={row} actions={actions} />}
      {row.last?.error && <p className="desk-down" style={{ margin: 0, fontSize: 12.5, whiteSpace: "pre-wrap" }}>Last error: {readable(row.last.error).slice(0, 600)}</p>}
    </div>
  );
}

export function Jobs({ rows, actions, message }: { rows: ConsoleJob[]; actions: JobActions; message: string | null }) {
  const [shown, setShown] = useState<Shown>("scheduled");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "run" | "stop"; row: ConsoleJob } | null>(null);
  const needle = find.trim().toLowerCase();
  const visible = useMemo(() => rows
    .filter((row) => (shown === "all" ? true : row.job.mode === "scheduled" && row.enabled) || row.running || row.queued)
    .filter((row) => !needle || `${row.job.name} ${row.job.id} ${row.job.group}`.toLowerCase().includes(needle))
    .sort(attentionOrder), [rows, shown, needle]);
  const groups = useMemo(() => {
    const failed = visible.filter((row) => row.last?.status === "error" || row.last?.status === "killed");
    const rest = visible.filter((row) => !failed.includes(row));
    const byGroup = new Map<string, ConsoleJob[]>();
    for (const row of rest) byGroup.set(row.job.group, [...(byGroup.get(row.job.group) ?? []), row]);
    return [...(failed.length ? [{ title: "Needs a look", rows: failed }] : []), ...[...byGroup].map(([group, list]) => ({ title: GROUP_LABEL[group as keyof typeof GROUP_LABEL] ?? group, rows: list }))];
  }, [visible]);
  const counts = { enabled: rows.filter((row) => row.job.mode === "scheduled" && row.enabled).length, all: rows.length };

  return (
    <>
      <div className="desk-controls" style={{ marginBottom: 12 }}>
        <Segmented<Shown> label="Jobs shown" options={[{ value: "scheduled", label: `Scheduled (${counts.enabled})` }, { value: "all", label: `All (${counts.all})` }]} value={shown} onChange={setShown} />
        <label className="desk-search" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Search size={14} aria-hidden="true" />
          <input className="desk-input" style={{ width: 220 }} placeholder="Find a job" aria-label="Find a job" value={find} onChange={(event) => setFind(event.target.value)} />
        </label>
        {message && <span className="desk-ink-2" style={{ fontSize: 12.5 }} role="status">{message}</span>}
      </div>
      {!actions.canAct && <p className="desk-muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>The controls are off on this server (the local worker console is not enabled), so jobs can be read here but not changed.</p>}

      {groups.length === 0 && <div className="desk-card desk-empty">No job matches.</div>}
      <div className="desk-grid">
      {groups.map((group) => (
        <Card key={group.title} className="desk-span-12" flush title={group.title} subtitle={`${group.rows.length} job${group.rows.length === 1 ? "" : "s"}`}>
          <div className="desk-table-wrap">
            <table className="desk-table desk-ops-jobs" style={{ fontSize: 12.5 }}>
              <thead>
                <tr><th>Job</th><th>Schedule</th><th>Last run</th><th className="num">Took</th><th>Next run</th><th>On</th><th /></tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const expanded = open === row.job.id;
                  return (
                    <Fragment key={row.job.id}>
                      <tr style={{ cursor: "default" }}>
                        <td>
                          <button type="button" className="desk-ops-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.job.id)}>
                            {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                            <span style={{ fontWeight: 560 }}>{row.job.name}</span>
                          </button>
                          {row.last?.error && !expanded && <span className="desk-muted" style={{ display: "block", whiteSpace: "normal", maxWidth: 420, paddingLeft: 20 }}>{readable(row.last.error).slice(0, 140)}</span>}
                        </td>
                        <td className="desk-ink-2" style={{ whiteSpace: "normal", maxWidth: 260 }}>{row.cron && row.job.mode !== "manual" ? <code>{row.cron}</code> : scheduleText(row)}</td>
                        <td>
                          {row.running ? <StatusLabel status="pending" label="running" /> : row.queued ? <StatusLabel status="pending" label="queued" /> : row.last ? <StatusLabel status={row.last.status} label={row.last.status} /> : <span className="desk-muted">not run yet</span>}
                          {row.last && !row.running && <span className="desk-muted" style={{ display: "block" }}>{fmtDateTime(row.last.endedAt ?? row.last.startedAt)}</span>}
                        </td>
                        <td className="num desk-ink-2">{row.last ? took(row.last.startedAt, row.last.endedAt) : "—"}</td>
                        <td className="desk-ink-2">{row.job.mode === "scheduled" && row.enabled ? fmtDateTime(row.next) : "—"}</td>
                        <td>
                          {row.editable ? (
                            <label className="desk-check" title={row.enabled ? "The scheduler runs this job" : "Switched off"}>
                              <input type="checkbox" checked={row.enabled} disabled={!actions.canAct || actions.busy} aria-label={`${row.job.name}: scheduled`} onChange={(event) => actions.setJob(row.job.id, event.target.checked, row.cron)} />
                            </label>
                          ) : <span className="desk-muted">{row.job.mode}</span>}
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                          {row.last && <button type="button" className="desk-button" style={{ marginRight: 6 }} onClick={() => actions.openLog(row.job.id)}>Log</button>}
                          {row.running ? (
                            <button type="button" className="desk-button" disabled={!actions.canAct || actions.busy} onClick={() => setConfirm({ kind: "stop", row })}><Square size={12} aria-hidden="true" /> Stop</button>
                          ) : (
                            <button type="button" className="desk-button" disabled={!actions.canAct || actions.busy || !row.runnable || row.queued} title={row.runnable ? undefined : "This entry is documentation only, frozen, or needs a review at the terminal"} onClick={() => setConfirm({ kind: "run", row })}><Play size={12} aria-hidden="true" /> Run</button>
                          )}
                        </td>
                      </tr>
                      {expanded && <tr className="desk-ops-open"><td colSpan={7}><Details row={row} actions={actions} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      </div>

      {confirm && (
        <DeskDialog title={confirm.kind === "run" ? `Run ${confirm.row.job.name}?` : `Stop ${confirm.row.job.name}?`} onClose={() => setConfirm(null)}>
          {confirm.kind === "run" ? (
            <div style={{ display: "grid", gap: 10, fontSize: 13.5 }}>
              <p style={{ margin: 0 }}>The scheduler takes the request into its one lane; a job that is running finishes first.</p>
              <p style={{ margin: 0 }}><strong>It runs, in this order:</strong> {chainOf(confirm.row.job.id).map((job) => job.name).join(" → ")}.</p>
              {followersOf(confirm.row.job.id).length > 0 && <p style={{ margin: 0 }}><strong>When it ends well, these follow:</strong> {followersOf(confirm.row.job.id).map((job) => job.name).join(", ")}.</p>}
              <p className="desk-muted" style={{ margin: 0, fontSize: 12.5 }}>A run started here never sends anything to production.</p>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13.5 }}>The scheduler ends the running process. The run is recorded as stopped, its partial output stays where it is, and the jobs that follow it do not run.</p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className="desk-button" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="desk-button primary" onClick={() => { (confirm.kind === "run" ? actions.run : actions.stop)(confirm.row.job.id); setConfirm(null); }}>{confirm.kind === "run" ? "Run it" : "Stop it"}</button>
          </div>
        </DeskDialog>
      )}
    </>
  );
}
