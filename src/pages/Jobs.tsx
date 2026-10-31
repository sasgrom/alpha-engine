import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { Play, Square, Terminal } from "lucide-react";
import { jobToast } from "@/lib/job-toast";
import { describeJob } from "@/lib/job-describe";

type LogRow = { id: number; level: "info" | "warn" | "error"; message: string; ts: Date | string };

function LogConsole({ jobId }: { jobId: number }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  // afterId as STATE, not a ref (3h fix): it feeds the query key, so each
  // poll asks the server only for rows after the newest one we have —
  // instead of re-fetching the first 500 rows every 2 s and filtering
  // client-side (the ref-in-input version silently depended on re-renders
  // to refresh its own query key)
  const [afterId, setAfterId] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const query = trpc.jobs.logs.useQuery(
    { jobId, afterId, limit: 500 },
    { refetchInterval: 2000 }
  );

  useEffect(() => {
    setLogs([]);
    setAfterId(0);
  }, [jobId]);

  useEffect(() => {
    if (query.data && query.data.length > 0) {
      const fresh = query.data.filter((l) => l.id > afterId);
      if (fresh.length > 0) {
        setAfterId(fresh[fresh.length - 1].id);
        setLogs((prev) => [...prev, ...fresh].slice(-1000));
      }
    }
  }, [query.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="console rounded-md h-[420px] overflow-y-auto p-3">
      {logs.map((l) => (
        <div key={l.id} className="flex gap-2">
          <span className="lv-ts shrink-0">{new Date(l.ts).toISOString().slice(11, 19)}</span>
          <span className={`lv-${l.level} break-all`}>{l.message}</span>
        </div>
      ))}
      {logs.length === 0 && (
        <div className="lv-ts flex items-center gap-2 pt-2">
          <Terminal size={12} /> waiting for job output…
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

/**
 * Mutation callbacks shared by every launcher: an acceptance toast the moment
 * the job is queued (8s ring toast, fades on its own), an explicit error toast
 * when the API rejects the launch. Completion/failure is reported later by
 * the global job watcher in AppLayout.
 */
const launchToast = {
  onSuccess: (label: string, desc: string) =>
    jobToast("success", `${label} accepted`, desc),
  onError: (label: string, message: string) =>
    jobToast("error", `${label} rejected`, message),
};

export default function Jobs() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const jobs = trpc.jobs.list.useQuery({ limit: 30 }, { refetchInterval: 3000 });
  const cancel = trpc.jobs.cancel.useMutation({
    // 3i: the mutation reports WHAT happened — surface it instead of silence
    onSuccess: (r) => {
      utils.jobs.list.invalidate();
      if (r.action === "flagged") jobToast("info", "Cancel requested", "the job stops at its next checkpoint");
      else if (r.action === "force-cancelled") jobToast("warning", "Job cancelled", "no live executor — row marked cancelled");
      else jobToast("warning", "Not cancellable", "the job is already in a terminal state");
    },
    onError: (e) => jobToast("error", "Cancel failed", e.message),
  });

  // job types: the three original stage-1 pipelines plus the iteration-2 ones
  // harvest  — downloads SEC documents (primary + exhibits) into object storage
  // series   — builds homogeneous quarterly time series from raw XBRL facts
  // sections — stage 2.1: cuts sections (MD&A, Risk Factors, 8-K items…) out of downloaded documents
  const [jobType, setJobType] = useState<"bootstrap" | "filings" | "stream" | "harvest" | "series" | "sections" | "score" | "prices">("bootstrap");
  const [tickers, setTickers] = useState("universe");
  // excluded tickers (scope grammar, services/scope.ts): subtracted from the base
  const [exclude, setExclude] = useState("");
  // debounce for the live scope preview (don't resolve on every keystroke)
  const [debouncedTickers, setDebouncedTickers] = useState("universe");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTickers(tickers), 600);
    return () => clearTimeout(t);
  }, [tickers]);
  const [forms, setForms] = useState("10-K,10-Q,8-K");
  const [cycles, setCycles] = useState("1");
  const [intervalSec, setIntervalSec] = useState("300");
  // how many recent filings per form a harvest job processes (test volume control)
  const [maxPerForm, setMaxPerForm] = useState("5");
  // score: how many recent documents per company get scored (LLM billing control)
  const [maxDocs, setMaxDocs] = useState("3");
  // score: pairwise mode (both periods' MD&A in one context → tone_delta)
  const [pairwise, setPairwise] = useState(true);
  const [selectedJob, setSelectedJob] = useState<number | null>(null);

  const launched = (label: string) => ({
    onSuccess: (_d: unknown, vars: Record<string, unknown>) => {
      utils.jobs.list.invalidate();
      launchToast.onSuccess(label, describeJob(jobType, JSON.stringify(vars)) || "queued");
    },
    onError: (err: { message: string }) => launchToast.onError(label, err.message),
  });

  const startBootstrap = trpc.jobs.startBootstrap.useMutation(launched("Bootstrap"));
  const startFilings = trpc.jobs.startFilingRefresh.useMutation(launched("Filings refresh"));
  const startStream = trpc.jobs.startStream.useMutation(launched("Stream"));
  const startHarvest = trpc.pipeline.startHarvest.useMutation(launched("Harvest"));
  const startSeries = trpc.pipeline.startSeriesBuild.useMutation(launched("Series build"));
  const startSections = trpc.pipeline.startSectionParse.useMutation(launched("Section parse"));
  const startScore = trpc.sentiment.startScore.useMutation(launched("Scoring"));
  const startPrices = trpc.prices.startPrices.useMutation(launched("Price sync"));
  // prices mode: incremental (daily top-up, default) vs full history refetch
  const [priceMode, setPriceMode] = useState<"incremental" | "backfill">("incremental");

  // suggestions for the Tickers field: indexes + GICS sectors + saved presets
  const scopeGroups = trpc.scope.groups.useQuery();
  const scopePresets = trpc.scope.presets.useQuery();
  // live preview: how many tickers the job will actually get after exclude;
  // a resolve error (e.g. Wikipedia unreachable) shows as n/a instead of crashing the form
  const preview = trpc.scope.resolvePreview.useQuery(
    { base: debouncedTickers || "universe", exclude },
    { enabled: debouncedTickers.trim().length > 0, retry: false }
  );

  const launch = () => {
    if (jobType === "bootstrap") startBootstrap.mutate({ tickers, exclude, forms, withFacts: true });
    else if (jobType === "filings") startFilings.mutate({ tickers, exclude, forms });
    else if (jobType === "stream")
      startStream.mutate({ tickers, exclude, forms: forms || "8-K", cycles: Number(cycles) || 1, intervalSec: Number(intervalSec) || 300 });
    // harvest's form scope is fixed on the backend (10-K/10-Q/8-K + amendments + DEF 14A);
    // the forms field is intentionally unused here so the UI promises no false flexibility
    else if (jobType === "harvest") startHarvest.mutate({ tickers, exclude, maxFilingsPerForm: Number(maxPerForm) || 5 });
    else if (jobType === "sections") startSections.mutate({ tickers, exclude });
    // sections:"mda" — the prototype scores MD&A only (the most informative block);
    // the other groups (risk, fin) arrive after rubric calibration in Sentiment Lab
    else if (jobType === "score") startScore.mutate({ tickers, exclude, maxDocs: Number(maxDocs) || 3, sections: "mda", pairwise });
    else if (jobType === "prices") startPrices.mutate({ tickers, exclude, mode: priceMode });
    else startSeries.mutate({ tickers, exclude });
  };

  const anyRunning = (jobs.data ?? []).some((j) => j.status === "running");
  const pending =
    startBootstrap.isPending || startFilings.isPending || startStream.isPending || startHarvest.isPending || startSeries.isPending || startScore.isPending || startPrices.isPending;

  return (
    <AppLayout title="Jobs & Logs">
      {/* launcher — ADMIN only (4c, D31): jobs write shared tables / burn
          owner-billed resources. Users get their coverage via the Universe
          page (add ticker → auto-ingest) and see their queue read-only. */}
      {isAdmin && (
      <div className="t-panel px-4 py-3 flex flex-wrap items-end gap-3">
        <div>
          <div className="t-label mb-1.5">Job type</div>
          <Select value={jobType} onValueChange={(v) => setJobType(v as typeof jobType)}>
            <SelectTrigger className="h-8 w-44 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bootstrap">bootstrap (index + facts)</SelectItem>
              <SelectItem value="filings">filings index refresh</SelectItem>
              <SelectItem value="stream">stream cycles (8-K feed)</SelectItem>
              <SelectItem value="harvest">harvest documents (stage 1.5)</SelectItem>
              <SelectItem value="series">build series (stage 1.6)</SelectItem>
              <SelectItem value="sections">parse sections (stage 2.1)</SelectItem>
              <SelectItem value="score">score sections (stage 2.2)</SelectItem>
              <SelectItem value="prices">price sync (stage 1.7)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="t-label mb-1.5">Tickers (scope)</div>
          {/* datalist suggestions: indexes, GICS sectors, presets from the Universe scope builder */}
          <Input
            value={tickers}
            onChange={(e) => setTickers(e.target.value)}
            list="scope-suggestions"
            className="h-8 w-64 t-mono text-[11px] uppercase bg-[hsl(var(--secondary)/0.5)]"
            placeholder="universe | sp500 | ndx | dow | sector:… | preset:… | AAPL,MSFT"
          />
          <datalist id="scope-suggestions">
            <option value="universe" />
            <option value="sp500" />
            <option value="ndx" />
            <option value="dow" />
            {(scopeGroups.data?.sectors ?? []).map((s) => (
              <option key={s.name} value={`sector:${s.name}`} />
            ))}
            {(scopePresets.data ?? []).map((p) => (
              <option key={p.name} value={`preset:${p.name}`} />
            ))}
          </datalist>
        </div>
        <div>
          <div className="t-label mb-1.5">Exclude</div>
          <Input
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            className="h-8 w-40 t-mono text-[11px] uppercase bg-[hsl(var(--secondary)/0.5)]"
            placeholder="AAPL,MSFT"
          />
        </div>
        {/* live scope counter: base → minus exclude → final job size */}
        <div className="t-mono text-[10px] text-muted-foreground pb-1.5">
          {preview.isLoading && "resolving…"}
          {preview.isError && <span className="text-[hsl(var(--warn))]">scope n/a (network?)</span>}
          {preview.data && (
            <span>
              → <span className="text-[hsl(var(--live))]">{preview.data.count}</span> tickers
              {preview.data.excluded.length > 0 && ` (−${preview.data.excluded.length} excluded)`}
            </span>
          )}
        </div>
        {/* the forms field only makes sense for bootstrap/filings/stream —
            harvest has a fixed form scope, series/sections/score use no forms */}
        {jobType !== "harvest" && jobType !== "series" && jobType !== "sections" && jobType !== "score" && jobType !== "prices" && (
          <div>
            <div className="t-label mb-1.5">Forms</div>
            <Input value={forms} onChange={(e) => setForms(e.target.value)} className="h-8 w-36 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
          </div>
        )}
        {jobType === "harvest" && (
          <div>
            <div className="t-label mb-1.5">Max filings / form</div>
            <Input value={maxPerForm} onChange={(e) => setMaxPerForm(e.target.value)} className="h-8 w-28 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
          </div>
        )}
        {jobType === "score" && (
          <>
            <div>
              <div className="t-label mb-1.5">Max docs / company</div>
              {/* the cap of 10 is hard-coded in the startScore backend schema — protection against accidentally burning the LLM quota */}
              <Input value={maxDocs} onChange={(e) => setMaxDocs(e.target.value)} className="h-8 w-24 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
            </div>
            <div>
              <div className="t-label mb-1.5">Pairwise tone Δ</div>
              <button
                type="button"
                onClick={() => setPairwise((v) => !v)}
                className={`h-8 px-3 t-mono text-[10px] rounded-md border transition-colors ${
                  pairwise
                    ? "border-[hsl(var(--live)/0.5)] text-[hsl(var(--live))] bg-[hsl(var(--live)/0.08)]"
                    : "border-border text-muted-foreground"
                }`}
              >
                {pairwise ? "ON" : "OFF"}
              </button>
            </div>
          </>
        )}
        {jobType === "stream" && (
          <>
            <div>
              <div className="t-label mb-1.5">Cycles</div>
              <Input value={cycles} onChange={(e) => setCycles(e.target.value)} className="h-8 w-20 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
            </div>
            <div>
              <div className="t-label mb-1.5">Interval (s)</div>
              <Input value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} className="h-8 w-24 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
            </div>
          </>
        )}
        {jobType === "prices" && (
          <div>
            <div className="t-label mb-1.5">Mode</div>
            {/* incremental = resume from the last stored bar (default, daily
                top-up); backfill = refetch full history (upsert — safe) */}
            <Select value={priceMode} onValueChange={(v) => setPriceMode(v as typeof priceMode)}>
              <SelectTrigger className="h-8 w-44 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="incremental">incremental (resume)</SelectItem>
                <SelectItem value="backfill">full backfill</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <Button
          size="sm"
          className="h-8 t-mono text-[10px] gap-1.5 bg-[hsl(var(--live))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--live)/0.85)]"
          onClick={launch}
          disabled={pending}
        >
          <Play size={12} /> Launch job
        </Button>
        {anyRunning && <span className="t-mono text-[10px] text-[hsl(var(--live))] flex items-center gap-1.5"><span className="led led-live" /> WORKER ACTIVE</span>}
      </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        {/* job list: admin sees everyone's jobs (with the launcher name),
            role="user" sees only their own — enforced server-side in jobs.list */}
        <div className="t-panel overflow-hidden">
          <div className="px-4 py-3 border-b border-border t-label">
            Job queue{isAdmin ? " — all users" : " — my jobs"}
          </div>
          <div className="divide-y divide-[hsl(var(--border)/0.6)] max-h-[420px] overflow-y-auto">
            {(jobs.data ?? []).map((j) => {
              const desc = describeJob(j.type, j.params);
              return (
                <button
                  key={j.id}
                  onClick={() => setSelectedJob(j.id)}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${
                    selectedJob === j.id ? "bg-[hsl(var(--accent)/0.35)]" : "hover:bg-[hsl(var(--accent)/0.15)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`led ${j.status === "running" ? "led-live" : j.status === "done" ? "led-ok" : j.status === "error" ? "led-crit" : j.status === "cancelled" ? "led-warn" : "led-off"}`} />
                    <span className="t-mono text-[11px]">#{j.id}</span>
                    <span className="t-mono text-[11px] uppercase text-[hsl(var(--live))]">{j.type}</span>
                    <span className="t-mono text-[10px] text-muted-foreground uppercase">{j.status}</span>
                    {/* who launched the job — admin-only context; a user's own
                        queue needs no name column */}
                    {isAdmin && (
                      <span className="t-mono text-[10px] text-muted-foreground">
                        · {j.startedByName ?? (j.startedBy ? `user ${j.startedBy}` : "legacy")}
                      </span>
                    )}
                    {/* cancellable while running OR waiting in the queue (3h);
                        4h: a real <button> — the span version was keyboard-inaccessible */}
                    {(j.status === "running" || j.status === "queued") && (
                      <button
                        type="button"
                        aria-label="Cancel job"
                        className="ml-auto text-[hsl(var(--crit))] hover:opacity-70"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancel.mutate({ jobId: j.id });
                        }}
                      >
                        <Square size={12} />
                      </button>
                    )}
                  </div>
                  {desc && <div className="t-mono text-[10px] text-muted-foreground mt-1">{desc}</div>}
                  {j.total > 0 && (
                    <div className="h-1 mt-2 bg-[hsl(var(--accent))] rounded-full overflow-hidden">
                      <div className="h-full bg-[hsl(var(--live))]" style={{ width: `${Math.min(100, (j.processed / j.total) * 100)}%` }} />
                    </div>
                  )}
                  <div className="t-mono text-[10px] text-muted-foreground mt-1">
                    {new Date(j.createdAt).toISOString().slice(0, 19).replace("T", " ")} · {j.processed}/{j.total} {j.message ? `· ${j.message}` : ""}
                  </div>
                </button>
              );
            })}
            {jobs.data?.length === 0 && (
              <div className="px-4 py-10 text-center t-mono text-[11px] text-muted-foreground">NO JOBS YET</div>
            )}
          </div>
        </div>

        {/* logs */}
        <div>
          <div className="t-label mb-2">{selectedJob ? `Live log — job #${selectedJob}` : "Select a job to view its log"}</div>
          {selectedJob ? <LogConsole jobId={selectedJob} /> : <div className="console rounded-md h-[420px] p-3 lv-ts">—</div>}
        </div>
      </div>
    </AppLayout>
  );
}
