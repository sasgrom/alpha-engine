/**
 * The Reference tab: how the home pipeline is started and what follows what. The flow is drawn from the job registry,
 * so it cannot drift from what the scheduler does.
 */
import { useMemo } from "react";
import { OPERATION_JOBS, type OperationJob } from "@contracts/operations";
import { Card } from "../components";
import { GROUP_LABEL, type ConsoleJob } from "./console-data";

interface FlowNode { job: OperationJob; children: FlowNode[] }

/** Every job under its first parent, so each job is drawn once; a job with several parents names the others. */
function flow(jobs: OperationJob[]): FlowNode[] {
  const nodes = new Map(jobs.map((job) => [job.id, { job, children: [] as FlowNode[] }]));
  const roots: FlowNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.job.dependsOn.map((id) => nodes.get(id)).find(Boolean);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function Branch({ node, rows, depth }: { node: FlowNode; rows: Map<string, ConsoleJob>; depth: number }) {
  const row = rows.get(node.job.id);
  const others = node.job.dependsOn.slice(1).map((id) => rows.get(id)?.job.name ?? id);
  return (
    <li>
      <span className="desk-ops-flow-row" style={{ paddingLeft: depth * 18 }}>
        <span style={{ fontWeight: depth === 0 ? 620 : 500 }}>{node.job.name}</span>
        <span className="desk-muted">
          {depth === 0 ? (row?.cron ? <code>{row.cron}</code> : node.job.mode) : "follows"}
          {others.length > 0 && ` · also after ${others.join(", ")}`}
          {row && !row.enabled && node.job.mode === "scheduled" ? " · switched off" : ""}
        </span>
      </span>
      {node.children.length > 0 && <ul>{node.children.map((child) => <Branch key={child.job.id} node={child} rows={rows} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export function Reference({ rows }: { rows: ConsoleJob[] }) {
  const byId = useMemo(() => new Map(rows.map((row) => [row.job.id, row])), [rows]);
  const scheduled = useMemo(() => OPERATION_JOBS.filter((job) => job.mode === "scheduled"), []);
  const roots = useMemo(() => flow(scheduled), [scheduled]);
  const groups = useMemo(() => {
    const out = new Map<string, FlowNode[]>();
    for (const root of roots) out.set(root.job.group, [...(out.get(root.job.group) ?? []), root]);
    return [...out];
  }, [roots]);
  const others = OPERATION_JOBS.filter((job) => job.mode !== "scheduled");

  return (
    <div className="desk-grid">
      <Card className="desk-span-12" title="How it is started" subtitle="The rules the home machine runs by">
        <ul className="desk-ops-rules">
          <li><strong>One web server</strong>, on port 3000. It starts with Windows through the task <code>AlphaEngine-Home-Server</code>; by hand: <code>wscript worker\home-server-hidden.vbs</code>.</li>
          <li><strong>One scheduler.</strong> The task <code>AlphaEngine-Operations-Scheduler</code> starts it; a lock file holds its process number, a second start exits, and a scheduler silent for ten minutes is taken over.</li>
          <li><strong>One job at a time.</strong> Jobs due together wait in one lane. A job runs after all the jobs it follows have run since its own last run.</li>
          <li><strong>Run and Stop here are requests.</strong> The scheduler reads them within 15 seconds. A run started by hand first runs the jobs before it, and never sends anything to production.</li>
          <li><strong>Nothing is pushed to production</strong> by a scheduled job (owner's decision of 13 November 2026).</li>
          <li><strong>Raw archives live on drive D.</strong> If the drive is away, a job fails and keeps its checkpoints; nothing is rebuilt on drive C.</li>
        </ul>
      </Card>

      <Card className="desk-span-12" title="What follows what" subtitle={`The ${scheduled.length} scheduled jobs: each schedule starts a chain`}>
        <div className="desk-ops-flow">
          {groups.map(([group, list]) => (
            <section key={group}>
              <h3>{GROUP_LABEL[group as keyof typeof GROUP_LABEL] ?? group}</h3>
              <ul>{list.map((root) => <Branch key={root.job.id} node={root} rows={byId} depth={0} />)}</ul>
            </section>
          ))}
        </div>
      </Card>

      <Card className="desk-span-12" flush title="Not on a schedule" subtitle={`${others.length} entries run by hand, paused, frozen, or kept as documentation`}>
        <div className="desk-table-wrap">
          <table className="desk-table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Job</th><th>State</th><th>What it is for</th></tr></thead>
            <tbody>
              {others.map((job) => (
                <tr key={job.id} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 560, whiteSpace: "nowrap" }}>{job.name}</td>
                  <td className="desk-ink-2">{job.mode === "manual" ? "by hand" : job.mode}</td>
                  <td className="desk-ink-2" style={{ whiteSpace: "normal" }}>{job.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
