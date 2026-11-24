import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, Notice, Shimmer } from "../components";
import { DeskDialog } from "../DeskDialog";

interface WorkerNote {
  cik: number;
  ticker: string | null;
  source: string;
  signalType: string;
  eventTs: string;
  ingestedAt: string;
  score: number | null;
  magnitude: number | null;
  src: string;
  note: string | null;
  payloadKey: string;
}

function filingUrl(payloadKey: string): string | null {
  const parts = payloadKey.split(":");
  if (parts[2] !== "edgar" || !parts[3] || !parts[4]) return null;
  return `https://www.sec.gov/Archives/edgar/data/${parts[3]}/${parts[4].replace(/-/g, "")}/`;
}

const timeText = (value: unknown) => value ? String(value).slice(0, 19).replace("T", " ") : "—";

export default function Monitors() {
  // The factor IC monitor went with the nightly factor materialization (2026-11-24): the old factor engine never
  // passed an out-of-sample test, and its table is no longer refreshed.
  const intake = trpc.workersMonitor.intake.useQuery(undefined, { retry: false, refetchInterval: 60_000, refetchIntervalInBackground: false });
  const [note, setNote] = useState<WorkerNote | null>(null);
  const perSource = intake.data?.perSource ?? [];
  const keys = intake.data?.keys ?? [];
  const recent = (intake.data?.recent ?? []) as unknown as WorkerNote[];

  return (
    <>
      <Card flush title="Workers intake" subtitle="What the home workers delivered. Event time is upstream publication; received time is delivery into the signals table.">
        {intake.isLoading && <Shimmer height={180} />}
        {intake.error && <Notice title="Worker intake could not be loaded">{intake.error.message}</Notice>}
        <h3 className="desk-section-title">By source</h3>
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead><tr><th>Source</th><th className="num">Rows</th><th className="num">Live</th><th className="num">Backfill</th><th>Last event</th><th>Last received</th></tr></thead>
            <tbody>{perSource.map((source) => <tr key={source.source}><td>{source.source}</td><td className="num">{Number(source.rows_total)}</td><td className="num">{Number(source.liveRows ?? 0)}</td><td className="num">{Number(source.backfillRows ?? 0)}</td><td>{timeText(source.lastEventTs)}</td><td>{timeText(source.lastIngestedAt)}</td></tr>)}</tbody>
          </table>
          {!intake.isLoading && perSource.length === 0 && <div className="desk-empty">No worker data received yet.</div>}
        </div>
        <h3 className="desk-section-title">Worker keys</h3>
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead><tr><th>Key</th><th>Status</th><th>Last used</th><th>Created</th></tr></thead>
            <tbody>{keys.map((key) => <tr key={key.id}><td>{key.label}</td><td><span className="desk-badge">{key.revokedAt ? "Revoked" : "Active"}</span></td><td>{timeText(key.lastUsedAt)}</td><td>{timeText(key.createdAt)}</td></tr>)}</tbody>
          </table>
          {!intake.isLoading && keys.length === 0 && <div className="desk-empty">No worker keys.</div>}
        </div>
        <h3 className="desk-section-title">Latest signals</h3>
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead><tr><th>Company</th><th>Source</th><th>Signal</th><th>Event</th><th className="num">Score</th><th className="num">Magnitude</th><th>Origin</th><th>Note</th></tr></thead>
            <tbody>{recent.slice(0, 12).map((row, index) => <tr key={`${row.payloadKey}-${index}`}><td>{row.ticker ?? row.cik}</td><td>{row.source}</td><td>{row.signalType}</td><td>{timeText(row.eventTs)}</td><td className="num">{row.score?.toFixed(2) ?? "—"}</td><td className="num">{row.magnitude ?? "—"}</td><td>{row.src}</td><td>{row.note ? <button type="button" className="desk-button" onClick={() => setNote(row)}>Open note</button> : "—"}</td></tr>)}</tbody>
          </table>
          {!intake.isLoading && recent.length === 0 && <div className="desk-empty">No recent worker signals.</div>}
        </div>
      </Card>
      {note && (
        <DeskDialog title={`${note.ticker ?? note.cik} · ${note.source} · ${note.signalType}`} onClose={() => setNote(null)}>
          <p className="desk-muted">Event {timeText(note.eventTs)} · received {timeText(note.ingestedAt)} · {note.src}</p>
          <div className="desk-note-body">{note.note}</div>
          {filingUrl(note.payloadKey) && <a className="desk-link" href={filingUrl(note.payloadKey)!} target="_blank" rel="noreferrer">Source filing on SEC EDGAR</a>}
          <code className="desk-payload-key">{note.payloadKey}</code>
        </DeskDialog>
      )}
    </>
  );
}
