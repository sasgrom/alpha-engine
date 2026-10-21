/**
 * Factor registry (4j) — the single source for every factor's:
 *   shortHint      — the (i) popover text (touch-friendly, click-to-open);
 *   wiki           — the long entry for /wiki (logic, how we got here);
 *   formula        — the exact computation from our tables;
 *   anchor         — the academic publication it stands on;
 *   reference      — how to read the number: a literature threshold, or the
 *                    company's own robust history (median + IQR band; sector
 *                    means are a finals-phase TODO once the registry is full);
 *   signal         — the growth/decline read: up / down / neutral.
 *
 * Signal philosophy (honest): "up" = the factor's literature direction is
 * favorable; it is NOT a buy order — it's one input among many.
 */

export type FactorSignal = "up" | "down" | "neutral" | null;

export interface FactorMeta {
  key: string;
  name: string;
  shortHint: string;
  formula: string;
  wiki: string;
  anchor: { citation: string; link: string };
  wikiLink: string;
  howWeCompute: string;
  reference: string;
  signal: (value: number | null, ownMedian: number | null) => FactorSignal;
}

const vsOwn = (v: number | null, m: number | null, eps = 0.005): FactorSignal =>
  v === null ? null : m === null ? "neutral" : v > m + eps ? "up" : v < m - eps ? "down" : "neutral";

export const FACTOR_META: FactorMeta[] = [
  {
    key: "accruals",
    name: "Accruals (NI−CFO)/Assets",
    shortHint:
      "Earnings not backed by cash. Negative = cash flow exceeds accounting profit (quality). High positive = profit lives on paper accruals — historically precedes underperformance.",
    formula: "(Net income TTM − operating cash flow TTM) / average total assets",
    wiki: "Accruals measure the gap between accounting profit and cash profit. Sloan (1996) showed the accrual component of earnings is less persistent than the cash component: firms with high accruals systematically disappoint. We compute it quarterly from our canonical series (NetIncomeLoss − NetCashProvidedByUsedInOperatingActivities over Assets); the displayed reference is the company's own robust median across its reporting history (median + interquartile band, so gaps and extremes don't poison it).",
    anchor: { citation: "Sloan, R. (1996) — Do Stock Prices Fully Reflect Information in Accruals and Cash Flows About Future Earnings?", link: "https://www.jstor.org/stable/2490730" },
    wikiLink: "https://en.wikipedia.org/wiki/Accrual",
    howWeCompute: "series_points TTM sums per quarter; assets averaged over the window edges",
    reference: "sign is the first-order read (<0 favorable); own-history median shown as the band",
    signal: (v, m) => (v === null ? null : v < 0 ? "up" : v > 0.05 ? "down" : m !== null ? vsOwn(v, m, 0.01) : "neutral"),
  },
  {
    key: "grossProfitability",
    name: "Gross profitability",
    shortHint:
      "Gross profit per dollar of assets. Novy-Marx: this single ratio predicts returns about as well as book-to-market — profitable firms keep winning.",
    formula: "Gross profit TTM / total assets",
    wiki: "Novy-Marx (2013) found gross profitability (revenue minus cost of goods, over assets) is roughly as powerful as book-to-market for predicting returns and works in the opposite corner of the income statement from bottom-line metrics. We read GrossProfit and Assets from the canonical series; the company is compared against its own history median (robust to gaps/extremes). Sector medians arrive with the full registry (finals-phase TODO).",
    anchor: { citation: "Novy-Marx, R. (2013) — The other side of value: The gross profitability premium", link: "https://www.sciencedirect.com/science/article/pii/S0304405X12000186" },
    wikiLink: "https://en.wikipedia.org/wiki/Gross_margin",
    howWeCompute: "series_points: GrossProfit TTM / Assets at quarter end",
    reference: "above the company's own median = favorable; sector median = TODO at full registry",
    signal: (v, m) => vsOwn(v, m, 0.01),
  },
  {
    key: "assetGrowth",
    name: "Asset growth YoY",
    shortHint:
      "How fast the balance sheet inflates. Cooper–Gulen–Schill: high asset growth is the strongest broad negative predictor — empires over-invest at the top.",
    formula: "Assets now / Assets a year ago − 1",
    wiki: "Cooper, Gulen & Schill (2008) documented that asset growth is a strong negative return predictor — aggressive expansion (acquisitions, capex sprees, equity issuance) tends to peak at valuation peaks. We measure year-over-year asset growth at fiscal-year ends from the series layer; the band is the company's own history.",
    anchor: { citation: "Cooper, Gulen & Schill (2008) — Asset Growth and the Cross-Section of Stock Returns", link: "https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.2008.01370.x" },
    wikiLink: "https://en.wikipedia.org/wiki/Asset_growth",
    howWeCompute: "Assets at FY end vs the previous FY end (series_points, stock kind)",
    reference: ">25% YoY reads aggressive (literature top quintile territory); own median shown",
    signal: (v) => (v === null ? null : v > 0.25 ? "down" : v < 0.05 ? "up" : "neutral"),
  },
  {
    key: "buybackYield",
    name: "Buyback yield",
    shortHint:
      "Net payout to shareholders: buybacks (shrinking share count) plus dividends over market cap. Positive = the company returns cash; negative = it issues.",
    formula: "−Δ shares outstanding / shares + |dividends TTM| / market cap",
    wiki: "The net-issuance anomaly (Loughran–Ritter lineage; Fama–French include it in profitability/investment factors): firms that shrink their share count outperform issuers. We track CommonStockSharesOutstanding in the series layer and dividend cash flows; price from our own bars.",
    anchor: { citation: "Loughran & Ritter (1995) — The new issues puzzle; Fama & French (2015) — five-factor model", link: "https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1995.tb05166.x" },
    wikiLink: "https://en.wikipedia.org/wiki/Share_repurchase",
    howWeCompute: "Δshares from series_points + PaymentsOfDividendsCommonStock TTM + our last close",
    reference: "0% is the natural divide: above = net payout, below = net issuance",
    signal: (v) => (v === null ? null : v > 0.005 ? "up" : v < -0.005 ? "down" : "neutral"),
  },
  {
    key: "momentum122",
    name: "Momentum 12-2",
    shortHint:
      "Twelve-month return skipping the last month. Winners keep winning in the medium run; the skip avoids the one-month reversal noise.",
    formula: "price(12m ago → 1m ago) return, from our own daily bars (adjusted)",
    wiki: "Jegadeesh & Titman (1993) established medium-term momentum: stocks that won over ~12 months keep outperforming for a while; skipping the most recent month avoids the short-term reversal leg. Computed from our own daily price history (stooq-adjusted bars), benchmark-free.",
    anchor: { citation: "Jegadeesh & Titman (1993) — Returns to Buying Winners and Selling Losers", link: "https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1993.tb04702.x" },
    wikiLink: "https://en.wikipedia.org/wiki/Momentum_investing",
    howWeCompute: "prices table (merged stooq/yahoo per date), adjClose-preferred closes",
    reference: "sign read: above 0 the name is in an uptrend",
    signal: (v) => (v === null ? null : v > 0 ? "up" : "down"),
  },
  {
    key: "high52",
    name: "52w-high proximity",
    shortHint:
      "Close / 52-week high. George–Hwang: proximity to the high (not the distance from the low) carries momentum information.",
    formula: "last close / max(high, 52 weeks) — from our bars",
    wiki: "George & Hwang (2004) showed nearness to the 52-week high explains momentum profits better than past returns alone — anchors in traders' heads adjust slowly. We compute it from our stored bars with the window anchored to the LAST bar date (archives age between syncs).",
    anchor: { citation: "George & Hwang (2004) — The 52-Week High and Momentum Investing", link: "https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.2004.00695.x" },
    wikiLink: "https://en.wikipedia.org/wiki/52-week_high",
    howWeCompute: "week52() over our prices table; window ends at the last stored bar",
    reference: "≥0.9 = hugging the high; <0.75 = deep off it",
    signal: (v) => (v === null ? null : v >= 0.9 ? "up" : v < 0.75 ? "down" : "neutral"),
  },
  {
    key: "sue",
    name: "SUE (EPS surprise)",
    shortHint:
      "Standardized unexpected earnings: this quarter's EPS vs a year ago, scaled by the volatility of past changes. Positive = earnings beat their own trend.",
    formula: "(EPS_q − EPS_{q−4}) / σ of such YoY diffs over the last quarters",
    wiki: "Chan, Jegadeesh & Lakonishok (1996) — earnings surprise (both against estimates and time-series trend) drives post-earnings drift. Without consensus estimates we use the time-series variant: current diluted EPS vs four quarters back, normalized by the surprise history. Pairs with our PEAD event stream (8-K Item 2.02).",
    anchor: { citation: "Chan, Jegadeesh & Lakonishok (1996) — Momentum Strategies", link: "https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1996.tb05222.x" },
    wikiLink: "https://en.wikipedia.org/wiki/Earnings_surprise",
    howWeCompute: "EarningsPerShareDiluted quarterly series (latest vintage)",
    reference: "sign read; |SUE| > 1 is a strong surprise",
    signal: (v) => (v === null ? null : v > 0.5 ? "up" : v < -0.5 ? "down" : "neutral"),
  },
  {
    key: "fScore",
    name: "Piotroski F-score",
    shortHint:
      "Nine yes/no health checks (profitability, balance-sheet strength, efficiency). 7–9 strong, 3–6 middling, 0–2 weak. The checklist on the card shows which signal failed.",
    formula: "9 binary signals over FY aggregates (ROA, CFO, ΔROA, accruals, Δleverage, Δcurrent, issuance, ΔGM, Δturnover)",
    wiki: "Piotroski (2000) built the F-score to separate winners from losers inside value portfolios: nine binary signals, each backed by accounting logic. We compute it from our statements data; signals whose inputs are missing in our coverage show as n/a and never count as a pass (honest scoring).",
    anchor: { citation: "Piotroski, J. (2000) — Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers", link: "https://www.jstor.org/stable/2492906" },
    wikiLink: "https://en.wikipedia.org/wiki/Piotroski_F-score",
    howWeCompute: "annual aggregates from series_points (flows summed per FY, stocks at FY end)",
    reference: "≥7 strong · 3–6 middling · ≤2 weak (Piotroski's bands)",
    signal: (v) => (v === null ? null : v >= 7 ? "up" : v <= 2 ? "down" : "neutral"),
  },
  {
    key: "altmanZ",
    name: "Altman Z-score",
    shortHint:
      "Bankruptcy-risk blend of five balance-sheet ratios. >2.99 safe zone, 1.8–2.99 grey, <1.8 distress. Tech giants score huge (equity-dominant) — read against the zones, not absolutes.",
    formula: "1.2·WC/TA + 1.4·RE/TA + 3.3·EBT/TA + 0.6·ME/TL + 1.0·S/TA",
    wiki: "Altman (1968) — the classic distress model, five ratios weighted by a discriminant analysis on bankrupt manufacturers. The equity/liability term makes cash-rich tech names score stratospherically; that's expected. We compute it from our statements layer; missing inputs (e.g. REIT retained-earnings tagging) yield an honest null.",
    anchor: { citation: "Altman, E. (1968) — Financial Ratios, Discriminant Analysis and the Prediction of Corporate Bankruptcy", link: "https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1968.tb00843.x" },
    wikiLink: "https://en.wikipedia.org/wiki/Altman_Z-score",
    howWeCompute: "series layer + market cap = our price × diluted shares",
    reference: "zones: >2.99 safe · 1.8–2.99 grey · <1.8 distress",
    signal: (v) => (v === null ? null : v >= 2.99 ? "up" : v < 1.8 ? "down" : "neutral"),
  },
  {
    key: "beneishM",
    name: "Beneish M-score",
    shortHint:
      "Earnings-manipulation probability from 8 ratio indices (receivables vs revenue, margin decay, depreciation policy, accruals…). M > −1.78 = flagged zone. Pairs with our restatement metrics.",
    formula: "−4.84 + 0.92·DSR + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI",
    wiki: "Beneish (1999) — a probit model over eight indices computed from public filings; it catches earnings manipulators with useful accuracy. M > −1.78 is the classic flag line. On our platform it complements the data-quality factors from Stage 1.6 (revision rate/magnitude, D7): accounting-risk readings from two independent angles.",
    anchor: { citation: "Beneish, M. (1999) — The Detection of Earnings Manipulation", link: "https://onlinelibrary.wiley.com/doi/10.2308/acch.1999.74.5.24" },
    wikiLink: "https://en.wikipedia.org/wiki/Beneish_M-score",
    howWeCompute: "all eight indices from our canonical series (receivables, revenue, GP, CA, PP&E, D&A, SGA, liabilities, NI, CFO)",
    reference: "−1.78 is the published flag line",
    signal: (v) => (v === null ? null : v > -1.78 ? "down" : "up"),
  },
  {
    key: "impliedGrowth",
    name: "Implied FCF growth (market)",
    shortHint:
      "Reverse DCF: the free-cash-flow growth rate that makes today's price fair at our WACC. Compare with the historical FCF CAGR next to it — the gap is the market's optimism premium.",
    formula: "solve g: DCF(FCF_TTM, g, fade→2.5%, WACC) = market cap (bisection)",
    wiki: "Rappaport & Mauboussin's 'Expectations Investing': prices don't predict, they IMPLY. Instead of forecasting, we read what the market must believe. Implied growth far above the company's own FCF history = expensive expectations; below = cheap. This is an expectation read, not a target price.",
    anchor: { citation: "Rappaport & Mauboussin (2001) — Expectations Investing", link: "https://en.wikipedia.org/wiki/Expectations_investing" },
    wikiLink: "https://en.wikipedia.org/wiki/Discounted_cash_flow",
    howWeCompute: "FCF TTM from our series (CFO − capex), market cap from our price × diluted shares, WACC = rf 4% + beta5y × ERP 5% (constants until FRED macro lands in Stage 4)",
    reference: "vs the company's own FCF CAGR (shown next to it)",
    signal: (v, m) => (v === null || m === null ? null : v < m ? "up" : v > m * 1.5 ? "down" : "neutral"),
  },
  {
    key: "vpRatio",
    name: "V/P ratio (Frankel–Lee)",
    shortHint:
      "Residual-income model value over market cap. >1 = the model sees more value than the price asks; <1 = price outruns the model. Read as a range, never a point.",
    formula: "RIM base (EBO: book + Σ(ROE−r)·B_t/(1+r)^t) / market cap",
    wiki: "Frankel & Lee (1998) — the residual-income (Edwards–Bell–Ohlson) value-to-price ratio predicts returns: V/P > 1 names outperform. Our RIM uses current ROE with a fade to the cost of equity (competition erodes excess returns) and shows bear/base/bull alongside.",
    anchor: { citation: "Frankel & Lee (1998) — Accounting valuation, market expectation, and cross-sectional stock returns", link: "https://www.sciencedirect.com/science/article/pii/S0165410198000135" },
    wikiLink: "https://en.wikipedia.org/wiki/Residual_income_valuation",
    howWeCompute: "book equity + ROE from our series; discount rate = the same WACC-lite as reverse DCF",
    reference: "1.0 is the parity line",
    signal: (v) => (v === null ? null : v > 1 ? "up" : v < 0.8 ? "down" : "neutral"),
  },
  {
    key: "peZ",
    name: "P/E z-score (vs own history)",
    shortHint:
      "Today's P/E measured in standard deviations against the company's own five-year P/E history. +1.65 means pricier than ~95% of its own past — not a sector comparison.",
    formula: "(P/E TTM now − median-history mean) / σ, monthly P/E series from our bars × trailing EPS",
    wiki: "A time-series value read: multiples mean-revert within a name more reliably than across names. We build the monthly P/E series honestly — each bar priced against the trailing EPS TTM known by then (point-in-time). z > +1 = rich vs own history, z < −1 = cheap.",
    anchor: { citation: "Time-series multiple discipline — see Fama–French value factor lineage", link: "https://en.wikipedia.org/wiki/Value_investing" },
    wikiLink: "https://en.wikipedia.org/wiki/Price%E2%80%93earnings_ratio",
    howWeCompute: "prices table monthly closes × EarningsPerShareDiluted TTM as-of (point-in-time)",
    reference: "±1σ bands vs own history; sector medians = finals-phase TODO",
    signal: (v) => (v === null ? null : v > 1 ? "down" : v < -1 ? "up" : "neutral"),
  },
];

export const factorMeta = (key: string): FactorMeta | undefined => FACTOR_META.find((f) => f.key === key);
