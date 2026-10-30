import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, BookOpen, Download, Gauge, ShieldCheck } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { AAPL_RISK_REPLAY, VOL_TARGET_LIMITS, type VolatilityForecastModel } from "@/data/volatility-risk-profile";
import { normalizeExpectedReturn, volatilityScalar } from "../../api/services/volatility-target";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;

function RiskBandChart({ model }: { model: VolatilityForecastModel }) {
  const data = AAPL_RISK_REPLAY;
  const em = data.expectedMove[model];
  const baseline = data.expectedMove[model === "atmIv" ? "rv20" : "atmIv"];
  const max = Math.max(18, em * 1.6, data.actualMove * 1.15);
  const x = (value: number) => 60 + value / max * 820;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max);
  const band = (from: number, to: number, color: string) => (
    <rect x={x(from)} y={54} width={Math.max(0, x(to) - x(from))} height={188} fill={color} />
  );
  const marker = (value: number, color: string, label: string, y: number, dashed = false) => (
    <g>
      <line x1={x(value)} x2={x(value)} y1={54} y2={242} stroke={color} strokeWidth={2} strokeDasharray={dashed ? "5 4" : undefined} />
      <text x={Math.min(x(value) + 7, 760)} y={y} fill={color} fontSize={12}>{label}</text>
    </g>
  );
  return (
    <svg className="risk-lab-chart" viewBox="0 0 920 310" role="img" aria-label={`AAPL ${model} expected move and historical risk bands`}>
      <text x={60} y={22} fill="hsl(var(--muted-foreground))" fontSize={12}>Absolute move in dollars · bands are scenario ranges, not probability intervals</text>
      {band(0, em * 0.5, "hsl(158 64% 52% / 0.07)")}
      {band(em * 0.5, em, "hsl(187 86% 53% / 0.09)")}
      {band(em, em * 1.5, "hsl(43 96% 56% / 0.08)")}
      {band(em * 1.5, max, "hsl(0 91% 71% / 0.07)")}
      <line x1={60} x2={880} y1={242} y2={242} stroke="hsl(var(--border))" />
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={x(tick)} x2={x(tick)} y1={242} y2={248} stroke="hsl(var(--border))" />
          <text x={x(tick)} y={274} textAnchor={tick === 0 ? "start" : tick === max ? "end" : "middle"} fill="hsl(var(--muted-foreground))" fontSize={11}>{money.format(tick)}</text>
        </g>
      ))}
      {marker(em * 0.5, "hsl(217 20% 62%)", "0.5× EM", 76, true)}
      {marker(em, "hsl(var(--live))", `${model === "atmIv" ? "ATM IV" : "RV20"} EM ${money.format(em)}`, 48)}
      {marker(em * 1.5, "hsl(var(--warn))", "1.5× EM", 76, true)}
      {marker(baseline, "hsl(43 96% 56%)", `${model === "atmIv" ? "RV20" : "ATM IV"} baseline ${money.format(baseline)}`, 100, true)}
      <line x1={x(data.actualMove)} x2={x(data.actualMove)} y1={116} y2={242} stroke="hsl(var(--ok))" strokeWidth={5} />
      <circle cx={x(data.actualMove)} cy={116} r={7} fill="hsl(var(--ok))" />
      <text x={Math.min(x(data.actualMove) + 10, 735)} y={112} fill="hsl(var(--ok))" fontSize={13} fontWeight={600}>Actual {money.format(data.actualMove)}</text>
    </svg>
  );
}

function CalibrationPanel() {
  const data = AAPL_RISK_REPLAY;
  return (
    <section className="t-panel risk-calibration">
      <div className="risk-section-heading">
        <div><div className="t-label">Empirical calibration</div><h2>Observed 1× EM coverage</h2></div>
        <span>Full research panel</span>
      </div>
      {(["atmIv", "rv20"] as const).map((model) => {
        const coverage = data.calibration[model === "atmIv" ? "atmIvCoverage" : "rv20Coverage"];
        return (
          <div className="risk-coverage-row" key={model}>
            <span>{model === "atmIv" ? "ATM IV" : "RV20"}</span>
            <div className="risk-coverage-track"><div className={model} style={{ width: pct(coverage) }} /></div>
            <strong>{pct(coverage)}</strong>
          </div>
        );
      })}
      <div className="risk-calibration-foot">
        <span>AAPL actual / ATM EM <strong>{(data.actualMove / data.expectedMove.atmIv).toFixed(3)}×</strong></span>
        <span>AAPL actual / RV20 EM <strong>{(data.actualMove / data.expectedMove.rv20).toFixed(3)}×</strong></span>
      </div>
      <p>Coverage is measured from historical outcomes. It is not a confidence score for this replay and does not make the bands statistically normal.</p>
    </section>
  );
}

export default function VolatilityRiskLab() {
  const data = AAPL_RISK_REPLAY;
  const [model, setModel] = useState<VolatilityForecastModel>("atmIv");
  const [targetVolPct, setTargetVolPct] = useState(20);
  const [expectedReturnPct, setExpectedReturnPct] = useState(5);
  const [notional, setNotional] = useState(100_000);
  const scenario = useMemo(() => {
    const forecastVol = data.forecastVol[model];
    const em = data.expectedMove[model];
    const emReturn = em / data.spot;
    const scalar = volatilityScalar(forecastVol, targetVolPct / 100, VOL_TARGET_LIMITS.minScalar, VOL_TARGET_LIMITS.maxScalar);
    const safeNotional = Number.isFinite(notional) && notional > 0 ? notional : 0;
    const z = normalizeExpectedReturn(expectedReturnPct / 100, emReturn);
    return {
      forecastVol,
      em,
      emReturn,
      scalar: scalar ?? VOL_TARGET_LIMITS.minScalar,
      exposure: safeNotional * (scalar ?? 0),
      z,
      scenarioMove: safeNotional * (scalar ?? 0) * emReturn,
      actualRatio: data.actualMove / em,
      valid: safeNotional > 0 && Number.isFinite(expectedReturnPct),
    };
  }, [data, expectedReturnPct, model, notional, targetVolPct]);
  const comparison = (["atmIv", "rv20"] as const).map((name) => {
    const em = data.expectedMove[name];
    const emReturn = em / data.spot;
    const scalar = volatilityScalar(data.forecastVol[name], targetVolPct / 100, VOL_TARGET_LIMITS.minScalar, VOL_TARGET_LIMITS.maxScalar) ?? 0;
    const safeNotional = Number.isFinite(notional) && notional > 0 ? notional : 0;
    return {
      name,
      vol: data.forecastVol[name],
      em,
      scalar,
      exposure: safeNotional * scalar,
      z: normalizeExpectedReturn(expectedReturnPct / 100, emReturn),
      actualRatio: data.actualMove / em,
    };
  });
  const downloadScenario = () => {
    const payload = {
      type: "historical-volatility-risk-replay",
      generatedAt: new Date().toISOString(),
      source: data,
      assumptions: { model, targetVol: targetVolPct / 100, expectedReturn: expectedReturnPct / 100, notional },
      result: scenario,
      limitation: "Historical research replay; not a live quote, expected-return forecast, probability or trade instruction.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `AAPL-risk-replay-${data.tradeDate}-${model}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout title="Volatility Risk Lab">
      <div className="risk-lab-page">
        <section className="risk-lab-hero t-panel">
          <div>
            <div className="t-label"><Gauge size={14} /> Historical risk replay · reviewed research snapshot</div>
            <h1><span>{data.ticker}</span> Volatility into exposure.</h1>
            <p>Convert implied or realized volatility into a bounded name-level risk scalar, normalize a scenario return by expected move, and inspect the result against the realized outcome.</p>
          </div>
          <div className="risk-lab-hero-meta">
            <span className="risk-replay-badge">REPLAY · NOT LIVE</span>
            <strong>{data.tradeDate}</strong>
            <span>{data.dteDays} calendar DTE · spot {money.format(data.spot)}</span>
            <div><Link to="/analytics/methodology">Methodology</Link><Link to="/analytics">Analytics</Link></div>
          </div>
        </section>

        <div className="risk-lab-grid">
          <aside className="t-panel risk-controls">
            <div className="t-label">Scenario controls</div>
            <fieldset className="risk-model-control">
              <legend>Volatility forecast</legend>
              <button type="button" aria-pressed={model === "atmIv"} className={model === "atmIv" ? "active" : ""} onClick={() => setModel("atmIv")}>
                <span>ATM IV</span><small>Forward market price</small>
              </button>
              <button type="button" aria-pressed={model === "rv20"} className={model === "rv20" ? "active" : ""} onClick={() => setModel("rv20")}>
                <span>RV20</span><small>Trailing baseline</small>
              </button>
            </fieldset>
            <label className="risk-input-label" htmlFor="target-vol">Target annual volatility <output>{targetVolPct}%</output></label>
            <input id="target-vol" className="risk-range" type="range" min={5} max={60} step={1} value={targetVolPct} onChange={(event) => setTargetVolPct(Number(event.target.value))} />
            <div className="risk-range-scale"><span>5%</span><span>60%</span></div>
            <label className="risk-input-label" htmlFor="expected-return">Scenario return over {data.dteDays} days</label>
            <div className="risk-number-input"><input id="expected-return" type="number" min={-100} max={100} step={0.5} value={expectedReturnPct} onChange={(event) => setExpectedReturnPct(Number(event.target.value))} /><span>%</span></div>
            <label className="risk-input-label" htmlFor="risk-notional">Reference capital</label>
            <div className="risk-number-input"><span>$</span><input id="risk-notional" type="number" min={1000} step={1000} value={notional} onChange={(event) => setNotional(Number(event.target.value))} /></div>
            {!scenario.valid && <div className="risk-input-error" role="alert">Enter positive capital and a finite scenario return.</div>}
            <div className="risk-assumption-note">Return and capital are your scenario assumptions. Alpha Engine does not supply an expected-return forecast on this screen.</div>
            <div className="risk-formula-block">
              <span>Risk scalar</span><code>w = clamp(σ_target / σ_forecast, 0.25, 1.00)</code>
              <span>Normalized return</span><code>z = R / (EM / S)</code>
            </div>
            <button type="button" className="risk-download" onClick={downloadScenario} disabled={!scenario.valid}><Download size={14} /> Download scenario JSON</button>
          </aside>

          <main className="risk-main-column">
            <section className="risk-metric-grid">
              <div className="t-panel"><span>Selected expected move</span><strong>{money.format(scenario.em)}</strong><small>{pct(scenario.emReturn)} of spot · {model === "atmIv" ? "ATM IV" : "RV20"}</small></div>
              <div className="t-panel"><span>Name-level risk scalar</span><strong>{pct(scenario.scalar)}</strong><small>{money.format(scenario.exposure)} analytical exposure</small></div>
              <div className="t-panel"><span>Normalized scenario return</span><strong className={(scenario.z ?? 0) < 0 ? "negative" : ""}>{scenario.z === null ? "—" : `${scenario.z.toFixed(2)}×`}</strong><small>Signed R / expected-move return</small></div>
              <div className="t-panel"><span>1× EM on scaled exposure</span><strong>{money.format(scenario.scenarioMove)}</strong><small>Scenario magnitude, not maximum loss</small></div>
            </section>
            <section className="t-panel risk-chart-panel">
              <div className="risk-section-heading">
                <div><div className="t-label">Risk boundaries</div><h2>{model === "atmIv" ? "ATM IV" : "RV20"} expected move versus actual</h2></div>
                <span className={scenario.actualRatio <= 1 ? "inside" : "outside"}>{scenario.actualRatio <= 1 ? "Actual inside 1× band" : "Actual outside 1× band"}</span>
              </div>
              <div className="risk-chart-scroll">
                <div className="risk-chart-scroll-note">Scroll risk chart horizontally →</div>
                <RiskBandChart model={model} />
              </div>
            </section>
            <CalibrationPanel />
          </main>

          <aside className="risk-audit-column">
            <section className="t-panel risk-audit-panel">
              <div className="t-label"><ShieldCheck size={13} /> Evidence and limits</div>
              <dl>
                <div><dt>Forecast role</dt><dd>Risk and sizing only</dd></div>
                <div><dt>Directional alpha</dt><dd>Not claimed</dd></div>
                <div><dt>Snapshot</dt><dd>{data.tradeDate}</dd></div>
                <div><dt>Actual move</dt><dd>{money.format(data.actualMove)}</dd></div>
                <div><dt>Actual / selected EM</dt><dd>{scenario.actualRatio.toFixed(3)}×</dd></div>
                <div><dt>Scalar bounds</dt><dd>0.25–1.00</dd></div>
                <div><dt>Sector / liquidity caps</dt><dd>Research engine only; not simulated in this one-name replay</dd></div>
              </dl>
              <p>{data.provenance}. Values remain historical and availability-anchored.</p>
            </section>
            <section className="t-panel risk-next-panel">
              <div className="t-label">Inspect the evidence</div>
              <h2>One replay is not validation.</h2>
              <p>Use the paired research panel for coverage, error, turnover and drawdown. Use this replay to audit the mechanics on one observable outcome.</p>
              <Link to={`/company/${data.ticker}`}>Open {data.ticker} company profile <ArrowRight size={14} /></Link>
              <Link to="/analytics/methodology"><BookOpen size={14} /> Read calculation handbook</Link>
            </section>
          </aside>
        </div>

        <section className="t-panel risk-comparison">
          <div className="risk-section-heading">
            <div><div className="t-label">Paired baseline · identical scenario assumptions</div><h2>ATM IV versus RV20</h2></div>
            <span>{number.format(notional || 0)} USD reference capital</span>
          </div>
          <div className="risk-table-wrap">
            <table>
              <thead><tr><th>Forecast</th><th>Annual vol</th><th>Expected move</th><th>Risk scalar</th><th>Scaled exposure</th><th>z = R / EM</th><th>Actual / EM</th></tr></thead>
              <tbody>{comparison.map((row) => (
                <tr key={row.name} className={model === row.name ? "selected" : ""}>
                  <td>{row.name === "atmIv" ? "ATM IV" : "RV20"}{model === row.name ? " · selected" : ""}</td>
                  <td>{pct(row.vol)}</td><td>{money.format(row.em)}</td><td>{pct(row.scalar)}</td><td>{money.format(row.exposure)}</td>
                  <td>{row.z === null ? "—" : `${row.z.toFixed(2)}×`}</td><td>{row.actualRatio.toFixed(3)}×</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="risk-comparison-note"><span>w scales a name, not the whole portfolio’s volatility.</span><span>z is a signed ratio, not a probability.</span><span>No order, entry or exit instruction.</span></div>
        </section>
        <Link to="/analytics/methodology" className="risk-back-link"><ArrowLeft size={14} /> Back to Volatility Lab handbook</Link>
      </div>
    </AppLayout>
  );
}
