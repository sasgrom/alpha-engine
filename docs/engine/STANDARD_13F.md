# Standard 13F — point-in-time institutional holdings

K16 builds standard institutional holdings from the fund books, not from the app's legacy `fund_holdings` table.
The research tables are provisional until Claude accepts them. Nothing here changes app pages, signals, production,
`alpha_engine` data, or the legacy table.

- **Code:** `C:\dev\alpha-engine-lab\src\thirteenf\` in the lab repository.
- **Inputs:** `D:\research\alpha-engine\fund-books\`, standard prices p1.1, and final standard fundamentals v3.1.
- **Artifacts:** `D:\research\alpha-engine\fund-books\std\` (build `k16.2`).
- **Tables:** `alpha_research.std_13f_filings`, `std_13f_positions`, `std_13f_company_quarters`, `std_13f_builds`.
- **Unit tests:** fifteen deterministic `node:test` cases in `src/thirteenf/model.test.mts`.

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
positionFactor = snap((value / sharesFiled) / (splitAdjustedClose(p) × classFactor))
sharesToday = sharesFiled × positionFactor
mainClassSharesToday = sharesToday × classFactor
```

`positionFactor` is snapped only to products of plausible split ratios. A match is labeled `filed_price`; an unclean
ratio keeps the period-end split factor and is labeled `assumed_period_end`. When that factor is 1, the label is
`no_split_factor`, not a newly derived split. A zero or unusable price also uses the period-end factor with the
`assumed_period_end` label. A filing already on the new basis therefore gets factor 1, not another split multiplier.
The filed-basis columns remain the historical evidence. Company aggregates use main-class-equivalent shares for
comparability across CUSIPs; options remain outside holders and shares held.

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

A company-quarter row means **as known at the first trading session after the filing deadline**. The deadline is the
period end + 45 calendar days, moved to the next session when that day is a weekend or holiday; `knownAt` is the
session after that deadline. For 2026-06-30, the deadline is Friday 2026-08-14 and `knownAt` is Monday 2026-08-17.
`availableFrom` is the first standard-price trading session strictly after the EDGAR filing date, and a filing enters
only when `availableFrom <= knownAt`. Acceptance time is supplementary evidence; it does not replace that date rule.
A period whose session calendar has not reached `knownAt` is deferred as `not_yet_known`, never assigned an invented
future session.

The merger runs independently for each `knownAt`. A later amendment cannot enter that row or replace the original
filing retrospectively. A filing without a verified date or next session is excluded rather than assigned an assumed
availability day. A later task may add a later `knownAt`; it must not update an existing row.

Each row contains holders, filed-basis and today's-basis main-class shares, covered value, the ten largest holders'
share, new/exited funds, continuing-fund shares bought/sold, and flow-exclusion counts. `fundsFiled` is the number of
usable books available by this `knownAt`; `fundsInBook` is the number in the complete period book. `coverage` is their
ratio, so the denominator cannot be confused with the previous quarter's fund count.

### Shares outstanding

The denominator is final v3.1 `sharesBasic`, selecting the latest quarter not after the period and the latest version
filed by `knownAt`. Its count is returned to today's share basis, so a filing after a split already uses the new basis:

```text
sharesOutstanding(today) = sharesBasic × splitIndex(today) / splitIndex(filed)
percentOfSharesOutstanding = 100 × mainClassSharesToday / sharesOutstanding(today)
```

A cover-derived count below 1,000,000 shares is not a credible consolidated denominator for this 500-company universe.
Those cases leave the percentage null and are listed with their filed source and basis factor in
`denominator-exclusions.json`; they are not presented as ownership above 100%. Missing denominators also leave the
percentage null. Values above 100% remain visible with the count, filing provenance,
largest-holder percentage and a reason: issued rather than outstanding shares (notably Boeing and Tyler), one-class or
one-listing denominators, or an unresolved possible fund double-count. No denominator is substituted to make the
percentage look reasonable.

### Trading versus reporting changes

New and exited funds are counted separately and are not treated as continuing-fund purchases or sales. Continuing-fund
flows use split- and class-corrected shares at each period's own `knownAt`. The following are excluded and listed in
`flow-exclusions.jsonl`, with per-company reason counts in the table:

- a reporting change identified by the existing `reportingChange` guard (mass moves, absorbed accounts, partial books);
- a manager whose aggregate book crosses the $100 million reporting threshold from below; a single large stock purchase
  by an already reportable manager is **not** excluded;
- a recent listing, using the standard-price first date within 183 days;
- an evidenced predecessor/successor conversion and a CUSIP-only share-class conversion with no net position change.

## 5. Filing dates and the only permitted network path

`alpha_engine.fund_quarters` is read-only and supplies filing dates already known there. For other accessions,
`dates.mts` reads `data.sec.gov/submissions/CIK##########.json` only:

- at most one request per missing fund per run, with no hidden retry;
- serialized requests at least 210 ms apart, below five requests a second;
- the same declared User-Agent as the existing EDGAR collectors;
- successful answers and their hashes cached in `D:\research\alpha-engine\fund-books\submissions\`;
- no older-file pagination and no other endpoint.

The cached submissions list supplies `filingDate` and `acceptanceDateTime` when the accession is present. Anything
still unresolved is listed and excluded from company-quarter aggregation. Request URLs, statuses, cache hits and
unresolved accessions are recorded in `build.json`; credentials and request headers are never logged.

## 6. Acceptance gates

| Check | Rule and evidence |
|---|---|
| 1. Cover totals | Every filing receives the books' totals verdict. Counts must match the rebuilt manifest; differences retain their reasons. |
| 2. Raw re-read | Ten deterministic random filings are re-read from raw XML and cover pages. Positions, shares, values, option shares and cover fields must match. |
| 3. Price levels | `(value ÷ filed shares) ÷ (splitAdjustedClose × classFactor × positionFactor)` must be within 2% for at least 98% of **priced** position value. Unpriced value is reported separately with its share of the total and reason; it neither passes nor fails the gate. Every exception is in `price-outliers.jsonl`, largest values first for review. |
| 4. Latest-book tie and corrections | For 2026-06-30, the **full-book** holders, today's-basis shares and value per company should equal the quarter file. A difference is accepted when (a) the chosen factor puts filed price within 2% of our close and the book's factor does not, or (b) no split factor fits and the position is under 1% of that fund's shares of the company, retained at factor 1 and labeled as a pricing anomaly. `latest-corrections.json` carries fund, accession, company, filed shares/value, implied and actual closes, chosen and book factors, and the verdict. Known-at rows remain a separate coverage figure; late filings are in `late-funds.json`. |
| 5. Ownership outliers | Every percentage above 100% is in `percent-outliers.json` with its denominator evidence and reason. |
| 6. Legacy comparison | For the same period, report app `fund_holdings` value/companies beside the standard value/companies and the app's declared fund-quarter value. Documentation only. |
| 7. Database load | Batches are at most 500, table counts equal the artifacts, and 2,000 deterministic random rows read back identical. |

A build with checks 1–4 failing is marked `failed` and cannot be loaded. Checks 5 and 6 are disclosure gates, not a
reason to delete outliers or mix the legacy data into the standard series.

## 7. Batched research-database load

`load-mysql.mts` accepts only `provisional`. It first verifies the build status, exact lab code commit, table columns,
row counts and artifact SHA256 hashes. It refuses to replace any final build. With `--replace`, only the four K16 tables
are truncated and rebuilt; there is no schema change in `alpha_engine` and no production write.

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
npx tsx C:\dev\alpha-engine-lab\src\thirteenf\load-mysql.mts D:\research\alpha-engine\fund-books\std k16.2 provisional --replace
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

## 9. Current evidence

The fund-book rebuild read 7,221 cached filings (two re-read, 7,219 reused), covering 6,509 fund-quarters. Its latest
full quarter, 2026-06-30, has 307 funds and 493 companies, $60.57tn filed and $43.47tn covered. Standard prices p1.1 has
2,891,701 bars; final fundamentals v3.1 has 1,664,739 values. The standard build's gate and table counts are taken from
`std\gates.json`, `std\build.json` and `std\load-report.json`, not inferred from these input totals.

Build `k16.2` at lab commit `142c6ea` has 7,221 filings, 2,393,709 positions and 12,077 company-quarter rows.
Unit counts and the three unresolved unit cases match the fund-book manifest, and zero positions lack a split factor.
The pre-load gates report:

- Cover totals: 6,665 agree, 46 thousandfold, 199 row-count differences, 193 value differences, 116 cover-only and two
  partial tables, exactly matching the manifest. Ten random raw re-reads have zero mismatches.
- Price levels after normalizing by each position's own factor: $615,013,526,601,123 of $624,725,547,067,065 priced
  value is within 2%, **98.445394%**. Unpriced value is $301,089,711,931 (0.04817% of all position value), kept outside
  the denominator. The largest-first exception file has 79,149 priced and 8,150 unpriced rows.
- Full-book corrections: all 14 differences have accession-level evidence and are accepted as basis corrections or
  explicitly bounded pricing anomalies. One Arista position (1,369 shares, 0.13% of its fund-company total) fits no
  split product, remains at factor 1 and is labeled `no_split_factor`; it is not miscalled a split or rounding.
  At `knownAt=2026-08-17`, 301/307 books (98.0456%) are available; 16 later filings are separately listed.
- Ownership: 94 above-100% rows have reasons. Another 91 cover-derived counts below 1,000,000 shares are excluded
  with null percentages and filed evidence, rather than used as denominators. Lam Research illustrates the correction:
  2023-09 ownership is 55.9143% rather than 559.1430%, and 2024-09 is 49.8546% rather than 483.3809%.
- Legacy comparison: the app has 370 companies and $17,199,558,833,123 held against $32,126,221,264,865 declared;
  the standard series has 493 companies and $43,465,564,787,623 covered against $60,574,814,607,781 filed.
- Date resolution used 190 cached submissions lists, resolved 618 accessions, and left 83 unresolved for lack of a
  verified date. The final build made zero new EDGAR requests.

`load-report.json` confirms the batched load completed at 2026-11-13 18:25:29 with 7,221 filings, 2,393,709
positions, 12,077 company quarters and 2,000 random rows read back with zero mismatches. The provisional build row is
present with code commit `142c6ea152bcb714bc3b83cff5ac8403a116855f`.
