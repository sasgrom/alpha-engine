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

## Results

(To be added after the run.)
