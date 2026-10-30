import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, BookOpen, ShieldCheck, Sigma } from "lucide-react";
import AppLayout from "@/components/AppLayout";

const toc = [
  ["foundations", "01 · Two lenses"],
  ["rv20", "02 · Realized volatility"],
  ["atm-iv", "03 · Implied volatility"],
  ["expected-move", "04 · Expected move"],
  ["paired-baseline", "05 · Paired baseline"],
  ["use-cases", "06 · Use cases"],
  ["case-study", "07 · AAPL risk profile"],
  ["references", "08 · Academic sources"],
] as const;

function Formula({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <div className="methodology-formula">
      <div className="methodology-formula-title">{title}</div>
      <div className="methodology-formula-body">{children}</div>
      {note && <div className="methodology-formula-note">{note}</div>}
    </div>
  );
}
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="methodology-section"><h2>{title}</h2>{children}</section>;
}
function UseCase({ title, formula, children }: { title: string; formula: string; children: ReactNode }) {
  return <div className="methodology-usecase"><h3>{title}</h3><div className="methodology-formula-body">{formula}</div><p>{children}</p></div>;
}
function RiskChart() {
  const em = 11.851, rv = 7.601, actual = 8.086, max = 18;
  const x = (v: number) => 58 + (v / max) * 824;
  const band = (from: number, to: number, color: string) => <rect x={x(from)} y={30} width={x(to) - x(from)} height={220} fill={color} />;
  const line = (value: number, color: string, label: string, dash = false) => <g><line x1={x(value)} x2={x(value)} y1={30} y2={250} stroke={color} strokeWidth={2} strokeDasharray={dash ? "5 4" : undefined} /><text x={x(value) + 6} y={48} fill={color} fontSize={12}>{label}</text></g>;
  return (
    <svg className="risk-chart" viewBox="0 0 900 310" role="img" aria-label="AAPL expected move and risk bands">
      {band(0, em * 0.5, "hsl(158 64% 52% / 0.07)")}
      {band(em * 0.5, em, "hsl(187 86% 53% / 0.08)")}
      {band(em, em * 1.5, "hsl(43 96% 56% / 0.08)")}
      {band(em * 1.5, max, "hsl(0 91% 71% / 0.07)")}
      <line x1={58} x2={882} y1={250} y2={250} stroke="hsl(var(--border))" />
      <text x={58} y={280} fill="hsl(var(--muted-foreground))" fontSize={12}>0</text>
      <text x={x(5)} y={280} fill="hsl(var(--muted-foreground))" fontSize={12}>$5</text>
      <text x={x(10)} y={280} fill="hsl(var(--muted-foreground))" fontSize={12}>$10</text>
      <text x={x(15)} y={280} fill="hsl(var(--muted-foreground))" fontSize={12}>$15</text>
      <text x={x(18)} y={280} fill="hsl(var(--muted-foreground))" fontSize={12}>$18</text>
      {line(em * 0.5, "hsl(217 20% 62%)", "0.5× EM", true)}
      {line(em, "hsl(var(--live))", "Expected move")}
      {line(em * 1.5, "hsl(var(--warn))", "1.5× EM", true)}
      {line(rv, "hsl(43 96% 56%)", "RV20 baseline", true)}
      <line x1={x(actual)} x2={x(actual)} y1={70} y2={250} stroke="hsl(var(--ok))" strokeWidth={5} />
      <circle cx={x(actual)} cy={70} r={7} fill="hsl(var(--ok))" />
      <text x={x(actual) + 10} y={66} fill="hsl(var(--ok))" fontSize={13} fontWeight={600}>Actual $8.09</text>
      <text x={58} y={18} fill="hsl(var(--muted-foreground))" fontSize={12}>Confidence band is a risk range, not a probability interval.</text>
    </svg>
  );
}

export default function Methodology() {
  const [active, setActive] = useState("foundations");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-25% 0px -60% 0px", threshold: [0.05, 0.25, 0.6] });
    document.querySelectorAll(".methodology-section").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <AppLayout title="Volatility Lab">
      <div className="methodology-hero t-panel">
        <div>
          <div className="t-label"><BookOpen size={13} /> Research handbook · volatility, risk and sizing</div>
          <h1>Volatility before direction.</h1>
          <p>A graduate-level field guide to realized and implied volatility, expected move, paired baselines and confidence-aware position sizing in Alpha Engine.</p>
        </div>
        <div className="methodology-hero-note">
          <div className="t-label">Read first</div>
          <strong>ATM IV is a risk and sizing signal.</strong>
          <span>It is not a directional trading signal.</span>
          <Link to="/analytics" className="methodology-back"><ArrowLeft size={14} /> Back to Analytics</Link>
        </div>
      </div>

      <div className="methodology-layout">
        <aside className="methodology-toc t-panel">
          <div className="t-label">Contents</div>
          <nav aria-label="Methodology sections">
            {toc.map(([id, label]) => <a key={id} href={`#${id}`} className={active === id ? "active" : ""} onClick={() => setActive(id)}>{label}</a>)}
          </nav>
          <div className="methodology-toc-note"><ShieldCheck size={14} /> Availability first. No look-ahead.</div>
        </aside>

        <article className="methodology-article">
          <Section id="foundations" title="01 · Two volatility lenses">
            <p><strong>RV20</strong> answers: <em>how risky was the asset in the past?</em> <strong>ATM IV</strong> answers: <em>how much risk is the options market pricing into the future?</em> They are related, but not interchangeable. Realized volatility is a backward-looking estimator. Implied volatility is a forward-looking price of uncertainty, insurance and positioning.</p>
            <div className="methodology-callout">RV20 is a statistical fact about the past. ATM IV is a market price of uncertainty, not a guarantee of future realized volatility.</div>
            <h3>Notation used below</h3>
            <div className="methodology-symbols">
              <span><b>P_t</b> close on session t</span><span><b>r_t</b> log return</span><span><b>S</b> spot price</span><span><b>K*</b> strike nearest spot</span><span><b>IV_ATM</b> implied volatility</span><span><b>DTE</b> calendar days to expiry</span><span><b>EM</b> expected move</span><span><b>ΔIC</b> incremental IC</span>
            </div>
          </Section>

          <Section id="rv20" title="02 · Realized volatility">
            <p>For close \(P_t\) and log return \(r_t = \ln(P_t/P_(t−1))\), annualized realized volatility over 20 sessions is:</p>
            <Formula title="RV20">{"RV20 = √(252 · Var(r_t−19, …, r_t))"}</Formula>
            <p>The result is expressed in decimal annualized volatility: <code>0.20</code> means 20%. The estimator does not assume a normal distribution or stationary volatility. It is our <strong>naive baseline</strong>: transparent, reproducible and difficult to challenge. Any more sophisticated volatility feature must beat it on the same calendar and with identical availability rules.</p>
          </Section>

          <Section id="atm-iv" title="03 · Implied volatility">
            <p>For DTE bucket \(b\), choose call and put contracts whose strike \(K^*\) is nearest to spot \(S\):</p>
            <Formula title="ATM IV">{"IV_ATM,b = (IV_call,K* + IV_put,K*) / 2"}</Formula>
            <p>DTE median is computed from actual expirations in the bucket, not from hardcoded 30- or 60-day windows. Missing inputs remain <code>null</code> rather than being silently filled. Implied volatility is a risk-neutral market quantity, not a physical forecast of realized volatility.</p>
            <div className="methodology-subgrid">
              <Formula title="Term slope" note="Short IV minus next available longer-bucket IV.">{"Slope_b = IV_ATM,next(b) − IV_ATM,b"}</Formula>
              <Formula title="25Δ skew" note="Put IV minus call IV at matched delta.">{"Skew25 = IV_put,Δ≈−0.25 − IV_call,Δ≈0.25"}</Formula>
              <Formula title="IV–RV premium" note="Implied minus trailing realized volatility.">{"VRP_t = IV_ATM,t − RV20,t"}</Formula>
            </div>
          </Section>

          <Section id="expected-move" title="04 · Expected move">
            <Formula title="Expected move in dollars">{"EM = S · IV_ATM · √(DTE / 365)"}</Formula>
            <p>Actual movement must be measured in the <strong>same unit</strong>. If entry and exit prices are \(P_(entry)\) and \(P_(exit)\), then:</p>
            <Formula title="Actual move in dollars">{"ActualMove = P_entry · |P_exit / P_entry − 1|"}</Formula>
            <p>Expected move is a <strong>risk range</strong>, not a promised 68% interval. Coverage, MAE and RMSE are measured empirically for ATM IV and for the RV20 baseline. For GEX, the target is absolute return or Garman–Klass volatility; for skew, SPY-excess return; for ATM IV, forward realized volatility.</p>
          </Section>

          <Section id="paired-baseline" title="05 · Paired baseline">
            <p>High ATM IV IC alone does not establish incremental value. The stronger test is whether implied volatility outperforms a simple trailing baseline:</p>
            <Formula title="Paired incremental IC">{"ΔIC = IC_ATM IV − IC_RV20"}</Formula>
            <p>A moving-block bootstrap is run over monthly cross-sections. A positive confidence interval means implied volatility adds information beyond trailing realized volatility. This is a statement about <strong>forecast quality</strong>, not about the sign of future returns.</p>
            <div className="methodology-table-wrap">
              <table className="methodology-table">
                <thead><tr><th>Metric</th><th>ATM IV</th><th>RV20</th><th>Interpretation</th></tr></thead>
                <tbody>
                  <tr><td>Forward-RV IC</td><td>0.737 <small>95% CI 0.687–0.778</small></td><td>0.667</td><td>Strong volatility information</td></tr>
                  <tr><td>Sector-neutral IC</td><td>0.582</td><td>0.469</td><td>Survives sector residualization</td></tr>
                  <tr><td>Paired ΔIC</td><td>0.0706 <small>95% CI 0.0385–0.1001</small></td><td>baseline</td><td>Positive incremental value</td></tr>
                  <tr><td>Expected-move coverage</td><td>64.85%</td><td>59.79%</td><td>Better interval calibration</td></tr>
                  <tr><td>MAE</td><td>13.58</td><td>13.91</td><td>Lower absolute error</td></tr>
                  <tr><td>RMSE</td><td>26.30</td><td>28.03</td><td>Lower tail-sensitive error</td></tr>
                  <tr><td>Mean actual / expected</td><td>0.899</td><td>1.057</td><td>RV20 overestimates more</td></tr>
                  <tr><td>Targeted annualized volatility</td><td>8.45%</td><td>9.95%</td><td>15.11% lower with ATM IV</td></tr>
                  <tr><td>Targeted max drawdown</td><td>11.40%</td><td>14.87%</td><td>Monthly observations, not a daily equity curve</td></tr>
                  <tr><td>Targeted net-return delta</td><td>−9.13 bps / month <small>95% CI −21.24…+6.42</small></td><td>baseline</td><td>No proven return advantage</td></tr>
                </tbody>
              </table>
            </div>
            <p>All 90 months and both independent CIK universes are positive for ATM IV. The paired advantage also wins in every month of 2025–2026. That supports <strong>volatility and sizing value</strong>, not directional alpha.</p>
            <p>In the 91-month volatility-target run, ATM IV also reduced volatility and monthly drawdown in every calendar year and in both independent universes. Its Sharpe-like ratio was 1.151 versus 1.087 for RV20, but the net-return confidence interval crossed zero. This is evidence for the <strong>risk layer</strong>, not a return forecast.</p>
          </Section>

          <Section id="use-cases" title="06 · Use cases">
            <div className="methodology-usecases">
              <UseCase title="Volatility targeting" formula="w_i = clamp(σ_target / σ_forecast,i, 0.25, 1.00)">Scale analytical weight down when forecast volatility rises and up when it falls, within hard leverage, sector and liquidity limits. Compare ATM IV targeting with RV20 targeting on forward realized volatility, drawdown, Sharpe, turnover and cost-adjusted results.</UseCase>
              <UseCase title="Expected-return normalization" formula="z_i = R_i / EM_i">Normalize expected return by expected move. This compares opportunities by risk-adjusted magnitude rather than by raw return, avoiding the false equivalence of high- and low-volatility names.</UseCase>
              <UseCase title="Risk dashboard" formula="EM, RV20, actual / expected, coverage, MAE, RMSE">Monitor implied versus realized volatility, calibration error, risk bands and regime deterioration. Alerts concern changing risk, not automatic bearishness.</UseCase>
            </div>
            <div className="methodology-callout">Implementation status: paired baseline and expected-move calibration are complete; the 91-month volatility-target run supports risk reduction but not return alpha; the scenario risk replay is implemented; a normalized magnitude model still awaits a preregistered expected-return series. Term slope, skew25 and VRP remain outside production because their evidence is weak or regime-dependent.</div>
          </Section>

          <Section id="case-study" title="07 · AAPL risk profile">
            <div className="methodology-case-grid">
              <div>
                <RiskChart />
              </div>
              <div className="methodology-case-metrics">
                <div><span>Snapshot</span><strong>2024-01-02</strong></div>
                <div><span>Spot</span><strong>$183.731</strong></div>
                <div><span>ATM IV</span><strong>0.30</strong></div>
                <div><span>DTE median</span><strong>17 days</strong></div>
                <div><span>Expected move</span><strong>$11.85</strong></div>
                <div><span>Actual move</span><strong>$8.09</strong></div>
                <div><span>Actual / EM</span><strong>0.682</strong></div>
                <div><span>Actual / RV20 EM</span><strong>1.064</strong></div>
              </div>
            </div>
            <p>The example illustrates the intended ticker profile: implied expected move, trailing baseline, realized move and confidence bands. ATM IV produced a wider but still serviceable range than RV20; the actual move finished inside the ATM band and slightly above the RV20 band. It is evidence of calibration, not a trade recommendation.</p>
            <Link to="/analytics/risk-lab" className="methodology-back methodology-case-action">Open interactive AAPL risk replay <ArrowRight size={14} /></Link>
          </Section>

          <Section id="references" title="08 · Academic sources">
            <ul className="methodology-references">
              <li>Black, F., Scholes, M. (1973). <em>The Pricing of Options and Corporate Liabilities</em>. Journal of Political Economy.</li>
              <li>Garman, M. B., Klass, M. J. (1980). <em>On the Estimation of Security Price Volatilities</em>. Journal of Business.</li>
              <li>Breeden, D. T., Litzenberger, R. H. (1978). <em>Prices of State-Contingent Claims Implicit in Option Prices</em>. Journal of Business.</li>
              <li>Xing, Y., Zhang, X., Zhao, R. (2010). <em>What Does the Individual Option Volatility Smirk Tell Us About Future Equity Returns?</em> Journal of Financial and Quantitative Analysis.</li>
              <li>Zhou, H. (2018). <em>Variance Risk Premia, Asset Predictability Puzzles, and Macroeconomic Uncertainty</em>. Annual Review of Financial Economics.</li>
              <li>Rogers, J. L., Skinner, D. J., Van Buskirk, A. (2009). <em>Earnings Guidance and Market Uncertainty</em>. Journal of Accounting & Economics.</li>
              <li>Pan, J., Poteshman, A. M. (2006). <em>The Information in Option Volume for Future Stock Prices</em>. Review of Financial Studies.</li>
            </ul>
            <p className="methodology-small"><Sigma size={14} /> This handbook documents calculations and evidence policy, not an offer to trade.</p>
          </Section>
        </article>
      </div>
    </AppLayout>
  );
}
