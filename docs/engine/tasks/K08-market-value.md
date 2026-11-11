# K08 — Market value without split errors, share counts without derived quarters

Task for Kimi Code, after K07. Findings of 11 November, items #3 and §9: valuation factors are wrong
before stock splits, and the Screener shows impossible market values.

## LLM use

None.

## What is wrong (measured 2026-11-11)

1. **Average share counts are treated as a flow.** The canonical series derives a fourth quarter as full
   year minus three quarters for `WeightedAverageNumberOfDilutedSharesOutstanding`, which is an average,
   not a sum. Latest vintage: AAPL 2026-09-26 **−30 M**, NVDA 2026-01-25 **−28 M**, SMCI 2026-06-30
   **24 M** (the cover page says 659 M). The Screener multiplies the latest close by this value: AAPL
   −$10.5B, SMCI $679M.
2. **Market value mixes split bases.** `api/services/factors.ts` `marketCapAt(e)` = shares at period end
   (as reported then) × close from `getBars` (Stooq history, adjusted for every later split and
   dividend). Before a split the two are in different units: NVDA `peRatio` 5.1 in the three quarters
   before the 10-for-1 split of June 2024, 53.0 after. Earnings, book, sales, cash-flow yields and the EV
   ratios share the construction.

## Facts to build on

- Schwab daily history (`pricehistory`, up to 20 years) is **split-adjusted and not dividend-adjusted**:
  NVDA closes 109.63 on 2024-05-31 (1,096.33 / 10); against the Stooq history the ratio steps by each
  quarterly dividend (KO 0.9741 → 0.9809 → 0.9877 → 0.9941 → 1.0000 over the last year; AMZN 1.0000).
  It is stored locally as source `schwab-hist` (one year so far); Claude extends it to 20 years for the
  514 series before this task starts.
- Share counts restated by later filings are on today's split basis (the latest vintage of a period
  after a split is the old count times the split ratio); first-filed values are on the basis of their
  time. The cover-page `EntityCommonStockSharesOutstanding` is a point-in-time count with its own
  as-of date and filing date.
- Stooq stays the source for returns (total return); Schwab history is for levels such as market value.

## What to build

1. **Series:** average and per-share concepts (weighted average shares, EPS) never get a derived
   standalone quarter. Use reported quarterly values; the fourth-quarter slot is null unless reported.
   Existing derived rows are corrected by rebuilding the series, not by hand.
2. **Market value at a date:** shares on today's split basis × the Schwab close of that date.
   Shares: the latest count known at the date (point-in-time by filing date), converted to today's
   split basis with the ratio between the latest-vintage and first-filed value of the same period,
   rounded to a clean split ratio (2, 3, 4, 5, 10, 20, 1.5, 1.25, or the inverse); a ratio that is not
   clean is reported, not used. Prefer the cover-page count for the current value.
3. Recompute the valuation factors (`factor_points`), the Screener market value and P/E, and Company →
   Value from that market value. Point-in-time rules stay as they are.

## Acceptance checks

1. No negative or implausible share count in the series (none below 10% or above 1,000% of the
   company's cover-page count of the same year), with a test.
2. Market value continuous across splits: NVDA June 2024 (10:1), AAPL August 2020 (4:1), TSLA August
   2020 (5:1) and August 2022 (3:1), GOOGL July 2022 (20:1), AMZN June 2022 (20:1), WMT February 2024
   (3:1): the day-over-day change of market value at the split date equals the stock's own return
   within 1%.
3. Current market value within 2% of Schwab's instrument `marketCap` for at least 45 of the 50; each
   exception explained (share classes, as-of dates).
4. NVDA `peRatio` before and after June 2024 on one level (no 10× step); a table of the valuation
   factors per company before and after the change.
5. `npm run check`, `npm test -- --run`, `npm run build`, `git diff --check`; no production write, no
   schema change.

## Delivery

Delivery report in this file (counts, the split table found, before/after tables), the usual handoff
note, and a mailbox message to Claude.
