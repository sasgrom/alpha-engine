/**
 * Statements viewer (iteration 3e) — curated financial statements on the
 * company page: income / balance / cash flow / ratios over the fiscal-quarter
 * grid (labels respect the company's fiscalYearEnd: MSFT columns end Jun 30,
 * NVDA — Jan 31). Three vintage modes ride on the D2 revision store:
 *   latest      — post-restatement truth
 *   first       — as originally reported
 *   as of [date]— what was known on date T (backtest-safe, no lookahead)
 * Derived rows (italic, "∂") are computed from the resolved base rows —
 * never fetched from an external source. Rows whose underlying series is
 * flagged by the health checks carry an amber triangle.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { Link } from "react-router";

type UnitScale = "auto" | "B" | "M" | "K";

interface Cell {
  v: number | null;
  partial?: boolean;
}
interface Row {
  key: string;
  label: string;
  indent: number;
  unit: "money" | "shares" | "perShare" | "pct" | "x";
  derived: boolean;
  concept: string | null;
  usedConcepts: string[];
  flagged: boolean;
  /** 4f: last period carrying a value when the tag was discontinued */
  staleSince: string | null;
  cells: Cell[];
  yoy: (number | null)[];
}

/** Scale a whole row so all cells share one unit (B/M/K) — Tiingo-style. */
function rowScale(row: Row, override: UnitScale): { div: number; suffix: string } {
  if (override !== "auto") return { div: { B: 1e9, M: 1e6, K: 1e3 }[override], suffix: override };
  const max = Math.max(...row.cells.map((c) => Math.abs(c.v ?? 0)), 0);
  if (max >= 1e9) return { div: 1e9, suffix: "B" };
  if (max >= 1e6) return { div: 1e6, suffix: "M" };
  return { div: 1e3, suffix: "K" };
}

function fmtCell(row: Row, v: number | null, scale: { div: number; suffix: string }): string {
  if (v == null) return "—";
  switch (row.unit) {
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "x":
      return `${v.toFixed(2)}x`;
    case "perShare":
      return `$${v.toFixed(2)}`;
    case "shares":
      return `${(v / scale.div).toFixed(2)}${scale.suffix}`;
    default:
      return `${v < 0 ? "-" : ""}$${(Math.abs(v) / scale.div).toFixed(2)}${scale.suffix}`;
  }
}

/** YoY sub-line: money/shares → relative %, pct/x rows → points. */
function fmtYoy(row: Row, y: number | null): string | null {
  if (y == null) return null;
  const sign = y > 0 ? "+" : "";
  return row.unit === "pct" ? `${sign}${(y * 100).toFixed(1)}pp` : row.unit === "x" ? `${sign}${y.toFixed(2)}x` : `${sign}${(y * 100).toFixed(1)}%`;
}

export default function Statements({ cik }: { cik: number }) {
  const [mode, setMode] = useState<"quarterly" | "annual">("quarterly");
  const [vintage, setVintage] = useState<"latest" | "first" | "asOf">("latest");
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [scale, setScale] = useState<UnitScale>("auto");
  // 4f (D37): health flags / partial markers / derivation badges are a DEBUG
  // surface — the owner called the amber overload "перебор" for prod
  const [debug, setDebug] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({
    income: true,
    balance: true,
    cashflow: true,
    ratios: true,
  });

  const q = trpc.series.statements.useQuery({
    cik,
    mode,
    vintage,
    asOf: vintage === "asOf" ? asOf : undefined,
    // 4f: the data goes back to ~2008 — the windows were just narrow
    periods: mode === "quarterly" ? 20 : 10,
  });

  const scales = useMemo(() => {
    const m = new Map<string, { div: number; suffix: string }>();
    for (const s of q.data?.sections ?? []) for (const r of s.rows) m.set(r.key, rowScale(r, scale));
    return m;
  }, [q.data, scale]);

  const empty = q.data && q.data.sections.length === 0;

  return (
    <div className="space-y-3">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex border border-border rounded-md overflow-hidden">
          {(["quarterly", "annual"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 h-8 t-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                mode === m ? "bg-[hsl(var(--live)/0.15)] text-[hsl(var(--live))]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "quarterly" ? "Quarterly" : "Annual"}
            </button>
          ))}
        </div>
        <Select value={vintage} onValueChange={(v) => setVintage(v as typeof vintage)}>
          <SelectTrigger className="h-8 w-52 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Latest (restated)</SelectItem>
            <SelectItem value="first">As reported (first)</SelectItem>
            <SelectItem value="asOf">As of date…</SelectItem>
          </SelectContent>
        </Select>
        {vintage === "asOf" && (
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-8 px-2 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)] border border-border rounded-md text-foreground"
          />
        )}
        <Select value={scale} onValueChange={(v) => setScale(v as UnitScale)}>
          <SelectTrigger className="h-8 w-24 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">auto</SelectItem>
            <SelectItem value="B">$B</SelectItem>
            <SelectItem value="M">$M</SelectItem>
            <SelectItem value="K">$K</SelectItem>
          </SelectContent>
        </Select>
        {q.data?.vintageNote && (
          <span className="t-mono text-[9px] text-[hsl(var(--warn))] uppercase tracking-[0.08em]">{q.data.vintageNote}</span>
        )}
        {/* 4f (D37): debug toggle — health flags, partial-year markers and
            derivation badges live behind it; prod shows values only */}
        <label className="flex items-center gap-1.5 t-mono text-[9px] text-muted-foreground uppercase tracking-[0.08em] cursor-pointer select-none ml-auto">
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
          debug
        </label>
        {q.isFetching && <span className="radar !w-3 !h-3" />}
      </div>

      {empty && (
        <div className="t-panel px-5 py-8 text-center space-y-2">
          <div className="t-mono text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
            No series built for this company yet
          </div>
          <div className="text-[11px] text-muted-foreground">
            Statements are resolved from the canonical series layer. Run a <span className="t-mono">series</span> job from the{" "}
            <Link to="/jobs" className="text-[hsl(var(--live))] hover:underline">Jobs</Link> page first.
          </div>
        </div>
      )}

      {/* sections */}
      {(q.data?.sections ?? []).map((sec) => (
        <div key={sec.key} className="t-panel overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border hover:bg-[hsl(var(--accent)/0.2)] transition-colors"
            onClick={() => setOpen((o) => ({ ...o, [sec.key]: !o[sec.key] }))}
          >
            {open[sec.key] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="t-label !text-[10px]">{sec.title}</span>
          </button>
          {open[sec.key] && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-10 bg-[hsl(222_45%_9%)] t-label text-left px-4 py-2 font-normal min-w-[220px]">Line item</th>
                    {q.data!.periods.map((p) => (
                      <th key={p.end} className="t-label text-right px-3 py-2 font-normal whitespace-nowrap">
                        {p.label}
                        <span className="block !text-[8px] text-muted-foreground/60 tracking-normal">{p.end}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--border)/0.5)]">
                  {sec.rows.map((r) => (
                    <tr key={r.key} className="hover:bg-[hsl(var(--accent)/0.12)]">
                      <td
                        className={`sticky left-0 z-10 bg-[hsl(222_45%_9%)] px-4 py-1.5 text-[11px] whitespace-nowrap ${
                          r.indent > 0 ? "pl-7 text-muted-foreground" : "text-foreground"
                        } ${r.derived ? "italic" : ""}`}
                        title={r.concept ?? "derived from statement rows"}
                      >
                        {r.derived && <span className="text-[hsl(var(--live))] mr-1" title="derived, not reported">∂</span>}
                        {r.label}
                        {/* 4f: health-flag triangles are debug-only */}
                        {debug && r.flagged && (
                          <AlertTriangle size={10} className="inline ml-1.5 text-[hsl(var(--warn))]">
                            <title>series flagged by health checks</title>
                          </AlertTriangle>
                        )}
                        {/* 4f: honest discontinuation marker — the tag ended,
                            the tail is empty because the filer stopped
                            reporting this line, not because data is missing */}
                        {r.staleSince && (
                          <span className="block t-mono text-[8px] text-[hsl(var(--warn))] tracking-[0.06em] uppercase">
                            tag ended {r.staleSince.slice(0, 7)}
                          </span>
                        )}
                      </td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="px-3 py-1.5 text-right t-mono whitespace-nowrap">
                          <span className={`text-[11px] ${c.v == null ? "text-muted-foreground/40" : ""}`}>
                            {fmtCell(r, c.v, scales.get(r.key) ?? { div: 1e9, suffix: "B" })}
                            {/* 4f: the partial-year asterisk is debug-mode
                                too — with the derivation fixed, real partials
                                are rare (in-progress FY only) */}
                            {debug && c.partial && <span title="partial fiscal year — fewer than 4 quarters" className="text-[hsl(var(--warn))]">*</span>}
                          </span>
                          {fmtYoy(r, r.yoy[i]) && (
                            <span className={`block text-[9px] ${r.yoy[i]! >= 0 ? "text-[hsl(var(--ok))]" : "text-[hsl(var(--crit))]"}`}>
                              {fmtYoy(r, r.yoy[i])} YoY
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* legend */}
      {!empty && (q.data?.sections.length ?? 0) > 0 && (
        <div className="t-mono text-[9px] text-muted-foreground/70 uppercase tracking-[0.08em] px-1 flex items-center gap-3">
          <span>∂ derived from statement rows</span>
          <span className="flex items-center gap-1"><AlertTriangle size={9} className="text-[hsl(var(--warn))]" /> series flagged by health checks</span>
          <span>* partial fiscal year</span>
          <span className="flex items-center gap-1"><FlaskConical size={9} /> full concept list in the series explorer below</span>
        </div>
      )}
    </div>
  );
}
