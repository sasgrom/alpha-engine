# Earnings surprise against consensus — pre-registered test (2026-11-26)

Owner, 2026-11-26: "go ahead with the earnings surprise". Author: Claude. This design is written **before** any surprise
was set against a return; results are added below it and the design is not changed to fit them. Method:
`docs/engine/FACTOR_TEST_METHOD.md`. Why now: the pooled engine showed the price moves on the surprise against
expectation, not on the figure (surprise ceiling 0.153 vs figure ceiling 0.121, lab `docs/findings-pooled-guidance-2026-11-18.md`);
consensus EPS was the missing input.

## Data

- **Consensus and actual:** Alpha Vantage EARNINGS (`D:/research/alpha-engine/estimates/alphavantage/earnings`, the
  newest stored file per ticker): per fiscal quarter `estimatedEPS` (consensus before the release), `reportedEPS`
  (the adjusted, "street" basis the consensus estimates; K32: 90.5% equal to our own adjusted EPS), `reportedDate`
  and `reportTime` (pre-market / post-market; K32: 98.4% the same New York day as our release calendar). EPS history
  is restated for later splits on both sides, so their difference is on one basis. One final consensus per quarter, no
  revisions, no revenue.
- **Prices:** the fable1 panel (`D:/research/alpha-engine/engine/fable1/data`): total-return opens and closes, index
  membership and sectors, 2005-02-25..2026-11-10.
- **Universe:** S&P 500 members on the event day whose ticker is in the Alpha Vantage archive. The archive is keyed by
  today's tickers, so it holds **today's members only (survivors)**; former members have no consensus. Stated as a
  bias, controlled below, never ignored.
- **Coverage today:** 50 tickers (A..AZO, 25 a day on the free key; the first full pass ends about 2026-12-15). The run
  on these 50 is a **pilot** that proves the code and shows the size of the numbers; the **verdict is taken on the full
  archive** with this design unchanged.

## Events and timing (all known before the decision)

- An event is a quarter with both EPS numbers and a release date from 2005-03-01 to 2026-10-31.
- Event session **E**: a pre-market release on a trading day → that day; a post-market release (or one on a non-trading
  day) → the next trading day. The surprise is public before E's open.
- Windows (total return, open or close of the panel):
  - **R0 reaction** (sanity, not tradable): close of E−1 → close of E.
  - **D1 first day**: open of E → open of E+1 (tradable: the news is out before E's open).
  - **D20, D60 drift**: open of E+1 → open of E+21 / E+61.
- **Abnormal return:** the stock's window return minus the equal-weight mean of its sector's index members over the same
  window (members on the entry day; at least 5 of them).

## Signals

- **S1 SUE:** (reported − estimated) / standard deviation of the company's previous 8 surprises (at least 4; floor at
  $0.01). Uses only earlier quarters.
- **S2 percent surprise:** (reported − estimated) / max(|estimated|, $0.10), clipped to ±1.
- **P1 predicted SUE (stage 1):** the mean of the company's previous 4 S1 values (at least 2), known well before E.
- **P2 last SUE:** the previous quarter's S1.

## Measures

- **Q1, is the surprise priced and does it drift?** For S1 and S2 against R0, D1, D20, D60 (the drift family = 2 signals
  × 3 tradable windows = **6 cells**; R0 is the sanity check): Spearman rank IC per calendar quarter of E across that
  quarter's events, averaged; t from the quarterly ICs (Newey-West, 2 lags for D60, 1 otherwise).
- **Q2, is the surprise predictable, and is the predictable part priced?** P1 and P2 against the same quarter's S1
  (forecast skill, rank IC) and against R0 and D1 (does the predicted surprise earn at the release; family = 2 × 2 =
  **4 cells**).
- **Money:** per calendar quarter, events in the top fifth of the signal minus the bottom fifth, mean abnormal return, as
  a per-event figure with its t over quarters; D60 also as $1M: equal-weight in every top-fifth event, held 60 sessions,
  against the same money in the sector members (a calendar-time account, overlapping positions averaged).
- **Controls:**
  - Family-wise: each signal shuffled within (calendar quarter × sector) 1,000 times; the best cell of each family is
    compared with the best cell of every shuffle.
  - Halves: E in 2005-03..2015-12 and 2016-01..2026-10.
  - Survivor control: the same IC with each event's abnormal return measured against **today's surviving members of its
    sector only** (both sides survivors), so survivorship that lifts everyone's later returns does not create the IC;
    and the IC on events in the last 3 years (2023-11..2026-10), where selection on later survival is shortest.

## Verdict rule, fixed in advance

- **Drift (Q1):** a candidate only if the best of the 6 cells has |t| ≥ 2 over the whole period, the same sign in both
  halves, beats 95% of the shuffled best cells, keeps its sign under the survivor control, and the top-minus-bottom fifth
  has t ≥ 1.5. The R0 sanity must be strongly positive (t ≥ 3); if it is not, the data are suspect and nothing is judged.
- **Predictable surprise (Q2):** stage 1 has a target only if P1 or P2 forecasts S1 with |t| ≥ 2 **and** the forecast
  earns at the release (R0 or D1 IC with t ≥ 2, same sign in both halves, beating 95% of the shuffles). If the forecast
  is skilful but does not earn, the predictable part is priced (as the guidance miss was) and the engine must look for
  information the consensus lacks.
- Otherwise: no edge, recorded as such. Exposure and risk uses are judged separately.

## Results

(Added after the runs. Pilot on 50 tickers first, marked as a pilot; the verdict waits for the full archive.)

### Pilot, 50 tickers (A..AZO), 2026-11-26 — not the verdict

Lab `src/research/surprise/surprise_test.py`; outputs `D:/research/alpha-engine/engine/surprise/surprise-test-pilot50.json`
(with 1,000 shuffles) and `surprise-test-pilot50-account.json` (the account; same code, shuffles off). 3,103 events
2005-03-17..2026-10-30, all 50 mapped to the panel by CIK, S1 on 3,091.

- **Sanity passes:** rank IC with the reaction R0: S1 0.263 (t 12.8), S2 0.272 (t 12.3) over 87 quarters. Data and timing
  are sound.
- **Q1 drift** (rank IC in %, t): S1 D1 4.6 (2.37), D20 3.8 (1.98), D60 2.1 (1.16); S2 D1 5.4 (2.62), D20 3.2 (1.65),
  D60 2.2 (1.17). Halves of the best cell S2 D1: 6.0 (1.79) and 4.8 (1.98), same sign. Last 3 years: D1 negative (S1
  −3.6, t −1.23), D60 positive (S1 6.1, t 2.74, 12 quarters). Top minus bottom fifth: D1 +0.37% / +0.39% per event
  (t 2.1), D20 +0.5% (t 1.3), D60 +0.1..0.5% (t ≤ 0.6). Family-wise: best |t| 2.62, p 0.057 against the shuffles
  (95th percentile 2.70) — just short of the bar. $1M accounts (top fifth, 60 sessions): S1 +1.87%/yr over the sector
  money (t 0.90), S2 +3.16%/yr (t 1.40); their levels ($26.5M and $27.7M from $1M) only show the universe is survivors.
- **Survivor control is weak as designed:** measuring against surviving peers changes the ICs by at most 0.01 point,
  because a sector benchmark shifts every event of a quarter and sector alike, while the rank IC is taken across them.
  The bias that matters is in the event set (today's members only); the full run reports it as unresolved unless
  former members' consensus can be obtained.
- **Q2:** the surprise is predictable — P1 forecasts S1 at rank IC 0.335 (t 18.3), P2 at 0.284 (t 13.6) — but the
  predicted part does not earn: P1 vs R0 −2.7 (t −1.60), vs D1 −1.5 (t −0.84); P2 vs R0 −3.5 (t −1.88); both halves
  negative; shuffle p 0.227. The market expects the habitual beat, as it expected the guidance miss.
- **Pilot reading:** a small first-day continuation (about 0.4% top minus bottom fifth) that does not survive the
  family-wise bar on 50 names, no reliable 60-day drift, and a predictable surprise that is already priced. Stage 1 needs
  information the consensus lacks. Verdict on the full archive.
