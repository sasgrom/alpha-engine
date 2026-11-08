import { useMemo, useState } from "react";
import { ExternalLink, ShieldCheck, Users } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { form4InsiderActivity } from "@/data/form4-insider-activity";
import {
  buildClusters,
  classifyTransaction,
  EXCLUDE_REASON_LABEL,
  filingLagDays,
  insiderRoles,
  transactionValueUsd,
  type Form4Transaction,
} from "@/lib/insider-form4";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shares = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

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
      {t.preplanned && (
        <span className="t-mono text-[9px] uppercase px-1.5 py-0.5 rounded border border-[hsl(var(--warn)/0.5)] text-[hsl(var(--warn))]">
          10b5-1 plan
        </span>
      )}
    </span>
  );
}

export default function InsiderActivity() {
  const feed = form4InsiderActivity;
  const [showExcluded, setShowExcluded] = useState(false);
  const [ticker, setTicker] = useState("all");

  const classified = useMemo(
    () => feed.transactions.map((t) => ({ t, cls: classifyTransaction(t), value: transactionValueUsd(t) })),
    [feed.transactions]
  );
  const tickers = useMemo(() => [...new Set(feed.transactions.map((t) => t.ticker))].sort(), [feed.transactions]);
  const visible = classified.filter((r) => ticker === "all" || r.t.ticker === ticker);
  const buys = visible.filter((r) => r.cls.included);
  const excluded = visible.filter((r) => !r.cls.included);
  const clusters = useMemo(() => buildClusters(buys.map((r) => r.t)), [buys]);
  const buyUsd = buys.reduce((s, r) => s + (r.value ?? 0), 0);
  const excludedUsd = excluded.reduce((s, r) => s + (r.value ?? 0), 0);

  return (
    <AppLayout title="Insider buys · Form 4">
      {feed.status === "preview_sample" && (
        <div className="mb-4 flex items-start gap-3 px-4 py-2.5 rounded-md border border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.08)]">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[hsl(var(--warn))]" />
          <div className="t-mono text-[10px] leading-relaxed text-[hsl(var(--warn))] uppercase tracking-[0.08em]">
            Preview sample — two real EDGAR filings for UI development. Full-universe worker run pending; this surface
            shows nothing until the reviewed export lands. {feed.note}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="t-panel p-4">
          <div className="t-label">Open-market buys</div>
          <div className="t-mono text-xl text-[hsl(var(--live))]">{money.format(buyUsd)}</div>
          <div className="t-mono text-[10px] text-muted-foreground">{buys.length} transaction{buys.length === 1 ? "" : "s"} · code P</div>
        </div>
        <div className="t-panel p-4">
          <div className="t-label">Excluded noise</div>
          <div className="t-mono text-xl text-muted-foreground">{money.format(excludedUsd)}</div>
          <div className="t-mono text-[10px] text-muted-foreground">{excluded.length} rows · M / F / A / G / S</div>
        </div>
        <div className="t-panel p-4">
          <div className="t-label">Unique insiders buying</div>
          <div className="t-mono text-xl">{new Set(buys.map((r) => r.t.ownerCik)).size}</div>
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
      </div>

      <div className="space-y-2 mb-6">
        {(showExcluded ? visible : buys).map(({ t, cls, value }) => {
          const lag = filingLagDays(t);
          return (
            <div key={`${t.accessionNo}-${t.transactionCode}-${t.shares}-${t.ownerCik}`} className={`t-panel p-3 md:p-4 ${cls.included ? "" : "opacity-55"}`}>
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
        {clusters.length === 0 ? (
          <div className="t-mono text-[11px] text-muted-foreground">No cluster windows yet — a cluster needs 3+ distinct insiders buying within 10 days.</div>
        ) : (
          <div className="space-y-2">
            {clusters.map((c) => (
              <div key={`${c.ticker}-${c.windowStart}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-[hsl(var(--border))] rounded px-3 py-2">
                <span className="t-mono text-[12px] font-semibold">{c.ticker}</span>
                <span className="t-mono text-[10px] text-muted-foreground">{c.windowStart} → {c.windowEnd}</span>
                <span className={`t-mono text-[10px] uppercase px-1.5 py-0.5 rounded ${c.strength === "cluster" ? "bg-[hsl(var(--live)/0.15)] text-[hsl(var(--live))]" : "bg-[hsl(var(--accent))] text-muted-foreground"}`}>
                  {c.strength} · {c.uniqueInsiders} insider{c.uniqueInsiders === 1 ? "" : "s"}
                </span>
                <span className="t-mono text-[11px]">{money.format(c.aggregatePurchaseUsd)}</span>
                <span className="t-mono text-[10px] text-muted-foreground">
                  {c.hasCeo ? "CEO " : ""}{c.hasCfo ? "CFO " : ""}{c.hasDirector ? "DIR " : ""}{c.hasTenPercent ? "10% " : ""}
                  {c.status === "partial" ? "· partial" : ""}{c.allPreplanned ? "· 10b5-1" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
