# The per-company engine: the agreed design (2026-11-14)

The owner and Claude agreed this design on 2026-11-14, after the n1 fundamentals results. It replaces the month-end,
cross-company design of `FUNDAMENTALS_NORMALIZATION.md` for the engine's tests. That design remains for cross-company
studies. The decision formula here supersedes section 1 of `FACTOR_TEST_METHOD.md` where they differ.

## 1. Purpose

The owner's words: "we are not trying to prove mathematic theorem that there is a common rule ... some companies are
well examined, some worse ... we are trying to extract useful dependencies from all the facts we have running any kind
of logic as long it is falsifable and verifiable".
- **Goal:** beat an index fund such as SPY and/or reduce the risk of holding (bad actors, black swans).
- **Beating SPY belongs to the later portfolio stage:** 10-20 companies per period, chosen when and which.
- **Per company, the task is to know when to avoid its bad seasons.**
- **A company where nothing works is a valid result:** it is efficiently priced and is not traded.

The hypothesis: the market is slow to discover what a report says, fundamentals carry information, and fear or hope
moves prices, which can be seen in volatility.

## 2. Calendar and data, per company

| Item | Rule |
|---|---|
| Events | each quarterly 10-Q/10-K since 2009. For new reports from now on, the press release (8-K) gives the first numbers; the history stays as built. |
| Entry | the first open after the report is public (SEC acceptance before 09:30: that day's open; otherwise the next session's open) |
| Exit | the last close before the next report is public. All to cash, then 100% reinvested on the new information, so each company has its own calendar. |
| Days | real trading sessions only; a missing session carries the last close |
| Numbers | **what every player sees at that moment**: the new quarter as first reported; older quarters as last printed by then, including the comparison figures in the same filing; nothing published later. A real mistake stays in for its time. Only XBRL tagging slips (the document showed the right number) are repaired. |
| Costs | none, for now |
| Dividends | added to profit while holding |

## 3. Signals and outcome: everything as percentage changes

**Two factor bases, tested separately (owner, 2026-11-14), combined into one probability later:**
- **Test A: the 64 standard fundamentals.**
  - Each field as its change against the same quarter a year earlier (the rules below).
  - No pre-selection: admission and the per-factor k decide which fields vote.
  - Acceleration and surprise forms are a later A2.
- **Test B: the 39 derived ratios of n1.**
  - Each ratio as its change against a year earlier, as a difference where the ratio can turn negative.
  - Computed at each report from the numbers public at that moment. Valuation ratios use market cap at entry, with n1's
    checked share counts.
  - The price-only measures and size are included.
- **The admission bar rises with the number of candidates.** A field is admitted only if its skill beats the
  time-shifted controls' best candidate, at a level of less than one expected noise admission per company.
- **B is built from A's fields, so the two overlap.** Their later combination must weigh that overlap, measured within
  rising and within falling quarters, as for single factors.

The field list below is the narrower set first proposed.

- **Signals:**
  - each fundamental's change against the same quarter a year earlier (the base as printed in the same filing);
  - **acceleration:** this quarter's year-on-year growth minus last quarter's;
  - **standardized surprise:** the change divided by the company's usual variability, from past quarters only.
  - The change against the previous quarter is only a control, because it mostly measures the season: Apple's December
    quarter is +49% against September every year.
- **Fields (about 20):**
  - revenue, gross profit, operating expenses, operating income, net income, EPS;
  - operating cash flow, capex, free cash flow, share-based pay, share count;
  - assets, cash, debt, equity, inventory, receivables, deferred revenue, goodwill.
- **Derived:**
  - margins as changes in points;
  - inventory growth − sales growth, and receivables growth − sales growth (warning signs).
- **Accounting identities are removed by construction.** Keep the parts or the total, never both (gross profit =
  revenue − cost; assets = current + non-current; free cash flow = operating cash flow + capex …).
- **Normalization for percentage changes:**
  - flows per day of the quarter (13/14/16-week quarters, 53-week years);
  - log change for always-positive items; for items that can turn negative, the change divided by revenue;
  - scale and sign repairs as in n1;
  - outliers: rank correlation on the maps, and clipping at the company's own past percentiles in the engine.
- **Outcome:** the market cap change from the entry to each day's close. Shares are on one basis, so a split is not a
  move.
- **A number missing at the report:** that signal sits out this event. It is never zero and never guessed. A number
  that arrives later is used from that day on.

## 4. Discovery views (before any trading rule)

- **Map:**
  - rows are signals and columns are days 1 … exit;
  - each cell is the correlation across the company's quarters between the signal and the market cap change to that day;
  - a volatility map uses the same layout.
- **Timeline (7b):**
  - anchored at the press release, from 20 sessions before it to the next report, with the 10-Q day marked;
  - it shows how much was priced before the release, on the day, before our entry and after it;
  - guidance surprise: design on the 50 companies now, confirm unchanged on the other ~440 after the GPU run;
  - options' expected move from 2019.
- **Controls:**
  - the **time shift** (main): the real signal series slid by k quarters, which keeps its own trends;
  - the whole-quarter **shuffle** (second).
  - A signal counts only if it beats the controls' strongest cell.
  - Noise can draw a convincing "slow discovery" band: the best of 2,000 random signals on Apple's real paths rose from
    −0.03 to +0.43.

## 5. The decision formula: the owner's note, with the agreed corrections

The base is `docs/Вероятностный подход.pdf`:
- the state y = ±1 and the votes x_i = ±1;
- e+ = P(x+ | y−) and e− = P(x− | y+), counted on history;
- P = p0·ΠL(x_i|+) / [p0·ΠL(x_i|+) + (1−p0)·ΠL(x_i|−)].

The corrections:
1. **A k per factor instead of one k.** Each factor's likelihood is raised to w_i = 1/k_i, where k_i = 1 + Σ_j ρ_ij².
   - ρ_ij is the correlation of the two factors' votes measured **within rising quarters and within falling quarters**
     (dependence given the state; overall correlation punishes good factors).
   - A group of k perfect copies gives k_i = k (the note's case); a unique factor gives k_i = 1.
   - In the note's own example, with factors 1 and 3 copies and factor 2 an independent dissenter, the result is 80%
     instead of the uniform-k 88%.
2. **Smoothing:** e = (count + 1) / (cases + 2), so no rate is 0 or 1 and no single factor can force P to 0 or 100%.
3. **Admission:** a factor votes only if its skill 1 − e+ − e− beats the time-shifted control in the training window.
4. **Decay:** training quarters are weighted by age, 0.5^(age / half-life).
5. **Prior p0:** the company's **sector trend as a percentage change** (owner's idea), tested against the stock's own
   history. The prior that forecasts better out of sample (log score) wins.
6. **Calibration:** P is checked against the outcomes on unseen quarters (does "0.70" rise 70% of the time?) and
   corrected if needed.
7. Votes stay binary for now; three levels (weak, medium, strong) are a later test.

## 6. Rule and judgment, per company

- **Always in by default.** The yardstick is the company's own buy-and-hold, with dividends.
- **Step out for a quarter when P(fall) ≥ threshold.** The threshold is swept from 0.60 in steps of 0.02.
- **The four cases:**

  | | Rose | Fell |
  |---|---|---|
  | Held | good | **bad**, a loss taken |
  | Sat out | missed, information only | good, a loss avoided |

  Missed rises are not bad: with thousands of companies to choose from, a missed rise is cheap and a loss taken is not.
- **Judge at each threshold:**
  - **precision:** the share of held quarters that rose, against the company's base rate;
  - losses avoided against gains missed;
  - the worst loss held;
  - **coverage** (the share of quarters held; this guards against the "never hold" trap);
  - **the same numbers for the time-shifted control at the same coverage.**
  - Money is information only.

## 7. Validation

- **Sliding 80/20, never random.** An unbroken block of 80% of the quarters (about 48) trains the model, which then
  decides the next quarter. The window slides forward one quarter.
- Every quantity is re-estimated inside each window: signal admission, directions, e±, k_i, p0 and calibration.
- About 12 test quarters per company is a first tell. The verdict comes from repeating the test company by company.

## 8. Peers

- **Defined by measurement, never by GICS sector:** daily co-movement after the market above about 0.3, point in time
  over the trailing 2-3 years, nearest 5-10.
- NVDA's measured peers are the AI-infrastructure trade (VRT 0.56, AVGO 0.53, KLAC, LRCX, ETN), two of them in GICS
  Industrials. ADBE's are the software group. AAPL has no close twin.
- Revenue-growth co-movement is no peer measure: with about 40 quarters, AAPL "grows with" Moderna at 0.83.
- **Uses, each tested against the company alone out of sample:**
  - "see how competitors did";
  - pooled data from companies that react alike;
  - peers reporting earlier as early news;
  - the outcome against peers.

## 9. To build next

- A risk veto vote (restatements, late filings, insider selling, accruals, guidance cuts), scored on big losses avoided.
- **Networks:** shallow (1-3 layers), pooled or by measured peers with leave-one-company-out, never one per company
  (about 200 months against about 760 weights).
