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
SEC transaction dates may carry an explicit offset such as `2015-11-23-05:00`; normalization preserves the filed
calendar date instead of treating it as missing. This prevents false source gaps and dateless economic groups.

An accession's original filing and raw evidence are never rewritten to agree with a later index. If another daily
index gives the same accession a different form, filing date, index CIK, or path, the verified cached filing remains
unchanged and `indexDiscrepancies` records both identities. The later daily index has no XML hash, so that value is
explicitly null rather than inferred. If an archive CIK listed in the daily index is unavailable, the collector tries
only the other archive CIKs actually listed for that accession and records every attempt plus a verified archive pointer.

Raw and normalized writes are atomic. Per-accession checkpoints preserve completed work, while the full manifest is
saved at day boundaries. This avoids rewriting a multi-megabyte manifest for every cached filing during a resume.

## 2. XML/bulk reconciliation

For accessions present in both the quarterly dataset and the reviewed local XML cache, `insider-merge.mts` matches
within each accession and derivative/non-derivative table on transaction date, code, acquired/disposed, shares, price,
and shares owned after. Numeric fields must agree within half a cent, with `1e-6` additional float slack. A unique
source-missing value can be filled without guessing among alternatives. Lines that also agree on their descriptive
fields are `pairedTwin` matches in document order.

If a bulk group and XML group are equal multisets on those economic fields but differ in descriptive text, the whole
group is `pairedGroup`: both ID sets are recorded and the XML lines remain exactly as filed, including their own
`natureOfOwnership`. No bulk-SK-to-XML-line attribution is made. Thus the three NVDA annuity-trust lines retain their
three distinct XML descriptions. Count or economic-value mismatches stay ambiguous, with the bulk rows, XML evidence,
and reason listed rather than assigned by nearest distance or document order.

XML supplies full-precision filed values. The primary bulk source hash remains the filing identity hash, and the XML
source URL and hash are retained as additional evidence. The build records every `pairedGroup` and `pairedTwin` and
all source differences.

The legacy-cache acceptance check independently rereads every cached XML accession and compares issuer, form, filing
date, owners, transaction count, and the same economic groups. Descriptive text is compared as group multisets rather
than being attributed to a different bulk line. Source-only fills, whitespace, ordering, and numeric precision are
classified separately from substantive differences. Cache items whose actual XML issuer is outside the registry are
listed, not treated as missing in-scope filings.

The rounding gate is absolute: `|bulk − XML| <= 0.005 + 1e-6` is bulk rounding regardless of transaction-relative
size. The full-precision XML value is kept. `nearZeroPrice` remains an informational class, not a failure or waived
`sourceConflict`. A difference beyond half a cent fails and cannot become a rounded match. The previous pinned
15-case exception and relative-transaction-value gate are retired; final QA requires zero failures beyond half a cent
and no unresolved ambiguity or unexplained substantive cache mismatch.

## 3. Availability and amendments

`availableFrom` is derived only from filing evidence and the standard-price session calendar:

- with an actual SEC acceptance timestamp, the first session whose 09:30 ET open follows acceptance; an acceptance
  before that day's open may use the same session;
- with only a filing date, the next session after that date;
- if the calendar does not yet contain a valid session, null with `availability_beyond_calendar`, never an invented
  future session.

An available session never falls on a Saturday or Sunday, even if the supplied price-session list contains a false
weekend date. The next weekday session is used; this does not modify the price standard.

Amendments remain separate filings with independent acceptance and availability. An amendment is linked by its explicit
reference when present, otherwise by a unique same-issuer original filing date. Missing, ambiguous, and out-of-scope
originals are flagged. An amendment does not rewrite the original row or its historical availability. QA lists real
amendment examples and rejects any `availableFrom` earlier than `filingDate`.

## 4. Owners, persons, and filed transaction lines

`issuerCik` is the registry join key. `filedIssuerCik` preserves the issuer CIK exactly as filed on every filing, owner
and transaction line, including predecessor identities. Owner groups are formed on the registry issuer so they remain
continuous through a reorganization. One filed issuer cannot be assigned to two registry companies; shared successors
remain explicitly listed rather than duplicated.

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

`finalizeInsiderQa` requires complete downloads or the explicitly recorded source gap, zero accession conflicts, the
Sequoia group check, no PIT violations, at least three amendment examples, a clean legacy-cache comparison, exact 2025
coverage, zero rounding failures beyond half a cent, and no unresolved reconciliation conflict.

`load-insiders.mts` accepts only a passed artifact whose build version and recorded artifact code match. The loader's
commit is recorded separately in `inputs.loaderCodeCommit`. It verifies all table schemas and SHA256 hashes, stages each
table in batches of at most 500 rows, checks counts, and reads back 500 complete rows per data table (2,000 total). JSON
objects are compared by recursively sorted keys with array order preserved, because MySQL may reorder object keys without
changing their values. Only then is the single provisional build row written and the five-table atomic swap performed.
Existing live data is not replaced before those checks pass. A final build refuses replacement.

The database build row stores compact provenance rather than the full multi-hundred-megabyte evidence arrays. It keeps
source gaps, paired-group identities, acceptance counts, and SHA256 references to the complete D: artifacts in
`inputs.evidenceHashes`. An explicit `--resume-staged` run may reuse a failed run's staging rows, but it still verifies
artifact hashes, every table count, an empty staging build table, and all 2,000 complete sampled rows before writing
the new build row and swapping. A mismatch prevents the swap; no resume is attempted implicitly.

`--resume-partial` handles a stopped partial table explicitly. It verifies every existing staged ID against the same
artifact's prefix and inserts only the remainder, never truncating or skipping unverified rows. `--artifact-code`
identifies the builder when loader code has changed; the loader's own commit is retained separately. Full counts, the
2,000-row read-back, positive filed-issuer checks and atomic swap remain mandatory.

`verify-insiders-load.mts` independently checks live counts, unique identities, 2,000 full rows with a different seed,
availability, duplicate counts, positive `filedIssuerCik`, weekend availability, XOM recovery, exactly one provisional
build, and absence of `_next`/`_old` tables.

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

## 8. Current evidence — provisional build loaded and independently verified

The owner authorized one retry and, if the same filing still failed, a build that records that exact gap. The retry
finished at `2026-11-16T01:21:16Z`. Accession `0001999371-26-023092` (filing date 2026-10-19) returned HTTP 404 from
all three listed archive index URLs (CIKs 1672013, 1687273 and 1687274). Earlier bounded attempts returned 503 on
2026-11-15, first at `00:48:11Z` and across the listed aliases by `00:55:22Z`; the full-submission document also
returned 503. The SEC no longer serves the filing through any listed archive. No cached XML or placeholder row exists.
The partial manifest retains every 404 URL and the UTC checkpoint. Its SHA256 is
`37a14bdd4252ab6035e9e798d2f5b70fdee24b5802df8dbbb73d48c3eb18546e`.

The accepted artifact is `D:\research\alpha-engine\insiders\std\20261116T123010Z`, version `i1.20261114`, built at lab
commit `8ed6650cb4129928631d0c4ffbe3a97ccb3e602a`. Counts are **735,721 filings, 754,154 owner rows, 1,906,883
filed transaction lines, 24,399 persons, and 501 companies**. One company (XOM, CIK 2115436) has no filings. There
are **141,476 linked duplicate trades**, zero accession conflicts, zero PIT violations, three real amendment examples,
and the required Sequoia ten-owner/one-group case. `inputs.edgar.status` and `gates.checks.downloads.status` are
`complete_with_recorded_gap`; `manifestStatus` remains `partial`, `unexpectedErrors=[]`, and the missing-filing evidence
is stored in both inputs and gates. All 83 quarterly sources and 3,291 available post-quarter filings passed hash checks.

Source acquisition used 80 quarterly ZIP downloads and three verified cache reuses. The initial complete post-quarter
pass used 42 daily indexes, one quarter-directory index, 13,876 filing indexes, 13,875 ownership XML documents and
13,875 acceptance headers (41,626 filing XML/metadata requests), with 2,405 cached reuses. The final authorized retry
used 14 daily indexes and three filing indexes, with 16,281 cached reuses and zero XML/header downloads. Its three
404 archive attempts are preserved.

The reviewed group and rounding rules now pass:

- **169 `pairedGroup` groups and 173,412 `pairedTwin` lines**. The actual NVDA accession keeps all four named-trust
  XML rows with their own descriptions and both ID sets, with no per-line attribution.
- **77,216 bulk/XML numeric differences, zero failures beyond `0.005 + 1e-6`**. Maximum absolute difference is
  `0.005000002682209015`; all four near-zero price cases remain informational. Fractional-share relative size does not
  create a false conflict.
- SEC offset dates such as `2015-11-23-05:00` retain their calendar date. A full scan of 177,876 cached transaction
  dates has zero unsupported values.

Independent acceptance is green:

- Legacy cache: **55,510/55,510 in-scope accessions matched**, zero substantive mismatches, zero precision-only
  filings, zero missing and zero read errors. Another 638 accessions are explicitly outside the registry. Order-only
  changes total 16,787, source whitespace 218 and source fills 1,253.
- The 2025 comparison covers ten companies and **2,495 accessions**, with zero missing or extra. Final verification
  used **zero new requests and ten cache reuses**. The 26 out-of-range pages remain listed as skipped evidence.
- Annual P/S price agreement within 10% is 27,421 / 27,548 (**99.5390%**) for 2025 and 24,240 / 24,397
  (**99.3565%**) for 2026. The complete annual P/S breakdown is in `gates.json`; 4,388 rows are listed in
  `price-outliers.jsonl`, including zero/negative prices and unavailable closes without repair.
- XML/bulk fills leave zero missing transaction dates. The 146 remaining unknown owner names are listed by accession,
  issuer and owner identity in `build.json`, not silently filled.

The provisional load used an explicit `--resume-staged` because all four table hashes were identical to the fully
staged artifact. Counts and all 2,000 complete staged read-backs passed before the build row and atomic swap. The
compact build row is **110,288 bytes of inputs and 524,505 bytes of gates**, with full-artifact SHA256 references and
the withdrawn accession present in both metadata locations. Only the build row was inserted on resume; the complete
staging run used batches of at most 500.

Independent live verification at `2026-11-16T13:28:18.098Z`, seed `20261114`, confirmed exact table counts and unique
identities, **2,000 complete rows with zero mismatches**, one provisional build, zero availability violations,
141,476 duplicate trades, and no `_next`/`_old` tables. Lab `e93f0d5` changes only the independent verifier's SQL
alias from reserved `rows` to `rowCount`; it does not change the data or artifact.

Final hashes: build `9580b46849e5b1daab86db65a114cd7e0859ff049104edf08c64783fdf7cb5db`; gates
`bc4e39c0f61a7f3db48417860366df561c4ba17f76aed1a72a332786f9af7e42`; legacy cache
`4f48a692bd1e91d3ff2c4fd973ecf4f941f4bc3be19c5a2e60adaeef12733544`; 2025 coverage
`5493325f6365e9df54fecb06688a9d8e29ca296b075a3b4737535b4d2d540e1f`; load summary
`bd017aaf7a9d54331473c9e5b22b7822a5fdec20f7c0ae14494f05beaba84ec0`; independent live check
`d51d04b0161c1ea2181a0aa99b237f712865fc72bf37d08cb5929fcfb7e38710`.

Verification: **7 insider test files / 65 tests** and standalone TypeScript pass. Main `npm run check`, its full test
suite, and `npm run build` passed during this work. The lab is clean and has no remote. The load is **provisional until
Claude's final review**, which also needs the flagged-value filters and one unflagged Alphabet purchase line
(2017-02-02, owner CIK 1695879, 7,371,008 shares, $6.02bn) noted in handoff section 185. No production or app-database
write, model promotion, alpha-signal claim, or scheduler change occurred. K23 was delivered separately. The i1.1
successor work in section 9 precedes K12.


## 9. Consumer rules and the i1.1 review

**Rules for consumers.** For every dollar-denominated measure, exclude transaction lines flagged `price_outlier` or
`equity_swap`. In the provisional i1 evidence, 293 flagged sale lines account for 2.1424e16 USD of the 2.1426e16 USD
raw sale total; summing the unfiltered field is not meaningful. The same filtering applies to purchases. Treat flagged
amendment lines carefully: an amendment is separately available evidence, not permission to rewrite the original or to
count both as independent economic activity. Use `duplicateOf`/`duplicateLineId` to select the earliest available copy
when a strategy requires unique economic trades.

The following suspicious but unflagged rows require source review, not an automatic exclusion rule:

| Issuer | Owner CIK | Transaction date | Shares | Reported value | Disposition |
| --- | ---: | --- | ---: | ---: | --- |
| Alphabet (CIK 1652044) | 1695879 | 2017-02-02 | 7,371,008 | approximately $6.02bn | Listed for filing-level review; no automatic repair or exclusion |

Following Claude's review, i1 remains provisional. The successor build, **i1.1**, must derive predecessor issuer CIKs
from raw `SUBMISSION` and `REPORTINGOWNER` evidence, preserve `issuerCik` as the registry join key, and add
`filedIssuerCik` to filings, owners and transaction lines. Owner groups continue through a reorganization. Every
changeover must have a gap of at most six months, XOM must have recovered filings, and any remaining first-filing gap
must have a documented reason. A parallel old-CIK filing history is evaluated at the actual changeover, not truncated.
Independent acceptance and staged loading remain mandatory; i1.1 is not final until Claude reviews it.

**Open p1 price-standard defect, not changed by K20.** `2007-01-06` is a Saturday but appears in the standard sessions
(the only weekend date among 9,285 sessions). `daily/1800.csv` line 1764 carries a Schwab row repeating Friday
`2007-01-05`; `320193.csv` has an empty row. Insider availability must exclude weekend sessions and use the next weekday
instead. The price standard itself requires a separate owner-approved revision; no insider task changes price rows.


## 10. i1.1 artifact and acceptance — 2026-11-16

The accepted **i1.1.20261116** artifact is `D:\research\alpha-engine\insiders\std\20261116T163802Z`, built at lab
commit `76efac29ef42b81d771619f64c5a56f5b372ceda`. It contains **762,354 filings, 781,860 owner rows, 2,052,812
filed transaction lines, 24,877 persons, and all 501 companies**. There are no companies without filings, no accession
conflicts, and **155,453 linked duplicate trades**. Its build and acceptance status is `built`, with
`gates.stage=ready_for_staged_load`; this is not a final-status claim.

The predecessor audit is `D:\research\alpha-engine\insiders\predecessors\20261116T154006Z\predecessors.json`, SHA256
`36dbc85e66887f1011c24a5475917d9bae4856d121b50bdbd479b86ac4aff1c9`. It examines raw `SUBMISSION` and
`REPORTINGOWNER` data for all 501 registry companies. **29 predecessor mappings**, all 16 companies named in Claude's
review, zero collisions and zero unresolved late histories pass the gate. The selection contains 501 current CIKs plus
29 filed CIKs. Each mapping includes the symbol, shared owners, actual last old-CIK filing, and the changeover used to
enforce the six-month limit. GOOGL retains the parallel old-CIK history through 2026-07-14 while measuring the 2015
transition correctly. SKYD uses the separately documented Paramount transaction (nine shared owners, a 35-day gap, and
the filed 2025-08-07 acquisition 8-K); it is not inferred from a ticker match. CRH, IVZ, NXPI, ENLT and the earlier FERG
interval have explicit 20-F/name-change/no-match evidence instead of invented CIKs. The shared FOX/NWSA predecessor is
not assigned to either successor, because neither has continuous prices across that transition.

An independent comparison with i1 found **26,633 added filings, 27,706 owner rows, 145,929 transaction lines and 478
persons**, with **zero removed accessions and zero form/filing-date identity changes**. Exactly those 26,633 filings
have a different `filedIssuerCik` from the registry join key. XOM now has **1,680 filings** under registry CIK 2115436
and filed CIK 34088. The comparison is `i1-comparison.json`, SHA256
`bdec2f56161e05987eb8d8ba3d36924df36c1e1b2134bc2dd7083f257ee7498b`.

All **387** former `2007-01-06` Saturday availability values now use Monday `2007-01-08`; there are zero other
availability changes and zero weekend dates. The independent comparison found zero unexpected availability changes.
The false price session remains an open p1 defect for the owner's separate price-revision decision; no price row was
changed by this work.

Acceptance also confirms:

- **169 pairedGroup groups / 173,412 pairedTwin lines**, **77,216 numeric differences and zero rounding failures**;
  the maximum difference is `0.005000002682209015`, with four informational near-zero-price cases and zero unresolved
  conflicts.
- Legacy cache **55,510/55,510 matched**, zero missing, read errors or substantive/precision mismatches. There are
  638 outside-registry rows, 16,787 order-only changes, 218 whitespace differences and 1,253 source fills.
- Ten-company 2025 coverage is **2,753/2,753 accessions**, with zero missing or extra. Three uncached SEC submissions
  requests were used and ten responses reused. The 30-request cap was not exceeded.
- Zero point-in-time violations, zero weekend availability rows, three amendment examples with their original rows,
  and zero missing transaction dates. **151 unknown owner names** remain explicitly listed rather than inferred.
- The withdrawn accession `0001999371-26-023092` remains recorded with its 503-then-404 source history and no
  placeholder row. The cached resume preserved all three 404 attempts without another filing request.
- All 83 quarterly sources were reused with zero ZIP downloads. EDGAR has 3,291 in-scope post-quarter filings, with
  zero XML or acceptance-header downloads on resume.

Artifact hashes: build `f1b7b35cfdaa820629763a805b30305bff9c06756e9996a60976360dc3d070c8`; gates
`fffdab99e8b1e8bab042a1dcda4563be48d0c652447316d5a9f318ad3325a08d`; legacy cache
`360a5cdcd6ae1e0e7679e278c16b0b7716edc5a5c69c708b0ada103ef99a34a0`; 2025 coverage
`f0d305adc44fb36fc6840f1a92ed42e751e9f217b3fae541751216356b6a1576`.

Verification: **9 insider test files / 83 tests** and standalone TypeScript passed. Main `npm run check`,
**259 files / 1,446 tests**, and `npm run build` passed. The per-company raw spool and cached weekday calendar avoid
re-reading every quarter per company and re-sorting 9,285 sessions per filing. The two stopped partial builds are
preserved; no acceptance or live replacement occurred from them. A representative 1,239-filing normalization retained
2,987 lines and the same serialized size while taking 71 ms after calendar memoization.

The provisional staged load and its independent live verification are reported below. **i1.1 remains provisional
pending Claude's review, even after a successful provisional load.**


## 11. G1 — predecessor identity and traded-line guardrails

Claude's review (`20261116-200416-claude-i11-review.md`) found that CIK 919567 is **RENN Fund, Inc.**, not Texas
Pacific Land. Its raw `ISSUERNAME` is `RENN Fund, Inc.` and its dominant symbol is RCG on 99.798% of raw filings; a
single shared owner and two TPL-symbol filings were insufficient evidence. The earlier i1.1 TPL lines must not be used.
Claude's subsequent price-continuity review also rejected CDW 899171: the old equity was taken private, whereas the
registry company's standard prices begin at the new listing on 2013-06-27. Its earlier pre-IPO insider rows are not part
of the current traded line. A prospectus documenting a business transition is not sufficient to join different securities.

Every predecessor mapping now requires:
- a dominant old-issuer trading symbol that is a registry-company symbol on at least **90%** of raw filings, unless a
  documented corporate transition exists;
- a matching normalized issuer name or documentary source when fewer than three owners are shared, or when the old CIK
  continues filing in parallel;
- at least **60 actual standard-price sessions for that registry company** before the first new-CIK filing. XOM's old CIK
  remains active, so its reference is the latest old-CIK filing. Weekend dates are excluded. The builder independently
  recomputes every count from `std_prices` and rejects stale supplied evidence;
- explicit rejected-candidate evidence, including the reason and measured continuity, rather than silent removal.

The retained weak mappings have explicit evidence: Texas Pacific Land Trust/Corporation names normalize to the same name;
Alphabet's 2015-10-02 8-K12B names Alphabet as Google's successor issuer; XOM has a documented predecessor hint. FOX
1308161 remains unmapped because it belongs to a different traded line. The accepted lineage is
`D:\research\alpha-engine\insiders\predecessors\20261116T223012Z\predecessors.json`, SHA256
`3c90d7120a677b0b53f34bda3020ea1497571ad8f762c0f7cfba94c60d6abf57`: **27 mappings**, zero collisions, zero
unresolved late histories and **1,680 XOM filings**. CDW is its sole price-continuity rejection, with zero prior sessions;
TPL 97517 has 815. Raw quarter, registry, audit and documentary-evidence hashes are unchanged from the preceding audit.

The failed intermediate lineage `20261116T222201Z` used the union of all companies' sessions, retained CDW and was
rejected before building or loading. This failure is preserved for audit. Earlier candidates `20261116T212155Z` and
`20261116T215316Z` were likewise not loaded. The current builder is lab commit
`8c2a2606c8db34663a5617733157e630a959463a`. Its explicit `--cached-source-links` option avoids refreshing SEC metadata;
all 83 raw ZIPs were reused and EDGAR reused its XML/header files. The first registry-lineage mismatch stopped before
model writes; normalization then established the corrected source registry before rebuilding.

## 12. Corrected artifact and scoped comparison — 2026-11-16

The artifact is `D:\research\alpha-engine\insiders\std\20261116T223552Z`, **i1.1.20261116**, with `status=built` and
`gates.stage=ready_for_staged_load`. It contains **760,667 filings, 780,157 owner rows, 2,045,254 transaction lines,
24,846 persons and all 501 companies**, with zero companies without filings and **153,923 duplicate trades**. Build SHA256
`7a215c5ec6433535e79d837e3d6aff75268fe1eeee2584e7c028d653e50c5eb7`; gates SHA256
`3009d02fe34904274743d01d139ec030e490744b267d91ac155f4e654ce93912`.

The comparison with `20261116T163802Z` is `g1-comparison.json`, SHA256
`773a743fe9fe8256872e9a64670845b436bedb354bb262976ee1267b82ca12b4`. It proves:
- TPL removes exactly **1,589 RENN filings, 1,591 owner rows and 7,230 transaction lines**. CDW removes exactly **98
  filings, 112 owner rows and 328 transaction lines** filed under 899171.
- No row filed under 919567 or 899171 remains anywhere in the new filings, owners or transactions. Filing, owner and
  transaction rows outside TPL/CDW are exactly identical.
- TPL has 6,728 shared lines and CDW 1,629; missing/unexpected lines, unexplained field differences, duplicate changes
  and owner-group violations are all zero. Only 57 false `ambiguous_original_date` flags disappeared at TPL.
- Exactly 1,703 rejected owner rows were removed from the old person histories and the remainder reaggregated. The new
  artifact matches that computation for every person: **24,807 unchanged, 31 removed, 39 changed and zero unexplained**.
  Shared people retain their genuine roles at other companies.

Legacy XML/cache acceptance is **55,510/55,510**, zero substantive or precision mismatches; its SHA256 is
`c11a678a99969a378f607fbc16f0ca16d52b2b77b8c391376bee64f54fa22e95`. The ten-company 2025 check used **zero new
requests and 12 cached responses**, with zero missing/extra accessions; SHA256
`c8c5fea062d4b9017320ca6963089a8eb682e7c521e9d5de85e41ea61cd5d06a`. The withdrawn accession retains its three 404
archive attempts. All nine insider suites (**91 tests**) and standalone TypeScript pass; main TypeScript, **260 files /
1,449 tests**, and the production build pass. The provisional load, independent live verification and Claude's review
are recorded in section 13, together with Claude's acceptance and the final live evidence.

Reproduction sequence:

```powershell
npx tsx C:/dev/alpha-engine-lab/src/insiders/predecessor-discovery.mts --out D:/research/alpha-engine/insiders/predecessors/20261116T223012Z
npx tsx C:/dev/alpha-engine-lab/src/insiders/sec-bulk.mts --cached-source-links --predecessor-map D:/research/alpha-engine/insiders/predecessors/20261116T223012Z/predecessors.json
npx tsx C:/dev/alpha-engine-lab/src/insiders/edgar-insiders.mts --since 2026-10-01 --until 2026-11-13 --predecessor-map D:/research/alpha-engine/insiders/predecessors/20261116T223012Z/predecessors.json
npx tsx C:/dev/alpha-engine-lab/src/insiders/build-insiders.mts --out D:/research/alpha-engine/insiders/std/20261116T223552Z --build-version i1.1.20261116 --predecessor-map D:/research/alpha-engine/insiders/predecessors/20261116T223012Z/predecessors.json --allow-missing-accession 0001999371-26-023092
npx tsx C:/dev/alpha-engine-lab/src/insiders/insider-acceptance.mts cache D:/research/alpha-engine/insiders/std/20261116T223552Z
npx tsx C:/dev/alpha-engine-lab/src/insiders/insider-acceptance.mts coverage2025 D:/research/alpha-engine/insiders/std/20261116T223552Z
npx tsx C:/dev/alpha-engine-lab/src/insiders/insider-acceptance.mts finalize D:/research/alpha-engine/insiders/std/20261116T223552Z
npx tsx worker/.runs/k20-g1-compare.mts D:/research/alpha-engine/insiders/std/20261116T163802Z D:/research/alpha-engine/insiders/std/20261116T223552Z
```

## 13. Final acceptance and live evidence — 2026-11-17

Claude accepted artifact `20261116T223552Z` in `20261116-231625-claude-i11-accepted.md`, conditional on the staged
load and independent live check matching it. Those conditions are now met: **3,610,925 rows** were inserted in batches
of at most 500, the five-table swap completed, and the old staging tables were removed. The load checked **2,000 complete
rows with zero mismatches**. `load-summary.json` SHA256 is
`5d48d9d207c531c232c9bedbb00a665978fd09cb71966469f0bc6a034313a02e`.

The independent live check has a different sampling seed and also checked 2,000 complete rows with zero mismatches.
It confirms the exact counts above, zero availability violations, zero weekend availability, zero missing/invalid filed
issuer CIKs, 1,680 recovered XOM filings, 153,923 duplicate trades and no `_next`/`_old` tables. Its verified timestamp is
`2026-11-17T02:11:39.493Z`; SHA256 is `f6aa886f746c3416e8344eddb38fa37626740a6b4ec343bba6234641890c63b6`.

The single local research build row was then changed transactionally from `provisional` to **final**, after checking its
builder, source directory, counts and every stored table hash against the accepted artifact. Finalization timestamp
`2026-11-17T02:14:36.722Z`; `finalization.json` SHA256
`5a0425500c7a2add7e13aef867ad2da90cb7192ec81022ce25b71e0f11e7cd8a`. This is a local research-data status change,
not a production write or model/factor promotion.

Claude also corrected the earlier owner-group attribution: on TPL's 6,223 lines shared with i1, the **17-group partition
is unchanged**. One group was legitimately relabelled through Trust 97517 history, covering 5,917 lines; the other nine
label changes are AVGO. RENN did not cause those group changes. RENN's actual effects were the 7,230 removed lines and
57 false ambiguity flags. Handoff section 193 carries this correction to section 190.

The false p1 price session 2007-01-06 and TPL's price coverage beginning only on 2017-10-13 remain separate
owner-decision issues. K20 changed no price rows, production data, app database, scheduler or model settings.
