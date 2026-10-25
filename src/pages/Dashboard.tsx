import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";
import { Play, RefreshCw, Radio, ArrowRight } from "lucide-react";

function fmtNum(n?: number) {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("en-US");
}

function Stat({ label, value, sub, live }: { label: string; value: string; sub?: string; live?: boolean }) {
  return (
    <div className="t-panel px-4 py-3.5">
      <div className="flex items-center gap-2">
        {live && <span className="led led-live" />}
        <span className="t-label">{label}</span>
      </div>
      <div className="t-mono text-[26px] font-semibold mt-1.5 leading-none text-foreground">{value}</div>
      {sub && <div className="t-mono text-[10px] text-muted-foreground mt-1.5">{sub}</div>}
    </div>
  );
}

const FORM_COLOR: Record<string, string> = {
  "10-K": "text-[hsl(var(--live))] border-[hsl(var(--live)/0.4)]",
  "10-Q": "text-[hsl(var(--ok))] border-[hsl(var(--ok)/0.4)]",
  "8-K": "text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.4)]",
};

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const stats = trpc.dashboard.stats.useQuery(undefined, { refetchInterval: 5000 });
  const latest = trpc.dashboard.latestFilings.useQuery({ limit: 12 }, { refetchInterval: 15000 });
  const jobs = trpc.jobs.list.useQuery({ limit: 6 }, { refetchInterval: 4000 });
  const utils = trpc.useUtils();

  const startRefresh = trpc.jobs.startFilingRefresh.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });
  const startStream = trpc.jobs.startStream.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const s = stats.data;
  // 4m: the FRED regime pack card (Stage 4 seed)
  const macro = trpc.dashboard.macro.useQuery(undefined, { refetchInterval: 60000 });
  // 5e: morning brief written by the home LLM from yesterday's signals
  const digest = trpc.digests.latest.useQuery(undefined, { refetchInterval: 120000 });
  // 13F flows include quarter-pair and comparable-fund coverage metadata.
  const flows = trpc.dashboard.sectorFlowsDetailed.useQuery(undefined, { refetchInterval: 300000 });
  const flowRows = flows.data?.rows ?? [];
  const flowGuard = flows.data?.guard ?? null;

  return (
    <AppLayout title="Mission Control">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Companies" value={fmtNum(s?.companies)} sub="tracked in the shared DB" />
        <Stat label="Universe" value={fmtNum(s?.universe)} sub="my active watchlist" />
        <Stat label="Filings" value={fmtNum(s?.filings)} sub="10-K / 10-Q / 8-K" />
        <Stat label="Fact rows" value={fmtNum(s?.facts)} sub="XBRL time series" />
        <Stat label="Latest filing" value={s?.latestFilingDate ?? "—"} sub="max filing date" />
        <Stat
          label="Jobs"
          value={fmtNum((s?.runningJobs ?? 0) + (s?.queuedJobs ?? 0))}
          sub={`${s?.runningJobs ?? 0} running · ${s?.queuedJobs ?? 0} queued`}
          live={((s?.runningJobs ?? 0) + (s?.queuedJobs ?? 0)) > 0}
        />
      </div>

      {/* launcher shortcuts — ADMIN only (4c, D31): they launch shared-write
          jobs; users add coverage from the Universe page */}
      {isAdmin && (
      <div className="flex flex-wrap gap-2 mt-5">
        <Button
          size="sm"
          variant="outline"
          className="t-mono text-[11px] uppercase tracking-[0.12em] gap-2"
          onClick={() => startRefresh.mutate({ tickers: "universe", forms: "10-K,10-Q,8-K" })}
          disabled={startRefresh.isPending}
        >
          <RefreshCw size={13} /> Refresh filing index
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="t-mono text-[11px] uppercase tracking-[0.12em] gap-2"
          onClick={() => startStream.mutate({ tickers: "universe", forms: "8-K", cycles: 1, intervalSec: 300 })}
          disabled={startStream.isPending}
        >
          <Radio size={13} /> Run one stream cycle
        </Button>
        <Link to="/jobs">
          <Button size="sm" variant="outline" className="t-mono text-[11px] uppercase tracking-[0.12em] gap-2">
            <Play size={13} /> New job
          </Button>
        </Link>
      </div>
      )}

      {/* Guarded 13F flows: the pair and exclusions are visible, never implicit. */}
      {flows.data && flowGuard && (
        <div className="t-panel px-4 py-3 mt-5">
          <div className="t-label mb-2.5">13F sector flows — {flowGuard.cur} vs {flowGuard.prev ?? "n/a"} · stable funds {flowGuard.stableFunds}</div>
          <div className="t-mono text-[10px] text-muted-foreground mb-2" title={flowGuard.warnings.join("\n")}>
            coverage {flowGuard.curFunds}/{flowGuard.expectedFunds} · excluded {flowGuard.missingFunds} missing + {flowGuard.suspectFunds} suspect{flowGuard.partial ? " · partial" : ""}
          </div>
          {flowGuard.warnings.length > 0 && <div className="t-mono text-[10px] text-amber-400 mb-2">{flowGuard.warnings[0]}</div>}
          {flowRows.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-2">
              {flowRows.map((f) => (
                <div key={f.sector}>
                  <div className="t-label !text-[8px]" title={f.sector}>{f.sector}</div>
                  <div className={`t-mono text-[13px] mt-0.5 ${f.deltaUsd >= 0 ? "text-emerald-400" : "text-crit-red"}`}>
                    {f.deltaUsd >= 0 ? "+" : "−"}{f.deltaUsd >= 1e12 || f.deltaUsd <= -1e12 ? `$${(Math.abs(f.deltaUsd) / 1e12).toFixed(1)}T` : `$${(Math.abs(f.deltaUsd) / 1e9).toFixed(1)}B`}
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="t-mono text-[11px] text-muted-foreground">No comparable flow panel for this quarter pair.</div>}
        </div>
      )}

      {/* 5e: morning brief — home-LLM digest of yesterday's signals */}
      {digest.data && (
        <div className="t-panel px-4 py-3 mt-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="t-label">Morning brief — {digest.data.forDate}</span>
            <span className="t-mono text-[9px] text-muted-foreground/70 ml-auto">
              {digest.data.model ?? "llm"} · derived from signals, verify against sources
            </span>
          </div>
          <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">{digest.data.body}</div>
        </div>
      )}

      {/* 4m (D46): the FRED regime pack — Stage 4 seed. Latest value per
          series; the full vintage-aware history lives in macro_points. */}
      {macro.data && macro.data.length > 0 && (
        <div className="t-panel px-4 py-3 mt-5">
          <div className="t-label mb-2.5">Macro — Stage 4 seed (FRED)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-6 gap-y-2">
            {macro.data.map((m) => (
              <div key={m.seriesId}>
                <div className="t-label !text-[8px]" title={m.seriesId}>{m.label}</div>
                <div className="t-mono text-[13px] mt-0.5">
                  {m.value === null ? "—" : m.unit === "pct" ? `${m.value.toFixed(2)}%` : m.value.toFixed(1)}
                </div>
                <div className="t-mono text-[8px] text-muted-foreground/60">{m.date}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-4 mt-5">
        {/* latest filings */}
        <div className="t-panel lg:col-span-3">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="t-label">Latest filings — my universe</span>
            <Link to="/database" className="t-mono text-[10px] text-[hsl(var(--live))] flex items-center gap-1">
              OPEN DATABASE <ArrowRight size={11} />
            </Link>
          </div>
          <div className="divide-y divide-[hsl(var(--border)/0.6)]">
            {(latest.data ?? []).map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2 alert-row">
                <span className="t-mono text-[12px] font-semibold w-16 text-[hsl(var(--live))]">{f.ticker}</span>
                <span
                  className={`t-mono text-[10px] px-1.5 py-0.5 border rounded-sm ${FORM_COLOR[f.form] ?? "text-muted-foreground border-border"}`}
                >
                  {f.form}
                </span>
                <span className="text-[12px] text-muted-foreground truncate flex-1">{f.name}</span>
                <span className="t-mono text-[10px] text-muted-foreground">{f.filingDate}</span>
              </div>
            ))}
            {latest.data?.length === 0 && (
              <div className="px-4 py-10 text-center t-mono text-[11px] text-muted-foreground">
                NOTHING YET — ADD TICKERS ON THE UNIVERSE PAGE
              </div>
            )}
          </div>
        </div>

        {/* recent jobs */}
        <div className="t-panel lg:col-span-2">
          <div className="px-4 py-3 border-b border-border">
            <span className="t-label">Recent jobs</span>
          </div>
          <div className="divide-y divide-[hsl(var(--border)/0.6)]">
            {(jobs.data ?? []).map((j) => (
              <div key={j.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`led ${
                      j.status === "running" ? "led-live" : j.status === "done" ? "led-ok" : j.status === "error" ? "led-crit" : "led-off"
                    }`}
                  />
                  <span className="t-mono text-[11px] uppercase tracking-wide">#{j.id} {j.type}</span>
                  <span className="t-mono text-[10px] text-muted-foreground ml-auto">
                    {j.processed}/{j.total}
                  </span>
                </div>
                {j.status === "running" && j.total > 0 && (
                  <div className="h-1 mt-2 bg-[hsl(var(--accent))] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[hsl(var(--live))] transition-all"
                      style={{ width: `${Math.min(100, (j.processed / j.total) * 100)}%` }}
                    />
                  </div>
                )}
                {j.message && <div className="t-mono text-[10px] text-muted-foreground mt-1 truncate">{j.message}</div>}
              </div>
            ))}
            {jobs.data?.length === 0 && (
              <div className="px-4 py-10 text-center t-mono text-[11px] text-muted-foreground">NO JOBS YET</div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
