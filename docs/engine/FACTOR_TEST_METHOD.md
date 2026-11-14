# Testing a factor — the method worked out on the Fed (2026-11-14)

Author of this record: Claude, with the owner. The owner asked to record the approach before moving to the next factor:
"we worked out the approach, fixed the formula, improved the understanding of the errors and prior probability".
The Fed outcome is the worked example (section 6). Code: lab `src/predmarkets/` (commits `fe6a35c` … `0e5be4a`).

## 1. The decision formula

For each company, each period:

1. **Prior from the stock's own history, before the test.**
   p0 = Φ(μ / σ), where μ and σ are the mean and spread of the stock's returns over the holding period. Also keep
   m₊ (mean rise) and m₋ (mean fall).
   - Not 0.5 by default, and never the market's probability of the factor's outcome: that is the probability of the
     factor's state, not of the stock rising.
   - JPM, 17-session windows 2010–2021: rose 60%, p0 = 0.566, m₊ = +4.97%, m₋ = −4.79%.
2. **The votes, as in the owner's note** (`docs/Вероятностный подход.pdf`), counted conditional on what the stock did:
   - e+ = P(factor says rise | the stock fell) = n(x+, y−) / n(y−);
   - e− = P(factor says fall | the stock rose) = n(x−, y+) / n(y+);
   - P = p0·ΠL(xᵢ|+)^(1/k) / [p0·ΠL(xᵢ|+)^(1/k) + (1−p0)·ΠL(xᵢ|−)^(1/k)], with L(+|+) = 1 − e−, L(−|+) = e−,
     L(−|−) = 1 − e+, L(+|−) = e+; k corrects for correlated factors.
   - Counts only from events whose window has closed (walk forward); one count added to each cell while counts are small.
3. **Expected return:** E[r] = P·m₊ + (1 − P)·m₋ − cost.
4. **Position:** f = clip(κ·E[r] / σ², 0, 1) of the account (Kelly; κ = ½ for estimation error, long only, no
   borrowing).
5. **Invested by default.** Cash only when E[r] ≤ 0. The stock's own drift is the most reliable gain; a rule that sits
   in cash between events throws it away (JPM: windows-only rules $1.2–2.1M against $2.9M for buy and hold).

## 2. Testing a factor: the protocol

1. **Define the factor point in time.** The value known at the decision moment, from data available then. A quote that
   closes at midnight is known only for the next open.
2. **Select the responders on old data only.** Regress each company's move on the factor (OLS, against the market so that
   common crashes do not count) on the training years; keep companies with a strong response (|t| ≥ 2.5) and compare
   the count with what chance gives (2 × companies × 1.2%).
3. **Mature the error rates without look-ahead.** When events are few, build a longer history in which the factor's
   value is known or can be simulated (Fed: actual decisions 2000–2021 as the market's ten-day call).
4. **Prove on years never seen.** Walk forward through the test years. Also leave-one-out, 80/20 and 90/10 (chronological
   and 1,000 random splits) to see how much rests on a few events.
5. **Judge in dollars against two yardsticks:** buy and hold, and the same account without the factor (drift only).
   A factor earns its place only by beating both out of sample.
6. **Controls:** scrambled factor values (z against them, with a floor on the spread), a date-shift placebo (windows
   moved 15 sessions), the first-half/second-half split.
7. **Measure exposure separately.** A daily regression of the stock on the factor's daily change (here the 2-year
   yield or Kalshi's expected path) gives the size and sign of the link from thousands of days. It says how much the
   stock moves with the factor, not when to buy.

## 3. Traps found on the way

- **Look-ahead at entry:** a start-day reading used at that day's open (fixed: entry at the next session).
- **Overlapping windows:** weekly events compounded two or three positions at once (fixed: one position at a time).
- **Period confound:** with few events, a factor's state and the market's trend line up by date (2022: every hike in a
  falling market). JPM looked hurt by hikes; over 22 years and in daily data it gains.
- **Selection in sample:** a window chosen as the best of 99 and judged on the same data; use the half split or the
  out-of-sample score.
- **Tiny scrambled spread:** rules that rarely trade gave z in the hundreds; z now uses a spread of at least $5.
- **Data:** SPY and the sector funds start only in 2006-11 in the standard prices (use an equal-weight market or
  company calendars before that); the effective Fed funds rate is not the target before 2008 (use DFEDTAR/DFEDTARU).
- **Judgement tables are wrong in places:** the hand-made rate signs were right for 29/30 "helped" and 82/101 "hurt",
  silent on 121 companies, and wrong about large tech. Measure the sign where the data allows.

## 4. Tools

- Python 3.12 (per user) with numpy, scipy, pandas, statsmodels, scikit-learn, matplotlib, openpyxl.
- Workbooks for the owner: formulas where Excel can carry them, Python values where not; recalculated and checked with
  the owner's Gridcraft (`gridcraft-cli cat`).

## 5. What the Fed signal is good for, beyond price timing

The prediction markets' Fed and CPI probabilities are well calibrated (Fed skill 0.99 the day before) and the
decision was the market's favourite at all 32 meetings of 2022–26. A correctly priced outcome carries no news on the
day, so it cannot time a stock. It is still useful:
- **Exposure and scenarios:** each company's measured rate sensitivity (`D:\research\alpha-engine\rate-sensitivity.xlsx`)
  times a repricing gives its expected move: "if the market moves 25 bp toward hikes, JPM +0.9% against the market".
- **Sizing and hedging:** the same sensitivity sets how much rate risk a position carries.
- **Volatility around events (to test):** an uncertain meeting (50/50) should mean larger moves for rate-sensitive stocks;
  the market's spread of outcomes may forecast that, and it can be checked against option prices.
- **Fundamental inputs:** the expected rate path for interest expense, bank margins and discount rates in company
  forecasts.
- **Regime labels:** hiking, holding or cutting, known point in time, to condition other factors.
- **A clean prior:** what the market already knows, so the engine looks for information beyond it.

## 6. The worked example: the Fed outcome as a factor (verdict: noise for timing)

| Test | Result |
|---|---|
| Timing grid, version 2, against the sector (owner's formula 0.60) | 22/99 windows at z ≥ 2 with the hand-made table; 6/99 with the measured one |
| JPM, the note's Bayes, walk forward | $1,228,164 (buy and hold $2,897,259) |
| JPM, 1,000 random 80/20 splits | −$8,927 against buying every unseen meeting; wins 46% |
| JPM, 1,000 random 90/10 splits | +$4,496; wins 42%, ties 22% |
| 40 companies, the formula, full Kelly | $2,949,882 (with the 2000–21 history $2,841,083); buy and hold $3,177,247 |
| Responders chosen on 2000–21 (OLS, \|t\| ≥ 2.5) | 8 selected, about 8 by chance; 3 of 8 better in 2022–26 |
| Daily exposure, 2-year yield, 490 companies | 252 clear links; JPM +0.90% per 25 bp in 2022–26 (t 6.3), +1.21% on Kalshi's path |

Verdict: the Fed outcome, known ten days ahead, has no edge for timing stocks; the market prices it before the
meeting. The daily rate sensitivity is a real, stable measurement of exposure and stays in the engine as such.

## 7. Next factors

The same protocol, on information that may not be in the price on the day:
- Kalshi company KPI markets: a company's own figure, priced before its report (217 settled releases; collected daily by
  K22 since 2026-11-13).
- The owner's SEC guidance factor, when the GPU extraction finishes (about 2026-11-17).
