import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, BookOpen, ShieldCheck, Sigma } from "lucide-react";
import AppLayout from "@/components/AppLayout";

const toc = [
  ["foundations", "01 · Two lenses"],
  ["rv20", "02 · Realized volatility"],
  ["atm-iv", "03 · Implied volatility"],
  ["expected-move", "04 · Expected move"],
  ["paired-baseline", "05 · Paired baseline"],
  ["evidence", "06 · Measured evidence"],
  ["production", "07 · Production gates"],
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
  return (
    <section id={id} className="methodology-section">
      <h2>{title}</h2>
      {children}
    </section>
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
    <AppLayout title="Methodology">
      <div className="methodology-hero t-panel">
        <div>
          <div className="t-label"><BookOpen size={13} /> Research handbook · v1</div>
          <h1>Volatility before direction.</h1>
          <p>How Alpha Engine measures realized and implied volatility, calibrates expected move and tests whether options add information beyond a naive trailing baseline.</p>
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
            <p><strong>RV20</strong> answers: <em>how risky was the asset in the past?</em> <strong>ATM IV</strong> answers: <em>how much risk is the options market pricing into the future?</em> They are related, but not interchangeable. Realized volatility is backward-looking; implied volatility embeds expectations, insurance demand and positioning.</p>
            <div className="methodology-callout">RV20 is a statistical fact about the past. ATM IV is a market price of uncertainty, not a guarantee of future realized volatility.</div>
          </Section>

          <Section id="rv20" title="02 · Realized volatility">
            <p>For close \(P_t\) and log return \(r_t = \ln(P_t/P_(t−1))\), annualized realized volatility over 20 sessions is:</p>
            <Formula title="RV20">{"RV20 = √(252 · Var(r_t−19, …, r_t))"}</Formula>
            <p>The result is expressed in decimal annualized volatility: <code>0.20</code> means 20%. The calculation does not assume a normal distribution or stationary volatility.</p>
            <p>RV20 is our <strong>naive baseline</strong>: simple, transparent and hard to dispute. Any implied-volatility feature must beat it on the same calendar and with the same availability rules.</p>
          </Section>

          <Section id="atm-iv" title="03 · Implied volatility">
            <p>For DTE bucket \(b\), choose the call and put whose strike \(K^*\) is nearest to spot \(S\):</p>
            <Formula title="ATM IV">{"IV_ATM,b = (IV_call,K* + IV_put,K*) / 2"}</Formula>
            <p>DTE median uses actual expirations inside the bucket, not hardcoded 30 or 60 days. Missing values remain <code>null</code>; they are never filled by assumption.</p>
            <div className="methodology-subgrid">
              <Formula title="Term slope" note="Short IV minus next available longer-bucket IV.">{"Slope_b = IV_ATM,next(b) − IV_ATM,b"}</Formula>
              <Formula title="25Δ skew" note="Put IV minus call IV at matched delta.">{"Skew25 = IV_put,Δ≈−0.25 − IV_call,Δ≈0.25"}</Formula>
              <Formula title="IV–RV premium" note="Implied minus trailing realized volatility.">{"VRP_t = IV_ATM,t − RV20,t"}</Formula>
            </div>
          </Section>

          <Section id="expected-move" title="04 · Expected move">
            <Formula title="Expected move in dollars">{"EM = S · IV_ATM · √(DTE / 365)"}</Formula>
            <p>Actual movement must use the <strong>same unit</strong>. If entry and exit prices are \(P_(entry)\) and \(P_(exit)\), then:</p>
            <Formula title="Actual move in dollars">{"ActualMove = P_entry · |P_exit / P_entry − 1|"}</Formula>
            <div className="methodology-callout warning">Never compare decimal return with a dollar expected move. Coverage and ratios become meaningless. Zero expected values are excluded from ratio statistics.</div>
            <p>Expected move is a <strong>risk range</strong>, not a promise of a 68% interval. Coverage, MAE and RMSE are measured empirically for ATM IV and for the RV20 baseline.</p>
          </Section>

          <Section id="paired-baseline" title="05 · Paired baseline">
            <p>High ATM IV IC alone does not prove added value. The real question is whether implied volatility outperforms a simple trailing baseline:</p>
            <Formula title="Paired incremental IC">{"ΔIC = IC_ATM IV − IC_RV20"}</Formula>
            <p>A moving-block bootstrap is run over monthly cross-sections. A positive confidence interval means that implied volatility adds information beyond trailing realized volatility. For GEX, the target is absolute return or Garman–Klass volatility; for skew, SPY-excess return; for ATM IV, forward realized volatility.</p>
          </Section>

          <Section id="evidence" title="06 · Measured evidence">
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
                </tbody>
              </table>
            </div>
            <p>All 90 months and both independent CIK universes are positive for ATM IV. The paired advantage also wins in every month of 2025–2026. That supports <strong>volatility and sizing value</strong>, not directional alpha.</p>
          </Section>

          <Section id="production" title="07 · Production gates">
            <ol className="methodology-list">
              <li>Beat the RV20 baseline on identical availability anchors.</li>
              <li>Confirm on odd/even CIK universes, sector-neutral residuals and sealed holdouts.</li>
              <li>Measure expected-move coverage and error in dollars.</li>
              <li>Model turnover, spread, liquidity and leverage-change costs.</li>
              <li>Use ATM IV only as a risk scalar, not as a bullish or bearish vote.</li>
            </ol>
            <div className="methodology-callout">Next gate: volatility targeting and expected-move-normalized returns. Term slope, skew25 and VRP remain outside production because their evidence is weak or regime-dependent.</div>
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
