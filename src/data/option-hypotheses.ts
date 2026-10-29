export type OptionHypothesisCategory = "Volatility" | "Events" | "Positioning" | "Liquidity" | "Probability engine";
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
    evidence: [{ date: "2026-10-29", kind: "qa", summary: "Cross-provider AAPL near-ATM IV MAE 0.00242 across 14 pairs. This is QA, not an IC result." }],
  },
  {
    id: "expected-move", category: "Volatility", parameter: "Option-implied expected move",
    formula: ["EM_b = S · IV_ATM,b · √(DTE_b / 365)"],
    hypothesis: "Expected move is a usable risk and strike scale. Test coverage and absolute-return error rather than assuming ideal 68% coverage.",
    target: "Absolute forward return and interval coverage",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Formula candidate only. Coverage testing requires a daily options history." }],
  },
  {
    id: "term-slope", category: "Volatility", parameter: "Term slope",
    formula: ["Slope_b = IV_ATM,next(b) − IV_ATM,b", "next = next available DTE bucket"],
    hypothesis: "An inversion where short IV exceeds longer IV marks event stress and higher near-term realized volatility.",
    target: "Near-term forward realized volatility",
    evidence: [{ date: "2026-10-29", kind: "computed", summary: "Computed for 52 latest chains. No time-series or IC test has run." }],
  },
  {
    id: "iv-rv-premium", category: "Volatility", parameter: "IV–RV premium",
    formula: ["VRP_t = IV_ATM,t − RV20,t", "RV20 = stdev(r_t−19…t) · √252"],
    hypothesis: "High IV relative to trailing RV indicates expensive insurance. Test forward RV and option risk premium separately.",
    target: "Forward RV and volatility risk premium",
    evidence: [{ date: "2026-10-29", kind: "blocked", summary: "Requires matched daily IV and price history." }],
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
    evidence: [{ date: "2026-10-29", kind: "computed", summary: "Computed for 52 latest chains. Sign and IC are untested." }],
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
