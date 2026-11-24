import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, BookOpen, ShieldCheck } from "lucide-react";
import { useDocumentTitle } from "../../context";
import { DevNotes } from "../../DevNotes";
import { ResearchFrame } from "../../ResearchParts";
import "./LibraryDocuments.css";

const SECTIONS = [
  ["foundations", "01 · Two lenses"],
  ["rv20", "02 · Realized volatility"],
  ["atm-iv", "03 · Implied volatility"],
  ["expected-move", "04 · Expected move"],
  ["paired-baseline", "05 · Paired baseline"],
  ["use-cases", "06 · Use cases"],
  ["case-study", "07 · AAPL risk profile"],
  ["references", "08 · Academic sources"],
] as const;

function Formula({ title, label, children, note }: { title: string; label: string; children: ReactNode; note?: string }) {
  return (
    <figure className="desk-formula-card">
      <figcaption>{title}</figcaption>
      <div className="desk-formula" role="math" aria-label={label}>{children}</div>
      {note && <p className="desk-formula-note">{note}</p>}
    </figure>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="desk-handbook-section"><h2>{title}</h2>{children}</section>;
}

function Root({ children }: { children: ReactNode }) {
  return <span className="desk-formula-radical">√<span>{children}</span></span>;
}

function UseCase({ title, formula, children }: { title: string; formula: ReactNode; children: ReactNode }) {
  return <div className="desk-handbook-usecase"><h3>{title}</h3><div className="desk-formula">{formula}</div><p>{children}</p></div>;
}

function RiskChart() {
  const em = 11.851;
  const rv = 7.601;
  const actual = 8.086;
  const max = 18;
  const x = (value: number) => 58 + (value / max) * 824;
  const band = (from: number, to: number, className: string) => <rect className={className} x={x(from)} y={30} width={x(to) - x(from)} height={220} />;
  const line = (value: number, className: string, label: string, dash = false) => <g className={className}><line x1={x(value)} x2={x(value)} y1={30} y2={250} strokeDasharray={dash ? "5 4" : undefined} /><text x={x(value) + 6} y={48}>{label}</text></g>;
  return (
    <svg className="desk-risk-chart" viewBox="0 0 900 310" role="img" aria-label="AAPL expected move and risk bands">
      {band(0, em * 0.5, "desk-risk-band-ok")}
      {band(em * 0.5, em, "desk-risk-band-accent")}
      {band(em, em * 1.5, "desk-risk-band-warning")}
      {band(em * 1.5, max, "desk-risk-band-critical")}
      <line className="desk-risk-axis" x1={58} x2={882} y1={250} y2={250} />
      {[0, 5, 10, 15, 18].map((value) => <text className="desk-risk-axis-text" key={value} x={x(value)} y={280}>{value === 0 ? "0" : `$${value}`}</text>)}
      {line(em * 0.5, "desk-risk-muted", "0.5× EM", true)}
      {line(em, "desk-risk-accent", "Expected move")}
      {line(em * 1.5, "desk-risk-warning", "1.5× EM", true)}
      {line(rv, "desk-risk-warning", "RV20 baseline", true)}
      <line className="desk-risk-actual-line" x1={x(actual)} x2={x(actual)} y1={70} y2={250} />
      <circle className="desk-risk-actual-dot" cx={x(actual)} cy={70} r={7} />
      <text className="desk-risk-actual-text" x={x(actual) + 10} y={66}>Actual $8.09</text>
      <text className="desk-risk-axis-text" x={58} y={18}>Confidence band is a risk range, not a probability interval.</text>
    </svg>
  );
}

export default function VolatilityHandbook() {
  useDocumentTitle("Volatility handbook");
  const [active, setActive] = useState("foundations");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-25% 0px -60% 0px", threshold: [0.05, 0.25, 0.6] });
    document.querySelectorAll(".desk-handbook-section").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <ResearchFrame>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Library · volatility, risk and sizing</span>
          <h1>Volatility before direction.</h1>
          <p className="desk-lede">A field guide to realized and implied volatility, expected move, paired baselines and confidence-aware position sizing in Alpha Engine.</p>
        </div>
        <Link to="/desk/research/library" className="desk-button"><ArrowLeft size={14} /> Library</Link>
      </div>

      <div className="desk-handbook-layout">
        <aside className="desk-card desk-handbook-toc">
          <span className="desk-eyebrow"><BookOpen size={13} /> Contents</span>
          <nav aria-label="Volatility handbook sections">
            {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className={active === id ? "active" : ""} onClick={() => setActive(id)}>{label}</a>)}
          </nav>
          <p><ShieldCheck size={14} /> Availability first. No look-ahead.</p>
        </aside>

        <article className="desk-card desk-library-document">
          <Section id="foundations" title="01 · Two volatility lenses">
            <p><strong>RV20</strong> answers: <em>how risky was the asset in the past?</em> <strong>ATM IV</strong> answers: <em>how much risk is the options market pricing into the future?</em> They are related, but not interchangeable. Realized volatility is a backward-looking estimator. Implied volatility is a forward-looking price of uncertainty, insurance and positioning.</p>
            <div className="desk-handbook-callout">RV20 is a statistical fact about the past. ATM IV is a market price of uncertainty, not a guarantee of future realized volatility.</div>
            <h3>Notation used below</h3>
            <div className="desk-handbook-symbols">
              <span><b>P<sub>t</sub></b> close on session t</span><span><b>r<sub>t</sub></b> log return</span><span><b>S</b> spot price</span><span><b>K*</b> strike nearest spot</span><span><b>IV<sub>ATM</sub></b> implied volatility</span><span><b>DTE</b> calendar days to expiry</span><span><b>EM</b> expected move</span><span><b>ΔIC</b> incremental IC</span>
            </div>
          </Section>

          <Section id="rv20" title="02 · Realized volatility">
            <p>For close P<sub>t</sub> and log return r<sub>t</sub> = ln(P<sub>t</sub>/P<sub>t−1</sub>), annualized realized volatility over 20 sessions is:</p>
            <Formula title="RV20" label="RV20 equals the square root of 252 times the variance of the last twenty log returns">RV20 = <Root>252 · Var(r<sub>t−19</sub>, …, r<sub>t</sub>)</Root></Formula>
            <p>The result is expressed in decimal annualized volatility: <code>0.20</code> means 20%. The estimator does not assume a normal distribution or stationary volatility. It is our <strong>naive baseline</strong>: transparent, reproducible and difficult to challenge. Any more sophisticated volatility feature must beat it on the same calendar and with identical availability rules.</p>
          </Section>

          <Section id="atm-iv" title="03 · Implied volatility">
            <p>For DTE bucket b, choose call and put contracts whose strike K<sup>*</sup> is nearest to spot S:</p>
            <Formula title="ATM IV" label="At-the-money implied volatility is the mean of call and put implied volatility">IV<sub>ATM,b</sub> = (IV<sub>call,K*</sub> + IV<sub>put,K*</sub>) / 2</Formula>
            <p>DTE median is computed from actual expirations in the bucket, not from hardcoded 30- or 60-day windows. Missing inputs remain <code>null</code> rather than being silently filled. Implied volatility is a risk-neutral market quantity, not a physical forecast of realized volatility.</p>
            <div className="desk-handbook-formula-grid">
              <Formula title="Term slope" label="Term slope" note="Short IV minus next available longer-bucket IV.">Slope<sub>b</sub> = IV<sub>ATM,next(b)</sub> − IV<sub>ATM,b</sub></Formula>
              <Formula title="25Δ skew" label="Twenty-five delta skew" note="Put IV minus call IV at matched delta.">Skew25 = IV<sub>put,Δ≈−0.25</sub> − IV<sub>call,Δ≈0.25</sub></Formula>
              <Formula title="IV–RV premium" label="Implied volatility minus realized volatility" note="Implied minus trailing realized volatility.">VRP<sub>t</sub> = IV<sub>ATM,t</sub> − RV20<sub>t</sub></Formula>
            </div>
          </Section>

          <Section id="expected-move" title="04 · Expected move">
            <Formula title="Expected move in dollars" label="Expected move equals spot times implied volatility times the square root of days to expiry over 365">EM = S · IV<sub>ATM</sub> · <Root>DTE / 365</Root></Formula>
            <p>Actual movement must be measured in the <strong>same unit</strong>. If entry and exit prices are P<sub>entry</sub> and P<sub>exit</sub>, then:</p>
            <Formula title="Actual move in dollars" label="Actual move equals entry price times the absolute relative price change">ActualMove = P<sub>entry</sub> · |P<sub>exit</sub> / P<sub>entry</sub> − 1|</Formula>
            <p>Expected move is a <strong>risk range</strong>, not a promised 68% interval. Coverage, MAE and RMSE are measured empirically for ATM IV and for the RV20 baseline. For GEX, the target is absolute return or Garman–Klass volatility; for skew, SPY-excess return; for ATM IV, forward realized volatility.</p>
          </Section>

          <Section id="paired-baseline" title="05 · Paired baseline">
            <p>High ATM IV IC alone does not establish incremental value. The stronger test is whether implied volatility outperforms a simple trailing baseline:</p>
            <Formula title="Paired incremental IC" label="Incremental IC equals ATM IV IC minus RV20 IC">ΔIC = IC<sub>ATM IV</sub> − IC<sub>RV20</sub></Formula>
            <p>A moving-block bootstrap is run over monthly cross-sections. A positive confidence interval means implied volatility adds information beyond trailing realized volatility. This is a statement about <strong>forecast quality</strong>, not about the sign of future returns.</p>
            <div className="desk-table-wrap">
              <table className="desk-table desk-handbook-table">
                <thead><tr><th>Metric</th><th>ATM IV</th><th>RV20</th><th>Interpretation</th></tr></thead>
                <tbody>
                  <tr><td>Forward-RV IC</td><td>0.796 <small>95% CI 0.764–0.821</small></td><td>0.667</td><td>Strong volatility information</td></tr>
                  <tr><td>Sector-neutral IC</td><td>0.639</td><td>0.471</td><td>Survives sector residualization</td></tr>
                  <tr><td>Paired ΔIC</td><td>0.1288 <small>95% CI 0.1150–0.1440</small></td><td>baseline</td><td>Positive incremental value</td></tr>
                  <tr><td>Expected-move coverage</td><td>62.32%</td><td>59.47%</td><td>Better interval calibration</td></tr>
                  <tr><td>MAE</td><td>13.06</td><td>13.61</td><td>Lower absolute error</td></tr>
                  <tr><td>RMSE</td><td>25.97</td><td>27.81</td><td>Lower tail-sensitive error</td></tr>
                  <tr><td>Mean actual / expected</td><td>0.949</td><td>1.063</td><td>RV20 overestimates more</td></tr>
                  <tr><td>Targeted annualized volatility</td><td>9.03%</td><td>9.98%</td><td>9.44% lower with ATM IV</td></tr>
                  <tr><td>Targeted max drawdown</td><td>12.34%</td><td>14.87%</td><td>Monthly observations, not a daily equity curve</td></tr>
                  <tr><td>Targeted net-return delta</td><td>−4.46 bps / month <small>95% CI −15.96…+9.97</small></td><td>baseline</td><td>No proven return advantage</td></tr>
                </tbody>
              </table>
            </div>
            <p>All 90 months and both independent CIK universes are positive for ATM IV. The paired advantage also wins in every month of 2025–2026. That supports <strong>volatility and sizing value</strong>, not directional alpha.</p>
            <p>In the 91-month volatility-target run, ATM IV also reduced volatility and monthly drawdown in every calendar year and in both independent universes. Its Sharpe-like ratio was 1.151 versus 1.087 for RV20, but the net-return confidence interval crossed zero. This is evidence for the <strong>risk layer</strong>, not a return forecast.</p>
          </Section>

          <Section id="use-cases" title="06 · Use cases">
            <div className="desk-handbook-usecases">
              <UseCase title="Volatility targeting" formula={<>w<sub>i</sub> = clamp(σ<sub>target</sub> / σ<sub>forecast,i</sub>, 0.25, 1.00)</>}>Scale analytical weight down when forecast volatility rises and up when it falls, within hard leverage, sector and liquidity limits. Compare ATM IV targeting with RV20 targeting on forward realized volatility, drawdown, Sharpe, turnover and cost-adjusted results.</UseCase>
              <UseCase title="Expected-return normalization" formula={<>z<sub>i</sub> = R<sub>i</sub> / EM<sub>i</sub></>}>Normalize expected return by expected move. This compares opportunities by risk-adjusted magnitude rather than by raw return, avoiding the false equivalence of high- and low-volatility names.</UseCase>
              <UseCase title="Risk dashboard" formula="EM, RV20, actual / expected, coverage, MAE, RMSE">Monitor implied versus realized volatility, calibration error, risk bands and regime deterioration. Alerts concern changing risk, not automatic bearishness.</UseCase>
            </div>
            <div className="desk-handbook-callout">Implementation status: paired baseline and expected-move calibration are complete; the 91-month volatility-target run supports risk reduction but not return alpha; the scenario risk replay is implemented; a normalized magnitude model still awaits a preregistered expected-return series. Term slope, skew25 and VRP remain outside production because their evidence is weak or regime-dependent.</div>
          </Section>

          <Section id="case-study" title="07 · AAPL risk profile">
            <div className="desk-handbook-case">
              <RiskChart />
              <div className="desk-handbook-case-metrics">
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
          </Section>

          <Section id="references" title="08 · Academic sources">
            <ul className="desk-handbook-references">
              <li>Black, F., Scholes, M. (1973). <em>The Pricing of Options and Corporate Liabilities</em>. Journal of Political Economy.</li>
              <li>Garman, M. B., Klass, M. J. (1980). <em>On the Estimation of Security Price Volatilities</em>. Journal of Business.</li>
              <li>Breeden, D. T., Litzenberger, R. H. (1978). <em>Prices of State-Contingent Claims Implicit in Option Prices</em>. Journal of Business.</li>
              <li>Xing, Y., Zhang, X., Zhao, R. (2010). <em>What Does the Individual Option Volatility Smirk Tell Us About Future Equity Returns?</em> Journal of Financial and Quantitative Analysis.</li>
              <li>Zhou, H. (2018). <em>Variance Risk Premia, Asset Predictability Puzzles, and Macroeconomic Uncertainty</em>. Annual Review of Financial Economics.</li>
              <li>Rogers, J. L., Skinner, D. J., Van Buskirk, A. (2009). <em>Earnings Guidance and Market Uncertainty</em>. Journal of Accounting &amp; Economics.</li>
              <li>Pan, J., Poteshman, A. M. (2006). <em>The Information in Option Volume for Future Stock Prices</em>. Review of Financial Studies.</li>
            </ul>
            <p className="desk-muted">This handbook documents calculations and evidence policy, not an offer to trade.</p>
          </Section>
        </article>
      </div>
      <DevNotes page="volatilityHandbook" />
    </ResearchFrame>
  );
}
