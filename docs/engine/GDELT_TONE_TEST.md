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
