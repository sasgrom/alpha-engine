import { useState } from "react";
import { describeJob } from "@/lib/job-describe";
import { trpc } from "@/providers/trpc";
import { Card, Notice, Shimmer, StatusLabel } from "../components";

export default function Logs() {
  const jobs = trpc.admin.recentJobs.useQuery(undefined, { retry: false });
  const [jobId, setJobId] = useState<number | null>(null);
  const log = trpc.admin.jobLog.useQuery({ jobId: jobId ?? 0 }, { enabled: jobId !== null, retry: false });
  return (
    <div className="desk-log-layout">
      <Card flush title="Recent jobs" subtitle="Jobs across all accounts.">
        <div className="desk-job-list">
          {jobs.isLoading && <Shimmer height={250} />}
          {jobs.error && <Notice title="Jobs could not be loaded">{jobs.error.message}</Notice>}
          {jobs.data?.length === 0 && <div className="desk-empty">No jobs yet.</div>}
          {(jobs.data ?? []).map((job) => (
            <button key={job.id} type="button" className={jobId === job.id ? "selected" : ""} onClick={() => setJobId(job.id)}>
              <span><strong>#{job.id} {job.type}</strong><StatusLabel status={job.status} label={job.status} /></span>
              <small>{describeJob(job.type, job.params) || "No parameters"}</small>
              <small>{job.startedByName ?? (job.startedBy ? `Account ${job.startedBy}` : "Legacy")} · {String(job.createdAt).slice(0, 19).replace("T", " ")}</small>
            </button>
          ))}
        </div>
      </Card>
      <Card flush title={jobId === null ? "Job log" : `Job #${jobId}`} subtitle="Chronological log lines, up to 2,000.">
        <div className="desk-log-lines">
          {jobId === null && <div className="desk-empty">Select a job to read its log.</div>}
          {log.isLoading && <Shimmer height={250} />}
          {log.error && <Notice title="The log could not be loaded">{log.error.message}</Notice>}
          {log.data?.truncated && <p className="desk-warning">The log is truncated to the first 2,000 lines.</p>}
          {log.data?.lines.map((line) => <div key={line.id}><span className="desk-muted">{String(line.ts).slice(11, 19)} </span><span className={line.level === "error" ? "desk-form-error" : line.level === "warn" ? "desk-warning" : ""}>[{line.level}]</span> {line.message}</div>)}
          {jobId !== null && log.data?.lines.length === 0 && <div className="desk-empty">No log lines for this job.</div>}
        </div>
      </Card>
    </div>
  );
}
