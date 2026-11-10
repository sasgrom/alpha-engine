import { useEffect, useMemo, useState } from "react";
import { ExternalLink, ShieldCheck, Users } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import type { Form4ActivityFeed } from "@/data/form4-insider-activity";
import { loadForm4ActivityFeed } from "@/lib/insider-form4-feed";
import {
  buildClusters,
  classifyTransaction,
  EXCLUDE_REASON_LABEL,
  filingLagDays,
  insiderRoles,
  transactionValueUsd,
  type Form4Transaction,
  type InsiderCluster,
} from "@/lib/insider-form4";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shares = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const TRANSACTION_LIMIT = 100;

const ROLE_LABEL: Record<string, string> = {
  ceo: "CEO",
  cfo: "CFO",
  officer: "Officer",
  director: "Director",
  ten_percent: "10% owner",
};

function RoleBadges({ t }: { t: Form4Transaction }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {insiderRoles(t).map((role) => (
        <span key={role} className="t-mono text-[9px] uppercase px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-muted-foreground">
          {ROLE_LABEL[role]}
        </span>
      ))}
      {t.multiOwner && (
        <span className="t-mono text-[9px] uppercase px-1.5 py-0.5 rounded border border-[hsl(var(--live)/0.4)] text-[hsl(var(--live))]">
          multi-owner · {t.owners?.length ?? 0}
        </span>
      )}
      {t.isAmendment && (
        <span className="t-mono text-[9px] uppercase px-1.5 py-0.5 rounded border border-[hsl(var(--warn)/0.5)] text-[hsl(var(--warn))]">
          amendment{t.amendmentOf ? ` · ${t.amendmentOf}` : ""}
        </span>
      )}
      {t.preplanned && (
        <span className="t-mono text-[9px] uppercase px-1.5 py-0.5 rounded border border-[hsl(var(--warn)/0.5)] text-[hsl(var(--warn))]">
          10b5-1 plan
        </span>
      )}
    </span>
  );
}

function servingClusters(feed: Form4ActivityFeed, ticker: string, buys: { t: Form4Transaction }[]): InsiderCluster[] {
  if (feed.status !== "full_run") return buildClusters(buys.map((row) => row.t));
  return (feed.clusters ?? []).filter((cluster) => ticker === "all" || cluster.ticker === ticker).map((cluster) => ({
    ...cluster,
    hasTenPercent: cluster.hasTenPercentOwner,
    allPreplanned: false,
    aggregatePurchaseUsd: cluster.aggregatePurchaseUsd ?? 0,
    maxSinglePurchaseUsd: cluster.maxSinglePurchaseUsd ?? 0,
    status: cluster.status === "partial" ? "partial" : "computed",
    strength: cluster.uniqueInsiders >= 3 ? "cluster" : cluster.uniqueInsiders === 2 ? "pair" : "single",
    transactions: [],
  }));
}

function horizonLabel(key: string): string {
  return key.replace(/^forward/, "+");
}

export default function InsiderActivity() {
  const [feed, setFeed] = useState<Form4ActivityFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [ticker, setTicker] = useState("all");

  useEffect(() => {
    let active = true;
    loadForm4ActivityFeed().then((value) => {
      if (active) setFeed(value);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, []);

  const classified = useMemo(
    () => (feed?.transactions ?? []).map((t) => ({ t, cls: classifyTransaction(t), value: transactionValueUsd(t) })),
    [feed?.transactions],
  );
  const tickers = useMemo(() => [...new Set((feed?.transactions ?? []).map((t) => t.ticker))].sort(), [feed?.transactions]);
  const visible = classified.filter((r) => ticker === "all" || r.t.ticker === ticker);
  const buys = visible.filter((r) => r.cls.included);
  const excluded = visible.filter((r) => !r.cls.included);
  const clusters = useMemo(() => feed ? servingClusters(feed, ticker, buys) : [], [feed, ticker, buys]);
  const aggregate = feed?.status === "full_run" ? ticker === "all" ? feed.kpi : feed.perTicker?.find((row) => row.ticker === ticker) : null;
  const buyUsd = aggregate?.openMarketBuyUsd ?? buys.reduce((s, r) => s + (r.value ?? 0), 0);
  const excludedUsd = aggregate?.excludedUsd ?? excluded.reduce((s, r) => s + (r.value ?? 0), 0);
  const buyCount = aggregate?.openMarketBuyCount ?? buys.length;
  const excludedCount = aggregate?.excludedCount ?? excluded.length;
  const uniqueInsiders = aggregate?.uniqueInsidersBuying ?? new Set(buys.flatMap((row) => (row.t.owners?.length ? row.t.owners : [{ ownerCik: row.t.ownerCik }]).map((owner) => String(owner.ownerCik ?? "")))).size;
  const displayedTransactions = (showExcluded ? visible : buys).slice(0, TRANSACTION_LIMIT);

  return (
    <AppLayout title="Insider buys · Form 4">
      <div className="mb-3 inline-flex t-mono text-[10px] uppercase tracking-[0.1em] px-2.5 py-1.5 rounded border border-[hsl(var(--border))] text-muted-foreground">
        {feed?.status === "full_run"
          ? `full run · ${feed.generatedAt.slice(0, 10)} · ${(feed.totals?.transactions ?? feed.transactions.length).toLocaleString("en-US")} tx`
          : feed?.status === "preview_sample" ? "preview sample" : error ? "report error" : "loading Form 4"}
      </div>

      {feed?.status === "preview_sample" && (
        <div className="mb-4 flex items-start gap-3 px-4 py-2.5 rounded-md border border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.08)]">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[hsl(var(--warn))]" />
          <div className="t-mono text-[10px] leading-relaxed text-[hsl(var(--warn))] uppercase tracking-[0.08em]">
            Preview sample — two real EDGAR filings for UI development. Full-universe worker run pending; this surface
            shows nothing until the reviewed export lands. {feed.note}
          </div>
        </div>
      )}
      {error && <div className="t-panel p-4 t-mono text-[11px] text-[hsl(var(--crit-red))]">{error}. Preview was not substituted.</div>}
      {!feed && !error && <div className="t-panel p-4 t-mono text-[11px] text-muted-foreground">Loading the full-run Form 4 report…</div>}

      {feed && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="t-panel p-4">
            <div className="t-label">Open-market buys</div>
            <div className="t-mono text-xl text-[hsl(var(--live))]">{money.format(buyUsd)}</div>
            <div className="t-mono text-[10px] text-muted-foreground">{buyCount} transaction{buyCount === 1 ? "" : "s"} · code P</div>
          </div>
          <div className="t-panel p-4">
            <div className="t-label">Excluded noise</div>
            <div className="t-mono text-xl text-muted-foreground">{money.format(excludedUsd)}</div>
            <div className="t-mono text-[10px] text-muted-foreground">{excludedCount} rows · M / F / A / G / S</div>
          </div>
          <div className="t-panel p-4">
            <div className="t-label">Unique insiders buying</div>
            <div className="t-mono text-xl">{uniqueInsiders}</div>
            <div className="t-mono text-[10px] text-muted-foreground">10-day cluster window</div>
          </div>
          <div className="t-panel p-4">
            <div className="t-label">Clusters (3+ insiders)</div>
            <div className="t-mono text-xl">{clusters.filter((c) => c.strength === "cluster").length}</div>
            <div className="t-mono text-[10px] text-muted-foreground">{clusters.length} window{clusters.length === 1 ? "" : "s"} total</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={ticker} onChange={(e) => setTicker(e.target.value)} className="t-mono text-[11px] bg-transparent border border-[hsl(var(--border))] rounded px-2 py-1.5">
            <option value="all">All tickers</option>
            {tickers.map((tk) => <option key={tk} value={tk}>{tk}</option>)}
          </select>
          <button
            onClick={() => setShowExcluded((v) => !v)}
            className={`t-mono text-[10px] uppercase tracking-[0.1em] px-2.5 py-1.5 rounded border ${showExcluded ? "border-[hsl(var(--live)/0.5)] text-[hsl(var(--live))]" : "border-[hsl(var(--border))] text-muted-foreground"}`}
          >
            {showExcluded ? "Hide excluded noise" : `Show excluded noise (${excluded.length})`}
          </button>
          <span className="t-mono text-[10px] text-muted-foreground">showing latest {Math.min(displayedTransactions.length, TRANSACTION_LIMIT)} of {(showExcluded ? visible : buys).length.toLocaleString("en-US")} rows</span>
        </div>

        <div className="space-y-2 mb-6">
          {displayedTransactions.map(({ t, cls, value }, index) => {
            const lag = filingLagDays(t);
            return (
              <div key={`${t.accessionNo}-${t.transactionCode}-${t.shares}-${t.ownerCik}-${index}`} className={`t-panel p-3 md:p-4 ${cls.included ? "" : "opacity-55"}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className={`t-mono text-[10px] px-1.5 py-0.5 rounded font-semibold ${cls.included ? "bg-[hsl(var(--live)/0.15)] text-[hsl(var(--live))]" : "bg-[hsl(var(--accent))] text-muted-foreground"}`}>
                    {t.transactionCode}
                  </span>
                  <span className="t-mono text-[12px] font-medium">{t.ownerName}</span>
                  <RoleBadges t={t} />
                  <span className="t-mono text-[10px] text-muted-foreground">{t.ticker}</span>
                  <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 t-mono text-[10px] text-[hsl(var(--live))] hover:underline underline-offset-4">
                    {t.accessionNo} <ExternalLink size={11} />
                  </a>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  {value !== null ? (
                    <span className={`t-mono text-[15px] ${cls.included ? "text-foreground" : "text-muted-foreground line-through decoration-[hsl(var(--crit-red)/0.6)]"}`}>
                      {money.format(value)}
                    </span>
                  ) : (
                    <span className="t-mono text-[12px] text-muted-foreground">no cash price</span>
                  )}
                  {t.shares !== null && (
                    <span className="t-mono text-[11px] text-muted-foreground">
                      {shares.format(t.shares)} sh{t.pricePerShare !== null ? ` @ $${t.pricePerShare}` : ""}
                    </span>
                  )}
                  {t.sharesOwnedAfter !== null && (
                    <span className="t-mono text-[11px] text-muted-foreground">owns {shares.format(t.sharesOwnedAfter)} after</span>
                  )}
                  {t.directOrIndirect === "I" && (
                    <span className="t-mono text-[10px] text-muted-foreground">indirect · {t.natureOfOwnership ?? "entity"}</span>
                  )}
                  {lag !== null && (
                    <span className="t-mono text-[10px] text-muted-foreground">traded {t.transactionDate} · filed +{lag}d</span>
                  )}
                  {t.clusterId && <span className="t-mono text-[10px] text-muted-foreground">cluster linked</span>}
                  {t.footnoteIds.length > 0 && (
                    <span className="t-mono text-[10px] text-muted-foreground">footnotes {t.footnoteIds.join(", ")}</span>
                  )}
                </div>
                {!cls.included && (
                  <div className="mt-1.5 t-mono text-[10px] text-[hsl(var(--crit-red)/0.9)]">
                    excluded — {EXCLUDE_REASON_LABEL[cls.reason]}
                  </div>
                )}
              </div>
            );
          })}
          {buys.length === 0 && !showExcluded && (
            <div className="t-panel p-8 text-center t-mono text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
              No open-market insider purchases in this feed
            </div>
          )}
        </div>

        <div className="t-panel p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users size={14} className="text-[hsl(var(--live))]" />
            <span className="t-mono text-[11px] uppercase tracking-[0.14em]">Cluster windows · 10 days</span>
          </div>
          {feed.benchmarkRuns?.map((run) => (
            <div key={run.generatedAt} className="mb-3 t-mono text-[10px] leading-relaxed text-muted-foreground">
              <div>
                Dry-run {run.generatedAt.slice(0, 10)} · {run.methodologyStatus === "invalid-methodology" ? "invalid-methodology · " : ""}{run.priceCoverage.status === "degraded" ? "degraded · " : ""}price coverage through {run.priceCoverage.latestDate}
              </div>
              <div>
                {Object.entries(run.horizons).map(([key, value]) => `${horizonLabel(key)} ${(value.hitRate * 100).toFixed(1)}% hit · ${(value.coverage * 100).toFixed(1)}% coverage`).join(" · ")}
              </div>
              {run.coverageByYear && (
                <div>
                  years: {run.coverageByYear.map((row) => `${row.year} ${(row.horizons.forward1d.coverage * 100).toFixed(0)}%/+1d ${(row.horizons.forward5d.coverage * 100).toFixed(0)}%/+5d ${(row.horizons.forward20d.coverage * 100).toFixed(0)}%/+20d`).join(" · ")}
                </div>
              )}
            </div>
          ))}
          {Boolean(feed.benchmarkRuns?.length) && (
            <div className="mb-3 t-mono text-[10px] leading-relaxed text-muted-foreground">
              window-sensitive dry-run, no CI, not a standalone signal
            </div>
          )}
          {clusters.length === 0 ? (
            <div className="t-mono text-[11px] text-muted-foreground">No cluster windows yet — a cluster needs 3+ distinct insiders buying within 10 days.</div>
          ) : (
            <div className="space-y-2">
              {clusters.map((c) => (
                <div key={c.clusterId ?? `${c.ticker}-${c.windowStart}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-[hsl(var(--border))] rounded px-3 py-2">
                  <span className="t-mono text-[12px] font-semibold">{c.ticker}</span>
                  <span className="t-mono text-[10px] text-muted-foreground">{c.windowStart} → {c.windowEnd}</span>
                  <span className={`t-mono text-[10px] uppercase px-1.5 py-0.5 rounded ${c.strength === "cluster" ? "bg-[hsl(var(--live)/0.15)] text-[hsl(var(--live))]" : "bg-[hsl(var(--accent))] text-muted-foreground"}`}>
                    {c.strength} · {c.uniqueInsiders} insider{c.uniqueInsiders === 1 ? "" : "s"}
                  </span>
                  <span className="t-mono text-[11px]">{money.format(c.aggregatePurchaseUsd)}</span>
                  <span className="t-mono text-[10px] text-muted-foreground">
                    {c.hasCeo ? "CEO " : ""}{c.hasCfo ? "CFO " : ""}{c.hasDirector ? "DIR " : ""}{c.hasTenPercent ? "10% " : ""}
                    {c.status === "partial" ? "· partial" : ""}{c.allPreplanned ? "· 10b5-1" : ""}{c.multiOwner ? "· multi-owner" : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>}
    </AppLayout>
  );
}
