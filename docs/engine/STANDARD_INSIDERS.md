# Standard insiders — point-in-time Forms 3, 4 and 5

K20 builds a research dataset directly from SEC evidence for every positive issuer CIK in the standard-price registry.
The research tables are provisional until Claude accepts them. The build does not change the app's insider tables,
`alpha_engine`, production, scheduled jobs, or any signal or model.

- **Code:** `C:\dev\alpha-engine-lab\src\insiders\` in the lab repository.
- **Bulk evidence:** `D:\research\alpha-engine\insiders\sec-345\`.
- **Post-quarter EDGAR evidence:** `D:\research\alpha-engine\insiders\edgar\`.
- **Read-only overlap evidence:** the existing Form 4 XML cache at `worker\cache\edgar-form4\`; its C: path resolves to D:.
- **Prices:** read-only `alpha_research.std_prices` and `std_price_companies`.
- **Tables:** `alpha_research.std_insider_filings`, `std_insider_owners`, `std_insider_transactions`,
  `std_insider_persons`, and `std_insider_builds`.

Negative pseudo-CIKs used internally for option share classes are not SEC issuer CIKs and are excluded explicitly.
The registry hash covers only sorted positive integer issuer CIKs.

## 1. Immutable SEC sources

`sec-bulk.mts` reads the SEC Insider Transactions Data Sets from 2006 Q1 through 2026 Q3. Each quarterly ZIP is
downloaded once, sequentially and no faster than one request per second, using the project's EDGAR client. The raw ZIP,
source URL, byte count, SHA256, parser commit, registry hash, row counts, and normalized-output hash are retained.
The parser streams the SEC's quoted TSV tables rather than assuming newline-free fields. It uses the actual
`SUBMISSION`, `REPORTINGOWNER`, `NONDERIV_TRANS`, `DERIV_TRANS`, and `FOOTNOTES` keys and retains only Forms 3, 4,
5 and their amendments whose issuer belongs to the registry. Raw archives retain the full SEC files.

`edgar-insiders.mts` extends coverage after the bulk cutoff through the daily form indexes. It handles dashed and
compact accessions, resolves the actual ownership XML filename from each filing's index, and stores the XML and SEC
acceptance header with hashes. Network requests are serialized at no more than five per second. A cached normalized
filing is reusable only after its normalized artifact, raw XML, and acceptance header match their recorded hashes.

An accession's original filing and raw evidence are never rewritten to agree with a later index. If another daily
index gives the same accession a different form, filing date, index CIK, or path, the verified cached filing remains
unchanged and `indexDiscrepancies` records both identities. The later daily index has no XML hash, so that value is
explicitly null rather than inferred. If an archive CIK listed in the daily index is unavailable, the collector tries
only the other archive CIKs actually listed for that accession and records every attempt plus a verified archive pointer.

Raw and normalized writes are atomic. Per-accession checkpoints preserve completed work, while the full manifest is
saved at day boundaries. This avoids rewriting a multi-megabyte manifest for every cached filing during a resume.

## 2. XML/bulk reconciliation

For accessions present in both the quarterly dataset and the reviewed local XML cache, `insider-merge.mts` matches
filed transaction lines globally with a one-to-one minimum-cost assignment. Ambiguous non-identical assignments are
refused and listed. XML supplies full-precision filed values; bulk fields fill XML gaps where appropriate. Neither
side's conflict evidence is discarded. The primary bulk source hash remains the filing identity hash, and the XML
source URL and hash are retained as additional evidence.

The legacy-cache acceptance check independently rereads every cached XML accession and compares issuer, form, filing
date, owners, transaction count, codes, dates, shares, prices, ownership, and security fields. Source-only fills,
whitespace, ordering, and numeric precision are classified separately from substantive differences. Cache items whose
actual XML issuer is outside the registry are listed, not treated as missing in-scope filings.

Bulk rounding is not silently repaired. The pinned review exception consists of exactly 15 failures: four
`nearZeroPrice` cases and eleven `sourceConflict` cases. Their sorted accession/line/field/bulk/XML identity hash must
be `5c7d464099a1674f5c87055fcd227790b9180b309ccc12235898e56b7eb01d9f`. All 15 remain reported as
`rounding_gate_failed`; the threshold is unchanged. The exact acceptance note is:

```text
accepted: 4 near-zero prices, 11 XML-precedence conflicts flagged
```

A changed value, an additional failure, or an unrelated conflict invalidates that exception. The eleven source
conflicts remain subject to Claude's review before a final build.

## 3. Availability and amendments

`availableFrom` is derived only from filing evidence and the standard-price session calendar:

- with an actual SEC acceptance timestamp, the first session whose 09:30 ET open follows acceptance; an acceptance
  before that day's open may use the same session;
- with only a filing date, the next session after that date;
- if the calendar does not yet contain a valid session, null with `availability_beyond_calendar`, never an invented
  future session.

Amendments remain separate filings with independent acceptance and availability. An amendment is linked by its explicit
reference when present, otherwise by a unique same-issuer original filing date. Missing, ambiguous, and out-of-scope
originals are flagged. An amendment does not rewrite the original row or its historical availability. QA lists real
amendment examples and rejects any `availableFrom` earlier than `filingDate`.

## 4. Owners, persons, and filed transaction lines

Owners appearing together for an issuer form connected components. `ownerGroups` counts components rather than
counting every affiliated co-filer as an independent insider. The Sequoia/DoorDash accession
`0001062993-22-007354` is a required ten-owner/one-group case, and the 20 largest groups retain their member lists.

Every filed transaction line remains present, including mechanical transactions and lines with missing source fields.
Only P and S are `discretionary`. Duplicate economic trades are linked only within the same issuer and owner group,
with the same transaction date, code, shares, and price. `duplicateOf` and `duplicateLineId` select the earliest
available copy, with deterministic accession/line tie-breaking; the later filed lines are not deleted.

`std_insider_persons` indexes each known reporting-owner CIK across companies. It retains all observed names, first
and last filing dates, issuer CIKs, and dated director/officer/10%-owner/other roles. This is an identity and filing
history, not a performance claim.

The SEC `AFF10B5ONE` value takes precedence when present. Otherwise a footnote mentioning 10b5-1 sets the plan flag
with `planSource=footnote`. Absence of that evidence is not represented as a new dataset flag.

## 5. Prices and quality flags

Filed shares and prices are preserved. Standard as-traded close and `splitIndex` supply independent checks:

```text
priceRatio = filedPrice / asTradedClose(transactionDate)
sharesToday = sharesFiled * latestSplitIndex / splitIndex(transactionDate)
valueUsd = sharesFiled * filedPrice
```

The ratio is computed only for discretionary rows with positive filed and closing prices. A ratio outside 0.5–2 is
flagged `price_outlier`; zero and negative discretionary prices receive separate flags and are never repaired. Missing
prices, closes, transaction dates, and split indices remain null with explicit flags. A filing more than two standard
sessions after its transaction is flagged `late` and becomes available only from its own filing evidence.

QA reports P and S coverage and the share within 10% of the close by transaction year, with outliers listed largest
value first. `price-outliers.jsonl` includes the owners, source values, ratio, and flags. The five largest positive-value
purchases and sales per year are retained for Claude's sanity review; this is not an alpha-signal evaluation.

## 6. Acceptance and load

The builder requires all 83 complete quarterly manifests, post-quarter EDGAR coverage through the latest standard-price
session, matching registry/parser lineage, and verified raw and normalized hashes. Accession duplicates are collapsed by
identity, but filed-content or evidence conflicts remain visible and block final QA.

The normal requirement is a complete EDGAR manifest with zero errors. Only an explicit owner-authorized
`--allow-missing-accession <accession>` can waive a source failure. Every manifest error must then match a declared
accession, the manifest remains `partial`, and `inputs.edgar.missingFilings` plus `gates.checks.downloads.missingFilings`
retain the complete error and archive-attempt evidence. The status is `complete_with_recorded_gap`, never `complete`.
An undeclared or additional error still fails the build. If the source recovers, the same option produces an ordinary
complete build with no missing-filing record.

In addition to the complete legacy-cache comparison, `insider-acceptance.mts coverage2025` selects ten companies and
compares every 2025 Form 3/4/5 accession with EDGAR's submissions lists. It downloads only `filings.files` pages whose
SEC-declared ranges overlap 2025; an unknown range is included rather than risking omission, and skipped ranges remain
listed. It may make at most 30 uncached requests. Responses and hashes are cached under
`D:\research\alpha-engine\insiders\submissions-2025\`. Missing and extra accessions remain listed; neither side is
silently treated as complete. The legacy comparator tries exact filed values before rounded matches so order changes
do not become false precision differences.

`finalizeInsiderQa` requires complete downloads, zero accession conflicts, the Sequoia group check, no PIT violations,
at least three amendment examples, a clean legacy-cache comparison, exact 2025 coverage, and either a clean merge or
the exact pinned exception above.

`load-insiders.mts` accepts only a passed artifact whose build version and lab commit match. It verifies all table
schemas and SHA256 hashes, stages each table in batches of at most 500 rows, checks counts, and reads back 500 complete
rows per data table (2,000 total). Only then is the single provisional build row written and the five-table atomic
swap performed. Existing live data is not replaced before those checks pass. A final build refuses replacement.

`verify-insiders-load.mts` independently checks live counts, unique identities, 2,000 full rows with a different seed,
availability, duplicate counts, exactly one provisional build, and absence of `_next`/`_old` tables.

Run from the main repository so the research connection reads its configured environment without printing it:

```powershell
npx tsx C:\dev\alpha-engine-lab\src\insiders\edgar-insiders.mts --since 2026-10-01 --until 2026-11-13
npx tsx C:\dev\alpha-engine-lab\src\insiders\build-insiders.mts --build-version i1.20261114
npx tsx C:\dev\alpha-engine-lab\src\insiders\insider-acceptance.mts cache <D: build dir>
npx tsx C:\dev\alpha-engine-lab\src\insiders\insider-acceptance.mts coverage2025 <D: build dir>
npx tsx C:\dev\alpha-engine-lab\src\insiders\insider-acceptance.mts finalize <D: build dir>
npx tsx C:\dev\alpha-engine-lab\src\insiders\load-insiders.mts <D: build dir> i1.20261114
npx tsx C:\dev\alpha-engine-lab\src\insiders\verify-insiders-load.mts <D: build dir> i1.20261114
```

## 7. Recovery and boundaries

A disconnected D: drive is an infrastructure failure, not an empty cache. Stop collection, preserve atomic checkpoints,
and never initialize a replacement cache on C:. After remount, verify realpaths, free space, representative hashes, and
the actual process list before resuming the same source directory. `.tmp` files are not completion evidence. Preserve
failed manifests and load reports alongside successful evidence.

On Windows, stopping a shell wrapper can leave nested Node processes alive. Inspect command lines and stop only verified
stale matching processes; never kill unrelated collectors, engines, or web servers. Confirm no writer remains before a
bounded resume. The lab has no remote; main receives only the documentation delivery through ordinary fast-forward.

No daily insider scheduling, app-page integration, production transport, engine reading, cluster strategy, track-record
claim, or model promotion is part of K20. Those require separate review and owner approval.

## 8. Current evidence — full build with one source gap, QA awaiting matcher review

The owner authorized one retry and, if the same filing still failed, a build that records that exact gap. The retry
finished at `2026-11-16T01:21:16Z`. Accession `0001999371-26-023092` (filing date 2026-10-19) returned HTTP 404 from
all three listed archive index URLs (CIKs 1672013, 1687273 and 1687274). Earlier bounded attempts returned 503 on
2026-11-15, first at `00:48:11Z` and across the listed aliases by `00:55:22Z`; the full-submission document also
returned 503. The SEC no longer serves the filing through any listed archive. No cached XML or placeholder row exists.
The partial manifest retains every 404 URL and the UTC checkpoint. Its SHA256 is
`37a14bdd4252ab6035e9e798d2f5b70fdee24b5802df8dbbb73d48c3eb18546e`.

The full artifact is `D:\research\alpha-engine\insiders\std\20261116T012540Z`, version `i1.20261114`, built at lab
commit `c4267c284286083d2445c0d0b0dc18fb5da21ef6`. The exact command was:

```powershell
npx tsx C:\dev\alpha-engine-lab\src\insiders\build-insiders.mts --build-version i1.20261114 --out D:\research\alpha-engine\insiders\std\20261116T012540Z --allow-missing-accession 0001999371-26-023092
```

Its counts are **735,721 filings, 754,154 owner rows, 1,906,883 filed transaction lines, 24,399 persons, and 501
companies**. One company (XOM, CIK 2115436) has no filings. There are 141,468 linked duplicate trades, zero accession
conflicts, zero PIT violations, three real amendment examples, and the required Sequoia ten-owner/one-group case.
`inputs.edgar.status` and `gates.checks.downloads.status` are `complete_with_recorded_gap`; `manifestStatus` remains
`partial`, `unexpectedErrors=[]`, and the missing-filing evidence is stored in both inputs and gates. All 83 quarterly
sources and 3,291 available post-quarter filings passed their hash checks.

Passing independent checks:

- The 2025 comparison covers ten companies and **2,495 accessions**, with zero missing or extra. It used two new
  requests and eight cache reuses after lab `97bc55e` limited older-page downloads to SEC-declared ranges overlapping
  2025. The 26 out-of-range pages remain listed as skipped evidence.
- Annual P/S price agreement within 10% is 27,421 / 27,548 (**99.5390%**) for 2025 and 24,240 / 24,397
  (**99.3565%**) for 2026. The complete annual P/S breakdown is in `gates.json`; 4,388 rows are listed in
  `price-outliers.jsonl`, including zero/negative prices and unavailable closes without repair.
- XML/bulk fills leave zero missing transaction dates. The 146 remaining unknown owner names are listed by accession,
  issuer and owner identity in `build.json`, not silently filled.

Final QA is **`qa_failed`; no staged load or live verification was attempted**. The independent findings are:

- Legacy cache: 55,510 in-scope accessions, 55,484 matched, **14 substantive mismatch filings and 12 precision-only
  filings**, zero missing and zero read errors. Another 638 accessions are explicitly outside the registry. Lab
  `5545a9b` removed one false precision report by trying exact filed values before rounded matches; all remaining 12
  precision-only filings are in the ambiguous-match set.
- The global matcher retains **136 ambiguous lines across 55 accessions**. For example, accession
  `0001045810-16-000214` has three economically identical bulk lines with blank ownership descriptions, while XML
  names three different trusts. Assigning those descriptions by order would invent attribution, so the rows remain
  unresolved.
- There are **353 rounding-gate failures**: four `nearZeroPrice` and 349 `sourceConflict`. All 15 previously reviewed
  cases remain, with 338 additional cases exposed by the newer matcher. Their identity hash is
  `95d24a250ac97f74c56b311fe6ea3c919fe938c63bcc1a70ca0ffbfdcc1db735`; thresholds have not changed and the old
  15-case exception was not applied.

Final artifact hashes: build `3d3113973c743fca017db8c81459e75b4d347d0fb2f40a49888dc842a69fb812`; gates
`04720d38f8478e34887a8bcb801bdddd7ca0dc6937d772fd869ddf363352ccd8`; legacy cache
`9011645ff2b07a081528da659e528a3da01e2fdd2891b87ecc62319dad6a4d72`; 2025 coverage
`f110981bded475d2f58dadcc06bd67d3480301acac926a6efabf4edda434cae7`. Per-table JSONL hashes are in `build.json`.

Verification: **7 insider test files / 59 tests** and standalone TypeScript pass. Main `npm run check`, its full test
suite, and `npm run build` passed during this work. The lab is clean at `5545a9b` and has no remote. Claude has the
build and all failure evidence for review. After that review, any load requires a fresh build at the final code commit,
all acceptance gates, a provisional staged load and independent verification. No production or app-database write,
model promotion, alpha-signal claim, or scheduler change occurred.
