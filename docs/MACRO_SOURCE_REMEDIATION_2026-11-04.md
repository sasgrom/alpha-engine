# Reviewed macro source remediation — 2026-11-04

## 1. Scope and outcome

- Baseline: `2c69c453c705f9d3e46137ed038e0091ecdcf1e3` (`Document completed macro vintage restoration`).
- Source commit, pushed by ordinary fast-forward: **`54d16fd523c9a928efae878f47cb72ae195ae092`** — `Remediate noncanonical macro vintages`.
- Evidence root, excluded from Git: `worker/.runs/macro-source-remediation-20261104T205424Z`.
- Result: **`verified_complete`** for the three findings in the partial verification: two noncanonical legacy rows were removed after proving their canonical replacements, and the extra BAML chunk was officially classified as `UNVERIFIED_OR_STALE_CHUNK` and quarantined without being used.
- Final `macro_points` count: **408,860**, exactly two fewer than the reviewed 408,862-row starting state. Canonical rows, values, dates, starts and `fetchedAt` of all other rows are unchanged.
- No full backfill, FRED `--group all`, SEC/13F/Statements/Atlas rebuild, F-15/F-16 work, schema/model/threshold/universe/protocol change, DFF substitution or production action occurred.

## 2. Backup and exact evidence

Before any mutation, a complete backup captured all **408,862 rows**:

- bytes: **85,308,483**;
- SHA256: `21bbff9dc427a94b9e28f83ff0a3253bf91a28273f5f27f8fb785a4292e03319`;
- exact table fingerprint: `ad14687c6161a8f0ffd518139f7ebce57c3e385d620ec8bf54e385514af2ef63`.

Eight archive/backup files were also preserved: the current FRED manifest, normalized BAMLH0A0HYM2, raw observations, vintage dates, metadata, first-vintage evidence and both disputed `2023-10-31` chunk files. Every copied backup was independently hashed. No UPDATE or DELETE occurred before these checks.

A final backup after remediation captured **408,860 rows**:

- bytes: **85,308,058**;
- SHA256: `a2e7a2e544cb9616c46cacb1bff0225dc2b6be2e2b0168f7db4d29f19b9bafc6`;
- fingerprint: `90e3311674808d19d5f43c43553baf5e3c3ca4a74ae229fe67c5e78721208aea`.

## 3. FEDFUNDS / CPIAUCSL exact-ID decisions

| Finding | Canonical proof in DB and normalized archive | Decision and reason |
|---|---|---|
| FEDFUNDS legacy id **47763**, observation `2026-09-01`, legacy start/end `2026-10-19`, value `3.75` | Canonical id **410405** has the same observation/value, `realtimeStart=2026-10-01`, `realtimeEnd=NULL`, exactly matching normalized `availableAt=2026-10-01` and `supersededAt=NULL` | **Delete only id 47763 as a noncanonical duplicate.** Do not edit canonical id 410405. No availability update was needed. |
| CPIAUCSL legacy id **47832**, observation `2026-09-01`, legacy start/end `2026-10-19`, value `336.298` | Canonical id **31824** has the same observation/value, `realtimeStart=2026-10-14`, `realtimeEnd=NULL`, exactly matching normalized evidence | **Delete only id 47832 as a noncanonical duplicate.** Do not change its start and do not create a duplicate key. Canonical id 31824 is preserved. |

If FEDFUNDS canonical evidence had been absent, the utility would have allowed only an exact-ID `realtimeStart=2026-10-01`, `realtimeEnd=NULL` update, without changing value, observation date or `fetchedAt`. This fallback was not used. A missing or mismatched CPI canonical row would have blocked the entire apply.

The dry-run produced exactly these two decisions with zero mismatches. Before apply, the complete guard passed: scheduler idle, no active macro job, one scheduler chain and web listener, MySQL SELECT 1 and local ingest. The saved plan fingerprint and backup fingerprint matched the current database.

## 4. BAML chunk classification and proof

The disputed local chunk has 45 observations and 44 vintage dates, with firstObservation/firstVintage `2023-10-31`. Its preserved hashes are:

- observations: `268e032856510ad9eb569be425a7f4eb17e0ed05fcde85824fce83bfbe0e414e`;
- vintage dates: `efa75cd10238198dbc3dcb50341d5fe84b5312fba3f19b3d5b7b9098630c52d1`.

Local source structure was checked: series metadata identifies `BAMLH0A0HYM2`, all 45 observation structures and realtime windows are valid, and there are no conflicting duplicate values or availability inversions. This local consistency alone was **not** used to accept the chunk.

A targeted read-only FRED/ALFRED verification used the existing client for metadata, observations and vintage dates for `2023-10-31…2023-12-31`, not a full collector. It returned:

| Evidence | Official response |
|---|---|
| Observations | **41** |
| Vintage dates | **40** |
| First observation / firstVintage | **2023-11-06 / 2023-11-06** |
| Observations SHA256 | `dbf5ad5c029d096eacc64f799a9a4291cabb61b27b253bd90b24e7a04a1ff9d5` |
| Vintage dates SHA256 | `c165be15ab5accd86a99000799bc83cf8577ec504b414684dfe641ed86bc180a` |
| Metadata SHA256 | `ed5f23e8ac17a4df0e3e71c010fc86fe577bd39d968db7b7e8de320a9756b532` |

The official response does **not** match the disputed 45/44 chunk. It exactly matches the existing `2023-11-06` chunk in both content and vintage dates. Therefore the classification is **`UNVERIFIED_OR_STALE_CHUNK`**, not `OFFICIAL_VALID_CHUNK`.

Consequences:

- the disputed file is preserved as quarantined evidence with its original hash;
- it is not included in normalized data and is not deleted;
- manifest and normalized data were not rewritten;
- current manifest firstVintage remains **2023-11-06**, with **1,711 observations** and **784 vintage dates**;
- no 1,715/788 manifest expansion was made because that would have accepted unverified content merely for matching counts.

The committed `scripts/verify-baml-chunk.mts` independently repeated the same targeted read-only verification and returned the same quarantine classification. Official response files were written only to new review paths, not over the original archive.

## 5. Transaction evidence and post-remediation checks

One committed transaction performed only these actions:

```text
DELETE noncanonical id 47763
DELETE noncanonical id 47832
```

Canonical ids **410405** and **31824** were locked and preserved. The transaction count is **1**, `deletedIds=[47763,47832]`, `updatedIds=[]`. Rollback-on-error is covered by regression tests.

Independent post-check returned **`verified_complete`**:

- before/after rows: **408,862 → 408,860**;
- exact deleted IDs: **47763 and 47832**, and no other deleted IDs;
- updated IDs and new IDs: **0**;
- unexpected changes: **0**;
- duplicate vintage groups: **0**;
- availability inversions: **0**;
- null realtime starts: **0**;
- selected-after-anchor: **0**;
- current eligible series: **8/8**;
- FEDFUNDS at anchor `2026-10-19` now selects canonical **410405**;
- CPIAUCSL at that anchor now selects canonical **31824**;
- removed legacy IDs are absent from the database.

BAML manifest, normalized and raw observation/vintage hashes are unchanged. The quarantined chunk is absent from normalized rows, while the official response exactly matches the current `2023-11-06` chunk. Macro QA completed **pass / 0 errors / 0 warnings** for **22 series** at `2026-11-04T21:14:19.918Z`.

## 6. Current and historical coverage

`latestMacro(asOf)` returns **all eight curated series** with eligible vintages. FEDFUNDS current selected id **410406** has observation `2026-10-01`, availability `2026-11-02`, open-ended end and value `3.88`. No neutral/current substitute was introduced.

A new frozen evaluation was required because exact-ID source rows changed. It used the unchanged protocol: `evaluateCompany` for AAPL 320193, NVDA 1045810 and MSFT 789019; `nestedEvaluate` for the same panel with bayes/logistic; `latestEligibleMacroPoint` and production `macroPriorAt`. Models, thresholds, pooling, universe and evaluation protocol were unchanged.

| Coverage | Result |
|---|---:|
| Anchors / checks | 485 / 1,455 |
| Eligible selections | **794** |
| Missing selections | **661** |
| Complete three-series anchors | **84** |
| Anchors with no eligible series | **97** |
| Anchors missing at least one series | **401** |
| Selected-after-anchor | **0** |
| Non-neutral prior anchors | **290** |

Per-series evaluated coverage: VIXCLS 388 eligible / 97 missing, BAMLH0A0HYM2 84 / 401, T10Y2Y 322 / 163. The additional quarantined BAML rows were not introduced into this history.

Macro prior distribution remains **0.50 × 195**, **0.54 × 189**, **0.42 × 31**, **0.47 × 66**, **0.39 × 4**. Current company-level prior remains **0.50**. Nested accuracy, up/down, baselines, cost, holdout, regime and pooling metrics are unchanged from the immediately preceding evaluation, with historical comparison only and no causal attribution.

The evaluation JSON was completely written, parsed and hashed before DB close. It completed in about 28 seconds with no timeout or second evaluation.

## 7. Guard and command integrity

- Guard before backup/FEDFUNDS collection: **pass**.
- Guard before exact-ID apply: **pass**.
- Guard after exact-ID apply: **pass**.
- No apply followed a failed guard, and no shell continuation bypassed a failed guard.
- No process was killed and scheduler state was not manually edited.
- No second exact-ID transaction or VIXCLS/BAMLH0A0HYM2 backfill was run.
- The targeted BAML verification is read-only and separate from a full collector; it never modified manifest or normalized data.

## 8. Tests, build and evidence hashes

Targeted verification passed **6 files / 39 tests**, including canonical delete decisions, availability-only fallback, rollback, duplicate prevention, repeated-apply rejection, BAML exact-content classification, stale firstVintage rejection and availability-inversion rejection. TypeScript passed.

Full source gates passed: **123 files / 706 tests**, `npm run check`, `npm run build` with established chunk-size warnings and `git diff --check`. Documentation gates are run separately before the evidence commit and their actual results are retained.

Core hashes:

- pre-remediation backup: `21bbff9dc427a94b9e28f83ff0a3253bf91a28273f5f27f8fb785a4292e03319`;
- final backup: `a2e7a2e544cb9616c46cacb1bff0225dc2b6be2e2b0168f7db4d29f19b9bafc6`;
- disputed BAML observations: `268e032856510ad9eb569be425a7f4eb17e0ed05fcde85824fce83bfbe0e414e`;
- disputed BAML vintage dates: `efa75cd10238198dbc3dcb50341d5fe84b5312fba3f19b3d5b7b9098630c52d1`;
- official BAML observations: `dbf5ad5c029d096eacc64f799a9a4291cabb61b27b253bd90b24e7a04a1ff9d5`;
- official BAML vintage dates: `c165be15ab5accd86a99000799bc83cf8577ec504b414684dfe641ed86bc180a`;
- evaluation JSON: 688,033 bytes, SHA256 `97eb8a0c0bc2616ac63af34ca99e951d60ef971353b5d7dc0357fa98246bf33f`;
- evaluation Markdown: 3,740 bytes, SHA256 `9a784ca35042802e5ad606878954a78b99119db75087977510de4cf18b1ea6e5`.

The evidence index covers complete backups, exact-ID rows, archive backups, official targeted responses, BAML chunks, guard logs, dry-run/apply, post-verification, evaluation, source/docs gates and Project State before/after. Its final verification records actual checked counts and mismatches without rewriting original evidence.

## 9. Remaining limitations and next safe block

The three discrepancies are resolved. Remaining limitations are research coverage limits, not open source-remediation defects:

- only **84 of 485** evaluated anchors have complete three-series evidence;
- official archive begins in 2000, VIX starts in 2010, T10Y2Y starts in 2014 and HY OAS has a short official history;
- the quarantined BAML chunk is not accepted as current official evidence, so it is not used to fill that history.

The next reviewed block is **Statements netDebt/ROE/ROA historical rebuild/evaluation**, then F-15/F-16, Atlas coverage from documented exposure and production/security findings. Those rebuilds were not started in this block.
