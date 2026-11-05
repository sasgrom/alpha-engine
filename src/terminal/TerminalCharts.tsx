import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ExternalLink } from "lucide-react";
import { formatTerminalCompact, formatTerminalMoney, formatTerminalPct, movingAverage, type PriceAnalytics, type TerminalPriceBar } from "./terminal-data";

const CHART_COLORS = ["#2251ff", "#22d3ee", "#7d9bff", "#42566a", "#8595a6", "#1233b8", "#008a6d", "#b07a10"];

function ChartTooltip({ active, payload, label, money = false }: { active?: boolean; payload?: Array<{ name?: string; value?: number | string; color?: string }>; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="terminal-tooltip">
      <span>{label}</span>
      {payload.map((item, index) => (
        <strong key={`${item.name}-${index}`} style={{ color: item.color }}>
          {item.name}: {money ? formatTerminalMoney(Number(item.value)) : typeof item.value === "number" && Math.abs(item.value) < 1 ? formatTerminalPct(item.value, 2, true) : item.value}
        </strong>
      ))}
    </div>
  );
}

export function TerminalPriceChart({ bars, events, reducedMotion }: { bars: TerminalPriceBar[]; events: string[]; reducedMotion: boolean }) {
  const average = useMemo(() => movingAverage(bars, 20), [bars]);
  const data = useMemo(() => bars.map((bar, index) => ({ ...bar, average: average[index]?.value ?? null })), [average, bars]);
  return (
    <div className="terminal-chart terminal-chart-large" data-testid="terminal-price-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 14, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="terminalPriceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--t-accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--t-accent)" stopOpacity={0.015} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--t-line-soft)" strokeDasharray="2 6" />
          <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} minTickGap={48} tick={{ fill: "var(--t-faint)", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fill: "var(--t-faint)", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={58} tickFormatter={(value: number) => formatTerminalCompact(value)} />
          <YAxis yAxisId="volume" orientation="right" hide domain={[0, "dataMax * 4"]} />
          <Tooltip content={<ChartTooltip money />} cursor={{ stroke: "var(--t-accent)", strokeOpacity: 0.25 }} />
          <Bar yAxisId="volume" dataKey="volume" fill="var(--t-accent)" fillOpacity={0.09} isAnimationActive={!reducedMotion} />
          <Area yAxisId="price" type="monotone" dataKey="close" name="Close" stroke="var(--t-accent)" strokeWidth={2.2} fill="url(#terminalPriceFill)" dot={false} activeDot={{ r: 4, fill: "var(--t-accent)" }} isAnimationActive={!reducedMotion} />
          <Line yAxisId="price" type="monotone" dataKey="average" name="20-day average" stroke="var(--t-muted)" strokeWidth={1.1} strokeDasharray="5 5" dot={false} isAnimationActive={!reducedMotion} />
          {events.map((date) => <ReferenceLine key={date} yAxisId="price" x={date} stroke="var(--t-warn)" strokeDasharray="3 5" label={{ value: "E", position: "insideTopLeft", fill: "var(--t-warn)", fontSize: 10 }} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SectorDonut({ rows, reducedMotion }: { rows: Array<{ sector: string | null; count: number }>; reducedMotion: boolean }) {
  const data = rows.map((row) => ({ ...row, sector: row.sector || "Unclassified" }));
  return (
    <div className="terminal-sector-wrap">
      <div className="terminal-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="sector" innerRadius="68%" outerRadius="93%" paddingAngle={1.5} stroke="var(--t-surface)" strokeWidth={2} isAnimationActive={!reducedMotion}>
              {data.map((row, index) => <Cell key={row.sector} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="terminal-donut-center"><strong>{data.reduce((sum, row) => sum + row.count, 0)}</strong><span>companies</span></div>
      </div>
      <div className="terminal-sector-legend">
        {data.map((row, index) => (
          <div key={row.sector}>
            <span className="terminal-legend-dot" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <span>{row.sector}</span>
            <strong>{row.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DrawdownChart({ analytics, reducedMotion }: { analytics: PriceAnalytics; reducedMotion: boolean }) {
  return (
    <div className="terminal-chart terminal-chart-small">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={analytics.drawdown} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <defs><linearGradient id="terminalDrawdownFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--t-neg)" stopOpacity={0.03} /><stop offset="100%" stopColor="var(--t-neg)" stopOpacity={0.24} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="var(--t-line-soft)" strokeDasharray="2 6" />
          <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} minTickGap={70} tick={{ fill: "var(--t-faint)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis domain={["auto", 0]} tickFormatter={(value: number) => formatTerminalPct(value, 0)} tick={{ fill: "var(--t-faint)", fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="value" name="Drawdown" stroke="var(--t-neg)" strokeWidth={1.7} fill="url(#terminalDrawdownFill)" dot={false} isAnimationActive={!reducedMotion} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReturnHistogram({ analytics, reducedMotion }: { analytics: PriceAnalytics; reducedMotion: boolean }) {
  return (
    <div className="terminal-chart terminal-chart-small">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={analytics.histogram} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--t-line-soft)" strokeDasharray="2 6" />
          <XAxis dataKey="label" tick={{ fill: "var(--t-faint)", fontSize: 9 }} axisLine={false} tickLine={false} interval={1} tickFormatter={(label: string) => {
            if (!label.includes("…")) return label;
            const [from, to] = label.split("…").map((part) => Number.parseFloat(part));
            return `${((from + to) / 2).toFixed(1)}%`;
          }} />
          <YAxis allowDecimals={false} tick={{ fill: "var(--t-faint)", fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="count" name="Trading days" isAnimationActive={!reducedMotion}>
            {analytics.histogram.map((bin) => <Cell key={bin.label} fill={bin.max < 0 ? "var(--t-neg)" : bin.min >= 0 ? "var(--t-pos)" : "var(--t-accent)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface TerminalScreenerRow {
  cik: number;
  ticker: string;
  name: string;
  sector: string | null;
  price: number | null;
  changePct: number | null;
  marketCap: number | null;
  peTtm: number | null;
  week52Pos: number | null;
}

export function MarketLeaders({ rows, onSelect }: { rows: TerminalScreenerRow[]; onSelect: (ticker: string) => void }) {
  const eligible = rows.filter((row) => row.changePct !== null);
  const leaders = [...eligible].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 3);
  const laggards = [...eligible].sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 3);
  const max = Math.max(0.001, ...eligible.map((row) => Math.abs(row.changePct ?? 0)));
  return (
    <div className="terminal-leaders">
      {[...leaders, ...laggards].map((row) => {
        const positive = (row.changePct ?? 0) >= 0;
        return (
          <button type="button" key={row.ticker} onClick={() => onSelect(row.ticker)}>
            <span className="terminal-leader-icon">{positive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</span>
            <span className="terminal-leader-name"><strong>{row.ticker}</strong><small>{row.sector || "Unclassified"}</small></span>
            <span className="terminal-leader-track"><span style={{ width: `${Math.max(4, Math.abs(row.changePct ?? 0) / max * 100)}%` }} className={positive ? "positive" : "negative"} /></span>
            <strong className={positive ? "positive" : "negative"}>{formatTerminalPct(row.changePct, 2, true)}</strong>
          </button>
        );
      })}
    </div>
  );
}

interface ScenarioBaseline {
  value: number;
  scenarioValue: number;
  unit: string;
  observationPeriod: string;
  availableAt: string;
}

export interface ScenarioReport {
  asOf: string;
  dataMode: string;
  scenarios: Array<{ channel: string; shock: number; status: string; baseline: ScenarioBaseline | null }>;
}

export function ScenarioPanel({ report }: { report: ScenarioReport | null }) {
  if (!report) {
    return <div className="terminal-empty"><CalendarDays size={20} /><strong>Scenario pack is being prepared</strong><p>The terminal will show the next reviewed macro scenarios here. No values are inferred from missing evidence.</p></div>;
  }
  return (
    <div className="terminal-scenarios">
      {report.scenarios.map((scenario) => {
        const rate = scenario.channel === "rates" || scenario.channel === "credit";
        const baseline = scenario.baseline;
        const change = baseline ? baseline.scenarioValue - baseline.value : 0;
        const max = baseline ? Math.max(Math.abs(baseline.value), Math.abs(baseline.scenarioValue), 0.0001) : 1;
        return (
          <div className="terminal-scenario-row" key={scenario.channel}>
            <div><strong>{scenario.channel.toUpperCase()}</strong><span>{rate ? `${scenario.shock >= 0 ? "+" : ""}${(scenario.shock * 10000).toFixed(0)} bp` : `${scenario.shock >= 0 ? "+" : ""}${(scenario.shock * 100).toFixed(0)}%`} · {scenario.status.replaceAll("_", " ")}</span></div>
            {baseline ? (
              <>
                <div className="terminal-scenario-track"><span style={{ width: `${Math.min(100, Math.abs(baseline.scenarioValue) / max * 100)}%` }} /></div>
                <div className="terminal-scenario-values"><span>{formatTerminalMoney(baseline.value)} {baseline.unit}</span><strong>{formatTerminalMoney(baseline.scenarioValue)} {baseline.unit}</strong><small>{change >= 0 ? "+" : ""}{formatTerminalMoney(change)}</small></div>
              </>
            ) : <span className="terminal-muted">No current baseline</span>}
          </div>
        );
      })}
      <p className="terminal-source-note">Reviewed snapshot {report.asOf.slice(0, 10)} · scenarios are conditional arithmetic, not forecasts.</p>
    </div>
  );
}

export interface TerminalFiling {
  id: number;
  cik: number;
  ticker: string;
  name: string | null;
  form: string;
  filingDate: string | null;
  accessionNo: string;
}

export function DisclosureTimeline({ filings }: { filings: TerminalFiling[] }) {
  if (!filings.length) return <div className="terminal-empty"><CalendarDays size={20} /><strong>No recent disclosures</strong><p>New filings for your universe will appear here as they become available.</p></div>;
  return (
    <div className="terminal-timeline">
      {filings.map((filing) => (
        <a key={filing.id} href={`https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accessionNo.replaceAll("-", "")}`} target="_blank" rel="noreferrer" className="terminal-filing">
          <span className="terminal-filing-date">{filing.filingDate ?? "—"}</span>
          <span className={`terminal-form form-${filing.form.replace("/", "-")}`}>{filing.form}</span>
          <span className="terminal-filing-copy"><strong>{filing.ticker}</strong><span>{filing.name}</span></span>
          <ExternalLink size={13} />
        </a>
      ))}
    </div>
  );
}

export function WatchlistTable({ rows, onSelect }: { rows: TerminalScreenerRow[]; onSelect: (ticker: string) => void }) {
  const sorted = [...rows].sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1)).slice(0, 15);
  return (
    <div className="terminal-table-wrap">
      <small className="terminal-table-hint">Swipe for price, day change, market cap, P/E and 52-week position →</small>
      <table className="terminal-table">
        <thead><tr><th>Company</th><th>Sector</th><th>Last</th><th>Day</th><th>Market cap</th><th>P/E</th><th>52-week position</th></tr></thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.ticker}>
              <td><button type="button" onClick={() => onSelect(row.ticker)}><strong>{row.ticker}</strong><span>{row.name}</span></button></td>
              <td>{row.sector || "—"}</td>
              <td>{formatTerminalMoney(row.price)}</td>
              <td className={(row.changePct ?? 0) >= 0 ? "positive" : "negative"}>{formatTerminalPct(row.changePct, 2, true)}</td>
              <td>{formatTerminalCompact(row.marketCap)}</td>
              <td>{formatTerminalMoney(row.peTtm, 1)}</td>
              <td><div className="terminal-52w"><span><i style={{ width: `${Math.min(100, Math.max(0, (row.week52Pos ?? 0) * 100))}%` }} /></span><small>{formatTerminalPct(row.week52Pos, 0)}</small></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
