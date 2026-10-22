/**
 * WorkersIntakeCard (4p) — owner verification surface: what the home workers
 * actually delivered into the signals table, and which worker keys are alive.
 * Rendered on /admin; works identically on prod and the home copy.
 */
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Satellite } from "lucide-react";

export function WorkersIntakeCard() {
  const q = trpc.workersMonitor.intake.useQuery(undefined, { retry: false, refetchInterval: 60000 });
  if (q.isError) return null; // admin page already shows the FORBIDDEN screen
  const d = q.data;
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Satellite size={14} className="text-live-cyan" /> Workers intake — signals delivery
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-[12px] font-mono">
        <div>
          {(d?.perSource ?? []).map((s: any) => (
            <div key={s.source} className="flex justify-between gap-3 border-b border-border/40 py-1 flex-wrap">
              <span className="w-24">{s.source}</span>
              <span>{String(s.rows_total)} rows ({String(s.liveRows ?? 0)} live / {String(s.backfillRows ?? 0)} backfill)</span>
              <span className="text-muted-foreground">last event {String(s.lastEventTs ?? "—")}</span>
              <span className="text-muted-foreground">last received {String(s.lastIngestedAt ?? "—")}</span>
            </div>
          ))}
          {d && d.perSource.length === 0 && <p className="text-muted-foreground">no worker data received yet</p>}
        </div>
        <div>
          <div className="text-muted-foreground mb-1">worker keys</div>
          {(d?.keys ?? []).map((k: any) => (
            <div key={k.id} className="flex justify-between gap-3 border-b border-border/40 py-1">
              <span>{k.label}</span>
              <span className={k.revokedAt ? "text-crit-red" : "text-emerald-400"}>{k.revokedAt ? "revoked" : "active"}</span>
              <span className="text-muted-foreground">last used {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="text-muted-foreground mb-1">latest 10 rows</div>
          {(d?.recent ?? []).slice(0, 10).map((r: any, i: number) => (
            <div key={i} className="flex gap-2 border-b border-border/30 py-0.5 flex-wrap text-[11px]">
              <span className="w-14">{r.ticker ?? r.cik}</span>
              <span className="w-16 text-muted-foreground">{r.source}</span>
              <span className="w-12">{r.signalType}</span>
              <span className="w-32 text-muted-foreground">{String(r.eventTs)}</span>
              {r.score !== null && <span className="w-14">score {Number(r.score).toFixed(2)}</span>}
              {r.magnitude !== null && <span className="w-14">mag {Number(r.magnitude)}</span>}
              <span className="text-muted-foreground">{r.src}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
