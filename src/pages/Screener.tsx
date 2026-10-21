/**
 * /screener — the universe-wide metrics table (iteration 4a, D28).
 *
 * The daily working surface: every column computed in-house from our own
 * tables (D22), the payload served from the DB cache (D27 — built once,
 * served instantly; the as-of badge says how fresh it is). Sortable by any
 * column, ticker/name search, click-through to the company page. The admin
 * "rebuild" button forces a refresh (owner op — per-company reads).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { jobToast } from "@/lib/job-toast";
import { RefreshCw, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { ScreenerRow } from "../../api/services/screener";

type SortKey = keyof ScreenerRow;

function fmt(n: number | null, digits = 2): string {
  return n === null ? "—" : n.toFixed(digits);
}
function compact(n: number | null): string {
  if (n === null) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(0) + "M";
  return "$" + n.toFixed(0);
}
function pct(n: number | null, digits = 1): string {
  return n === null ? "—" : (n * 100).toFixed(digits) + "%";
}
/** signed pct for the daily change cell, with tone */
function ChangeCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const up = v >= 0;
  return (
    <span className={up ? "text-[hsl(var(--live))]" : "text-[hsl(var(--crit))]"}>
      {up ? "+" : ""}{(v * 100).toFixed(2)}%
    </span>
  );
}
/** 52-week position rendered as a tiny bar + % */
function W52Cell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-10 h-1 bg-[hsl(var(--accent))] rounded-full overflow-hidden">
        <span className="block h-full bg-[hsl(var(--live))]" style={{ width: `${(v * 100).toFixed(0)}%` }} />
      </span>
      {(v * 100).toFixed(0)}%
    </span>
  );
}
/** sentiment tone: positive cyan, negative red, zero dim */
function SentCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const cls = v > 0.05 ? "text-[hsl(var(--live))]" : v < -0.05 ? "text-[hsl(var(--crit))]" : "text-muted-foreground";
  return <span className={cls}>{v >= 0 ? "+" : ""}{v.toFixed(2)}</span>;
}

const COLUMNS: { key: SortKey; label: string; hint?: string }[] = [
  { key: "ticker", label: "Ticker" },
  { key: "name", label: "Company" },
  { key: "sector", label: "Sector" },
  { key: "price", label: "Price" },
  { key: "changePct", label: "Chg%" },
  { key: "marketCap", label: "Mkt cap" },
  { key: "peTtm", label: "P/E TTM" },
  { key: "epsTtm", label: "EPS TTM" },
  { key: "fcfMarginTtm", label: "FCF mgn TTM" },
  { key: "beta", label: "Beta 5Y" },
  { key: "week52Pos", label: "52w pos" },
  { key: "avgVolume3m", label: "Avg vol 3M" },
  { key: "revisionRate", label: "Rev rate", hint: "share of quarters restated between vintages (data quality)" },
  { key: "sentiment", label: "Sentiment", hint: "latest LLM-pair mean aspect score (prototype)" },
];

export default function Screener() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const table = trpc.screener.table.useQuery();
  const refresh = trpc.screener.refresh.useMutation({
    onSuccess: (r) => {
      jobToast("success", "Screener rebuilt", `${r.rows} rows`);
      utils.screener.table.invalidate();
    },
    onError: (e) => jobToast("error", "Rebuild failed", e.message),
  });

  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    let r = table.data?.rows ?? [];
    if (q.trim()) {
      const needle = q.trim().toUpperCase();
      r = r.filter((x) => x.ticker.includes(needle) || x.name.toUpperCase().includes(needle));
    }
    return [...r].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === null || va === undefined) return 1; // nulls always last
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "string" && typeof vb === "string") return sortDir * va.localeCompare(vb);
      return sortDir * (Number(va) - Number(vb));
    });
  }, [table.data, sortKey, sortDir, q]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(-1); }
  };

  return (
    <AppLayout title="Screener">
      <div className="t-panel px-4 py-3 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="FILTER TICKER / NAME"
          className="h-8 w-64 px-3 t-mono text-[11px] uppercase bg-[hsl(var(--secondary)/0.5)] border border-border rounded-md outline-none focus:border-[hsl(var(--live)/0.5)]"
        />
        <span className="t-mono text-[10px] text-muted-foreground">
          {rows.length} companies
          {table.data && (
            <> · computed {table.data.asOf.slice(0, 16).replace("T", " ")} UTC{table.data.fresh ? "" : " · refreshing in background"}</>
          )}
        </span>
        {user?.role === "admin" && (
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="ml-auto inline-flex items-center gap-1.5 border border-[var(--line)] px-3 py-1.5 text-[11px] uppercase tracking-wider hover:border-live-cyan disabled:opacity-50"
          >
            <RefreshCw size={12} className={refresh.isPending ? "animate-spin" : undefined} /> Rebuild
          </button>
        )}
      </div>

      <div className="t-panel mt-4 overflow-x-auto">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr className="border-b border-border">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  title={c.hint}
                  onClick={() => toggleSort(c.key)}
                  className="t-label text-left px-3 py-2.5 font-normal cursor-pointer select-none hover:text-foreground transition-colors"
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key
                      ? (sortDir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)
                      : <ArrowUpDown size={10} className="opacity-30" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border)/0.6)]">
            {rows.map((r) => (
              <tr key={r.cik} className="hover:bg-[hsl(var(--accent)/0.15)] transition-colors t-mono text-[11px]">
                <td className="px-3 py-2 font-semibold">
                  <Link to={`/company/${r.ticker}`} className="text-[hsl(var(--live))] hover:underline underline-offset-2">{r.ticker}</Link>
                </td>
                <td className="px-3 py-2 font-sans text-[12px] max-w-[220px] truncate">{r.name}</td>
                <td className="px-3 py-2 text-muted-foreground font-sans text-[11px]">{r.sector ?? "—"}</td>
                <td className="px-3 py-2">{fmt(r.price)}</td>
                <td className="px-3 py-2"><ChangeCell v={r.changePct} /></td>
                <td className="px-3 py-2">{compact(r.marketCap)}</td>
                <td className="px-3 py-2">{fmt(r.peTtm, 1)}</td>
                <td className="px-3 py-2">{fmt(r.epsTtm)}</td>
                <td className="px-3 py-2">{pct(r.fcfMarginTtm)}</td>
                <td className="px-3 py-2">{fmt(r.beta)}</td>
                <td className="px-3 py-2"><W52Cell v={r.week52Pos} /></td>
                <td className="px-3 py-2">{r.avgVolume3m === null ? "—" : (r.avgVolume3m / 1e6).toFixed(1) + "M"}</td>
                <td className="px-3 py-2">{pct(r.revisionRate)}</td>
                <td className="px-3 py-2"><SentCell v={r.sentiment} /></td>
              </tr>
            ))}
            {rows.length === 0 && !table.isLoading && (
              <tr><td colSpan={COLUMNS.length} className="px-4 py-12 text-center t-mono text-[11px] text-muted-foreground">
                EMPTY — THE UNIVERSE HAS NO COMPANIES YET
              </td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border t-mono text-[9px] text-muted-foreground/70 uppercase tracking-[0.08em]">
          all metrics computed in-house from our own prices + series + scores · served from the DB cache (D27) · free EOD data — not for real-time execution
        </div>
      </div>
    </AppLayout>
  );
}
