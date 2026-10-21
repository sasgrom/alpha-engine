/**
 * PriceOverview (iteration 3f) — the top block of the company Overview tab:
 * quote header (last price, daily change, day range), an interactive daily
 * chart with range chips (1M..ALL), and a stats grid computed entirely from
 * our own accumulated data (prices table + canonical series — D22).
 *
 * Functionally inspired by consumer quote pages, but deliberately NOT a
 * copy: mission-control styling, EOD/delayed data only, and only statistics
 * we can compute and defend in-house. What free sources do not provide
 * (bid/ask, analyst targets) is absent by design.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Area, AreaChart, Brush, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, LineChart as LineChartIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** 4n (D47): stat tiles that chart their own history when clicked. */
const METRIC_BY_LABEL: Record<string, { key: "volume" | "avgVolume3m" | "marketCap" | "epsTtm" | "peTtm" | "beta5y"; note: string }> = {
  "Volume": { key: "volume", note: "mean daily volume per calendar month" },
  "Avg volume (3M)": { key: "avgVolume3m", note: "trailing 63 trading days, month-end points" },
  "Market cap": { key: "marketCap", note: "close × diluted shares outstanding (as-of the month-end)" },
  "EPS (TTM, diluted)": { key: "epsTtm", note: "trailing 4 quarters of diluted EPS (latest vintage)" },
  "P/E (TTM)": { key: "peTtm", note: "close / EPS TTM (null when EPS ≤ 0)" },
  "Beta (5Y monthly vs SPY)": { key: "beta5y", note: "rolling 60-month OLS slope vs SPY (≥24 months)" },
};

/** The metric-history dialog: a chart of one metric's stored month-end series. */
function MetricChartDialog({ cik, label, onClose }: { cik: number; label: string | null; onClose: () => void }) {
  const meta = label ? METRIC_BY_LABEL[label] : undefined;
  const q = trpc.prices.metricHistory.useQuery(
    { cik, metric: meta?.key ?? "volume" },
    { enabled: !!label && !!meta }
  );
  const data = (q.data ?? []).filter((r) => r.value !== null).map((r) => ({ date: r.date, v: r.value as number }));
  return (
    <Dialog open={!!label} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl t-panel !bg-[hsl(var(--card))]">
        <DialogHeader>
          <DialogTitle className="t-mono text-[12px] uppercase tracking-[0.14em] flex items-center gap-2">
            <LineChartIcon size={14} className="text-[hsl(var(--live))]" /> {label} — history
          </DialogTitle>
        </DialogHeader>
        {q.isLoading && <div className="t-mono text-[11px] text-muted-foreground">loading stored history…</div>}
        {!q.isLoading && data.length === 0 && (
          <div className="t-mono text-[11px] text-muted-foreground">NO STORED HISTORY — the metric-history job fills it after prices/series runs (or t_4n_metrics.mts now)</div>
        )}
        {data.length > 0 && (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data} margin={{ top: 6, right: 10, bottom: 4, left: 8 }}>
                <defs>
                  <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(187 86% 53%)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(187 86% 53%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(223 42% 14%)" strokeDasharray="2 4" />
                <XAxis dataKey="date" tick={{ fill: "hsl(217 20% 62%)", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(d: string) => d.slice(0, 7)} minTickGap={48} />
                <YAxis tick={{ fill: "hsl(217 20% 62%)", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v: number) => compact(v)} width={64} />
                <Tooltip
                  contentStyle={{ background: "hsl(219 43% 12%)", border: "1px solid hsl(223 42% 18%)", borderRadius: 6, fontFamily: "JetBrains Mono", fontSize: 11 }}
                  formatter={(v: number) => [compact(v), meta?.key ?? "value"]}
                />
                <Area type="monotone" dataKey="v" stroke="hsl(187 86% 53%)" strokeWidth={1.75} fill="url(#metricFill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="t-mono text-[9px] text-muted-foreground mt-2 uppercase tracking-[0.06em]">
              {meta?.note} · {data.length} month-end points · pre-computed (metric_history, D47) — instant display
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const RANGES = ["1M", "3M", "6M", "YTD", "1Y", "5Y", "ALL"] as const;

function money(n: number | null | undefined, digits = 2) {
  return n === null || n === undefined ? "—" : n.toFixed(digits);
}

function compact(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

export default function PriceOverview({ cik }: { cik: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1Y");
  // 4n (D47): which stat tile's history chart is open (null = none)
  const [chartMetric, setChartMetric] = useState<string | null>(null);
  const quote = trpc.prices.quote.useQuery({ cik });
  const hist = trpc.prices.history.useQuery(
    { cik, range },
    { enabled: quote.data?.available === true }
  );
  // 4a (D28): earnings events (8-K Item 2.02) as chart markers
  const evts = trpc.events.byCompany.useQuery({ cik }, { enabled: quote.data?.available === true });

  const chartData = useMemo(
    () =>
      (hist.data?.bars ?? [])
        .filter((b) => b.close !== null)
        .map((b) => ({ date: b.date, close: b.close as number, volume: b.volume })),
    [hist.data]
  );

  // 4f (D38): the % change of the SELECTED chart window — computed on the fly
  // in the browser from the bars we already ship (no prepared table needed)
  const [brushIdx, setBrushIdx] = useState<{ startIndex?: number; endIndex?: number } | null>(null);
  const rangeStats = useMemo(() => {
    if (chartData.length === 0) return null;
    const hasBrush =
      brushIdx &&
      brushIdx.startIndex !== undefined &&
      brushIdx.endIndex !== undefined &&
      (brushIdx.startIndex > 0 || brushIdx.endIndex < chartData.length - 1);
    const slice = hasBrush ? chartData.slice(brushIdx.startIndex, brushIdx.endIndex! + 1) : chartData;
    if (slice.length === 0) return null;
    const first = slice[0].close;
    const last = slice[slice.length - 1].close;
    let hi = -Infinity, lo = Infinity;
    for (const b of slice) { if (b.close > hi) hi = b.close; if (b.close < lo) lo = b.close; }
    return {
      mode: hasBrush ? "selection" : "range",
      from: slice[0].date,
      to: slice[slice.length - 1].date,
      abs: last - first,
      pct: first !== 0 ? (last - first) / first : null,
      hi, lo,
      n: slice.length,
    };
  }, [chartData, brushIdx]);

  // earnings events visible in the current chart window (ReferenceLine needs
  // an exact x value — snap to the nearest bar date)
  const eventMarks = useMemo(() => {
    if (!evts.data || chartData.length === 0) return [];
    const barDates = new Set(chartData.map((b) => b.date));
    const lo = chartData[0].date;
    const hi = chartData[chartData.length - 1].date;
    return evts.data
      .map((e) => e.eventDate)
      .filter((d) => d >= lo && d <= hi)
      .map((d) => (barDates.has(d) ? d : null))
      .filter((d): d is string => d !== null);
  }, [evts.data, chartData]);

  if (quote.isLoading) {
    return <div className="t-mono text-[11px] text-muted-foreground">loading prices…</div>;
  }

  // empty state: no bars accumulated yet — point to the prices job, honestly
  if (!quote.data?.available) {
    return (
      <div className="t-panel-inset border-dashed px-4 py-10 text-center">
        <div className="t-mono text-[11px] text-muted-foreground">
          NO PRICE HISTORY YET — RUN A «prices» JOB (STAGE 1.7) TO ACCUMULATE DAILY BARS
        </div>
        <div className="t-mono text-[9px] text-muted-foreground mt-2 opacity-70">
          free providers · end-of-day · resumable backfill — history accrues run over run
        </div>
      </div>
    );
  }

  const q = quote.data;
  const up = (q.change ?? 0) >= 0;
  const toneCls = up ? "text-[hsl(var(--live))]" : "text-[hsl(var(--crit))]";

  const stats: [string, string][] = [
    ["Previous close", money(q.prevClose)],
    ["Open", money(q.open)],
    ["Day range", q.dayLow !== null && q.dayHigh !== null ? `${money(q.dayLow)} – ${money(q.dayHigh)}` : "—"],
    ["52-week range", q.week52Low !== null && q.week52High !== null ? `${money(q.week52Low)} – ${money(q.week52High)}` : "—"],
    ["Volume", compact(q.volume)],
    ["Avg volume (3M)", compact(q.avgVolume3m)],
    ["Market cap", q.marketCap !== null ? "$" + compact(q.marketCap) : "—"],
    ["EPS (TTM, diluted)", money(q.epsTtm)],
    ["P/E (TTM)", money(q.peTtm, 1)],
    ["Beta (5Y monthly vs SPY)", money(q.beta)],
  ];

  return (
    <div className="space-y-3">
      {/* quote header — 4f (D38): the change is explicitly the LAST TRADING
          DAY's (EOD feed, not live), with the freshness date on it */}
      <div className="t-panel px-5 py-4">
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className="t-mono text-[26px] font-semibold">{money(q.price)}</span>
          <span className={`t-mono text-[14px] ${toneCls}`}>
            {up ? "+" : ""}{money(q.change)} ({up ? "+" : ""}{q.changePct !== null ? (q.changePct * 100).toFixed(2) : "—"}%)
          </span>
          <span className="t-mono text-[9px] text-muted-foreground uppercase tracking-[0.08em]">
            day change · last close vs prev close
          </span>
          <span className="t-mono text-[10px] text-muted-foreground ml-auto">
            as of {q.asOf} · {q.source} · end-of-day
          </span>
        </div>
      </div>

      {/* chart with range chips */}
      <div className="t-panel p-4">
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => { setRange(r); setBrushIdx(null); }}
              className={`t-mono text-[10px] px-2.5 py-1 rounded border transition-colors ${
                range === r
                  ? "border-[hsl(var(--live)/0.6)] text-[hsl(var(--live))] bg-[hsl(var(--live)/0.08)]"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
          {/* 4f (D38): the selected window's performance — browser-computed */}
          {rangeStats && (
            <span className="t-mono text-[10px] ml-2 flex items-center gap-2">
              <span className="text-muted-foreground uppercase">{rangeStats.mode === "selection" ? "selection" : range}</span>
              <span className={rangeStats.pct !== null && rangeStats.pct >= 0 ? "text-[hsl(var(--live))]" : "text-[hsl(var(--crit))]"}>
                {rangeStats.abs >= 0 ? "+" : ""}{money(rangeStats.abs)} ({rangeStats.pct !== null ? `${rangeStats.pct >= 0 ? "+" : ""}${(rangeStats.pct * 100).toFixed(1)}%` : "—"})
              </span>
              <span className="text-muted-foreground">{rangeStats.from} → {rangeStats.to}</span>
              <span className="text-muted-foreground/70">hi {money(rangeStats.hi)} · lo {money(rangeStats.lo)}</span>
            </span>
          )}
          <span className="t-mono text-[9px] text-muted-foreground ml-auto">
            {chartData.length} daily bars{hist.data?.source ? ` · ${hist.data.source}` : ""}
          </span>
        </div>
        {hist.isLoading ? (
          <div className="h-[260px] flex items-center justify-center t-mono text-[11px] text-muted-foreground">loading…</div>
        ) : chartData.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center t-mono text-[11px] text-muted-foreground">
            NO BARS IN THIS RANGE YET — HISTORY ACCRUES DAILY
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(187 86% 53%)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(187 86% 53%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(223 42% 14%)" strokeDasharray="2 4" />
              <XAxis
                dataKey="date"
                tick={{ fill: "hsl(217 20% 62%)", fontSize: 10, fontFamily: "JetBrains Mono" }}
                /* tick density follows the range: short ranges label by day,
                   mid ranges by month, ALL by year (3h review fix — a plain
                   YYYY-MM formatter repeated the same label on 1M/3M) */
                tickFormatter={
                  range === "1M" || range === "3M"
                    ? (d: string) => d.slice(5)
                    : range === "ALL"
                      ? (d: string) => d.slice(0, 4)
                      : (d: string) => d.slice(0, 7)
                }
                minTickGap={48}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "hsl(217 20% 62%)", fontSize: 10, fontFamily: "JetBrains Mono" }}
                tickFormatter={(v: number) => compact(v)}
                width={56}
              />
              <Tooltip
                contentStyle={{ background: "hsl(219 43% 12%)", border: "1px solid hsl(223 42% 18%)", borderRadius: 6, fontFamily: "JetBrains Mono", fontSize: 11 }}
                formatter={(v: number, name: string) => [name === "close" ? money(v) : compact(v), name === "close" ? "close" : "volume"]}
                labelFormatter={(d: string) => d}
              />
              <Area type="monotone" dataKey="close" stroke="hsl(187 86% 53%)" strokeWidth={1.75} fill="url(#priceFill)" dot={false} activeDot={{ r: 3, fill: "hsl(187 86% 53%)" }} />
              {/* 4a: earnings releases (8-K Item 2.02) — amber dashed */}
              {eventMarks.map((d) => (
                <ReferenceLine key={d} x={d} stroke="hsl(43 96% 56%)" strokeDasharray="3 3" strokeOpacity={0.55} />
              ))}
              {/* 4f (D38): drag an arbitrary sub-range — the stats strip above
                  switches to SELECTION (start/end, Δ%, Δ$, hi/lo) */}
              <Brush
                dataKey="date"
                height={22}
                travellerWidth={8}
                stroke="hsl(223 42% 25%)"
                fill="hsl(222 45% 7%)"
                tickFormatter={(d: string) => String(d).slice(2)}
                onChange={(s: unknown) => setBrushIdx(s as { startIndex?: number; endIndex?: number })}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <div className="t-mono text-[9px] text-muted-foreground mt-2 flex items-center gap-1.5 flex-wrap">
          <AlertTriangle size={11} className="text-[hsl(var(--warn))]" />
          FREE EOD DATA — NOT FOR REAL-TIME EXECUTION; SOURCES MAY REVISE / DIFFER (SOURCE TAGGED PER BAR)
          {eventMarks.length > 0 && (
            <span className="text-[hsl(var(--warn))]">· {eventMarks.length} EARNINGS EVENT{eventMarks.length > 1 ? "S" : ""} MARKED (8-K ITEM 2.02, AMBER DASHED)</span>
          )}
        </div>
      </div>

      {/* stats grid — all computed in-house; 4n: history-backed tiles chart
          on click (the metric history is stored, so display is immediate) */}
      <div className="t-panel px-5 py-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-x-8 gap-y-3">
          {stats.map(([k, v]) => {
            const chartable = k in METRIC_BY_LABEL;
            return (
              <div
                key={k}
                role={chartable ? "button" : undefined}
                tabIndex={chartable ? 0 : undefined}
                onClick={() => chartable && setChartMetric(k)}
                onKeyDown={(e) => chartable && e.key === "Enter" && setChartMetric(k)}
                className={chartable ? "cursor-pointer rounded-sm px-1 -mx-1 transition-colors hover:bg-[hsl(var(--accent)/0.25)]" : ""}
                title={chartable ? "chart this metric's history" : undefined}
              >
                <div className="t-label !text-[9px] flex items-center gap-1">
                  {k}
                  {chartable && <LineChartIcon size={9} className="text-[hsl(var(--live))] opacity-70" />}
                </div>
                <div className="t-mono text-[12px] mt-0.5">{v}</div>
              </div>
            );
          })}
        </div>
        <div className="t-mono text-[9px] text-muted-foreground mt-3 opacity-70">
          MARKET CAP = PRICE × DILUTED SHARES (OUR SERIES) · P/E FROM TTM DILUTED EPS (OUR SERIES) · BID/ASK AND ANALYST TARGETS ARE NOT AVAILABLE FROM FREE SOURCES · CHART-ICON TILES OPEN THE STORED HISTORY
        </div>
      </div>

      {/* 4n: the metric history chart dialog */}
      <MetricChartDialog cik={cik} label={chartMetric} onClose={() => setChartMetric(null)} />
    </div>
  );
}
