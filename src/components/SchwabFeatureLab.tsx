import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, FileWarning, LineChart as LineChartIcon, ShieldAlert } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SchwabFeatureReport, SchwabTickerFeatures } from "../../worker/lib/schwab-features";

const pct = (value: number | null, digits = 1) => value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
const money = (value: number | null) => value === null ? "—" : value.toFixed(2);
const decimal = (value: number | null, digits = 3) => value === null ? "—" : value.toFixed(digits);

function FeatureMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="t-panel market-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

export default function SchwabFeatureLab() {
  const [report, setReport] = useState<SchwabFeatureReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [ticker, setTicker] = useState("AAPL");
  useEffect(() => {
    let active = true;
    void fetch("/reports/schwab-features.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(`Features HTTP ${response.status}`); return response.json() as Promise<SchwabFeatureReport>; })
      .then((value) => { if (active) { setReport(value); setStatus("ready"); } })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, []);
  const selected: SchwabTickerFeatures | undefined = useMemo(() => {
    if (!report?.tickers.length) return undefined;
    return report.tickers.find((item) => item.ticker === ticker) ?? report.tickers[0];
  }, [report, ticker]);
  const chart = useMemo(() => selected?.buckets.map((bucket) => ({
    name: bucket.bucket,
    iv: bucket.atmIv === null ? null : bucket.atmIv * 100,
    em: bucket.expectedMovePct === null ? null : bucket.expectedMovePct * 100,
  })) ?? [], [selected]);

  if (status === "loading") return <section className="t-panel market-empty"><Activity size={22} /><h2>Loading Feature Lab</h2><p>Reading the small derived feature snapshot, not the full option chain.</p></section>;
  if (status === "error") return <section className="t-panel market-empty"><FileWarning size={22} /><h2>Feature snapshot unavailable</h2><p>Run <code>npx tsx worker/schwab-features.mts</code> after the normalized market-data builder.</p></section>;
  if (!selected) return <section className="t-panel market-empty"><ShieldAlert size={22} /><h2>No features yet</h2><p>Collect a valid Schwab chain, then materialize features. No history is inferred.</p></section>;

  const frontIv = selected.buckets.find((bucket) => bucket.atmIv !== null)?.atmIv ?? null;
  return (
    <div className="feature-lab">
      <section className="t-panel feature-toolbar">
        <div><span className="t-label">Ticker feature profile</span><strong>{selected.ticker}</strong><small>captured {selected.capturedAt.slice(0, 16).replace("T", " ")} UTC · source {report!.sourceSnapshotSha256.slice(0, 12)}</small></div>
        <select aria-label="Feature ticker" value={selected.ticker} onChange={(event) => setTicker(event.target.value)}>{report!.tickers.map((item) => <option key={item.ticker}>{item.ticker}</option>)}</select>
      </section>

      <section className="market-metric-grid">
        <FeatureMetric label="Spot" value={selected.spot === null ? "—" : money(selected.spot)} note="Underlying price from chain" />
        <FeatureMetric label="RV20" value={pct(selected.rv20)} note="Completed daily bars only" />
        <FeatureMetric label="Front ATM IV" value={pct(frontIv)} note="Nearest strike, call + put" />
        <FeatureMetric label="IV − RV20" value={pct(selected.ivRvspread)} note="Descriptive, not a production signal" />
        <FeatureMetric label="Snapshots" value={String(selected.snapshotCount)} note="Actual Schwab history so far" />
      </section>

      <section className="feature-chart-grid">
        <div className="t-panel feature-chart">
          <div className="feature-chart-title"><LineChartIcon size={15} /><div><strong>ATM IV term structure</strong><span>Annualized implied volatility by DTE bucket{selected.rv20 !== null ? " · dashed RV20" : ""}</span></div></div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chart} margin={{ top: 16, right: 18, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="hsl(var(--border) / 0.45)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis unit="%" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "ATM IV"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
              {selected.rv20 !== null && <ReferenceLine y={selected.rv20 * 100} stroke="hsl(var(--warn))" strokeDasharray="5 4" label={{ value: "RV20", fill: "hsl(var(--warn))", fontSize: 10, position: "insideTopRight" }} />}
              <Line type="monotone" dataKey="iv" stroke="hsl(var(--live))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--live))" }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="t-panel feature-chart">
          <div className="feature-chart-title"><BarChart3 size={15} /><div><strong>Expected move</strong><span>S · IV · √(DTE / 365), as % of spot</span></div></div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chart} margin={{ top: 16, right: 18, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="hsl(var(--border) / 0.45)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis unit="%" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Expected move"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
              <Bar dataKey="em" fill="hsl(var(--live))" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="t-panel market-table-wrap"><table className="market-table feature-table"><thead><tr><th>Bucket</th><th>DTE</th><th>ATM IV</th><th>EM $</th><th>EM %</th><th>Slope</th><th>Skew25</th><th>P/C vol</th><th>P/C OI</th><th>Turnover</th><th>Spread</th><th>Zero bid</th><th>Contracts</th></tr></thead><tbody>{selected.buckets.map((bucket) => (
        <tr key={bucket.bucket}><td>{bucket.bucket}</td><td>{bucket.dte ?? "—"}</td><td>{pct(bucket.atmIv)}</td><td>{money(bucket.expectedMove)}</td><td>{pct(bucket.expectedMovePct)}</td><td>{pct(bucket.termSlope)}</td><td>{decimal(bucket.skew25)}</td><td>{decimal(bucket.putCallVolumeRatio, 2)}</td><td>{decimal(bucket.putCallOiRatio, 2)}</td><td>{decimal(bucket.turnover, 2)}</td><td>{pct(bucket.atmSpreadPct)}</td><td>{pct(bucket.zeroBidShare)}</td><td>{bucket.contracts}</td></tr>
      ))}</tbody></table></section>

      <section className="feature-notes">
        <div><strong>Interpretation limits</strong><span>Skew, put/call and IV−RV20 are descriptive features, not directional production signals. 0DTE expected move remains null until an intraday time-to-close model exists. Earnings IV crush requires matched pre/post event history.</span></div>
        {selected.warnings.map((warning) => <div key={warning}><strong>Data note</strong><span>{warning}</span></div>)}
      </section>
    </div>
  );
}
