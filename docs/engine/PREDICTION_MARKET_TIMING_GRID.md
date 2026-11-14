# Prediction-market timing grid — the owner's procedure

**Owner's design, 2026-11-14:** treat each topic (Fed rate, CPI …) as a data series of contracts. Read the contract's
probability on a start day before resolution, learn the outcome on the end day, then record each company's move
over the following sessions as e+ or e−. Use the record in the Bayes calculation, with the size of the move. Run many
tests, one per entry day and exit day, and look at the whole matrix: a real signal is a coherent region, noise is a
normal scatter.

Author of this record: Claude. **Status:** version 1 run and reviewed; version 2 planned, not coded (owner: "dont code
anything else, lets strategise").

## 1. Data (all point in time)

- **Kalshi** daily candles of every settled market, read-only and keyless (`api.elections.kalshi.com/trade-api/v2`,
  settled markets under `/historical/...`).
  - Topics: core CPI, CPI, CPI year on year, core PCE, payrolls, Fed decisions; 2022–2026.
  - Stored in `D:\research\alpha-engine\predmarkets\kalshi\`.
- **The probability of a day** is the last quotes of that day: the bid/ask mid when the spread is at most 0.15, else
  the last trade. Quotes under 3% count as 0 and over 97% as 1, then the curve is made non-increasing over thresholds.
- **Release day:**
  - CPI, PCE, payrolls: FRED's first vintage date of the month.
  - Fed: the statement day.
- **Prices:** standard prices p1.1 (total-return index, as-traded open and close) of 493 companies and the 11 sector
  funds.

## 2. Version 1 (run 2026-11-14; lab `8b9f7b1`)

Code: `C:\dev\alpha-engine-lab\src\predmarkets\`.
- `kalshi_fetch.py`: history.
- `kalshi_events.py`: events, distributions and the 10-day survival curve.
- `macro_grid.py`: the grid.
- `export_grid_dataset.py`: the page's data.

Steps per topic:
1. **Start day:** 10 calendar days before the release. Read p_up, the market's probability that the figure comes above
   the last print (the Fed: a hike).
2. **Signal:** up when p_up ≥ 0.55, down when p_up ≤ 0.45, else no trade.
3. **Windows:**
   - entry at the open 0–8 sessions after the start day (never on or after the release session);
   - exit at the close 0–10 sessions after the release;
   - 99 tests.
4. **Per company and window,** a walk-forward account starting at $1,000:
   - On an up signal, buy when the company's own posterior P(rise | up) = (e+ + 1) / (n + 2) ≥ 0.5; on a down signal,
     stay in cash.
   - Every signal adds to the company's record, traded or not; up and down signals are kept in separate tables.
   - Cost 0.1% per round trip.
5. **Two views:**
   - raw (the stock's own return);
   - against the sector (the stock minus its sector fund over the same window).
6. **Yardsticks:**
   - buy every signalled event in the same window;
   - 20 scrambled runs, with the readings permuted across the topic's events and the dates kept.
   - z per cell = (real account − scrambled mean) ÷ scrambled sd.
7. **Placebo:** the same test with every window moved 15 sessions before and after the releases.
8. **Out of sample:** the best window chosen on 2022–23, judged on 2024–26.

Reproduce:
```
python -I macro_grid.py --scrambles 20                      # raw
python -I macro_grid.py --scrambles 20 --excess             # against the sector
python -I macro_grid.py --scrambles 20 --excess --only core_cpi_mom --date-shift -15   # placebo (and +15)
python -I export_grid_dataset.py <folder>                   # data for the page
```

The page "Macro Timing Grid" (Data type, private): https://claude.ai/artifact/B77znr84LFY9YoPYhFu6Tw

## 3. How to read the matrix (owner, 2026-11-14)

- **No effect:** results scatter like a normal distribution around zero, so the histogram follows the normal curve.
- **A real effect:** a coherent region, with neighbouring windows alike, and a heavy tail in the histogram.
- **A permanent effect:** it jumps at exit 0 (the release day) and stays flat for later exits.
- **A decaying effect:** a peak, then decline. Drift grows with later exits.
- **Which test made more $:** each window's account against the buy-every-event benchmark and against the best
  scrambled window. A best window below the best scrambled window is luck.

## 4. Version 1 results

| Topic (against the sector) | Windows z ≥ 2 | Mean z | Best window | Best account | Best scrambled | Chosen on 2022–23 → 2024–26 |
|---|---|---|---|---|---|---|
| Core CPI | 68 / 99 | +2.27 | start +0 / release +9 | $1,095 | $1,067 | $1,021 (median $1,006) |
| Core PCE | 11 / 99 | +1.04 | start +7 / release +5 | $1,021 | $1,024 | $988 ($1,001) |
| CPI | 0 / 99 | +0.19 | start +0 / release +10 | $1,053 | $1,154 | $1,041 ($1,007) |
| CPI year on year | 0 / 99 | −0.70 | start +0 / release +10 | $1,035 | $1,091 | $995 ($987) |
| Payrolls | 8 / 99 | +0.74 | start +0 / release +10 | $1,036 | $1,074 | $982 ($988) |
| Fed decision | 0 / 99 (5 ≤ −2) | −1.17 | start +6 / release +0 | $1,003 | $1,059 | $1,000 ($1,000) |

- **Core CPI placebo:** 15 sessions earlier, 1 of 99 windows at z ≥ 2 (mean +0.10); 15 sessions later, 4 of 99 (mean
  +0.44). The gain belongs to the releases.
- **Core CPI rests on 12 up readings in 48 releases:** a strong candidate, not a rule.
- **Its shape:** a top row (entry on the start day) of z 2.1–5.1 rising with later exits, with rows +3 to +8 similar.
  That is a jump that holds, as the owner's reading of a lasting effect describes.
- **Fed:** a pink region (mean z −1.17). Here the learned buy rule did worse than random picks; see version 2.
- **All topics against the sector:** 92 of 594 tests reach |z| ≥ 2 where chance gives about 27, almost all core CPI.
  Raw: 46 against about 27.

## 5. Version 2 (planned with the owner, 2026-11-14; not coded)

What changes, in the owner's words: "remove the rule of p>=0.55 and p<=0.45 … use their probability as p0 market
basis in the formula and our updated ei ratios as the new inputs, so new p from polymarket becomes new p0 in the
calculation. … decision to buy … based on the well known dependency (if not known we need to find out before test):
fed rate up good for banks > buy; for heavily in debt or reit maybe > bad, dont buy".

1. **The dependency is set before the test,** per topic and company: +1 (the outcome helps the stock), −1 (it hurts),
   or 0 (unknown, no trade). Sources, in order:
   - **Economic rule by industry and balance sheet,** from the standard fundamentals:
     - a Fed hike helps banks and insurers and hurts REITs, utilities, homebuilders and heavy borrowers (net debt to
       operating income);
     - hot inflation helps energy and materials and hurts REITs and long-duration growth.
   - **Estimated on 2022–23 only, then frozen for 2024–26,** where the rule says nothing.
   - **Nothing estimated on the years it is tested on.**
2. **The prior** for company c and event t is the market's probability q_t of the outcome, used without a threshold:
   p0 = q_t when the dependency is +1, 1 − q_t when it is −1.
3. **The update:** the company's own record of following its dependency after past events of the topic. Here e+ means
   it moved the dependency's way and e− against.
   - Likelihood ratio LR = (e+ + 1) / (e− + 1).
   - Posterior odds = prior odds × LR^(1/k), with k from the owner's formula for correlated topics. CPI, core CPI and
     CPI y/y share a release day, so k > 1 when they are combined.
4. **Decision:** buy when the posterior is at or above a set level (to be fixed before the run, e.g. 0.6), long only;
   otherwise cash. Record e+/e− and the % move after every event, traded or not.
5. **Evaluation as in version 1:**
   - the same 99 windows;
   - both views;
   - the every-event benchmark;
   - 20 scrambled runs (q permuted across events);
   - the date-shift placebo;
   - the 2022–23 / 2024–26 split.
   - The heat maps and the "which test made more $" table are redrawn side by side with version 1.
6. **Magnitude:** each company keeps its mean and spread of moves after outcome-yes and outcome-no events. They feed a
   % move estimate (owner: "next time can give probability even for the % move").

### Open decisions before coding

- **Dependency map:** the rule table first, with estimation only where it is silent? (Claude's recommendation: yes.)
- **Buying level for the posterior:** 0.55, 0.60 or 0.65, or all three side by side?
- **Outcome definition per topic:**
  - "above the last print", as in version 1;
  - "above the market's own median 10 days before";
  - for the Fed, hike / hold / cut.
- **More events:**
  - weekly jobless claims (about 200 events) as a seventh topic;
  - the company KPI markets (217 settled releases, 57 companies) as their own family.
