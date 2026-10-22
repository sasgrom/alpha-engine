/**
 * WorkersIntakeCard (4p) — owner verification surface: what the home workers
 * actually delivered into the signals table, and which worker keys are alive.
 * Rendered on /admin (full width); prod and home copy behave identically.
 *
 * Time honesty: the DB stores UTC everywhere; this card renders in the
 * viewer's LOCAL time (tz abbreviation shown) so "when did it happen" reads
 * naturally, while the UTC column stays available in the title tooltip.
 */
import { trpc } from "@/providers/trpc";
import { Satellite } from "lucide-react";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TZ_ABBR = new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop();

/** "2026-10-22 04:28:25" (UTC string) → local "10/21 21:28" */
function toLocal(utc: unknown): string {
  if (!utc) return "—";
  const d = new Date(String(utc).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return String(utc);
  return d.toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

const TH = "border border-border/60 bg-muted/40 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground";
const TD = "border border-border/40 px-3 py-1.5";

export function WorkersIntakeCard() {
  const q = trpc.workersMonitor.intake.useQuery(undefined, { retry: false, refetchInterval: 60000 });
  if (q.isError) return null; // admin page already shows the FORBIDDEN screen
  const d = q.data;
  return (
    <div className="panel p-4 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <Satellite size={14} className="text-live-cyan" />
        <span className="t-mono text-[12px] font-semibold">Workers intake — signals delivery</span>
        <span className="t-mono text-[10px] text-muted-foreground ml-auto">times shown in {TZ} ({TZ_ABBR}); DB stores UTC</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        <b>event</b> = when the content was published upstream (Stocktwits post time / GDELT bucket);{" "}
        <b>received</b> = when the row reached prod (delivery lag = event → received);{" "}
        <b>mag</b> = sample size behind the row (messages fetched / articles counted);{" "}
        <b>score</b> = (bullish − bearish) / labeled, −1…+1; <b>src</b> = live stream vs backfill history.
      </p>

      {/* per-source summary */}
      <table className="w-full border-collapse t-mono text-[12px] mb-4">
        <thead>
          <tr>
            <th className={TH}>source</th><th className={TH}>rows total</th><th className={TH}>live</th>
            <th className={TH}>backfill</th><th className={TH}>last event</th><th className={TH}>last received</th>
          </tr>
        </thead>
        <tbody>
          {(d?.perSource ?? []).map((s: any) => (
            <tr key={s.source}>
              <td className={TD}>{s.source}</td>
              <td className={TD}>{String(s.rows_total)}</td>
              <td className={TD}>{String(s.liveRows ?? 0)}</td>
              <td className={TD}>{String(s.backfillRows ?? 0)}</td>
              <td className={TD} title={`UTC ${s.lastEventTs}`}>{toLocal(s.lastEventTs)}</td>
              <td className={TD} title={`UTC ${s.lastIngestedAt}`}>{toLocal(s.lastIngestedAt)}</td>
            </tr>
          ))}
          {d && d.perSource.length === 0 && (
            <tr><td className={TD} colSpan={6}><span className="text-muted-foreground">no worker data received yet</span></td></tr>
          )}
        </tbody>
      </table>

      {/* worker keys */}
      <table className="w-full border-collapse t-mono text-[12px] mb-4">
        <thead>
          <tr><th className={TH}>worker key</th><th className={TH}>status</th><th className={TH}>last used</th><th className={TH}>created</th></tr>
        </thead>
        <tbody>
          {(d?.keys ?? []).map((k: any) => (
            <tr key={k.id}>
              <td className={TD}>{k.label}</td>
              <td className={`${TD} ${k.revokedAt ? "text-crit-red" : "text-emerald-400"}`}>{k.revokedAt ? "revoked" : "active"}</td>
              <td className={TD} title={k.lastUsedAt ? `UTC ${k.lastUsedAt}` : ""}>{k.lastUsedAt ? toLocal(k.lastUsedAt) : "never"}</td>
              <td className={TD} title={`UTC ${k.createdAt}`}>{toLocal(k.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* latest rows */}
      <table className="w-full border-collapse t-mono text-[12px]">
        <thead>
          <tr>
            <th className={TH}>ticker</th><th className={TH}>source</th><th className={TH}>signal</th>
            <th className={TH}>event (local)</th><th className={TH}>score</th><th className={TH}>mag</th><th className={TH}>src</th><th className={TH}>why (model note)</th>
          </tr>
        </thead>
        <tbody>
          {(d?.recent ?? []).slice(0, 15).map((r: any, i: number) => (
            <tr key={i}>
              <td className={TD}>{r.ticker ?? r.cik}</td>
              <td className={`${TD} text-muted-foreground`}>{r.source}</td>
              <td className={TD}>{r.signalType}</td>
              <td className={`${TD} text-muted-foreground`} title={`UTC ${r.eventTs}`}>{toLocal(r.eventTs)}</td>
              <td className={`${TD} ${r.score === null ? "text-muted-foreground" : Number(r.score) >= 0 ? "text-emerald-400" : "text-crit-red"}`}>
                {r.score === null ? "—" : Number(r.score).toFixed(2)}
              </td>
              <td className={TD}>{r.magnitude === null ? "—" : Number(r.magnitude)}</td>
              <td className={`${TD} text-muted-foreground`}>{r.src}</td>
              <td className={`${TD} max-w-[380px] truncate text-muted-foreground`} title={r.note ?? undefined}>{r.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
