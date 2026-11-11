# Prediction engine — design (living document)

Designed step by step by the owner and Claude. Kimi Code implements prep tasks from the specs in
[`tasks/`](tasks/). The theory basis is the owner's note `docs/Вероятностный подход.pdf`
(binary factor forecasts, error rates e+ / e−, prior p0, Bayes combination, 1/k correction for
dependent factors).

This document records decisions, not history. Existing engine code in `api/services/` is not a
baseline for this design; existing tables and caches are used only as data sources.

| Step | Topic | Status |
|---|---|---|
| 1 | Problem definition: what is predicted, when, for whom | **decided 2026-11-10** |
| 2 | Information timeline: what is known at each moment (incl. press-release extraction) | in progress (K01 and K02 delivered, K03 running) |
| 3 | Signals: how each data family becomes a factor forecast | method decided (section 1.9); factor list open |
| 4 | Model: error rates, priors, dependence, combining market / sector / company | open; lessons from the earlier model in section 6 |
| 5 | Evaluation: walk-forward protocol, scoring, baselines | open |
| 6 | Interface to the downstream "gearbox" modules | open |
| 7 | Build plan | open |

## 1. Problem definition (decided)

### 1.1 Role of the engine

The engine analyses; it does not trade. For each company it states how likely the stock is to rise
or fall and how large the move is likely to be. Later modules (the "gearbox": options, volatility
risk, hedging, portfolio management) decide how to profit from those probabilities.

Consequences:

- A correctly predicted fall is worth as much as a correctly predicted rise. Scoring is symmetric.
- Quality means honest probabilities: when the engine says 70%, the event should happen about 70%
  of the time, and the engine should be confident more often than a naive baseline.
- SPY is not a benchmark or a goal. The market's own move is modeled only because it explains a
  large part of every stock's move (section 1.5).

### 1.2 Outputs

For each company, at each decision point, for each horizon:

1. **Direction:** probability that the stock's own total return over the horizon is positive
   (and its complement, negative).
2. **Value bands:** probability of each size band of that return. Bands are scaled to the stock's
   own typical move for the horizon (σ), so a calm stock and a volatile stock are comparable, and
   are reported in percent. Provisional bands: large fall (below −1.5σ), fall (−1.5σ to −0.5σ),
   small fall (−0.5σ to 0), small rise (0 to +0.5σ), rise (+0.5σ to +1.5σ), large rise (above
   +1.5σ). The three rise bands add up to the direction probability.

σ must be computed only from information available at the decision point; its definition is set in
steps 2–4.

### 1.3 Events, windows and decision points

Per company and fiscal quarter:

- **Earnings release:** the first public release of the quarter's results — the 8-K with Item 2.02
  and its press-release exhibit.
- **Periodic filing:** the 10-Q or 10-K for the same quarter.
- **Window:** opens at the earnings release and closes at the last market close before the *next*
  quarter's first results-related publication. That is normally the next earnings release; when a
  company publishes part of its results earlier (for example Tesla's delivery numbers), the window
  closes before that earlier publication. The reaction to the next results never enters a target.
- **Decision points inside a window:** (a) the earnings release, using what the press release
  contains; (b) the periodic filing, when it arrives later, to add missing or updated fundamentals.
  Other in-window events may be added in later steps.

If a quarter has no separate earnings release, the periodic filing is the first publication and
opens the window.

Price conventions (daily bars, split- and dividend-adjusted):

- **Entry, primary ("right away"):** the open of the first regular session that starts at least
  60 minutes after publication. A horizon of h sessions exits at the close of the h-th session.
- **Entry, conservative check:** the close of that same first session; exit h closes later.
- **Window end:** the last session whose close is before the next earnings release is published.
  Until publication times are available (task K01), use filing dates with a one-session safety
  buffer.
- A horizon counts only if its exit lies inside the window. Horizons are never stretched or cut.

### 1.4 Horizons

5, 10, 20, 30 and 45 trading sessions, plus "until the window closes". The classic 63-session
quarter is excluded: it crosses the next earnings release in almost every window. Which horizon
suits which company is a question for the evaluation step, answered on walk-forward data only.

### 1.5 Three states: market, sector, company

The owner's note models the state of "the market (company, sector)". The engine keeps all three:

- **Market state:** direction of the market over the horizon.
- **Sector state:** direction of the company's sector relative to the market.
- **Company state:** direction of the company relative to its sector.

The stock's return is the sum of the three parts. Each state has its own factors and its own Bayes
update as in the note; the engine then combines the three into the stock's own direction and value
bands. Company factors are judged against the company's own part of the move, so market swings do
not hide their accuracy.

Why: in the 50-company set, over 20 sessions a stock moved the same way as the market in 71% of
periods; it rose in 70% of periods when the market rose and in 29% when it fell.

Comparison baseline: the note's formula applied directly to the stock's own direction, with no
market or sector part.

### 1.6 How company differences are estimated

Companies may differ in which factors work and at which horizon. A company has at most about 68
quarterly windows since 2009, so three variants are tested side by side and compared on
walk-forward data:

1. **Per company:** error rates from the company's own history only.
2. **Partial pooling:** a company's error rates start from the values of similar companies (sector,
   then all) and move toward its own history as its own windows accumulate.
3. **Fully pooled:** one set of error rates for all companies (reference point).

### 1.7 Universe and history

- Start with the 50 companies in `worker/research-universe-50.json`.
- History: 2009 onward first (structured SEC data exists and extractions can be graded against
  it). Then extend back to 2000 by reading old 10-Q/10-K and press releases with the same
  extraction tool, and test whether older years improve predictions.
- The other ~450 S&P 500 companies follow once press-release processing is proven. Their prices
  are in the owner's Stooq archive (task K02).

### 1.8 Experimental data families

EDGAR tone, options, 13F and expectations/guidance are experimental. They are tested on the data
already collected for the 50 companies, with the same windows and scoring as everything else.
No new processing or collection for a family until it passes that test.

### 1.9 How a factor becomes a forecast (owner's method)

- One regression per factor, on changes or logs, never on levels (two trending levels correlate
  without meaning anything). The factor is lagged: change in market value after the publication
  against the change in the factor that was published.
- The regression is refitted on an expanding window, using only finished windows. Its forecast is
  then compared with what happened, and e+ and e− are counted from those past forecasts only.
- A factor's output is a confidence between −1 and +1, not a yes/no vote: its sign says rise or
  fall, its size says how much its own record supports that.
- Comparison bases to test: the same quarter a year ago, the company's own trend, sector peers.
- The stock's price reaction to the release is allowed, as one separate family.
- All factors are tested. Factors that are derivatives of one another are joined and count once
  (the note's 1/k rule), with k measured from how the factors actually move together.

### 1.10 Reading press releases

- Statement tables are read by ordinary code. Rows are named by matching the prior-period columns
  of the release against figures the company had already filed (task K03). Rows that code cannot
  name go to the local model with a fixed list of allowed answers (task K04).
- Releases published as page images are read with the local model's vision. A number read from an
  image is accepted only if it also appears in the document's hidden text (task K05).
- Until the press-release numbers exist, engine research continues on the fundamentals of the
  10-Q/10-K. The research prototype lives outside this repository (`C:\dev\alpha-engine-lab`).

## 2. Facts measured on local data (2026-11-10)

Research-50, local MySQL and caches, read-only.

- Windows from a 10-Q/10-K to the next earnings release (2014+, 1,412 windows): median 58 sessions
  (60 after a 10-Q, 46 after a 10-K). A 42-session horizon fits 92% of them, a 63-session horizon
  12%. Windows opened at the earnings release are longer; task K01 will give exact numbers.
- The periodic filing follows the earnings release on the same day in 26% of quarters, within one
  day in 48%, and more than a week later in 30% (median 2 days).
- Market share of stock moves, non-overlapping periods since 2005: median R² against the market
  about 30% at 10–20 sessions and about 19% at 45; a typical stock rose in 57–61% of periods.
- Press releases are not machine-readable (only 10-Q/10-K are, from 2009). The 8-K documents of
  the 50 are cached locally (17,236 primary documents and 16,178 exhibits); the exhibit type is not
  recorded and the earnings flag (Item 2.02) is mostly missing before 2019.
- Structured SEC facts exist for 33 of the 50 companies in 2009 and for all 50 from 2021. 10-Q/10-K
  documents for 2000–2008 are cached for about 35–40 of the 50.
- Publication times of filings are not stored anywhere (dates only).
- Prices: 55 tickers loaded. The archive `D:\stooq data 102726\d_us_txt.zip` holds 13,289 US
  stocks and ETFs through 2026-10-26, currently listed tickers only; SPY starts 2005-02-25.

Added after tasks K01 and K02 (2026-11-10):

- Event calendar for the 50 (K01): 22,240 filings with publication times; 4,447 company-quarters.
  Windows opened at the first publication, fiscal periods from 2009-06: 3,169 windows, median 62
  sessions, shortest 26; 100% hold a 20-session horizon and 98.6% a 45-session horizon.
- Prices (K02, per its delivery report): 514 series loaded from the Stooq archive, 3.63 million
  daily bars: all 502 S&P 500 tickers of the snapshot, SPY and the eleven sector ETFs.
- Earnings releases of the 50 since 2009: 3,615. Statements are real HTML tables in 86% of them;
  2.5% are page images (5% in recent years).

Known limit: both the 50-company list and the price archive contain only companies that exist
today, so historical results describe survivors. Step 5 must state this next to every result.

## 3. Working rules

- **Who does what.** The owner decides. Claude designs and writes the task specs, including any
  instructions for the local model and the rules for grading its output. Kimi Code writes and runs
  code to those specs. The local model (qwen3.5:9b on Ollama) does the bulk reading work.
- **Cost rule.** No paid cloud model processes documents in bulk. Ordinary code comes first; the
  local model is used only for what code cannot do, on narrow questions with a fixed list of
  allowed answers. Kimi Code's own model is for writing code, not for reading filings.
- **Every task spec states its LLM use:** none, or local model only with the exact instructions
  attached. Instructions for the local model are versioned and accepted only after automatic
  grading on real documents.

## 4. Decision log

| Date | Decision | Source |
|---|---|---|
| 2026-11-10 | Bulk document work runs as code or on the local model, never on a paid cloud model; Claude writes the local-model instructions | owner |
| 2026-11-10 | Engine is analysis only; trading logic lives in later "gearbox" modules | owner |
| 2026-11-10 | Target: the stock's own direction plus value-band probabilities; SPY is not a benchmark | owner |
| 2026-11-10 | Window: earnings release → day before next earnings release; update at the 10-Q/10-K | owner |
| 2026-11-10 | Horizons 5/10/20/30/45 sessions and window end; no 63-session horizon | owner + measurement |
| 2026-11-10 | Three states (market, sector, company); company-only version kept as baseline | owner |
| 2026-11-10 | Bands scaled to each stock's own typical move | owner |
| 2026-11-10 | Test per-company, partial pooling and fully pooled side by side | owner |
| 2026-11-10 | 2009+ first, then back to 2000 with the extraction tool | owner |
| 2026-11-10 | Start with the 50; tone / options / 13F / expectations are experimental and gated | owner |
| 2026-11-10 | Prep work goes to Kimi Code as spec files under `docs/engine/tasks/` | owner |
| 2026-11-10 | A window also closes before an early partial results publication (e.g. deliveries) | owner |
| 2026-11-10 | Task K03 approved: press-release statements by code, graded against the later filing | owner |
| 2026-11-10 | Image-only releases are read with the local model's vision; numbers must also appear in the hidden text | owner + measurement |
| 2026-11-10 | Engine research continues on existing fundamentals while extraction runs; prototype built by Claude outside this repository | owner |
| 2026-11-10 | Factor method: lagged regression on changes, expanding window, e+/e− from past forecasts, output as confidence −1..+1; price reaction as a separate family | owner |
| 2026-11-10 | Test all factors; join those that are derivatives of one another | owner |
| 2026-11-10 | No wider company set for now; first reproduce the earlier model, then explain it with schemas, graphs and examples | owner |

## 5. Open items for the next steps

- Step 2: which numbers to extract from a press release, how extraction is graded against the
  later 10-Q/10-K, sector definition and sector return series, exact σ definition.
- Step 3: which fundamentals become factor forecasts at the press release and which wait for the
  periodic filing; whether the stock's price reaction to the release may be used as a signal.
- Step 4: final band edges, combining the three states, pooling strength, recency weighting of old
  history.
- Step 5: walk-forward protocol, scoring rules, baselines, survivorship statement.
- After the review in section 6: how factors share evidence across companies when one company has
  about 40 finished quarters per factor; how k is measured; which prior replaces 50%.

## 6. Findings from the earlier model (2026-11-10)

The owner's earlier model (Python scripts and two database dumps, 2021–2024) was rebuilt from the
dumps and tested. Code and the illustrated page are in the research repository
(`C:\dev\alpha-engine-lab\src\old-model`, `reports\old-model.html`). These are findings, not
decisions.

- **Reproduced.** Every stored number of the REIT run (103 companies) is reproduced from its raw
  rows through all seven steps, and every stored error rate and probability of the S&P 500 run
  (493 companies).
- **The fundamentals were not the companies' own.** In both databases every company carries one
  identical fundamentals history for 1999–2020 (the figures of a single small REIT); companies'
  own figures start in 2021. The earlier results therefore say nothing about whether fundamentals
  predict.
- **The error rates saw the answers.** e+ and e− were counted once over each company's whole
  history and used for every quarter of that history. Scored that way, accepted company-quarters
  rose 79% of the time against 58% for the rest, and forecasts scrambled in time score the same
  (81% against 58%). With error rates from finished quarters only: 62% against 62%.
- **Portfolio.** Stored result 21.7% a year (S&P 500 universe, 2006–2021); holding every company
  of that universe under the same weighting rule 12.6%; the same acceptance rule with past-only
  error rates 12.1%.
- **One vote, many times.** A factor voted "up" when its regression's forecast growth was at least
  the stock's last quarterly move, so 76% of votes were simply the opposite of that move. Twenty
  factors of a company were worth about two independent ones, while the rule k = factors ÷ 10
  counted them as ten.
- **A company's lean did not last.** Whether up-votes preceded rises more or less often than
  down-votes in the first half of a company's history had no relation to the second half
  (correlation 0.05, same sign for 50% of companies).

Consequences already covered by sections 1.3, 1.6 and 1.9: error rates from finished windows only,
each factor forecasting from its own change, measured k, real publication dates. Still to decide:
see section 5.
