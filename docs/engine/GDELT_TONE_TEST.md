# GDELT tone as a factor — pre-registered test (2026-11-26)

Owner, 2026-11-26: "test gdelt tone". Author: Claude. This design was written **before** any tone history was read;
the results section is added afterwards and the design is not changed to fit them. Method:
`docs/engine/FACTOR_TEST_METHOD.md`, test bed: the fable1 panel (point-in-time S&P 500 members with former members,
total-return opens and closes, index weights by quarter).

## Data

- GDELT 2.1 GKG, English stream, static files (`scripts/gdelt-history.mts`), 2019-08-01 to 2026-11-25. A fixed sample of
  one slot in 16: on day d the 15-minute slots k with k mod 16 = d mod 16 (six a day, rotating through the day).
  Each file is checked against masterfilelist.txt (size, MD5). The full history (1.5 TB) does not fit our line (about
  3 MB/s); the sample reads one article in 16.
- An article counts for a company when one of its GKG organizations resolves to the company (the news reader's
  `CompanyIndex.resolve`: one clear candidate). Articles naming more than three index companies (market round-ups) are
  left out. GDELT's tone: positive minus negative words per 100 words (dictionary based, not a model).
- Known before the decision: GDELT's time is when it processed the article (at most 15 minutes after finding it). A
  week's signal uses articles up to the last session's date, 23:59 UTC; the position is entered at the next session's
  open and held to the open one week (or one month) later.

## Signals (the whole family: 4 signals × 2 horizons = 8 cells)

Weekly, for each member with at least 3 articles in the week:
- **S1 level:** mean tone of the week's articles.
- **S2 abnormal tone:** S1 minus the company's own mean weekly tone over the previous 26 weeks (at least 13 weeks).
- **S3 change:** S1 minus the mean of the previous 4 weeks (at least 2).
- **S4 attention:** log((articles this week + 1) / (mean weekly articles over the previous 26 weeks + 1)).

Monthly (the last session of each month): the same four over 30 days, S2 and S4 against the previous 12 months.

## Measures

- **Primary:** inside-sector rank IC: signal ranked within its sector (former members without a sector form one
  group), the next period's open-to-open total return less its sector's mean, Spearman over all members, averaged
  over periods; t from the period ICs (Newey-West, 4 lags for weekly).
- **Money:** each sector's members split by the signal into fifths; the best fifth at index weights against the
  sector's scored members at index weights (sector weights kept), as a yearly figure with its t.
- **Sanity:** the same-week IC of tone with the same week's return (tone should move with news if it measures
  anything).
- **Controls:** family-wise: the signal series shifted against the returns by 26 to 104 weeks (both directions,
  keeping each series' autocorrelation); the best of the 8 cells is compared with the best cell of every shift.
  Halves: 2019-10..2023-03 and 2023-04..2026-10.

## Verdict rule, fixed in advance

A signal is a candidate only if: its inside-sector IC has |t| ≥ 2 over the whole period, the same sign in both halves,
the best cell beats at least 95% of the shifted best cells, and the best fifth earns more than its sector at index
weights with t ≥ 1.5. Otherwise GDELT tone is recorded as no edge for timing. Exposure use (tone as a description of
the news flow) is judged separately.

## Results (2026-11-26, lab `src/research/gdelt/tone_test.py`; output `news/gdelt-history/tone-test.json`)

**Data.** 15,744 sampled GKG files (2019-08-01 to 2026-11-25; 7 slots failed twice and are listed), 3,563,608 article rows
naming an index company, 2,192,820 kept for 481 panel companies (three companies or fewer, a GDELT tone).
One correction after the first run, a bug and not a design change: a row's time is the article's own GDELT date, not the
stamp of the file it came from, so the analysis's slot filter kept only 6% of the rows; it was removed. The pilot's
2021-03-01..05 files (one slot in 8) therefore count double for those five days.

Inside-sector rank IC with the next period's open-to-open return (in percent), Newey-West t:

| Cell | Periods | IC | t | First half (t) | Second half (t) | Best fifth vs sector, index weights |
|---|---|---|---|---|---|---|
| weekly S1 level | 368 | −0.46 | −0.90 | +0.58 (0.74) | −1.49 (−2.45) | −7.8%/yr (t −2.07) |
| weekly S2 abnormal | 364 | −0.36 | −0.59 | +0.49 (0.54) | −1.18 (−1.46) | −3.5%/yr (t −0.84) |
| weekly S3 change | 368 | −0.19 | −0.28 | +0.74 (0.78) | −1.10 (−1.27) | −4.3%/yr (t −1.12) |
| weekly S4 attention | 368 | +0.05 | +0.10 | +0.86 (1.25) | −0.76 (−1.50) | −2.7%/yr (t −0.81) |
| monthly S1 level | 84 | −0.37 | −0.49 | +0.56 (0.55) | −1.30 (−1.21) | −4.2%/yr (t −1.62) |
| monthly S2 abnormal | 80 | +1.34 | +1.80 | +2.19 (2.11) | +0.57 (0.55) | +0.9%/yr (t 0.30) |
| monthly S3 change | 84 | +0.93 | +1.24 | +0.95 (0.97) | +0.91 (0.80) | +2.3%/yr (t 0.73) |
| monthly S4 attention | 84 | +0.27 | +0.42 | +0.24 (0.24) | +0.30 (0.37) | −1.4%/yr (t −0.53) |

**Sanity (same period).** Tone moves with the same week's return: level IC +1.88 (t 4.23), abnormal +1.52 (t 2.78), change
+1.41 (t 2.88); monthly +2.0 to +2.6 (t 2.4 to 3.3). Attention (article counts) does not (t 0.04). So the tone measure
reads the news, but the news is in the price by the time the week closes.

**Family-wise.** Best cell |t| 1.80 (monthly abnormal tone); 42.5% of 80 time-shifted copies do at least as well; the
shifted 95th percentile is 3.10.

**Verdict by the rule fixed in advance: GDELT tone has no edge for timing.** No cell reaches |t| ≥ 2 over the whole
period; the best (monthly abnormal tone, t 1.8) is strong in the first half only and its best fifth earns nothing; the
weekly level's negative second half (t −2.45) has the opposite sign in the first half and fails the family-wise control.
GDELT tone stays a description of the news flow (same-week), not a forecast. Next, as planned: the same design on the
Russell 1000 mid-caps once their price panel is screened (K31), monthly horizon first.

## Russell 1000 mid-caps — design addendum (fixed 2026-11-27, before any mid-cap result was computed)

Everything above holds (signals, horizons, measures, controls, verdict rule), with these inputs:

- **Panel:** the accepted Russell 1000 panel `D:/research/alpha-engine/engine/r1000-panel/20261127T091213Z` (K31.3):
  total-return opens, Russell 1000 membership and weights by quarter from 2019-09-30, sectors.
- **Universe (primary, the verdict):** on each decision session, Russell 1000 members that are **not** S&P 500 members
  that day (S&P membership from the fable1 panel, matched by CIK). Index weights in the money measure are their
  Russell 1000 weights.
- **Secondary (reported, not judged):** all Russell 1000 members, same design.
- **Articles:** the stored sample rows (`news/gdelt-history/rows`, the 15,744 files of the S&P run; no new GDELT
  requests). They were resolved against a 6,728-company index, so 669 of the panel's 706 priced non-S&P companies already
  have articles (521,644 company-article rows before the ≤ 3 companies rule).
- **Return validity (a data rule found on the panel before the run):** a period's return counts only if **every session
  from entry to exit has a price and lies in one listed segment** of the company. Reason: in this panel the price level
  is not on one basis across an excluded day (20-session windows containing an excluded day disagree with Stooq by
  more than 5 points in 831 of 1,981 cases, e.g. VISN 2026-04-06→05-04 +926% vs +35%; windows without one: 94 of 53,543),
  and a new listed segment restarts the index (WOLF 2025-09-29). Such company-periods are left out, not repaired.
- Window 2019-10-01..2026-10-31, halves split at 2023-04-01, as above.

### Results, Russell 1000 (2026-11-27, lab `src/research/gdelt/tone_test_r1000.py` d5a0c92; outputs
`news/gdelt-history/tone-test-r1000-midcap.json` and `-all.json`)

**Data.** 3,421,888 company-article rows kept for 1,332 panel companies. S&P membership by date from fable1: 113 of its
members in the window have no CIK and were matched by ticker; 43 have no ticker match either. They are all among the
panel's unpriced companies (placeholder tickers, no prices), so they never enter a scored set.

**Mid-caps (the verdict).** Inside-sector rank IC with the next period's open-to-open return, in percent (median scored
companies per period in brackets):

| Cell | Periods | IC | t | First half (t) | Second half (t) | Best fifth vs sector |
|---|---|---|---|---|---|---|
| weekly S1 level | — | not measurable: median 38 scored, below the design's 50 | | | | |
| weekly S2 abnormal | — | not measurable | | | | |
| weekly S3 change | — | not measurable | | | | |
| weekly S4 attention (90) | 366 | −0.33 | −0.50 | +0.19 (0.18) | −0.83 (−1.08) | −7.0%/yr (t −1.48) |
| monthly S1 level (84) | 83 | −0.20 | −0.15 | +0.96 (0.42) | −1.39 (−1.07) | −6.7%/yr (t −1.14) |
| monthly S2 abnormal (46) | 69 | +0.19 | +0.09 | −1.69 (−0.52) | +1.82 (0.62) | +3.0%/yr (t 0.42) |
| monthly S3 change (49) | 68 | −1.60 | −1.02 | −0.60 (−0.31) | −2.59 (−1.06) | −13.4%/yr (t −1.69) |
| monthly S4 attention (214) | 84 | −0.53 | −0.68 | −0.20 (−0.17) | −0.86 (−0.83) | −2.5%/yr (t −0.79) |

Sanity (same month): level +2.37 (t 1.88), abnormal +2.79 (t 1.36), change +2.08 (t 1.25), attention +1.56 (t 2.10) —
weaker than on the S&P 500 (t 2.4 to 3.3): the one-in-16 sample holds few articles per mid-cap. Family-wise: best |t|
1.02; 88.7% of 80 shifted copies do at least as well (95th percentile 3.22).

**Verdict by the rule: no edge for timing on the mid-caps.** No cell comes near |t| 2. The test is weak, not only
negative: three weekly cells cannot be measured, and the monthly cells score 46–214 companies. A stronger mid-cap test
would need far more articles per company (a denser GDELT sample or another news source), not a different design.

**All Russell 1000 members (secondary, not judged).** It repeats the S&P 500 result, which it contains: monthly abnormal
tone +0.93 (t 1.24) is the best cell; weekly level's best fifth −7.6%/yr (t −2.03) with a negative second half
(t −1.96), as on the S&P; family-wise best |t| 1.52, 83.8% of shifts at least as good. Sanity is as strong as on the S&P
(weekly level t 4.17, monthly level t 3.37).
