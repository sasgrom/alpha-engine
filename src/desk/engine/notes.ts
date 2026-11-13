/**
 * The write-up of every step of the Engine page: the hypothesis, the process used, why it was chosen, what to expect,
 * the formula or principle, what can be done better, and ideas from outside the box. The worked example of each
 * formula is computed on the page from the chosen company's own numbers.
 */
export interface StepNotes {
  hypothesis: string;
  process: string[];
  why: string;
  expected: string;
  formulas: string[];
  better: string[];
  ideas: string[];
}

export const STEP_TITLES = [
  "Raw fundamentals and prices",
  "Readings: the processed data",
  "The algorithm: from a reading to a forecast",
  "Track record: e+ and e−",
  "Probabilities: Bayes from the usual rate",
  "Decision tree: how a probability becomes a trade",
  "Test results and benchmarks",
] as const;

export const NOTES: StepNotes[] = [
  {
    hypothesis: "A company's own filed figures and its share price carry information about how its stock will move against its sector after a publication. They can only be used honestly as they stood on the day: figures filed later, or corrected later, must not leak into a decision.",
    process: [
      "Filed figures come from the SEC's XBRL company facts (the local facts table): every value with the period it covers, the filing it came from (accession number, form) and the day that filing was made.",
      "Prices are total-return closes of the stock, of its sector fund (the SPDR sector ETF; before XLRE and XLC existed, the fund the companies belonged to then) and of the market (SPY).",
      "Two decisions a quarter, each at the close of the first full session after a publication: after the earnings release (release decision, prices only) and after the 10-Q or 10-K (filing decision, prices and filed figures).",
      "A decision is followed until the last close before the next quarter's first publication; horizons of 5, 10, 20 and 45 sessions count only if they end inside that window.",
    ],
    why: "The SEC filing is the primary source and carries an exact date, so the point-in-time rule can be enforced mechanically. Within a filing, the engine prefers the filing's own figures, including its own prior-year columns, over any later restatement. The sector fund as benchmark isolates what is particular to the company from what moved its whole industry.",
    expected: "Complete figures from about 2009, when XBRL tagging began; earlier quarters have prices but few figures. The same item appears under several names across companies and years (revenue alone has six), so each item is read from a short list of names, the first that has both quarters.",
    formulas: [
      "Point in time: a figure counts at a decision only if filed ≤ decision day; the decision's own filing is preferred, then the nearest period end.",
      "A quarter's flow item (revenue, profit) is the 3-month value; when only year-to-date values are filed, it is taken as the difference of two year-to-date values.",
    ],
    better: [
      "Read the figures printed in the earnings release on its own day (task K03's reader), so the release decision can use figures too.",
      "Treat amendments and restatements explicitly, and keep unadjusted prices so valuation ratios (price against earnings per share as filed) become possible.",
      "Segment and geographic figures, guidance, and the text of the filing itself.",
    ],
    ideas: [
      "Data beyond the filings: option-implied moves before a release, short interest, insider purchases, all-filer 13F flows, analyst revisions, job postings, web and app traffic.",
      "The order and timing of filings as a signal: late filers, unusual 8-K items, a 10-K filed on a Friday evening.",
    ],
  },
  {
    hypothesis: "Changes carry news, levels do not: a figure matters against the same quarter a year ago, against the company's own recent record, and against what its peers reported. A price move matters in units of how much the stock usually moves.",
    process: [
      "Price readings (step 1 of the engine): moves of the stock against its sector fund, each divided by the company's usual daily move against the sector (σc, over the 126 sessions before) times √(sessions): the first-session reaction, the drift since then, 12- and 6-month momentum (ending a month before), the run-up over the 21 sessions before; also recent volatility against usual (log ratio) and the distance below the 52-week high (log).",
      "Filed-figure readings (step 2): 18 changes against the same quarter a year ago (revenue growth, margin changes, accruals, cash flow, asset and share growth, inventory and receivables against sales, R&D and overhead intensity, capital spending, payout, deferred revenue, cash margin).",
      "Each filed-figure reading on three bases: as it is; .trend, against the company's own last four values in units of its last eight; .peer, minus the median of the other companies' latest values filed within 100 days.",
      "At the release decision only the price readings are used (the figures are not filed yet); the filing decision uses both.",
    ],
    why: "Units of the usual move make a 3% move in a utility and a 3% move in a chip maker different things, as they are. Year-ago comparisons remove seasons. The three bases test three different surprises: against last year, against the company's habits, and against everyone else.",
    expected: "Most readings sit near zero with long tails; many are missing in the early years and for companies without a given item (banks have no gross margin). Related readings move together (the three margins, the three bases of one item); step 5 measures how much and counts them accordingly.",
    formulas: [
      "Price reading: x = Δ ln(stock / sector fund) / (σc · √sessions).",
      "Growth: x = value now / value a year ago − 1 (both positive).",
      "Margin change: x = item now / revenue now − item a year ago / revenue a year ago.",
      ".trend: (x − mean of the company's last 4 values) / standard deviation of its last 8 (needs at least 4).",
      ".peer: x − median of the peers' latest values (needs at least 8 peers within 100 days).",
    ],
    better: [
      "Expectations instead of year-ago figures: against guidance or a consensus, the surprise is what the market had not priced.",
      "Per-sector definitions (banks, insurers and REITs report differently) and robust scaling of the tails.",
    ],
    ideas: [
      "Text readings: tone of the release and of the filing, how much the risk factors changed since last year.",
      "Spillovers: a supplier's or customer's surprise read into the company before its own report.",
    ],
  },
  {
    hypothesis: "Each reading relates to the later move against the sector in a simple, roughly monotonic way, and the direction of that relation (direct or inverse) can be learned from history without being chosen in advance.",
    process: [
      "Rank-normal score: the reading's place among all earlier readings of that factor (all companies), turned into a normal score z and capped at ±3; needs 50 earlier readings.",
      "Ordinary least squares of the later move y (company against sector over the horizon, in usual moves) on z, from finished outcomes only, refitted before every decision; needs 30 finished outcomes.",
      "The factor's forecast: rise if slope × z > 0, otherwise fall; its strength by the size of z: weak below 0.43, medium below 0.97, strong above (the thirds of a normal reading).",
      "Alongside, as references: a penalised logistic regression on all readings at once (the joint model), and two simpler readings of the same tables (table, soft).",
    ],
    why: "One small regression per factor is transparent: anyone can see which way a factor points and how sure it is. The rank-normal score makes factors in different units comparable and tames outliers. Refitting on finished outcomes only means every forecast uses nothing that was not known that day. This is the owner's method, chosen for interpretability; it is not proven better than alternatives, and the joint model is computed beside it to check.",
    expected: "Small slopes: a few hundredths of a usual move per unit of z, because the links are weak. Directions can change in the early years, while the counts are small.",
    formulas: [
      "z = Φ⁻¹((rank + ½) / (N + 1)), capped at ±3; Φ(z) is the share of earlier readings below this one.",
      "b = (Σzy − Σz·Σy / n) / (Σz² − (Σz)² / n),  a = (Σy − b·Σz) / n,  forecast y = a + b·z.",
      "side = rise if b·z > 0; strength = weak (|z| < 0.43), medium (|z| < 0.97), strong.",
    ],
    better: [
      "Robust regression (Huber) so that a few huge moves do not set the direction; shapes that are not straight lines.",
      "Per-sector slopes where sectors truly differ, and recent years weighted more (tested: no gain so far).",
    ],
    ideas: [
      "Gradient-boosted trees under the same strict walk-forward, as a challenger to read where the simple engine misses structure.",
      "Quantile regression: forecast the tails, not only the direction.",
    ],
  },
  {
    hypothesis: "A factor's forecast is only worth what its track record shows. Count how its earlier forecasts turned out, by side and strength.",
    process: [
      "Every forecast is filed on the day it is made in one of six cells: said fall or rise, weak, medium or strong. It is counted only once its outcome is known, under the side it took that day (never a side chosen afterwards).",
      "e+ is the share of the falls in which the factor had said rise (a false rise); e− the share of the rises in which it had said fall (a missed rise).",
      "The evidence of today's cell is the log of how much likelier that forecast was before a rise than before a fall, each count smoothed by a half; its variance comes with it.",
      "A factor needs 150 finished outcomes and at least 20 rises and 20 falls after its forecasts before its evidence is used.",
    ],
    why: "Bayes' rule needs exactly these likelihoods: how often this forecast came before a rise, and before a fall. The table gives them directly, without assuming a shape. Graded cells let a strong reading count for more than a weak one only if the record shows it.",
    expected: "For a factor that knows nothing, the rise and fall counts in each cell are in proportion to all rises and falls, so the evidence is near zero and e+ ≈ the share of rise forecasts. In today's engine almost every factor looks like that.",
    formulas: [
      "e+ = (said rise and fell) / (all falls);  e− = (said fall and rose) / (all rises).",
      "evidence e = ln( ((a + ½) / (U + 3)) / ((b + ½) / (D + 3)) ),  a, b = rises and falls after this cell's forecasts; U, D = all rises and falls after this factor's forecasts.",
      "variance v = 1/(a + ½) − 1/(U + 3) + 1/(b + ½) − 1/(D + 3).",
    ],
    better: [
      "Tables per sector or per company with partial pooling (computed as a variant: table.partial).",
      "Older forecasts weighted less (tested as DECAY: no gain on all companies).",
    ],
    ideas: [
      "Hierarchical Bayesian tables: factor within family within sector, learned together.",
      "Conformal prediction to give each probability an honest error band.",
    ],
  },
  {
    hypothesis: "Separate pieces of evidence add up in log-odds (Bayes' rule). Start from how often the target has risen so far, and let every factor that has earned trust move the probability.",
    process: [
      "The usual rate: (rises + 1) / (all + 2) over all finished outcomes so far.",
      "Shrinking: within each family (price behaviour, filed figures, ...), how much the factors' evidence differs beyond its own noise (the family's real spread S) decides how much of each factor's evidence is kept: e · S / (S + v). A family that shows nothing beyond noise keeps nothing.",
      "k: each factor's kept evidence is divided by how much the other voting factors repeat it: 1 + the sum of its correlations with them (by direction, weighted by their relative strength, only pairs seen together at least 100 times), and never below 1.",
      "logit(p) = logit(usual rate) + Σ kept / k; p is the probability that the company beats its sector over the horizon.",
    ],
    why: "Shrinking toward no information is what keeps the engine from trading on noise: a family must first show real differences. Dividing by k stops the same information (three margins, three bases of one item) from being counted three times; this is the owner's rule that factors which repeat each other are joined. The log-odds sum is exact Bayes when the pieces are independent, and k is the correction where they are not.",
    expected: "Probabilities close to the usual rate unless a family has shown real differences. On all companies today the price family shows nothing beyond noise, so release decisions stay at the usual rate; filing decisions move a little, and only now and then by 5 points or more (about 870 of 24,000 at 20 sessions).",
    formulas: [
      "usual rate = (rises + 1) / (rises + falls + 2).",
      "kept = e · S / (S + v);  S = Σ w·(e² − v) / Σ w with w = 1/v², over all six cells of every voting factor in the family (zero if negative).",
      "logit(p) = logit(usual rate) + Σ kept / k,  logit(p) = ln(p / (1 − p)).",
    ],
    better: [
      "Calibration of the final probability on finished outcomes (isotonic regression), checked by period.",
      "k learned from a joint model instead of pairwise correlations.",
    ],
    ideas: [
      "Forecast the size of the move as well as its direction: variability is far more predictable than direction, and it decides option prices and position sizes.",
      "Stacking: let a small meta-model weigh the engine, the joint model and simple rules by their recent record.",
    ],
  },
  {
    hypothesis: "Only a lean large enough to cover costs is worth trading, and the trade should isolate what the engine forecasts: the company against its sector.",
    process: [
      "lean = p − usual rate.",
      "If lean ≥ the threshold (5 points by default): buy the company and sell its sector fund at the decision's close, for the horizon. If lean ≤ −threshold: the reverse. Otherwise: no trade.",
      "The trade earns the company's return minus the fund's over the horizon, less a cost per trade (0.1% by default).",
      "The owner's account set-up is another tree, run in the lab's simulations: long only, entry at the next open, the 50-company index as yardstick, exit when the trend turns.",
    ],
    why: "A long-short trade against the sector fund matches the target the engine forecasts, so the result measures the engine, not the market. A threshold keeps turnover down: tiny leans cannot pay their costs.",
    expected: "With today's engine on all companies, almost no trades: it leans on no release decision by 5 points, and on few filing decisions.",
    formulas: [
      "trade = sign(lean) if |lean| ≥ threshold, otherwise none.",
      "return = side × (company return − fund return) − cost.",
    ],
    better: [
      "Size by confidence (a fraction of the Kelly bet), cap by volatility, and stop rules.",
      "Execution at the next open, and the cost of borrowing for the short side.",
    ],
    ideas: [
      "Options instead of shares when the size of the move, not its direction, is what is forecast.",
      "Pairs inside the sector: the most and least favoured companies of one sector against each other.",
    ],
  },
  {
    hypothesis: "The engine is useful only if it beats simple benchmarks on decisions it has never seen, by more than chance and costs.",
    process: [
      "Walk-forward: every forecast uses only what was known on its day; scored from 2013 (after a warm-up) to mid-2026; decisions from July 2026 stay sealed for one final check of a frozen design.",
      "The main yardstick: the gain in log score over the usual rate, per 1000 decisions; a 90% interval from resampling whole calendar quarters (decisions in one season are not independent).",
      "Also: the Brier score against the usual rate's, the share of leaned decisions that went the engine's way, the return per trade against always holding the company against its fund, and holding the stock, its fund and the market.",
      "Controls: 20 runs with scrambled readings (what the procedure reports when nothing can be known), and a planted factor (what a real link of known strength gives). On all companies a correlation of 0.05 is visible.",
    ],
    why: "The log score is a proper scoring rule: it rewards honest probabilities and punishes confident mistakes. Resampling quarters respects that one earnings season moves many stocks together. The controls show both what noise looks like and that the test could see a real effect.",
    expected: "For one company the record is short and noisy: a few dozen decisions. What counts is the engine over all companies (the table below). Version 1 did not repeat its release effect on the other 440 companies.",
    formulas: [
      "gain per 1000 = 1000 / n · Σ ln( p(outcome) / usual rate(outcome) ),  p(rise) = p, p(fall) = 1 − p.",
      "Brier = mean of (p − outcome)²;  better than the usual rate if lower.",
    ],
    better: [
      "Costs and market impact by company size; survivorship (today's companies only: those that failed are missing).",
      "One sealed final test when a design is frozen, not before.",
    ],
    ideas: [
      "Cross-sectional tests each quarter: rank all companies by the engine's probability and follow the top and bottom fifths (information coefficient, decile spreads).",
      "Score the probability bands too, with the continuous ranked probability score.",
    ],
  },
];
