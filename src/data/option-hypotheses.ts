export type OptionHypothesisCategory = "Volatility" | "Events" | "Positioning" | "Liquidity" | "Probability engine" | "Macro";
export type OptionEvidenceKind = "qa" | "computed" | "blocked" | "gate" | "supported" | "refuted";

export interface OptionEvidence {
  date: string;
  kind: OptionEvidenceKind;
  summary: string;
}

export interface OptionHypothesis {
  id: string;
  category: OptionHypothesisCategory;
  parameter: string;
  formula: readonly string[];
  hypothesis: string;
  target: string;
  evidence: readonly OptionEvidence[];
}

export const optionHypotheses: readonly OptionHypothesis[] = [
  {
    id: "atm-iv", category: "Volatility", parameter: "ATM IV by DTE bucket",
    formula: ["IV_ATM,b = mean(IV_call,K*, IV_put,K*)", "K* = strike nearest to spot S"],
    hypothesis: "ATM IV should forecast future realized volatility. No directional equity-return sign is assumed.",
    target: "Forward realized volatility",
    evidence: [
      { date: "2026-10-29", kind: "qa", summary: "Cross-provider AAPL near-ATM IV MAE 0.00242 across 14 pairs. This is QA, not an IC result." },
      { date: "2026-10-29", kind: "qa", summary: "Yahoo AAPL chains rejected for IV/OI QA: two-sided quotes cover only 0.56% near and 3.45% far; OI is almost absent. EODHD/Cboe result unchanged." },
      { date: "2026-10-29", kind: "supported", summary: "Strong forward-RV evidence: IC 0.737 (95% CI 0.687–0.778), sector-neutral 0.582, all 90 months positive. Volatility use only; incremental baseline test required before production." },
    ],
  },
  {
    id: "expected-move", category: "Volatility", parameter: "Option-implied expected move",
    formula: ["EM_b = S · IV_ATM,b · √(DTE_b / 365)"],
    hypothesis: "Expected move is a usable risk and strike scale. Test coverage and absolute-return error rather than assuming ideal 68% coverage.",
    target: "Absolute forward return and interval coverage",
    evidence: [
      { date: "2026-10-29", kind: "blocked", summary: "Formula candidate only. Coverage testing requires a daily options history." },
      { date: "2026-10-29", kind: "supported", summary: "Calibrated: coverage 64.8% versus RV20 59.8%, MAE 13.58 versus 13.91, RMSE 26.30 versus 28.03. Better than trailing RV, but not directional alpha." },
    ],
  },
  {
    id: "term-slope", category: "Volatility", parameter: "Term slope",
    formula: ["Slope_b = IV_ATM,next(b) − IV_ATM,b", "next = next available DTE bucket"],
    hypothesis: "An inversion where short IV exceeds longer IV marks event stress and higher near-term realized volatility.",
    target: "Near-term forward realized volatility",
    evidence: [
      { date: "2026-10-29", kind: "computed", summary: "Computed for 52 latest chains. No time-series or IC test has run." },
      { date: "2026-10-29", kind: "refuted", summary: "Weak and regime-dependent: overall IC −0.070 (95% CI −0.096 to −0.044), but the 2026 holdout CI crosses zero. Not a production signal." },
    ],
  },
  {
    id: "iv-rv-premium", category: "Volatility", parameter: "IV–RV premium",
    formula: ["VRP_t = IV_ATM,t − RV20,t", "RV20 = stdev(r_t−19…t) · √252"],
    hypothesis: "High IV relative to trailing RV indicates expensive insurance. Test forward RV and option risk premium separately.",
    target: "Forward RV and volatility risk premium",
    evidence: [
      { date: "2026-10-29", kind: "blocked", summary: "Requires matched daily IV and price history." },
      { date: "2026-10-29", kind: "refuted", summary: "No stable VRP effect: overall IC −0.029 (95% CI −0.069 to 0.009); odd/even and sector regimes flip signs. Nominal FDR rejection is insufficient." },
    ],
  },
  {
    id: "earnings-crush", category: "Events", parameter: "Earnings IV crush",
    formula: ["Crush = IV_after / IV_before − 1", "Use the same DTE bucket before and after"],
    hypothesis: "Implied volatility falls after earnings. Compare matched pre/post events without mixing maturities.",
    target: "Event-window IV change",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Remains honest null until earnings dates and pre/post snapshots exist." }],
  },
  {
    id: "skew-25", category: "Positioning", parameter: "25Δ skew",
    formula: ["Skew25 = IV_put,Δ≈−0.25 − IV_call,Δ≈0.25"],
    hypothesis: "Rising skew measures downside-protection demand and left-tail risk. The forward equity-return sign remains open.",
    target: "Left-tail risk and forward excess return",
    evidence: [
      { date: "2026-10-29", kind: "computed", summary: "Computed for 52 latest chains. Sign and IC are untested." },
      { date: "2026-10-29", kind: "refuted", summary: "No robust directional evidence: overall IC 0.041 (95% CI −0.012 to 0.084), FDR not rejected and yearly sign flips. Do not use as a crash indicator." },
    ],
  },
  {
    id: "put-call-volume", category: "Positioning", parameter: "Put/Call volume",
    formula: ["P/C Vol_b = ΣV_put / ΣV_call"],
    hypothesis: "An extreme may represent bearish positioning or a contrarian setup. Test both signs and a possible U-shape.",
    target: "Forward excess return and forward RV",
    evidence: [{ date: "2026-10-29", kind: "computed", summary: "Computed, but zero volume is common. No predictive test has run." }],
  },
  {
    id: "put-call-oi", category: "Positioning", parameter: "Put/Call open interest",
    formula: ["P/C OI_b = ΣOI_put / ΣOI_call"],
    hypothesis: "Open interest may capture a slower structural hedge. Test forward return and volatility without presuming a sign.",
    target: "Forward excess return and forward RV",
    evidence: [{ date: "2026-10-29", kind: "computed", summary: "Computed, but OI freshness is unproven and IC is untested." }],
  },
  {
    id: "volume-oi", category: "Positioning", parameter: "Volume / open interest",
    formula: ["Turnover_b = (ΣV_call + ΣV_put) /", "(ΣOI_call + ΣOI_put)"],
    hypothesis: "A turnover spike marks new information. The primary hypothesis is higher forward realized volatility, not direction.",
    target: "Forward realized volatility",
    evidence: [{ date: "2026-10-29", kind: "computed", summary: "Computed. Interpret only after OI quality and availability checks." }],
  },
  {
    id: "atm-spread", category: "Liquidity", parameter: "ATM relative spread",
    formula: ["Spread_ATM = mean[(ask − bid) /", "((ask + bid) / 2)]"],
    hypothesis: "Wide spreads worsen execution and feature quality. Tradable alpha after costs should weaken as spreads widen.",
    target: "Execution cost and signal decay",
    evidence: [{ date: "2026-10-29", kind: "gate", summary: "Computed. Use as a quality filter first; no execution test has run." }],
  },
  {
    id: "zero-bid", category: "Liquidity", parameter: "Zero-bid share",
    formula: ["ZeroBid = count(bid = 0) / N"],
    hypothesis: "A high zero-bid share identifies poor liquidity and unstable Greeks. This is a QA filter, not a forecast.",
    target: "Data quality and tradability",
    evidence: [{ date: "2026-10-29", kind: "gate", summary: "11.90% of 310,634 rows across 250 snapshots. Not an alpha signal." }],
  },
  {
    id: "signed-call-volume", category: "Positioning", parameter: "Signed call ask volume",
    formula: ["SignedCall = ΣV_call,ask − ΣV_call,bid"],
    hypothesis: "Aggressive ask-side call buying may precede positive excess returns. It must outperform unsigned put/call volume after costs.",
    target: "SPY-excess forward return over 1–5 sessions",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Current sources do not identify aggressor side or buy-to-open volume. Total call volume is not a valid substitute." }],
  },
  {
    id: "option-pinning", category: "Events", parameter: "Expiration pinning / max-OI strike",
    formula: ["K_pin = argmax_K [OI_call(K) + OI_put(K)]", "PinDist = (S_close − K_pin) / S_close"],
    hypothesis: "Expiration closes may cluster near the highest-OI strike more often than matched non-expiration sessions.",
    target: "Expiration-day PinDist and absolute return",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Strike-level OI exists only for a few current snapshots. No expiration-day history or control sample yet." }],
  },
  {
    id: "deep-tail-skew", category: "Volatility", parameter: "Deep-tail skew acceleration",
    formula: ["WingSkew = IV_put,Δ≈−0.10 − IV_put,Δ≈−0.25", "Track ΔWingSkew_t"],
    hypothesis: "Acceleration in deep-put demand may add left-tail information beyond the standard 25-delta skew. A crash is not assumed.",
    target: "Downside semivariance and forward excess return",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Requires historical 10-delta wing IV and an incremental test over the existing 25-delta skew." }],
  },
  {
    id: "event-vrp-compression", category: "Events", parameter: "Pre-event IV–RV compression",
    formula: ["Compression_t = (IV_t − RV20_t) −", "median(IV_t−20 − RV20_t−20)"],
    hypothesis: "Unusual IV–RV compression before earnings may underprice the subsequent absolute move, independent of direction.",
    target: "Event-window absolute return and realized volatility",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Needs daily IV/RV and event timestamps with matched term structure and event-type controls." }],
  },
  {
    id: "rnd-tail-shift", category: "Volatility", parameter: "Risk-neutral density tail shift",
    formula: ["q(S_T) = (1/P) · ∂²C(K,T)/∂K²", "TailShift = q_t(S_T < 0.9S) − q_t−20(S_T < 0.9S)"],
    hypothesis: "Changes in risk-neutral left-tail probability may add trend and tail-risk information beyond skew.",
    target: "Forward tail return and trend change",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Requires a complete smooth chain, rates/dividends and stable second derivatives. Sparse chains are insufficient." }],
  },
  {
    id: "gamma-squeeze", category: "Positioning", parameter: "Dollar gamma exposure",
    formula: ["GEX_K,T = Γ_K,T · OI_K,T · Multiplier · S² · 0.01", "NetGEX = Σ_calls GEX − Σ_puts GEX", "Gamma flip requires repricing Γ(S), not fixed-Γ scaling"],
    hypothesis: "Positive GEX may dampen volatility while negative GEX may amplify it. The expected volatility IC is negative, not a direction forecast.",
    target: "Next-day Garman-Klass volatility or absolute log return",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Dollar GEX is defined, but dealer inventory is a scenario. Claimed IC ranges are not accepted without independent validation." }],
  },
  {
    id: "gamma-wall-reversal", category: "Positioning", parameter: "Gamma-wall reversal",
    formula: ["WallDist = (S − K_max|GEX|) / S", "Evaluate only |WallDist| ≤ 1%"],
    hypothesis: "Proximity to a large gamma wall may increase reversal probability. Support/resistance direction and persistence remain open.",
    target: "Signed return and reversal probability over 1–5 sessions",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Requires historical wall paths and a dealer scenario. A fixed 1% window is preregistered and must not be tuned on results." }],
  },
  {
    id: "vanna-charm", category: "Volatility", parameter: "Vanna and Charm hedging pressure",
    formula: ["Vanna = ∂Δ/∂σ", "Charm = ∂Δ/∂τ"],
    hypothesis: "IV changes and time decay may alter hedging pressure and intraday realized volatility around expirations.",
    target: "Intraday realized volatility around IV changes and expiry",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Second-order Greeks, synchronized surfaces and a dealer-position model are missing. Not testable from current data." }],
  },
  {
    id: "cot-positioning", category: "Macro", parameter: "CFTC COT positioning extreme",
    formula: ["NetComm = (Long − Short) / OpenInterest", "COTZ = (NetComm − μ_3y) / σ_3y"],
    hypothesis: "Extreme commercial positioning may mark trend continuation or contrarian reversal. The sign is tested separately by asset and regime.",
    target: "Multi-week futures returns and cross-asset regime",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Requires CFTC COT history with actual publication dates, contract mapping and no look-ahead from the report week." }],
  },
  {
    id: "futures-term-structure", category: "Macro", parameter: "Futures term-structure slope",
    formula: ["Basis = F_near / F_far − 1", "ΔBasis = Basis_t − Basis_t−20"],
    hypothesis: "Contango/backwardation and its changes may classify supply-demand and volatility regimes without guaranteeing spot direction.",
    target: "Futures curve returns, spot realized volatility and macro regime",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Requires point-in-time futures curves with expiry mapping, roll rules, rates/carry and no nearest-contract splicing artifacts." }],
  },
  {
    id: "engine-increment", category: "Probability engine", parameter: "Incremental engine value",
    formula: ["ΔBrier = Brier_base − Brier_base+options", "ΔLogLoss = LL_base − LL_base+options"],
    hypothesis: "Options improve the base engine when deltas are positive and held-out calibration and incremental IC also improve.",
    target: "Brier, log loss, calibration and incremental IC",
    evidence: [{ date: "2026-10-29", kind: "gate", summary: "Gate defined. Base versus base+options evaluation has not run." }],
  },
];

export function latestEvidence(hypothesis: OptionHypothesis): OptionEvidence {
  return hypothesis.evidence[hypothesis.evidence.length - 1];
}
