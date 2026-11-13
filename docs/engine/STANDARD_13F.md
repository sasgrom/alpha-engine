# Standard 13F — point-in-time institutional holdings

K16 builds standard institutional holdings from the fund books, not from the app's legacy `fund_holdings` table.
The research tables are provisional until Claude accepts them. Nothing here changes app pages, signals, production,
`alpha_engine` data, or the legacy table.

- **Code:** `C:\dev\alpha-engine-lab\src\thirteenf\` in the lab repository.
- **Inputs:** `D:\research\alpha-engine\fund-books\`, standard prices p1.1, and final standard fundamentals v3.1.
- **Artifacts:** `D:\research\alpha-engine\fund-books\std\` (build `k16.4`).
- **Tables:** `alpha_research.std_13f_filings`, `std_13f_positions`, `std_13f_company_quarters`, `std_13f_builds`.
- **Unit tests:** nineteen deterministic `node:test` cases in `src/thirteenf/model.test.mts`.

## 1. One filing reader and one set of book decisions

`reader.mts` imports `readInfoTable`, `readCoverPage`, `filedCusip`, `valueUnit`, and the other filing primitives from
`worker/lib/thirteenf-table.ts`. `books.mts` imports `mergeFiledParts`; flow guards import `reportingChange` from
`worker/lib/fund-flows.ts`. The main repository's implementations are executed, not reimplemented in the lab.

The builder reads the books' per-filing checkpoints, `manifest.json` mapping decisions and quarter files. A CUSIP's
company comes from those price-level decisions, resolved to the company's SEC CIK before any synthetic price key.
Share classes retain their CUSIP identity and a `main`/`secondary` label; the checkpoints do not preserve a literal
class name such as A or B. A secondary class also carries the residual `classFactor = bookClassFactor / splitFactor`.
Other share-count conversions are resolved from each position's own filed price rather than hidden in `classFactor`.

A small lab extension reads only the fields missing from the original checkpoints: underlying put and call shares and
confidential-omission flags. These live in atomic per-filing `filing-detail` checkpoints keyed by the original raw and
cover hashes and the fund-book reader version. On a first read, the raw XML and cover must reproduce every checkpoint
position, value and cover field. A mismatch stops the build; it is not silently accepted as a new filing.

## 2. Filing table

`std_13f_filings` has one row per filing read by the books, including amendments, cover-only tables and filings that do
not form a book. It retains:

- fund CIK, manager, period, accession, form, manager, signature date and amendment kind;
- filing date, EDGAR acceptance time when available, and `availableFrom`;
- dollars per filed value unit and shares per filed share unit, with the decision basis;
- declared rows/value, rows/value actually read, covered value, mapped position count, and separate put/call values;
- totals verdict, cover-page-only, confidential-treatment, partial-table and used-in-book flags.

An amendment labeled `NEW HOLDINGS` that repeats at least 80% of the preceding book is marked
`whole_report_new_holdings`, because the shared merger replaces rather than adds that book. Explicit restatements are
`restatement`; genuine additions are `addition`. Cover-page copies do not form books. `isConfidentialOmitted` stays
flagged on the filing, but a complete public table (for example Capula's 1,029 rows) is used; no values are invented
for the omitted confidential positions.
An incomplete or unreadable-unit book remains listed in the gate report rather than becoming a fabricated zero book.

The positions sum to the table value by construction of the shared reader. `valueReadUsd` covers the whole table,
whereas `coveredValueUsd` covers only company-mapped shares and options. Their difference is therefore explicit:
unmapped securities and principal-amount rows are not silently assigned to a company. `totalsAgree` compares the raw
rows and values with the cover, allowing a documented thousandfold cover/table unit difference. Other differences
stay visible as `rowsDiffer`, `valueDiffers`, `noTable` or `partTable`.

## 3. Filing positions and share bases

`std_13f_positions` has one row per filing, company and CUSIP share class. Values are converted to dollars, but the
filed share count is never overwritten with an adjusted count. Put and call underlying shares and their values have
separate columns; they are not added to shares held.

Standard prices provide an as-traded close and `splitIndex`. For period `p`:

```text
splitFactor(p) = splitIndex(today) / splitIndex(p)
splitAdjustedClose(p) = asTradedClose(p) / splitFactor(p)
positionFactor = nearestLog((value / sharesFiled) / (splitAdjustedClose(p) × classFactor), tolerance = ±40%)
sharesToday = sharesFiled × positionFactor
mainClassSharesToday = sharesToday × classFactor
```

The candidate set contains only distinct values of `splitIndex(today) / splitIndex(t)` for sessions `t` from the
period end through today. Thus a company with no later split has only `{1}`; Lam at 2024-09-30 has `{1, 10}`. Generic
split products are forbidden. When prices are unavailable, the candidates are the cumulative products of the company's
own later split events. Share-class conversion remains a separate multiplier.

`positionFactor` is the candidate nearest the filed-price ratio in log terms, accepted only when
`|log(filedRatio / candidate)| <= log(1.4)`. Candidate sets are cached per company and period during the build. This
allows ordinary price movement between the period end and the fund's valuation date without turning it into a false
split. A match is labeled `filed_price`; an unclean ratio keeps the period-end split factor and is labeled
`assumed_period_end`. When that factor is 1, the label is `no_split_factor`, not a newly derived split. A zero or
unusable price also uses the period-end factor with the `assumed_period_end` label. A filing already on the new basis
therefore gets factor 1, not another split multiplier. The filed-basis columns remain the historical evidence. Company
aggregates use main-class-equivalent shares for comparability across CUSIPs; options remain outside holders and shares held.

When a company has no standard-price series, `priceBasisSource` is `events (no standard price series)` and the split
factor is the product of that company's split ratios in `events.json` strictly after the period. The `sharesBasic`
basis factor is `eventFactor(filed)`. RIVN is the only such company in this build: its entry has
empty split, distribution and dividend lists, so its factor is an evidenced 1, not an assumption. Its first price date
still comes from the app history for the listing exclusion; no app close is substituted into the standard-price gate.
When a series exists but the requested date precedes its first split-index point, the same event rule applies and is
labeled `events (before standard price span)`. Such positions are not dropped merely because the index starts later.

Per-filing units are decided from cross-filing price medians, not from the calendar alone. The pre-2023-thousand /
2023-dollar convention supplies an explicitly labeled fallback only when there is no price reference. Three unresolved
unit cases stay out of books. The gate report compares the complete unit counts and unresolved list with the books'
manifest.

## 4. Availability and company quarters

Every company-period has up to two rows: `deadline`, meaning **as known at the first trading session after the filing
deadline**, and `plus_10`, exactly ten sessions later. The deadline is the period end + 45 calendar days, moved to the
next session when that day is a weekend or holiday. For 2026-06-30, the deadline is Friday 2026-08-14 and `knownAt` is
Monday 2026-08-17. A kind whose session is not yet in the calendar is deferred as `not_yet_known`, never assigned an
invented future session.

`availableFrom` is the first session whose 09:30 ET open comes after `acceptanceDateTime`. Acceptance before the open
can therefore enter that same session; an acceptance after the open enters the next session. With only a filing date,
the old session-after-filing-date rule remains. A filing enters a row only when its `availableFrom <= knownAt`, so a
deadline-evening acceptance is not incorrectly treated as a trade one session later.

The merger runs independently for each row kind. A later amendment cannot enter that row or replace the original
filing retrospectively. A filing without a verified date or next session is excluded rather than assigned an assumed
availability day. Every field, including the shares denominator, is selected using the row's own `knownAt`.

Each row contains holders, filed-basis and today's-basis main-class shares, covered value, the ten largest holders'
share, continuing-fund shares bought/sold, and flow-exclusion counts. `fundsFiled` is the number of usable books
available by this `knownAt`; `fundsInBook` is the number in the complete period book. `coverage` is their ratio, so the
denominator cannot be confused with the previous quarter's fund count.

### Shares outstanding

The denominator is final v3.1 `sharesBasic`, selecting the latest quarter not after the period and the latest version
filed by `knownAt`. Its count is returned to today's share basis, so a filing after a split already uses the new basis:

```text
sharesOutstanding(today) = sharesBasic × splitIndex(today) / splitIndex(filed)
percentOfSharesOutstanding = 100 × mainClassSharesToday / sharesOutstanding(today)
```

The raw filed count (`rawValue`) is tested before any basis factor is applied. A cover-derived count below 1,000,000
shares is not a credible consolidated denominator for this 500-company universe, even if a later split would make the
adjusted value exceed that floor. Those cases leave the percentage null and are listed with their filed source and basis factor in
`denominator-exclusions.json`; they are not presented as ownership above 100%. Missing denominators also leave the
percentage null. Values above 100% remain visible with the count, filing provenance,
largest-holder percentage and a reason: issued rather than outstanding shares (notably Boeing and Tyler), one-class or
one-listing denominators, or an unresolved possible fund double-count. No denominator is substituted to make the
percentage look reasonable.

### Trading versus reporting changes

Continuing funds have a book at both periods of the same row kind, after newly reportable and mass-reporting funds
are excluded. `entries` counts continuing funds that hold the company now but not before; `exits` is the reverse.
`breadthChange = (entries − exits) / continuingFunds`, the Chen–Hong–Stein breadth measure. A full exit therefore
remains visible even when the company has zero current holders. The old `newFunds` and `exitedFunds` fields are gone;
whole-book presence remains in `fundsFiled`, `fundsInBook` and `coverage`, not mislabeled as trading.

Flows use split- and class-corrected shares at each period's own `knownAt`. The following are excluded and listed in
`flow-exclusions.jsonl`, with per-company reason counts in the table:

- a reporting change identified by the existing `reportingChange` guard (mass moves, absorbed accounts, partial books);
- a manager whose aggregate book crosses the $100 million reporting threshold from below; a single large stock purchase
  by an already reportable manager is **not** excluded;
- a recent listing, using the standard-price first date within 183 days;
- an evidenced predecessor/successor conversion and a CUSIP-only share-class conversion with no net position change.

## 5. Filing dates and the only permitted network path

`alpha_engine.fund_quarters` is read-only and supplies filing dates already known there. For other accessions,
`dates.mts` first reads `data.sec.gov/submissions/CIK##########.json`. The recent list contains only the latest 1,000
filings, so an unresolved accession is then looked up only in the `filings.files` page whose range covers its signed
date (±10 days):

- at most one recent-list request per missing fund and one request per selected page per run, with no hidden retry;
- serialized requests at least 210 ms apart, below five requests a second;
- the same declared User-Agent as the existing EDGAR collectors;
- successful answers and their hashes cached in `D:\research\alpha-engine\fund-books\submissions\`;
- no older-filing downloads and no other endpoint.

The cached submissions list and dated pages supply `filingDate` and `acceptanceDateTime` when the accession is present.
Anything still unresolved is listed with its reason and excluded from company-quarter aggregation. Request URLs,
statuses, cache hits and unresolved reasons are recorded in `build.json`; credentials and request headers are never logged.

## 6. Acceptance gates

| Check | Rule and evidence |
|---|---|
| 1. Cover totals | Every filing receives the books' totals verdict. Counts must match the rebuilt manifest; differences retain their reasons. |
| 2. Raw re-read | Ten deterministic random filings are re-read from raw XML and cover pages. Positions, shares, values, option shares and cover fields must match. |
| 3. Price levels | `(value ÷ filed shares) ÷ (splitAdjustedClose × classFactor × positionFactor)` must be within 2% for at least 98% of **priced** position value. Unpriced value is reported separately with its share of the total and reason; it neither passes nor fails the gate. Every exception is in `price-outliers.jsonl`, largest values first for review. |
| 4. Latest-book tie and corrections | For 2026-06-30, the **full-book** holders, today's-basis shares and value per company should equal the quarter file. With `normalized = filedRatio / chosenFactor`, classes are **basis** (within 2%), **valuation difference** (over 2% through 40%, with only one candidate that close to the filed ratio or only one candidate overall), **pricing anomaly** (over 40% from every candidate), and **books error** (the reference factor is absent from the company's own candidates). Basis, valuation differences and books errors are explained; a pricing anomaly is accepted only under 1% of that fund's today's-basis, main-class-equivalent shares of the company. A larger anomaly fails, even if the reference factor is also invalid. `latest-corrections.json` carries fund, accession, company, filed shares/value, implied and actual closes, candidates, chosen and book factors, normalized ratio, class and acceptance verdict. Only book-forming accessions supply evidence. Known-at rows remain a separate coverage figure; late filings are in `late-funds.json`. |
| 5. Ownership outliers | Every percentage above 100% is in `percent-outliers.json` with its denominator evidence and reason. |
| 6. Legacy comparison | For the same period, report app `fund_holdings` value/companies beside the standard value/companies and the app's declared fund-quarter value. Documentation only. |
| 7. Database load | Batches are at most 500, table counts equal the artifacts, and 2,000 deterministic random rows read back identical. |
| 8. Dates, timing and breadth | The target is zero unresolved accessions. Any residual source gap must have an explicit reason and stay excluded; `unresolvedComplete=false` is never hidden and no date is invented. `absence-summary.json` records every absent fund-period by row kind with its reason and value. `coverage` reports both row kinds, including `not_yet_known`. `holder-drops.json` has the ten largest one-period holder drops and per-fund reasons. `breadth-evidence.json` reports each period's spread of `breadthChange` and its descriptive Pearson correlation with `(sharesBought − sharesSold) / sharesOutstanding`; this is not a signal evaluation. |

A build with checks 1–4 or 8 failing is marked `failed` and cannot be loaded. Checks 5 and 6 are disclosure gates, not a
reason to delete outliers or mix the legacy data into the standard series.

## 7. Batched research-database load

`load-mysql.mts` accepts only `provisional`. It first verifies the build status, exact lab code commit, table columns,
row counts and artifact SHA256 hashes. It refuses to replace any final build. With `--replace`, only the four K16 tables
are truncated and rebuilt; there is no schema change in `alpha_engine` and no production write.

K16.4's migration is limited to the provisional research table: it adds `rowKind`, `continuingFunds`, `entries`, `exits`
and `breadthChange`, removes the old `newFunds`/`exitedFunds` fields, and includes `rowKind` in the company-quarter
identity. The migration runs only after the provisional replacement has been authorized and cleared, never against a
final build or an `alpha_engine` table.

The loader streams JSONL rather than holding the position table in memory. Each insert of at most 500 rows is its own
autocommitted statement, avoiding a single multi-million-row rollback. Counts are checked after insertion, then 100
filings, 1,700 positions and 200 company quarters are selected by a fixed seed and compared column by column with the
artifacts. JSON objects are compared by recursively sorted keys, with array order preserved: MySQL may return a JSON
object's keys in a different order without changing its content. Only after all 2,000 rows match is the build row
written, with the code commit, input hashes, gate results and table counts. A failure before that row leaves the
partial tables unmarked by a build; `--replace` clears them for the corrected rerun. `load-report.json` is the final
load evidence.

## 8. Running and recovery

Run from the main repository so the research connection reads its configured environment without printing it:

```powershell
npx tsx scripts/build-fund-books.mts
npx tsx --test C:\dev\alpha-engine-lab\src\thirteenf\model.test.mts
npx tsx C:\dev\alpha-engine-lab\src\thirteenf\build.mts
npx tsx C:\dev\alpha-engine-lab\src\thirteenf\load-mysql.mts D:\research\alpha-engine\fund-books\std k16.4 provisional --replace
```

Commit the lab code before building: `build.json` and `std_13f_builds` must name the exact code commit, and the loader
refuses an uncommitted-code mismatch. A later code fix requires a new build and load, not a hand-edited artifact.

The D: drive can disconnect and remount. A missing or unreadable archive is not an empty cache. Stop; do not initialize
an alternate C: cache or redownload completed filings. Atomic filing-detail checkpoints are reusable only when their
schema, reader and raw/cover hashes match. `.tmp` files are not completion evidence. After remount, verify the archive
and raw-cache realpaths, free space, representative hashes and active process list, then resume the same command. The
complete artifacts replace their predecessors only after the build finishes; the database build row is written only
after all load checks pass. A failed load leaves no build row and is replaced only after the cause is fixed. Preserve
failed reports and the last verified checkpoint in the handoff.

On Windows, stopping a shell wrapper may leave nested `node` loaders alive. Inspect the actual matching process tree,
stop only the verified stale loader processes, and confirm both zero matching processes and no writer database session
before replacement. Never kill unrelated Node or web-server processes. Check `std_13f_builds` independently: its missing
build row proves that a stopped load did not finish. Avoid expensive full-table counts of a knowingly partial load when
this marker and the process/session evidence are sufficient.

## 9. Current evidence

The fund-book rebuild read 7,221 cached filings (two re-read, 7,219 reused), covering 6,509 fund-quarters. Its latest
full quarter, 2026-06-30, has 307 funds and 493 companies, $60.57tn filed and $43.47tn covered. Standard prices p1.1 has
2,891,701 bars; final fundamentals v3.1 has 1,664,739 values. The standard build's gate and table counts are taken from
`std\gates.json`, `std\build.json` and `std\load-report.json`, not inferred from these input totals.

Build `k16.4` at lab commit `c42bcae` has 7,221 filings, 2,393,709 positions and 24,600 company-quarter rows across
`deadline` and `plus_10`. Unit counts and the three unresolved unit cases match the fund-book manifest, and zero
positions lack a split factor. The pre-load gates report:

- Cover totals: 6,665 agree, 46 thousandfold, 199 row-count differences, 193 value differences, 116 cover-only and two
  partial tables, exactly matching the manifest. Ten random raw re-reads have zero mismatches.
- Price levels after normalizing by each position's own factor: $614,805,156,746,334 of $624,725,547,067,065 priced
  value is within 2%, **98.412040%**. Unpriced value is $301,089,711,931 (0.04817% of all position value), kept outside
  the denominator. The largest-first exception file has 79,889 priced and 8,150 unpriced rows. The lower share than
  K16.2 is retained honestly: generic split products no longer repair positions for companies without those splits.
- Full-book corrections: four fund-company differences have five book-forming position rows. The position classes are
  one basis, zero valuation differences, three books errors and one accepted pricing anomaly; zero are unclassified or
  rejected. Four rows flag an invalid reference-book aggregate factor, including the small Arista anomaly whose primary
  class is pricing anomaly. All four fund-company differences are explained, not silently reconciled.
- Latest availability: `deadline` at 2026-08-17 has 301/307 books (98.0456%); `plus_10` at 2026-08-31 has all 307
  (100%). Sixteen later filings remain separately listed.
- Ownership: 187 above-100% rows across the two row kinds have reasons. Another 191 raw filed counts below 1,000,000
  shares are excluded with null percentages and filed evidence, rather than used as denominators.
- Legacy comparison: the app has 370 companies and $17,199,558,833,123 held against $32,126,221,264,865 declared;
  the standard series has 493 companies and $43,465,564,787,623 covered against $60,574,814,607,781 filed.
- Date resolution used 190 cached submissions lists and 53 cached dated pages, resolved 618 accessions from recent
  lists and 78 from dated pages, and made **zero new requests** on the final build. The first dated-page backfill made
  53 requests, each selected by signed date and below five requests per second. Five residual SEC metadata gaps remain
  explicitly excluded (`unresolvedComplete=false`), with exact page evidence in `unresolved-date-evidence.json`; no
  filing or acceptance date is invented.

Every correction row is shown below (fewer than ten per class); full numeric evidence is in `latest-corrections.json`.

| Class | Count | Fund / accession | Company / CUSIP | Filed shares | Chosen factor; candidates | Normalized ratio | Verdict |
|---|---:|---|---|---:|---|---:|---|
| `basis` | 1 | 1632972 / 000121465926008573 | Amphenol / 032095101 | 526,268 | 1; {1, 2} | 1.005631505 | Accepted basis; reference factor 2 |
| `books_error` | 3 | 2057170 / 000205717026000021 | Arista / 040413205 | 1,016,076 | 1; {1} | 0.999999989 | Accepted; reference aggregate factor is not a company candidate |
| `books_error` | 3 | 310051 / 000119312526342342 | DuPont / 26614N102 | 90,557 | 1; {1} | 0.999617817 | Accepted; reference factor about 1/3 is not a company candidate |
| `books_error` | 3 | 1456670 / 000091228226001061 | Amcor / G0250X107 | 110,626 | 1; {1} | 0.999999979 | Accepted; reference factor about 1/5 is not a company candidate |
| `pricing_anomaly` | 1 | 2057170 / 000205717026000021 | Arista / 040413106 | 1,369 | 1; {1} | 1.652401738 | Accepted anomaly: 0.134553% of the fund-company shares; `no_split_factor`, not a generic 4-for-1 |

There are no valuation-difference or unclassified rows. The Arista anomaly retains the period factor 1; the large
Arista position is separately classified from it. Regressions prove that an invalid reference factor cannot make a
pricing anomaly at or above 1% acceptable, and that uniqueness is measured against the original filed-price ratio.
The anomaly fraction applies both the position's split-basis factor and its share-class factor, exactly as the company
aggregation does.

### Absence and holder drops

The 498 absence records across both row kinds total $26,306,611,051,124 of book value. Every record carries a reason;
late records include sessions (or calendar days when the session is outside the calendar) and availableFrom. The 18
`not_filed` records are prior books with no current-period filing, not unresolved EDGAR metadata.

| Reason | Fund-periods | Value |
|---|---:|---:|
| `late` | 459 | $26,185,925,077,748 |
| `not_filed` | 18 | $0 (prior-book reason, not metadata failure) |
| `cover_page_only` | 16 | $0 |
| `unresolved_unit` | 5 | $120,685,973,376 |

The five accessions still absent from SEC metadata have exact page evidence in `unresolved-date-evidence.json`:
JPMorgan 2021-02-11 (`CIK0000019617-submissions-043.json`), 2022-02-10 (`...-037.json`), 2024-05-10 (`...-017.json`);
Goldman Sachs 2023-11-14 (`CIK0000886982-submissions-011.json`); Morgan Stanley 2024-08-16
(`CIK0000895421-submissions-011.json`). Their original cover metadata is preserved, but no filing date is inferred.

The ten largest one-period holder drops are below. Reason counts are included per affected fund, with the previous
period's value. `position_no_longer_reported` means the fund has a current book but not that company; it is not a
missing-date explanation.

| Period / kind | Company | Holder drop | Reason counts |
|---|---|---:|---|
| 2026-06-30 / plus_10 | CCL | 211 | 212 position_no_longer_reported |
| 2026-06-30 / deadline | CCL | 207 | 206 position_no_longer_reported; 2 late |
| 2026-03-31 / plus_10 | AMCR | 155 | 153 position_no_longer_reported; 1 unresolved; 1 cover_page_only; 1 unresolved_unit |
| 2026-03-31 / deadline | AMCR | 149 | 146 position_no_longer_reported; 3 late; 1 unresolved; 1 cover_page_only |
| 2024-09-30 / plus_10 | SMCI | 33 | 40 position_no_longer_reported; 1 unresolved; 2 late |
| 2024-09-30 / plus_10 | LRCX | 32 | 34 position_no_longer_reported; 1 unresolved; 2 late |
| 2024-09-30 / deadline | SMCI | 28 | 36 position_no_longer_reported; 8 late; 1 unresolved |
| 2024-09-30 / deadline | LRCX | 26 | 31 position_no_longer_reported; 7 late; 1 unresolved |
| 2022-09-30 / deadline | NKE | 24 | 17 late; 11 position_no_longer_reported |
| 2022-09-30 / deadline | BLK | 24 | 17 late; 10 position_no_longer_reported |

The first CCL drop therefore cannot be blamed on unresolved metadata: all 212 fund-level explanations are positions no
longer reported. Full reason and value detail is in `holder-drops.json`; all absence records are in `absence-summary.json`.

### Breadth evidence

At 2026-06-30, 493 companies have a breadth reading. The deadline spread is min −0.705263, median 0.003509, max
0.098246; plus_10 is min −0.704082, median 0.003401, max 0.095238. Correlation with net shares bought divided by
shares outstanding is **0.463022** at deadline and **0.459571** at plus_10 (474 observations each). Across periods
with at least 20 observations, the lowest correlation is −0.092793 for 2025-03-31/deadline and the highest is
0.786792 for 2021-06-30/plus_10. These are descriptive correlations, not a predictive or alpha claim.

Lam Research now uses factor 1 for both reviewed post-split positions. In particular, accession 000093041324003070 has
16,081,071 filed shares and 16,081,071 today's-basis shares, rather than the reviewed K16.2 result of 160,810,710 after
an erroneous factor 10. The implied price is $72.860010 against the $81.61 today's-basis period close, a 0.892783 ratio
whose nearest company candidate is 1. Aggregate ownership is:

| Period / row kind | K16.2 ownership | K16.3 ownership | K16.4 ownership |
|---|---|---|---|
| 2023-09-30 / deadline | 55.914303% | 55.914303% | 56.201068% |
| 2023-09-30 / plus_10 | — | — | 58.179799% |
| 2024-09-30 / deadline | 49.854553% | 49.846493% | 55.761094% |
| 2024-09-30 / plus_10 | — | — | 56.330033% |

The aggregate change after better date coverage is distinct from the factor correction: the 16,081,071-share position
still uses factor 1. Earlier K16.1 ownership figures were 559.143028% and 483.380925%. Evidence files are
`lam-k16.1-before.json`, `lam-k16.2-after.json`, `lam-k16.3-after.json` and `lam-k16.4-after.json`.

Chipotle 2022-03-31 is excluded by the raw-count denominator check. Frozen v3.1 contains exactly 27,962 shares filed
2022-04-28 through `d0:sharesBasic` (about 27,960, rather than the adjacent quarter's 28,031,948). Applying factor 50
would produce 1,398,100, but the raw 27,962 is below the floor. `sharesOutstanding`, `percentOfSharesOutstanding` and
`percentAbove100` are consequently null; this is an exposed input erratum, not a 41,704% ownership observation.

The complete ownership list is `percent-outliers.json`. Its ten largest rows are all Bloom Energy, with the same
10,570,841-share v3.1 denominator. They remain visible for class-scope and possible fund-duplication review; no split
factor or replacement denominator is used to make them look reasonable.

| Period / row kind | Institutional shares | Ownership | Largest fund's ownership |
|---|---:|---:|---:|
| 2023-06-30 / plus_10 | 89,745,433 | 848.990473% | 224.370994% |
| 2023-06-30 / deadline | 86,917,251 | 822.235913% | 224.370994% |
| 2022-12-31 / plus_10 | 77,569,608 | 733.807348% | 189.202051% |
| 2022-12-31 / deadline | 76,294,340 | 721.743331% | 189.202051% |
| 2023-03-31 / plus_10 | 74,357,853 | 703.424193% | 196.708455% |
| 2023-03-31 / deadline | 73,599,381 | 696.249059% | 196.708455% |
| 2022-09-30 / plus_10 | 72,070,616 | 681.786965% | 195.946141% |
| 2021-12-31 / plus_10 | 66,551,086 | 629.572292% | 195.228014% |
| 2021-12-31 / deadline | 64,890,671 | 613.864791% | 195.228014% |
| 2022-03-31 / plus_10 | 64,753,144 | 612.563787% | 203.063881% |

Artifact SHA256 values before the database load:

- `build.json`: `5ccbccb3663da1dd69810299b008bbf49db2856437bf8e103644887038397806`
- `latest-corrections.json`: `e9657e8839abcd6b8520d6d1b188f78af230960d68bb9bf3917ec8397f800554`
- `filings.jsonl`: `56c89ac83f51b1a3ecf1a3391550f7436a798e5bdadce20f2ae009651dca04dd`
- `positions.jsonl`: `0f40a18c933101c76695de8d427d53937fefdabbb09a4ada89aff89a5884d01f`
- `company-quarters.jsonl`: `415da6c5278a5c7e11ae2c081763a8267bb286ded18d03e16420b1f56d5c0751`
- `lam-k16.4-after.json`: `94f9295a82b62c17dcf07d4b01b28587bd4705fa5b191bc43c133f0b896b4c02`
- `percent-outliers.json`: `af81e45db910dce28e7ec3c06b2dd930138aa0859afb87b5c388dfe8191f9e56`
- `denominator-exclusions.json`: `55f7d11ed26005d7d7823248874fecf8ef3dc908a02f9cec31d2e0a49c2470ac`
- `absence-summary.json`: `f44e3fa39a0151a00c9044c7e9dddfaa5776f9afe228bc39f09dbd442b6f60e0`
- `holder-drops.json`: `8c88cd7ccb1afe4ebc0ba6378b3db4dfd44e343a1f1174ba1e1a908bfccadb46`
- `breadth-evidence.json`: `1b9f70f72bb19f5ebe3b59b48c04654dc672cfb3b18bccf8eb59846cd5e2d519`
- `unresolved-date-evidence.json`: `25e5d920be879865de69714d554af134d4e8e09915d309e9d374cc1e2ed25290`


`load-report.json` confirms the provisional load completed at **2026-11-13 23:16:24** with 7,221 filings,
2,393,709 positions and 24,600 company quarters. It inserted 2,425,530 data rows in batches of at most 500 and read
back 2,000 rows using seed 1601 with zero mismatches. The single `std_13f_builds` row is provisional and names exact
code commit `c42bcae45d73ba0cb398e101d11d5d8372ad8a81`.

An independent read-only post-check repeated the three table counts and build-row checks, verified that every stored
row is `k16.4`, and compared another 2,000 rows (100 filings, 1,700 positions and 200 company quarters) against the
artifacts using seed **1603**. It found **zero mismatches**. It confirmed the new breadth fields, removal of
newFunds/exitedFunds, the `(cik,period,rowKind,knownAt)` identity, 12,082 deadline rows and 12,518 plus_10 rows.
Lam's 16,081,071-share factor-1 position and all four ownership rows, Chipotle's two null percentage rows, all 187
above-100% rows and the top ten Bloom Energy rows match. CCL's 2026-06/plus_10 drop from 215 to 4 holders and both
latest correlations (0.4630218338977116 and 0.4595707267896085) were independently recomputed from stored rows.
Evidence: `independent-postcheck.json`.

- `load-report.json` SHA256: `20f5410db55307dbab6545a34551d21ab11a393c73484844a03593beedafb1c6`
- `independent-postcheck.json` SHA256: `3a0b698643dc03915be27f4d04c13e72fdb363fd3dc6f93bb7180d1b7864d279`
