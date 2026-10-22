/**
 * /workers — Local Workers Console (4p). Visible only on the home machine
 * (server enforces LOCAL_WORKER_UI=1); admins elsewhere see the disabled note.
 * Run/kill collectors, watch live logs, check the Windows scheduler, probe GDELT.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AppLayout from "@/components/AppLayout";
import { Play, Square, RefreshCw, Activity, CalendarClock, Satellite } from "lucide-react";

const WORKER_DEFS = [
  { key: "stocktwits", title: "Stocktwits live", hint: "30-message stream → buzz + sentiment label, per ticker" },
  { key: "gdelt", title: "GDELT live", hint: "hourly tone + article volume per company" },
  { key: "gdelt-backfill", title: "GDELT backfill", hint: "historical day buckets, resumable; uses from/to below" },
  { key: "edgar-fetch", title: "EDGAR fetch", hint: "download 10-K/10-Q/8-K docs to local cache; network only, no GPU" },
  { key: "edgar-tone", title: "EDGAR tone", hint: "local LLM scores cached filings → ingest (local or prod by INGEST_URL)" },
] as const;

function StatusChip({ status }: { status: string }) {
  const cls =
    status === "done" ? "bg-emerald-500/15 text-emerald-400" :
    status === "running" ? "bg-sky-500/15 text-sky-400" :
    status === "killed" ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400";
  return <span className={`px-2 py-0.5 rounded text-xs font-mono ${cls}`}>{status}</span>;
}

export default function Workers() {
  const enabled = trpc.workersLocal.enabled.useQuery();
  const runs = trpc.workersLocal.runs.useQuery({ limit: 30 }, { enabled: enabled.data?.enabled === true, refetchInterval: 4000 });
  const scheduler = trpc.workersLocal.scheduler.useQuery(undefined, { enabled: enabled.data?.enabled === true, refetchInterval: 30000 });
  const utils = trpc.useUtils();
  const runMut = trpc.workersLocal.run.useMutation({ onSuccess: () => utils.workersLocal.runs.invalidate() });
  const killMut = trpc.workersLocal.kill.useMutation({ onSuccess: () => utils.workersLocal.runs.invalidate() });
  const probeMut = trpc.workersLocal.probe.useQuery({ query: '"Microsoft"' }, { enabled: false });
  const [from, setFrom] = useState("2026-10-15");
  const [to, setTo] = useState("2026-10-21");
  const [only, setOnly] = useState("");
  const [logId, setLogId] = useState<string | null>(null);
  const log = trpc.workersLocal.logTail.useQuery({ id: logId!, lines: 200 }, { enabled: !!logId, refetchInterval: 2000 });
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log.data]);

  const running = runs.data?.some((r) => r.status === "running");

  return (
    <AppLayout title="Workers Console">
      <div className="space-y-4 p-4 max-w-6xl mx-auto">

        {enabled.data && !enabled.data.enabled && (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">
            This console is local-only. On the home machine set <code>LOCAL_WORKER_UI=1</code> in .env and restart the dev server.
            For intake verification everywhere, see Admin → Workers intake.
          </CardContent></Card>
        )}

        {enabled.data?.enabled && (
          <>
            {/* Run controls */}
            <div className="grid gap-4 md:grid-cols-3">
              {WORKER_DEFS.map((w) => (
                <Card key={w.key}>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{w.title}</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground">{w.hint}</p>
                    <Button size="sm" disabled={running || runMut.isPending}
                      onClick={() => runMut.mutate({ worker: w.key, from: w.key === "gdelt-backfill" || w.key === "edgar-fetch" ? from : undefined, to: w.key === "gdelt-backfill" ? to : undefined, only: only || undefined })}>
                      <Play className="h-3.5 w-3.5 mr-1" /> Run
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardContent className="p-4 flex flex-wrap items-end gap-3 text-sm">
                <label className="text-xs">from <Input value={from} onChange={(e) => setFrom(e.target.value)} className="w-32 h-8" /></label>
                <label className="text-xs">to <Input value={to} onChange={(e) => setTo(e.target.value)} className="w-32 h-8" /></label>
                <label className="text-xs">only ticker <Input value={only} onChange={(e) => setOnly(e.target.value.toUpperCase())} placeholder="MSFT" className="w-24 h-8" /></label>
                <span className="text-xs text-muted-foreground">only one worker runs at a time (upstream pacing discipline)</span>
              </CardContent>
            </Card>

            {/* Scheduler + probe */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Windows scheduler</CardTitle></CardHeader>
                <CardContent className="text-xs font-mono space-y-1">
                  {scheduler.data?.supported === false && <p className="text-muted-foreground">not Windows — scheduler query unsupported here</p>}
                  {scheduler.data?.tasks.map((t) => (
                    <div key={t.taskName} className="flex justify-between gap-2 border-b border-border/40 py-1">
                      <span>{t.taskName}</span>
                      <span className="text-muted-foreground">last: {t.lastRun || "—"} ({t.lastResult || "—"}) → next: {t.nextRun || "—"}</span>
                    </div>
                  ))}
                  {scheduler.data?.supported && scheduler.data.tasks.length === 0 && <p className="text-muted-foreground">no AlphaEngine tasks registered</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Satellite className="h-4 w-4" /> GDELT probe</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Button size="sm" variant="outline" onClick={() => probeMut.refetch()}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Probe now</Button>
                  {probeMut.data && (
                    <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/40 rounded p-2 max-h-40 overflow-auto">
                      HTTP {probeMut.data.status}{"\n"}{probeMut.data.body}
                    </pre>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Run history */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Runs</CardTitle></CardHeader>
              <CardContent className="text-xs font-mono space-y-1">
                {(runs.data ?? []).map((r) => (
                  <div key={r.id} className="flex items-center gap-2 border-b border-border/40 py-1 flex-wrap">
                    <StatusChip status={r.status} />
                    <span className="w-28">{r.worker}</span>
                    <span className="text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</span>
                    {r.args.length > 0 && <span className="text-muted-foreground">[{r.args.join(" ")}]</span>}
                    {r.accepted !== null && <span className="text-emerald-400">+{r.accepted} new</span>}
                    {r.dupes !== null && <span className="text-muted-foreground">{r.dupes} dupes</span>}
                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setLogId(r.id)}>log</Button>
                    {r.status === "running" && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-red-400" onClick={() => killMut.mutate({ id: r.id })}>
                        <Square className="h-3 w-3 mr-1" /> kill
                      </Button>
                    )}
                  </div>
                ))}
                {runs.data?.length === 0 && <p className="text-muted-foreground">no runs yet</p>}
              </CardContent>
            </Card>

            {logId && (
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">Log: {logId}</CardTitle>
                  <Button size="sm" variant="ghost" onClick={() => setLogId(null)}>close</Button>
                </CardHeader>
                <CardContent>
                  <pre ref={logRef} className="text-xs font-mono bg-black/60 text-emerald-300 rounded p-3 max-h-96 overflow-auto whitespace-pre-wrap">
                    {(log.data?.lines ?? []).join("\n") || "…"}
                  </pre>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
