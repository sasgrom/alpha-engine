import { useEffect, useMemo, useState } from "react";
import { Activity, Clock3, Globe2, ShieldAlert } from "lucide-react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SchwabContextReport, SchwabIntradaySeries } from "../../worker/lib/schwab-context";

const price = (value: number | null) => value === null ? "—" : value.toFixed(2);
const percent = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const volume = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const clock = (value: string) => value ? value.slice(11, 16) : "—";

function ContextMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="t-panel market-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}
function IntradayChart({ series }: { series: SchwabIntradaySeries }) {
  const data = series.bars.slice(-48).map((bar) => ({ time: new Date(bar.datetime).toISOString().slice(11, 16), close: bar.close }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 16, right: 18, left: 0, bottom: 4 }}>
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={54} />
        <Tooltip formatter={(value) => [price(Number(value)), "Close"]} labelFormatter={(label) => `Time ${label}`} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
        {series.vwap !== null && <ReferenceLine y={series.vwap} stroke="hsl(var(--warn))" strokeDasharray="5 4" label={{ value: "VWAP", fill: "hsl(var(--warn))", fontSize: 10, position: "insideTopRight" }} />}
        <Line type="monotone" dataKey="close" stroke="hsl(var(--live))" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function SchwabContext() {
  const [report, setReport] = useState<SchwabContextReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [index, setIndex] = useState("SPX");
  const [intradayTicker, setIntradayTicker] = useState("AAPL");
  const [profileTicker, setProfileTicker] = useState("AAPL");
  useEffect(() => {
    let active = true;
    void fetch("/reports/schwab-context.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(`Context HTTP ${response.status}`); return response.json() as Promise<SchwabContextReport>; })
      .then((value) => { if (active) { setReport(value); setStatus("ready"); } })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, []);
  const movers = useMemo(() => report?.movers.find((group) => group.index === index)?.rows ?? [], [report, index]);
  const series = report?.intraday.find((item) => item.ticker === intradayTicker);
  const profile = report?.instruments.find((item) => item.symbol === profileTicker);

  if (status === "loading") return <section className="t-panel market-empty"><Activity size={22} /><h2>Loading Market Context</h2><p>Reading market hours, movers, instrument profiles and intraday bars.</p></section>;
  if (status === "error") return <section className="t-panel market-empty"><ShieldAlert size={22} /><h2>Context unavailable</h2><p>Run <code>npx tsx worker/schwab-context.mts</code>. This is separate from option-chain collection.</p></section>;
  if (!report) return null;

  return (
    <div className="context-lab">
      <section className="market-metric-grid">
        <ContextMetric label="Context endpoints" value={`${report.coverage.complete} / ${report.coverage.expected}`} note="Hours + movers + intraday + instruments" />
        <ContextMetric label="Endpoint errors" value={String(report.coverage.errors)} note="Explicit, never hidden" />
        {(["equity", "option"] as const).map((market) => {
          const session = report.hours[market];
          const state = session.isHoliday ? "Holiday" : !session.regularMarket.length ? "Schedule unknown" : session.isOpen ? "Open" : "Closed";
          return <ContextMetric key={market} label={`${market} hours`} value={state} note={session.regularMarket.length ? `${clock(session.regularMarket[0].start)}–${clock(session.regularMarket[0].end)} · ${session.date}` : session.date} />;
        })}
      </section>

      <section className="context-grid">
        <div className="t-panel context-section">
          <div className="context-section-heading"><Globe2 size={15} /><div><strong>Market movers</strong><span>Top movers returned by Schwab, not an alpha ranking</span></div></div>
          <div className="context-selector-row">{report.movers.map((group) => <button type="button" key={group.index} className={index === group.index ? "active" : ""} onClick={() => setIndex(group.index)}>{group.index}</button>)}</div>
          {movers.length ? <div className="market-table-wrap"><table className="market-table context-movers-table"><thead><tr><th>Symbol</th><th>Last</th><th>Change</th><th>%</th><th>Volume</th><th>Direction</th></tr></thead><tbody>{movers.map((row) => <tr key={row.symbol}><td className="market-contract"><strong>{row.symbol}</strong><small>{row.description ?? "—"}</small></td><td>{price(row.last)}</td><td>{price(row.change)}</td><td>{percent(row.percentChange)}</td><td>{volume(row.volume)}</td><td className={row.direction === "down" ? "context-down" : "context-up"}>{row.direction}</td></tr>)}</tbody></table></div> : <div className="context-empty">No movers for {index}.</div>}
        </div>

        <div className="t-panel context-section">
          <div className="context-section-heading"><Clock3 size={15} /><div><strong>Intraday · 5 minutes</strong><span>Last 48 bars with session VWAP and opening range</span></div></div>
          <div className="context-selector-row">{report.intraday.map((item) => <button type="button" key={item.ticker} className={intradayTicker === item.ticker ? "active" : ""} onClick={() => setIntradayTicker(item.ticker)}>{item.ticker}</button>)}</div>
          {series?.bars.length ? <><div className="context-intraday-metrics"><span>Last <strong>{price(series.lastClose)}</strong></span><span>VWAP <strong>{price(series.vwap)}</strong></span><span>Opening range <strong>{price(series.openingRangeLow)}–{price(series.openingRangeHigh)}</strong></span></div><IntradayChart series={series} /></> : <div className="context-empty">No intraday bars for {intradayTicker}.</div>}
        </div>
      </section>

      <section className="t-panel context-section">
        <div className="context-section-heading"><Globe2 size={15} /><div><strong>Instrument profile</strong><span>Only fields actually returned by the provider; not an XBRL replacement</span></div></div>
        <select aria-label="Instrument profile ticker" value={profileTicker} onChange={(event) => setProfileTicker(event.target.value)}>{report.instruments.map((item) => <option key={item.symbol}>{item.symbol}</option>)}</select>
        {profile ? <div className="context-profile"><div><span>Description</span><strong>{profile.description ?? "—"}</strong></div><div><span>CUSIP</span><strong>{profile.cusip ?? "—"}</strong></div><div><span>Exchange</span><strong>{profile.exchange ?? "—"}</strong></div><div><span>Asset type</span><strong>{profile.assetType ?? "—"}{profile.assetMainType ? ` · ${profile.assetMainType}` : ""}</strong></div>{Object.entries(profile.fundamental).map(([key, value]) => <div key={key}><span>{key}</span><strong>{String(value)}</strong></div>)}</div> : <div className="context-empty">No instrument profile for {profileTicker}.</div>}
      </section>

      <details className="context-provenance"><summary>Context provenance · {report.files.length} records</summary><div className="market-table-wrap"><table className="market-table"><thead><tr><th>Kind</th><th>Status</th><th>Captured</th><th>SHA256</th><th>Error</th></tr></thead><tbody>{report.files.map((file) => <tr key={file.kind}><td>{file.kind}</td><td>{file.status}</td><td>{file.capturedAt.slice(0, 19).replace("T", " ")}</td><td className="market-hash" title={file.sourceHash}>{file.sourceHash ? `${file.sourceHash.slice(0, 12)}…` : "—"}</td><td>{file.error ?? "—"}</td></tr>)}</tbody></table></div></details>
    </div>
  );
}
