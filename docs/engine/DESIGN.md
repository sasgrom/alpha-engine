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
| 2026-11-10 | The engine is built and described on its own procedures; its code and documents make no statements about earlier runs | owner |
| 2026-11-10 | Sealed period: only the last quarter of decisions (from 2026-07-01) is held back | owner |
| 2026-11-10 | Company guidance and expectations, not year-ago changes, are the reference for reported figures | owner |
| 2026-11-10 | Local-model pass over guidance in releases the first pass left unstructured: the 50 first, then the rest; partial results usable while it runs | owner |
| 2026-11-11 | Task K06 approved: release calendar and release documents for the other S&P 500 companies (pilot of 20, then the full list on the owner's word) | owner |
| 2026-11-11 | Old forecasts fade with an 8-year half-life (exponential) as the working setting for round two | owner + measurement |
| 2026-11-11 | Account simulations: yardstick is the index of the universe, entry above a confidence margin, long only with shorts as an option, orders at the next open, exit when the trend reverses | owner |
| 2026-11-11 | The starting probability is the measured up-rate, never one half; macro corrections are tested as a factor family | owner + measurement |
| 2026-11-11 | Guards against overheating (stretch, sector lead, valuation, acceleration) are tested like factors and used only where the data supports them | owner + measurement |

## 5. Open items for the next steps

- Step 2: which numbers to extract from a press release, how extraction is graded against the
  later 10-Q/10-K, sector definition and sector return series, exact σ definition.
- Step 3: which fundamentals become factor forecasts at the press release and which wait for the
  periodic filing; whether the stock's price reaction to the release may be used as a signal.
- Step 4: final band edges, combining the three states, pooling strength, recency weighting of old
  history.
- Step 5: walk-forward protocol, scoring rules, baselines, survivorship statement.
- Round two (see section 6): whether the engine should also predict "beats the index of the
  universe" beside "beats its sector"; the full list of task K06; the comparison of release revenue
  with the company's own guidance once the local-model pass is complete.
- In this repository, after the owner's approval: a daily price series without gaps for the
  universe, its sector funds and the market fund; market value for valuation factors that is right
  across stock splits; one Engine page fed by a reviewed report.

## 6. Engine version 1: procedure and results (2026-11-10 and 11)

The engine is research code in a separate repository (`C:\dev\alpha-engine-lab\src\engine`, steps
0 to 9; `README.md` there holds the procedure, every result and the controls). Its data is under
`D:\research\alpha-engine\engine\lab\data\engine\`. Nothing of it runs in this repository yet. A
review of the earlier model's stored runs is kept in the same research repository; nothing in this
design depends on it.

**Procedure.** Decisions at the close of the first full session after an earnings release and after
the 10-Q/10-K. Every reading is placed among all earlier readings of its factor; a regression on
finished outcomes gives the side; tables of side and strength are counted only from forecasts whose
outcome was known on the day; evidence is trusted as far as its family of factors has shown more
than noise; a factor's evidence is divided by how much the other factors repeat it (measured k);
Bayes starts from the up-rate seen so far. Controls in every round: runs with scrambled readings, a
planted factor, resampling by quarter and by company.

**Results on the 50 companies** (gain in log score per 1000 decisions over the up-rate, 90% interval):

- Release decision, company against its sector, 10 sessions: +5.9 [+2.2, +9.5] in 2013–2022; on the
  years the design had not seen (2023 to mid-2026) +3.2 [−4.0, +10.7]. Decisions the engine leaned
  on went its way in 60.6% and 60.5% of cases. The source is the first-session price reaction to
  the release. No scrambled run reached these numbers.
- Nothing measurable beyond noise so far: figures from the 10-Q/10-K as year-ago changes; the
  figures printed in the release itself as year-ago changes (task K03); tone at the release; macro
  readings for timing the market or the sectors; overheating guards as probabilities of a sharp
  fall. A small unproven lift: tone of the 10-Q/10-K at 20 to 45 sessions.
- Account illustration under the owner's set-up (2016–2025, $100,000, long only, entry when the
  probability that the stock rises is at least 55%, orders at the next open, exit when the trend
  reverses, ten equal parts): 21.4% a year with 60% of the money in use; the index of the 50 held
  all the time made 24.6% a year, being a list of today's large companies. Per position the picks
  made about one point more than the index over the same days in 2016–2022 and no more than the
  index in 2023–2025, while still beating their own sector funds.
- Guards: a price in the outermost 2% above its own one-year average was followed by a sharp fall
  about twice as often as usual (8.3% against 4.4%); acceleration and a price above 100 times
  earnings gave no warning on this list. Passing over signals with the price or the sector in the
  top tenth of its reading lowered the deepest fall of the account from 14.3% to 10.9%.

**First look at companies the engine had not seen (2026-11-11).** Applied unchanged to the 20
companies of the K06 pilot, 17 of them banks and insurers, the release effect does not repeat: −8.2
[−14.7, −1.9] per 1000 at 10 sessions, and the decisions leaned on went the engine's way in 46% of
cases. In both sets financial companies show no continuation after a release (among the 50: 49.5 /
48.5 / 49.5% beat their sector after the weakest / middle / strongest reaction; the 50 without them:
42.7 / 47.5 / 56.1%). The result above is therefore a result for non-financial companies, and the
full K06 list is the test of how far it holds. Separate tables per sector are too thin on this many
companies.

**Inputs that arrived on 2026-11-11.** Task K03: the statements printed in 3,609 releases, graded
against the later filing; the release's revenue equals the filed figure in 1,484 of 1,491 comparable
cases. Local-model second pass over guidance in releases (in progress): about nine in ten of the
releases the first pass could not structure now yield verified statements. Task K06: pilot of 20
companies passed; the other 426 wait for the owner's word.

**Open test.** The quarter's revenue from the release against what the company itself had guided,
known at the release decision. It needs the second pass to reach back to 2010.
