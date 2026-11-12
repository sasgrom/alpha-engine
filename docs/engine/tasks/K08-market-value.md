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


## Delivery report — 2026-11-12 (source 78f0a2d)

### Implementation

Weighted-average shares and per-share concepts no longer receive a derived standalone quarter. Market value uses a point-in-time share count converted to today's split basis times the latest completed Schwab close. Split detection requires identical start/end periods, corroborated share-count evidence and clean ratios; EPS is supporting evidence only. The COF 1.25 false positive from mixing three-month and nine-month averages was removed. Stooq remains the return source.

The same calculation now covers factor history, Screener market value/P/E and Company → Value. A provider share count is used only when no current SEC candidate exists; V is explicitly approximate and class-A-only. No instrument count replaces rejected SEC evidence.

### Acceptance evidence

1. Series rebuild: **50/50 companies, 24,211 series, 1,110,764 points, zero failures**. QA found **0 derived non-additive points, 0 negative shares** and preserved **1,170 negative reported EPS observations**. Latest AAPL, NVDA, SMCI and WMT counts pass the 10%–1,000% same-year cover check. The literal all-history comparison initially reported 81 outliers: **15** were unlike split bases and were resolved by converting the cover reference. The owner accepted deferral of the remaining **66** to K09: **58/58 unit-scale suspects have same-filing or earlier-filed references within 1%**, and **8 LIN 2017** comparisons are the pre-combination holding company. Their literal report remains `status: failed`; `market-value-k09-quarantine.json` is `ready_for_k09`. No historical value was rescaled or silently discarded.
2. Split continuity: **7/7 pass**; market-value return equals stock return within floating-point rounding. Independent 13F evidence corroborates five required cases and lists no conflicting COF split; AAPL 4:1 and TSLA 5:1 are absent from that secondary list, not contradicted.
3. Current counts: the literal old threshold remains **43/50**, not 45. The owner accepted **42/44 comparable companies = 95.45%**. Five multi-class companies and V are not comparable; GS is dated by evidence and LLY remains unexplained. No counts were substituted to make the comparison pass.
4. Factor rebuild: **21,701 → 21,046 rows**, 50 companies, zero failures. Stored keys equal the no-write candidate exactly; **20** last-bit MySQL rounding differences have maximum relative error **1.957e-16** (tolerance 1e-12). NVDA P/E is **51.4913 → 52.4690** around the 10:1 split, ratio **1.0190**, replacing **5.1253 → 52.9895**. The complete nine-valuation-factor before/after table for every company is in `market-value-factor-comparison.json`; a compact P/E and market-value table follows below.
5. Verification: `npm run check`, **217 test files / 1,225 tests**, `npm run build`, `git diff --check`, and K07/K08 script typechecks pass. Focused K08 tests: **22/22**.

### Split continuity

| Company | Split | First new-basis filing | Sessions | Shares before → after | Schwab close before → after | Market-cap minus stock return |
|---|---:|---|---|---|---|---:|
| NVDA | 10:1 | 2024-08-28 | 2024-06-07 → 2024-06-10 | 24,600,000,000 → 24,600,000,000 | 120.888 → 121.79 | 0.00e+0% |
| AAPL | 4:1 | 2020-10-30 | 2020-08-28 → 2020-08-31 | 17,102,536,000 → 17,102,536,000 | 124.8075 → 129.04 | 2.22e-14% |
| TSLA | 5:1 | 2020-10-26 | 2020-08-28 → 2020-08-31 | 2,795,425,890 → 2,795,425,890 | 147.56 → 166.1066666666667 | 0.00e+0% |
| TSLA | 3:1 | 2022-10-24 | 2022-08-24 → 2022-08-25 | 3,133,470,045 → 3,133,470,045 | 297.096666666667 → 296.07 | 1.11e-14% |
| GOOGL | 20:1 | 2022-07-27 | 2022-07-14 → 2022-07-15 | 13,175,260,000 → 13,175,260,000 | 110.3675 → 111.7775 | 0.00e+0% |
| AMZN | 20:1 | 2022-07-29 | 2022-06-03 → 2022-06-06 | 10,174,409,620 → 10,174,409,620 | 122.35 → 124.79 | 0.00e+0% |
| WMT | 3:1 | 2024-03-15 | 2024-02-23 → 2024-02-26 | 8,076,701,109 → 8,076,701,109 | 58.52 → 59.6 | 0.00e+0% |

### Current-count exceptions

| Company | SEC/provider shares (as-of; filed) | Instrument shares (captured) | Difference | Reason |
|---|---|---|---:|---|
| PLTR | 2,409,153,000 (2026-09-30; filed 2026-11-03) | 2,306,705,341 (2026-11-12T05:10:17.642Z) | 4.44% | more than one share class; the instrument counts the listed class |
| META | 2,552,000,000 (2026-09-30; filed 2026-10-22) | 2,214,472,367 (2026-11-12T05:10:17.642Z) | 15.24% | more than one share class; the instrument counts the listed class |
| NKE | 1,483,600,000 (2026-08-31; filed 2026-10-02) | 1,203,921,077 (2026-11-12T05:10:17.642Z) | 23.23% | more than one share class; the instrument counts the listed class |
| GS | 288,434,583 (2026-10-16; filed 2026-11-02) | 300,028,487 (2026-11-12T05:10:17.642Z) | -3.86% | instrument count dated about 2025-10; matching cover 2025-10-17, 299,928,511, -0.03% |
| LLY | 940,745,031 (2026-10-26; filed 2026-10-29) | 890,751,125 (2026-11-12T05:10:17.642Z) | 5.61% | unexplained |
| DASH | 434,409,000 (2026-09-30; filed 2026-10-30) | 411,998,576 (2026-11-12T05:10:17.642Z) | 5.44% | more than one share class; the instrument counts the listed class |
| GOOGL | 12,294,000,000 (2026-09-30; filed 2026-10-29) | 5,888,000,000 (2026-11-12T05:10:17.642Z) | 108.80% | more than one share class; the instrument counts the listed class |
| V | 1,724,473,215 (2026-11-12; filed 2026-11-12T05:10:17.642Z) | 1,724,473,215 (2026-11-12T05:10:17.642Z) | 0.00% | no SEC count; labelled class-A-only provider fallback understates all-class market value |

V remains approximate: its provider fallback counts class A only and understates the all-class company. There is no per-company note field in the existing page payload, so the limitation is recorded here and in the evidence.

### Per-company before/after

P/E is the latest stored `factor_points.peRatio` at the shown period. Market value is the full-universe Screener cache (`screener:u3`). All nine valuation factors for all 50 companies are preserved in the factor-comparison JSON.

| Company | Period | P/E before → after | Screener market value before → after |
|---|---|---:|---:|
| NVDA | 2026-07-26 | 26.04 → 25.95 | $4.860T → $4.070T |
| AMD | 2026-09-26 | 135.74 → 135.12 | $811.86B → $844.99B |
| INTC | 2025-09-27 | 854.51 → 784.77 | $309.24B → $308.96B |
| PLTR | 2026-09-30 | 122.82 → 122.50 | $441.94B → $406.71B |
| META | 2026-09-30 | 24.80 → 24.51 | $1.621T → $1.637T |
| NFLX | 2026-09-30 | 19.35 → 19.62 | $278.51B → $259.77B |
| AMZN | 2026-09-30 | 19.99 → 19.94 | $2.907T → $2.929T |
| TSLA | 2026-09-30 | 435.85 → 435.47 | $1.364T → $1.501T |
| NKE | 2026-08-31 | 18.74 → 18.70 | $60.10B → $57.37B |
| LULU | 2026-08-02 | 8.93 → 9.09 | $12.65B → $11.65B |
| RCL | 2026-09-30 | 15.66 → 15.62 | $89.28B → $90.90B |
| GS | 2026-09-30 | 11.72 → 11.83 | $279.42B → $262.53B |
| COF | 2026-09-30 | 10.69 → 10.90 | $125.75B → $117.80B |
| UNH | 2026-09-30 | 20.71 → 20.74 | $369.26B → $363.00B |
| PFE | 2026-09-27 | 40.88 → 40.52 | $177.07B → $167.35B |
| FCX | 2026-09-30 | 28.01 → 27.89 | $90.33B → $86.54B |
| BA | 2026-09-30 | 19.26 → 19.21 | $140.31B → $137.39B |
| PLD | 2026-03-31 | 33.15 → 33.05 | $125.79B → $121.30B |
| NEE | 2026-03-31 | 23.67 → 23.65 | $185.07B → $179.90B |
| MSFT | 2026-09-30 | 26.71 → 26.70 | $4.138T → $3.959T |
| AVGO | 2026-08-02 | 621.13 → 618.99 | $1.591T → $1.585T |
| ANET | 2026-09-30 | 54.13 → 54.03 | $228.13B → $233.75B |
| MU | 2026-09-03 | 12.75 → 12.74 | $0.80B → $820.41B |
| SMCI | 2026-09-30 | 7.40 → 7.38 | $0.70B → $18.32B |
| FSLR | 2026-09-30 | 10.12 → 10.11 | $20.95B → $19.45B |
| MRNA | 2023-06-30 | 38.35 → 38.37 | $102.84B → $101.49B |
| LLY | 2026-09-30 | 37.48 → 39.49 | $1.267T → $1.347T |
| DAL | 2026-09-30 | 16.72 → 16.68 | $58.81B → $60.66B |
| DASH | 2026-09-30 | 76.03 → 75.01 | $87.44B → $77.43B |
| HD | 2026-08-02 | 23.29 → 23.27 | $354.02B → $350.19B |
| CAT | 2026-09-30 | 85.31 → 85.70 | $272.53B → $267.50B |
| AMT | 2026-09-30 | 23.95 → 24.04 | $90.76B → $88.29B |
| JPM | 2026-09-30 | 13.45 → 13.33 | $944.71B → $908.40B |
| KMI | 2026-09-30 | 18.64 → 18.63 | $70.20B → $69.48B |
| AAPL | 2026-09-26 | 37.50 → 37.66 | −$10.48B → $5.065T |
| IBM | 2026-09-30 | 18.77 → 18.55 | $242.50B → $231.11B |
| LMT | 2026-09-27 | 18.47 → 18.41 | $137.75B → $139.32B |
| T | 2026-09-30 | 12.71 → 12.73 | $149.40B → $147.80B |
| GOOGL | 2026-09-30 | 17.95 → 17.85 | $3.573T → $3.533T |
| JNJ | 2026-09-27 | 41.26 → 40.61 | $676.60B → $675.92B |
| PG | 2026-09-30 | 21.82 → 21.07 | $402.77B → $390.92B |
| WMT | 2026-07-31 | 40.19 → 40.09 | $1.031T → $996.08B |
| CVX | 2026-09-30 | 14.86 → 14.96 | $428.51B → $415.14B |
| MA | 2026-09-30 | 150.03 → 151.05 | $589.27B → $576.49B |
| V | — | — → — | — → $729.45B |
| COST | 2026-08-30 | 45.43 → 45.45 | −$0.03B → $472.44B |
| AIG | 2026-09-30 | 12.47 → 12.57 | $43.08B → $42.68B |
| COP | 2026-09-30 | 12.95 → 13.01 | $166.28B → $160.31B |
| LIN | 2026-09-30 | 31.33 → 31.23 | $242.70B → $239.54B |
| CSCO | 2026-07-25 | 33.96 → 33.92 | $0.00B → $386.96B |

### Rebuild and serving evidence

- Local series writes were atomic per company. Factor materialization completed **50/50**, with no missing or unexpected candidate keys.
- Local cache refresh upserted **104/104 payloads successfully**: 50 factor, 50 value and four Screener caches (8, 50, 50 and 1 rows). No cache row was deleted.
- Full-universe Screener comparison: **50/50 exact market-value matches**, **50 positive**, zero negative. AAPL moved from −$10.48B to $5.065T; COST from −$29.30M to $472.44B; SMCI from $0.703B to $18.32B.
- K07 artifacts: **103 total**, **101 reused**, **2 recomputed**. On-request equality: **22/22 checks, 13,713 fields, 0 differences**, tolerance 1e-12. Artifact staleness depends on inputs/source runs/evaluation day, not the later commit hash; these artifacts were built from base `3b019ee` plus the K08 working tree, with source delivered as 78f0a2d.
- Authenticated live check after one coordinated restart (18276 to 6812): **pass**, final auth 200, 8/8 owner Screener rows matched, Company Value AAPL $5.065T, no page errors or failed requests. Rendered marker: `vs market cap $5.06T`.

### Evidence hashes

| File | Bytes | SHA256 |
|---|---:|---|
| research/engine/market-value-current-check.json | 47,797 | `6a5b0529d55ca156464f36fa3f89aac3e63275a808d81a8881332c2490e15382` |
| research/engine/market-value-split-check.json | 396,949 | `3b3cb28577a068786659b90e7da13d2593d1edab3135cf073aff0749e5b0acdf` |
| research/engine/market-value-series-check.json | 50,452 | `0e0fe24857df2a828fcca892069f96573cf17f29a0c259619e2d829b541556f3` |
| research/engine/market-value-k09-quarantine.json | 72,219 | `bd811f8e08c31860646008085842891cbfcdc990191cdf7385677835c809c566` |
| research/engine/market-value-factor-comparison.json | 188,261 | `5cda29b8fe374161bb0a7b4c3ad7baea7d9bb37ee2453b96bb0ba8fb6e151cfa` |
| research/engine/market-value-materialization-check.json | 7,470 | `820614696ccb0f6f4bd02c06fe33d7425c34d57e561ddd13d35891c383b6eaf2` |
| research/engine/market-value-cache-refresh.json | 26,869 | `b03564a59c7460b77bd2e393e7529623be7fb2deae815bfcc6e99113f7d52f9a` |
| research/engine/market-value-ui-comparison.json | 29,279 | `703b820ecd2e60b805e973aa951a1ceac9c3051608065b9a2a346915095b96db` |
| research/engine/precomputed-page-data.summary.json | 96,715 | `cb5f3cee8d0af1a1270539333e17ca36d58d9610bff1d88b770394e3f5d84c8e` |
| research/engine/precomputed-page-data.equality.json | 9,006 | `47d006f3ff1e2546009be68d238697d391f537997d6964abaa3ed7e030bdf729` |
| research/engine/market-value-live-check.json | 2,319 | `8b3da4a273c6862be5a61d3e78d81637bd32b6a68c43c99d2f16a94285b774c3` |

### Boundaries and next action

Only local MySQL `series_points`, `factor_points`, `external_cache` and local artifacts changed. No production write, deployment, schema change, new table/index, LLM call, GDELT request or alpha promotion occurred. Unrelated generated `company-exposures.*` and `src/data/analytics-snapshot.ts` changes remain uncommitted and are not part of K08.

K09 starts with the 58 unit-scale and eight LIN quarantine regression cases. The future unit action is **reject without rescaling**, using only same-filing or earlier-filed references; preserve LIN predecessor weighted averages and exclude its pre-combination cover as a reference. Schwab's pre-combination LIN prices belong to the predecessor; Stooq begins at the new listing on 2018-11-01.
