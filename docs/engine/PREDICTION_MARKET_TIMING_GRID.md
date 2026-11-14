# Prediction-market timing grid — the owner's procedure

**Owner's design, 2026-11-14:** treat each topic (Fed rate, CPI …) as a data series of contracts. Read the contract's
probability on a start day before resolution, learn the outcome on the end day, then record each company's move
over the following sessions as e+ or e−. Use the record in the Bayes calculation, with the size of the move. Run many
tests, one per entry day and exit day, and look at the whole matrix: a real signal is a coherent region, noise is a
normal scatter.

Author of this record: Claude. **Status (2026-11-14):** version 1 run, fixed (section 2) and rerun; version 2 built
and run with the owner's choices (section 5); the put run done (section 6). The short answer is in section 7.

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
   - entry at the open 0–8 sessions after the start day (never on or after the release session). The first entry is
     the session after the start day: the start day's reading is its last quote, and its daily candle closes at
     midnight ET. The first run (lab `8b9f7b1`) entered at the start day's own open, a look-ahead of up to one session
     in the first row. Fixed and rerun in lab `fe6a35c`; the old outputs are kept in
     `D:\research\alpha-engine\predmarkets\kalshi\v1-before-entry-fix\`;
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

## 4. Version 1 results (after the entry-day fix)

| Topic (against the sector) | Windows z ≥ 2 | Mean z | Best window | Best account | Best scrambled | Chosen on 2022–23 → 2024–26 |
|---|---|---|---|---|---|---|
| Core CPI | 67 / 99 | +2.40 | start +0 / release +9 | $1,085 | $1,075 | $1,017 (median $1,008) |
| Core PCE | 16 / 99 | +1.15 | start +2 / release +5 | $1,022 | $1,026 | $989 ($1,001) |
| CPI | 0 / 99 | +0.10 | start +0 / release +10 | $1,039 | $1,134 | $1,061 ($1,005) |
| CPI year on year | 0 / 99 | −0.76 | start +0 / release +10 | $1,027 | $1,087 | $993 ($986) |
| Payrolls | 13 / 99 | +0.93 | start +6 / release +9 | $1,033 | $1,071 | $985 ($990) |
| Fed decision | 0 / 99 (5 ≤ −2) | −1.17 | start +6 / release +0 | $1,003 | $1,059 | $1,000 ($1,000) |

- **Before the fix** core CPI read 68 / 99, mean +2.27, best $1,095 against $1,067 scrambled. The fix moved little.
- **Core CPI placebo:** 15 sessions earlier, 2 of 99 windows at z ≥ 2 (mean +0.15); 15 sessions later, 5 of 99 (mean
  +0.55). The gain belongs to the releases.
- **Core CPI rests on 12 up readings in 48 releases:** a strong candidate, not a rule. Version 2 does not see it
  (section 5).
- **Its shape:** a top row of high z rising with later exits, with rows +3 to +8 similar. That is a jump that holds, as
  the owner's reading of a lasting effect describes.
- **Fed:** a pink region (mean z −1.17). The learned buy rule did worse than random picks; version 2 turns this around.
- **All topics against the sector:** 101 of 594 tests reach |z| ≥ 2 where chance gives about 27, most of them core CPI.
  Raw: 48.

## 5. Version 2 (owner's design, 2026-11-14; built and run in lab `fe6a35c`)

What changes, in the owner's words: "remove the rule of p>=0.55 and p<=0.45 … use their probability as p0 market
basis in the formula and our updated ei ratios as the new inputs, so new p from polymarket becomes new p0 in the
calculation. … decision to buy … based on the well known dependency (if not known we need to find out before test):
fed rate up good for banks > buy; for heavily in debt or reit maybe > bad, dont buy".

The owner's choices on the open decisions (2026-11-14):
- the dependency table by Claude's judgement, per company and topic;
- all three buying levels, side by side;
- the outcome definition by Claude's recommendation;
- more events: yes (weekly jobless claims added).

Code: `macro_grid_v2.py`, `dependencies.py` (the table), `put_returns.py` (section 6), `export-leverage-inputs.mts`
(the debt rule's inputs), `kalshi_events.py` (claims, start horizon per topic).

### 5.1 Steps

1. **Topics:** core CPI, CPI, CPI y/y, core PCE, payrolls, weekly jobless claims (new) and Fed decisions.
   - Start day: 10 calendar days before the release; 4 for claims, whose markets open about 6 days before.
   - First entry: the session after the start day.
2. **Outcomes against the last print, no threshold:**
   - up / unchanged / down for CPI, core CPI, CPI y/y and core PCE (0.1-point grid);
   - up / down for payrolls and claims;
   - hike / hold / cut for the Fed (0.25 grid).
   - The market's probabilities q come from the start day's survival curve.
3. **The dependency table, set before the test** (`dependencies.json`):
   - every one of the 125 industries carries three sensitivities, rates R, growth G and inflation I (−1, 0, +1), with
     87 company overrides. Examples: brokers with cash sweeps gain from hikes; Moody's and S&P Global lose (issuance);
     gold miners are hurt by rates and helped by inflation; defence primes lose from inflation (fixed-price contracts).
   - The direction of the "up" outcome for each topic:
     - Fed = R;
     - inflation = sign(I + R), since hot inflation also means higher rates;
     - payrolls = sign(2G + R);
     - claims = the opposite of payrolls.
   - **The debt rule, point in time:** a non-financial company whose interest expense is at least 25% of its operating
     income over the last four quarters filed by the start day (or whose operating income is not positive while it
     pays interest) counts as R = −1. This changed 902 to 1,617 company-events per topic.
   - Direction 0 means no trade and no record. Companies a topic never touches are left out of its averages
     (300 to 447 companies per topic).
4. **The prior:** p0 = q(the outcome that helps the company) + half of q(unchanged), clamped to 0.01–0.99.
5. **The record:** after each earlier event whose exit has passed, e+ when the stock moved the way the realised outcome
   implied, e− otherwise. Unchanged outcomes add nothing.
6. **Two posteriors, side by side:**
   - **the owner's formula:** posterior odds = odds(p0) × (e+ + 1) / (e− + 1);
   - **total probability:** p0 × P(rise | helpful outcome) + (1 − p0) × P(rise | harmful outcome), both counted with
     one rise and one fall added. This is Claude's check on the formula: when the market is 50/50 and the company
     always follows its outcome, the stock is still 50/50, while the owner's formula reads a buy.
7. **Decision:** buy (long) at a posterior of 0.55, 0.60 or 0.65; else cash. One position at a time: a trade whose
   entry comes before the previous trade's exit is skipped. This matters only for the weekly claims, whose windows
   would otherwise overlap.
8. **Evaluation as in version 1:** 99 windows, raw and against the sector, the every-event benchmark, 20 scrambled runs
   (q permuted across the topic's events). z uses a scrambled spread of at least $5, so rules that hardly trade cannot
   show huge z from a few dollars. Two further checks:
   - **placebo:** windows moved 15 sessions before and after, for the two topics that stood out;
   - **out of sample:** every event teaches the record, but only 2024–26 events trade, for the real and the scrambled
     runs alike (`--score-from 2024-01-01`).
9. **Magnitudes:** each company's record per topic at the reference window (entry +0, exit +0): helpful and harmful
   outcomes, rises and falls after them, mean moves. They are on the page.

Reproduce (lab `src/predmarkets/`):
```
python -I put_returns.py --workers 8
python -I macro_grid_v2.py --puts --scrambles 20                      # raw, with puts
python -I macro_grid_v2.py --excess --scrambles 20                    # against the sector
python -I macro_grid_v2.py --excess --scrambles 20 --score-from 2024-01-01
python -I macro_grid_v2.py --excess --scrambles 20 --workers 1 --date-shift -15 --only cpi_yoy   # and +15, fed_upper
python -I export_grid_dataset.py <folder>
```

### 5.2 Results against the sector (owner's formula, buy at 0.60; the other levels and the total form are on the page)

| Topic | Windows z ≥ 2 (all years) | Placebo −15 / +15 | Best window, all years | Best scrambled | Windows z ≥ 2, 2024–26 trades | Best 2024–26 / best scrambled |
|---|---|---|---|---|---|---|
| Fed decision | 22 / 99 | 1 / 0 | +0/+10: $1,114 (every event $1,144) | $1,092 | 26 / 99 | $1,102 / $1,072 |
| CPI year on year | 97 / 99 | 0 / 0 | +3/+9: $1,112 ($1,063) | $1,073 | 33 / 99 | $1,036 / $1,045 |
| Core CPI | 0 | — | $1,027 | $1,069 | 0 | — |
| CPI | 0 | — | $1,018 | $1,096 | 0 (10 ≤ −2) | — |
| Core PCE (15 events, 2024+) | 0 | — | $1,025 | $1,049 | 0 | — |
| Payrolls | 0 (5 ≤ −2) | — | $1,002 | $1,040 | 0 | — |
| Jobless claims (52 events, 2024+) | 2 | — | $1,040 | $1,043 | 2 | — |

- **Two effects sit on the release days,** both with the owner's formula: the Fed and CPI year on year. Moved 15
  sessions away, both vanish.
- **The Fed holds out of sample.** With only 2024–26 trades, the best window (enter the session after the start day,
  exit 10 sessions after the meeting) made $1,102 from about 7 trades a company and beat all 20 scrambled runs (their
  mean $1,035 ± 15). The total-probability form agrees there (53–59 windows at 0.60–0.65).
- **CPI year on year fades out of sample:** 33 windows, and the best window falls below the best scrambled one. Its
  strength was 2022–23, the inflation peak.
- **Neither beats buying every event.** The Fed rule picks the better meetings, about 1.4% a trade against 0.6% for
  every meeting, but sits in cash at the rest; the every-event account ends higher ($1,132 against $1,102 in 2024–26).
- **Version 1's core CPI does not appear in version 2.** Version 1 bought the companies whose own record rose after up
  readings; version 2 buys from the dependency table, which gives core CPI the same direction as CPI.
- **Raw prices** show CPI y/y again (77–82 windows) but not the Fed (0 windows), plus core PCE (67–71 windows from
  15 events) that the sector view does not confirm. In raw prices nothing beats buying every event, because the
  market rose through 2023–26.
- **The effective sample is the number of events,** not companies × events: every company shares each event's market
  move. The Fed's 2024–26 score rests on 20 meetings.

## 6. The put run (owner, 2026-11-14)

The owner's words: "another run when we act on market down for each case when we buy option (take realistic cost)
wait as usual and execute if it is in the money, assume realistic cost of the transaction as well".

- **Down call:** the version 2 posterior is at most 1 − level (0.45, 0.40, 0.35). The same windows; raw prices only,
  since a put is on the stock itself.
- **Contract:** the at-the-money put (strike nearest the entry close) with the first expiration on or after the exit
  session, bought at the entry session's closing ask from the DoltHub chains.
  - A DoltHub snapshot dated D holds the closing quotes of D (checked by put-call parity on AAPL 2024-03-06).
  - On 2021–24 days without a snapshot (chains come about three days a week then), the previous snapshot of the four
    days before, repriced to the entry close at its own ask-implied volatility. Checked on 2025's daily chains:
    repricing from two sessions back misses the real ask by a median 4.7%, overpaying by 0.08% of the stock on
    average (a little harsh on puts, not flattering).
- **Cost:** the ask, $0.65 a contract when bought and again when exercised.
- **Exit:** exercised at the exit close when in the money (intrinsic value), else it lapses.
- **Size:** one contract per 100 shares the account could buy, so a trade risks its premium, about 2–3% of the stock.
- **Data:** 4.07 million priced trades for 490 companies (47.5% ended in the money); skipped trades: no snapshot within
  four days 6%, no strike within 5% of the close 0.4%, a split or spin-off inside the window 0.1%; three companies have
  no options.

**Result: puts lose.**
- Almost every put account ends below $1,000, in every topic, formula and level. The best windows reach $856–$1,022;
  only core PCE touches $1,021, below its best scrambled $1,029–1,043.
- A put on every event loses 3–55%, most topics 20–30% (the premium is the price of insurance).
- The down calls choose better than every event, because they trade less, but no better than puts at scrambled times.
- "Stock and puts" is worse than the stock alone wherever the stock rule works.
- **Why:** a down call is right about as often as chance, and when it is right the fall is rarely larger than the
  premium. A put pays only when the fall within the window beats 2–3% of the stock plus the spread.

## 7. The short answer (2026-11-14)

- **Version 2, as the owner specified it, mostly does not work.** Five of seven topics stay at chance in every
  formula, level and view.
- **One candidate:** Fed decisions with the owner's formula, against the sector. It sits on the meeting days
  (placebo), holds in 2024–26 out of sample, and picks the better meetings. But it does not beat buying every meeting,
  and it rests on 20 meetings. To be watched forward, not traded.
- **CPI year on year** was a 2022–23 effect.
- **Puts on down calls lose money** at realistic cost.
- **Version 1's core CPI** remains a separate candidate (12 up readings in 48 releases).

### Next, if the owner wants to pursue it

- Forward check of the Fed rule on each new meeting (the daily collector K22 records the probabilities).
- The company KPI markets (217 settled releases, 57 companies) as their own family: the closest to the engine's
  question.
- The owner's combined signal with the SEC guidance once the GPU guidance run finishes (about 2026-11-16).
