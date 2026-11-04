# Macro vintage-data remediation and probability reevaluation — 2026-11-04

## 1. Scope, baseline and outcome

- Reviewed baseline: `07727f497a013bd93e62a2546461b7683a8da179` (`Merge pooled model data strategy`). Local `39f7fc6` was four commits behind; the four incoming commits were read and the branch was fast-forwarded without rebase, reset or stash.
- Source commit, pushed by ordinary fast-forward: **`991f0462db7861ddf08df508ed0ed2ae74fda8d6`** — `Add macro vintage remediation adapter`.
- Scope: eight curated legacy `macro_points` series, normalized official FRED/ALFRED evidence, one targeted VIXCLS collection, one reviewed backfill and one frozen probability evaluation.
- Actual result: **partial remediation**. Two of eight series were restored with **85,480 new rows**; five series remain blocked by one exact vintage-window conflict each and `FEDFUNDS` has no normalized archive. No conflict was overwritten and no substitute series was used.
- This is not repaired alpha, model promotion, complete macro coverage or production readiness. Production apply/deploy/sync, migrations, `db:push`, full FRED refresh and other historical rebuilds were not performed.
- Evidence root, excluded from Git: `worker/.runs/macro-vintage-remediation-20261104T121416Z`.

## 2. Preflight and source delivery

Initial scheduler state was `current=null`, `queue=[]`, heartbeat `2026-11-04T12:17:29.758Z`. One existing scheduler chain and one web listener on `127.0.0.1:3000` were retained. HTTP was 200, MySQL `SELECT 1` succeeded through application configuration, ingest classification was local and the FRED key was present in `.env`. Neither its value nor any other credential was read, printed or copied.

The dirty tree contained pre-existing `docs/ALPHA_COMMANDS.jsonl`, generated public reports and `src/data/analytics-snapshot.ts`, plus untracked macro reports. Those files were preserved and excluded from the source commit. The ten source files were exactly:

- `api/services/macro.ts` and regenerated `api/services/manuals-content.ts`;
- `scripts/backfill-macro-vintages.mts`;
- `worker/lib/macro-sources.ts` and new `macro-sources.test.ts`;
- new `worker/lib/macro-vintage-backfill.ts` and `.test.ts`;
- `docs/MACRO_DATA.md` and RU/EN manuals.

The staged whitelist matched all ten paths. A broad marker scan matched prose in large bundled manual strings; a follow-up scan for concrete key assignments, URL keys, bearer tokens, private-key blocks and quoted password/secret assignments found zero matches. `git diff --cached --check` passed.

## 3. Initial database audit

The complete table contained **47,901 rows**, all belonging to the eight curated series. Every current selection at `2026-11-04` was empty before remediation. Across the table there were **1,780 null values**, **45,063 rows with `realtimeStart = realtimeEnd = 2026-10-19`**, zero duplicate vintage groups, zero availability inversions and zero null realtime starts.

| Series | Rows | Observation range | realtimeStart range | realtimeEnd range | Null values | Legacy start=end 2026-10-19 |
|---|---:|---|---|---|---:|---:|
| DGS10 | 11,511 | 1962-01-02 → 2026-10-16 | 2026-10-19 only | 2026-10-19 only | 498 | 11,511 |
| DGS2 | 11,511 | 1976-06-01 → 2026-10-16 | 2026-10-19 only | 2026-10-19 only | 484 | 11,511 |
| T10Y2Y | 11,512 | 1976-06-01 → 2026-10-19 | 2026-10-19 only | 2026-10-19 only | 484 | 11,512 |
| FEDFUNDS | 936 | 1954-07-01 → 2026-09-01 | 2026-10-02 → 2026-10-19 | 2026-10-02 → 2026-10-19 | 0 | 69 |
| CPIAUCSL | 1,026 | 1947-01-01 → 2026-09-01 | 2026-10-14 → 2026-10-19 | 2026-10-14 → 2026-10-19 | 2 | 69 |
| UNRATE | 1,014 | 1948-01-01 → 2026-09-01 | 2026-10-02 → 2026-10-06 | 2026-10-02 → 2026-10-06 | 2 | 0 |
| BAMLH0A0HYM2 | 792 | 2023-10-20 → 2026-10-16 | 2026-10-19 only | 2026-10-19 only | 8 | 792 |
| VIXCLS | 9,599 | 1990-01-02 → 2026-10-16 | 2026-10-19 only | 2026-10-19 only | 302 | 9,599 |

All original `fetchedAt` values were on `2026-10-19`, between 19:41:37Z and 19:44:17Z. Current ineligibility was caused by expired realtime windows; the initial null-start count was zero. Exact rows, ranges, fetchedAt bounds, current rejection reasons and selected IDs are in `initial-audit.json`. All 45,063 exact legacy `start=end=2026-10-19` rows are separately listed in `legacy-start-end-20261019.json`.

## 4. Mandatory backup and normalized archive audit

Before any database write, `backup-macro-points.json` captured every table row ordered by ID:

| Rows | Bytes | SHA256 |
|---:|---:|---|
| **47,901** | **9,983,065** | `5622b2d965a0bfbde5d734c4aafc39bd5731293804a40b13d809fd8bfdd613fd` |

`backup-manifest.json` records `beforeAnyDbWrite=true`, table, scope, count, bytes and hash. The apply verified both the backup hash and an exact current-versus-backup row fingerprint before writing. The backup was not overwritten or deleted.

Initial normalized archive evidence:

| Series | Normalized rows | Observation / vintage coverage | Existing DB key conflicts |
|---|---:|---|---:|
| DGS10 | 94,623 | 2000-01-03 → 2026-11-02 · 2005-06-28 → 2026-11-03 | 1 |
| DGS2 | 94,622 | 2000-01-03 → 2026-11-02 · 2005-06-28 → 2026-11-03 | 1 |
| T10Y2Y | 71,174 | 2000-01-03 → 2026-11-03 · 2014-01-27 → 2026-11-03 | 1 |
| FEDFUNDS | **archive absent** | No official normalized input available | — |
| CPIAUCSL | 5,774 | 2000-01-01 → 2026-09-01 · 2000-02-18 → 2026-10-14 | 1 |
| UNRATE | 4,783 | 2000-01-01 → 2026-09-01 · 2000-02-04 → 2026-10-02 | 1 |
| BAMLH0A0HYM2 | 1,711 | 2023-11-06 → 2026-11-02 · 2023-11-06 → 2026-11-02 | 0 |
| VIXCLS before targeted fetch | **archive absent** | Collected once in this block, see §5 | — |

For all available archives, normalized source hashes matched the manifest raw-observation hashes and actual raw-file SHA256. There were zero missing `availableAt` rows and zero archive availability inversions. A search found no `FEDFUNDS` archive under the macro root. Regular collector `DFF` is daily effective federal funds data and was **not** substituted for monthly `FEDFUNDS`.

## 5. One targeted VIXCLS fetch and manifest QA

After a fresh idle/no-macro-process check, exactly one command ran:

```text
npx tsx worker/macro-fred-fetch.mts --series VIXCLS
```

It completed with **exit 0**, without `--force` or `--group all`:

- status `complete`, `availabilityMode=alfred_vintages`, **83,769 normalized vintage rows**;
- observation range `2000-01-03 → 2026-11-02`;
- official vintage range `2010-11-22 → 2026-11-02`, with 17 yearly realtime chunks and 34 chunk files;
- zero missing availability starts, **7,001 open-ended rows**, 2,442 null values, zero availability inversions;
- normalized SHA256 `3a6e70bb948505e2d743790f7a66114241a79cc65ae9f33a2483f45c6ee195c6`;
- raw-observation SHA256 `7323926ca0c3eef639746be3b4687ac6eedf6533982e3f7403f868a573c72526`;
- all manifest raw hashes and 34 chunk hashes are preserved in `vix-fetch-evidence.json`.

`VIXCLS` is now a separate `volatility` / `vix_close` channel, not part of rates. One subsequent `npx tsx worker/macro-manifest-qa.mts` completed with **exit 0 / pass / 0 errors / 0 warnings** at `2026-11-04T12:28:00.063Z`, covering 21 registered series. No Event Study or Shock Calibration series was changed and no derived builder was run.

## 6. Adapter contract and regression coverage

`prepareMacroVintageBackfill` implements the required mapping exactly:

| Normalized FRED/ALFRED | `macro_points` |
|---|---|
| `observationPeriod` | `date` |
| `value` | `value`, including null |
| `availableAt` | `realtimeStart` |
| `supersededAt` | `realtimeEnd`; null remains open-ended |
| actual new ingest timestamp | `fetchedAt` |

`researchEligibleAt`, source `ingestedAt` and `fetchedAt` never become availability. Missing `availableAt` produces a skip diagnostic rather than a timestamp substitute. Identical keys are deduplicated; identical `(seriesId, observationPeriod, realtimeStart)` with different value/end throws `MacroVintageConflictError` before ingest. A conflict-bearing series is not partially upserted. Independent valid series can complete, but the run remains `partial` with exit 1.

New writes use the existing `ingestMacroPoints`, which now accepts an optional actual ingest timestamp and keeps its ≤500 batches. Duplicate-key updates do not advance `fetchedAt`; the reviewed adapter excludes conflicts before calling it. There are no DELETE/DROP/TRUNCATE or schema operations. The CLI defaults to dry-run, refuses to overwrite an existing result, and apply requires a complete matching backup.

The seven adapter regressions cover: original/revised vintages; open-ended windows; missing availability; identical duplicate idempotency; archive and database conflicts without writes; null values; actual `fetchedAt` separate from availability; and a second fixture backfill producing zero writes without changing original timestamps. The registry test separately proves 21 series and `volatility/vix_close`. Combined adjacent macro/health/vintage suites passed **5 files / 32 tests**. Live idempotency was not tested by a second apply.

## 7. Dry-run and the single apply

Dry-run at `2026-11-04T12:29:52.138Z` returned **partial / exit 1**, planned 85,480 rows and wrote zero database rows. The only apply used:

```text
npx tsx scripts/backfill-macro-vintages.mts --apply --out worker/.runs/macro-vintage-remediation-20261104T121416Z/apply --backup-manifest worker/.runs/macro-vintage-remediation-20261104T121416Z/backup-manifest.json
```

It completed at `2026-11-04T12:32:16.177Z` with **partial / exit 1**, not a false success. No second apply or retry was run.

| Series | Result | Inserted | Conflict / missing availability |
|---|---|---:|---|
| DGS10 | preserved, `vintage_conflict` | 0 | `DGS10|2026-10-16|2026-10-19`: DB end 2026-10-19 vs official null |
| DGS2 | preserved, `vintage_conflict` | 0 | `DGS2|2026-10-16|2026-10-19`: DB end 2026-10-19 vs official null |
| T10Y2Y | preserved, `vintage_conflict` | 0 | `T10Y2Y|2026-10-19|2026-10-19`: DB end 2026-10-19 vs official null |
| FEDFUNDS | preserved, source error | 0 | Normalized `FEDFUNDS.json` absent; no row-level availability skip was invented |
| CPIAUCSL | preserved, `vintage_conflict` | 0 | `CPIAUCSL|2026-09-01|2026-10-14`: DB end 2026-10-14 vs official null |
| UNRATE | preserved, `vintage_conflict` | 0 | `UNRATE|2026-09-01|2026-10-02`: DB end 2026-10-02 vs official null |
| BAMLH0A0HYM2 | complete | **1,711** | 0 conflicts / 0 missing availability |
| VIXCLS | complete | **83,769** | 0 conflicts / 0 missing availability |
| **Total** | **partial, 6 series errors** | **85,480** | **5 conflicts + 1 missing archive; 0 availability skips** |

The five conflicts have equal values but different realtime ends. They are official open-ended evidence disagreeing with legacy one-day closure, not permission for a silent upsert. Exact legacy IDs are DGS10 44671, DGS2 46182, T10Y2Y 47694, CPIAUCSL 31824 and UNRATE 32769.

## 8. Scheduler guard incident — retained, not hidden

The shell guard before apply returned exit 1 because the scheduler had become non-idle. The command used `&& set -o pipefail;` before the apply; the semicolon therefore allowed the apply to continue despite the failed idle check. This was a command-chain error, not a passed preflight.

The overlapping registered jobs were:

- `1793795400183-stocktwits-hourly`, cron, `2026-11-04T12:30:00.183Z → 12:31:40.737Z`, exit 0;
- `1793795520242-alpha-bridge-agent`, cron, `12:32:00.242Z → 12:32:01.850Z`, exit 0.

No macro collector/builder process or macro scheduler job was observed in the subsequent process/state check; scheduler was then idle. No duplicate scheduler, process kill or reload occurred. The incident and exact shell cause are preserved in `scheduler-apply-concurrency.json` and the command ledger. Backup fingerprint verification passed, and post-verification below found no original-row modification, but these facts do not erase the failed guard.

## 9. Post-backfill verification

Read-only verification returned **pass**:

| Check | Result |
|---|---:|
| Total `macro_points` before → after | **47,901 → 133,381** |
| New rows | **85,480** |
| Original rows preserved byte-for-byte by ID | **47,901 / 47,901** |
| Missing original IDs / modified original rows | **0 / 0** |
| New rows outside the two approved independent series | **0** |
| New-row value/window mismatches against archive | **0** |
| Duplicate vintage groups / conflicting duplicates | **0 / 0** |
| Availability inversions / null realtime starts | **0 / 0** |
| Selected-after-anchor in fixed boundary probes | **0** |

| Series | Rows after | New | Current selected ID / observation / start / end / value |
|---|---:|---:|---|
| DGS10 | 11,511 | 0 | none at 2026-11-04 |
| DGS2 | 11,511 | 0 | none |
| T10Y2Y | 11,512 | 0 | none |
| FEDFUNDS | 936 | 0 | none |
| CPIAUCSL | 1,026 | 0 | none |
| UNRATE | 1,014 | 0 | none |
| BAMLH0A0HYM2 | 2,503 | 1,711 | 61711 · 2026-11-02 · 2026-11-02 · NULL · 3.43 |
| VIXCLS | 93,368 | 83,769 | 145480 · 2026-11-02 · 2026-11-02 · NULL · 21.15 |

Only `VIXCLS` and `BAMLH0A0HYM2` currently have eligible vintages; `latestMacro` returns those two, not a fabricated complete eight-series dashboard. Source file and raw hashes still match the apply evidence. `post-backfill-verification.json` contains every current selection and historical boundary probe.

## 10. Frozen probability protocol and macro coverage

The evaluation used `evaluateCompany` for AAPL 320193, NVDA 1045810 and MSFT 789019; `nestedEvaluate` for the same `panelCiks` and bayes/logistic; and `latestEligibleMacroPoint` plus production `macroPriorAt` for coverage. `macro-validation.mts` was not used.

Frozen parameters: 63-session horizon; chronological 50% fit / 25% calibration / 25% evaluation; final four-anchor holdout excluded from fit/calibration/thresholding/selection; isotonic PAVA identity below eight known points; threshold 0.5; pooling tau 8; non-overlapping long/cash excess-vs-SPY with initial cash, 5bp commission + 10bp slippage; bull/bear by SPY 63-session return. Models, weights, pooling, universes, thresholds and evaluation protocol were unchanged.

The JSON and Markdown were fully written, parsed and hashed before database close; the process exited 0 in about 25 seconds. No wrapper timeout or second evaluation occurred.

| Coverage metric | Result |
|---|---:|
| Unique evaluated anchors | 485 |
| Anchor/series checks | 1,455 |
| Eligible selections | **472** |
| Missing eligible selections | **983** |
| Eligible null-value rows | 0 |
| Selected vintage after anchor | **0** |
| Anchors missing at least one series | **485 / 485** |
| Anchors with no eligible series | **97 / 485** |
| Complete three-series anchors | **0 / 485** |

| Series | Eligible anchors | Missing anchors | Earliest eligible example | Current ID / date / start / end |
|---|---:|---:|---|---|
| VIXCLS | 388 | 97 | id 110245 · anchor/date 2011-01-18/2011-01-14 · start 2011-01-18 · end 2011-12-31 | 145480 · 2026-11-02 · 2026-11-02 · NULL |
| BAMLH0A0HYM2 | 84 | 401 | id 60001 · anchor/date 2023-11-06 · start 2023-11-06 · end 2023-12-31 | 61711 · 2026-11-02 · 2026-11-02 · NULL |
| T10Y2Y | 0 | 485 | none | none |

Actual production prior distribution over the 485 anchors: **0.54 on 224 anchors**, **0.42 on 35**, **0.50 on 226**. Thus 259 anchors have non-neutral macro input instead of the former universal neutral result. Current company-level macro prior remains **0.50** for AAPL/NVDA/MSFT because current VIX is 21.15, HY OAS is 3.43 and the curve is missing; this is not presented as a complete regime measurement.

## 11. Company and nested evaluation metrics

| Ticker | Anchors | Current anchor | Current P | Current macro prior | Backtest baseline up | Hit ≥60% | Hit <60% |
|---|---:|---|---:|---:|---:|---:|---:|
| AAPL | 211 | 2026-11-03 | 94.2217% | 50% | 61.6114% | 58.3333% | 62.0321% |
| NVDA | 176 | 2026-10-22 | 66.2406% | 50% | 69.8864% | 62.2222% | 72.5191% |
| MSFT | 224 | 2026-10-28 | 82.8598% | 50% | 56.2500% | 47.4576% | 59.3939% |

| Ticker / model | n | Accuracy | Balanced | Up / down accuracy | Always-up / majority baseline | Cost return / max DD | Holdout acc / return | Pooling rows / intercept |
|---|---:|---:|---:|---|---|---|---|---|
| AAPL bayes | 53 | 49.0566% | 50.0000% | 49.0566% / — | 49.0566% / 50.9434% | 9.8303% / 21.9507% | 75% / 8.8876% | bayes |
| AAPL logistic | 53 | 54.7170% | 55.1994% | 52.5000% / 61.5385% | 49.0566% / 50.9434% | −5.0282% / 21.9507% | 25% / 0% | 318/99 · 0.813084 |
| NVDA bayes | 43 | 32.5581% | 31.5271% | 50.0000% / 17.3913% | 67.4419% / 67.4419% | 64.1608% / 3.3785% | 100% / 4.1076% | bayes |
| NVDA logistic | 43 | 67.4419% | 50.0000% | 67.4419% / — | 67.4419% / 67.4419% | 104.3092% / 14.4502% | 100% / 4.1076% | 310/84 · 0.481908 |
| MSFT bayes | 55 | 50.9091% | 54.8319% | 41.6667% / 68.4211% | 38.1818% / 61.8182% | −22.9173% / 22.9173% | 100% / 28.1268% | bayes |
| MSFT logistic | 55 | 38.1818% | 50.0000% | 38.1818% / — | 38.1818% / 61.8182% | −35.5847% / 35.5847% | 100% / 28.1268% | 238/107 · 0.138182 |

Costs use only non-overlapping windows, not sums of overlapping 63-session returns. Four-anchor holdouts and always-up predictions are too small/degenerate for model selection.

| Ticker / model | Bull n / accuracy | Bear n / accuracy |
|---|---|---|
| AAPL bayes | 46 / 54.3478% | 7 / 14.2857% |
| AAPL logistic | 46 / 54.3478% | 7 / 57.1429% |
| NVDA bayes | 38 / 36.8421% | 5 / 0% |
| NVDA logistic | 38 / 71.0526% | 5 / 40% |
| MSFT bayes | 43 / 51.1628% | 12 / 50% |
| MSFT logistic | 43 / 34.8837% | 12 / 50% |

Full confusion matrices, recalls, calibration, cost turnover, baselines and pooling metadata are in the 716,149-byte evaluation JSON.

## 12. Historical comparison only

The comparison source is `worker/.runs/integrated-verification-20261104T084250Z/macro-evaluation.json`, SHA256 `8a80b1bd829a237bf8d6a968ec34de578d1496d707e52f4fb9472b36018266b4`. There is no previous complete model-input DB snapshot. The macro backup is an audit backup, not a full evaluation-input snapshot; therefore this is **not a direct same-DB pre/post** and not causal attribution.

| Ticker / model | Historical accuracy | Current accuracy | Historical holdout | Current holdout |
|---|---:|---:|---:|---:|
| AAPL bayes | 45.2830% | 49.0566% | 75% | 75% |
| AAPL logistic | 54.7170% | 54.7170% | 25% | 25% |
| NVDA bayes | 55.8140% | 32.5581% | 100% | 100% |
| NVDA logistic | 62.7907% | 67.4419% | 100% | 100% |
| MSFT bayes | 49.0909% | 50.9091% | 100% | 100% |
| MSFT logistic | 38.1818% | 38.1818% | 100% | 100% |

No best result was selected. Changes can reflect both the new partial macro evidence and other current model inputs; they cannot be attributed solely to this remediation.

## 13. Command ledger, including failures

| Command / check | Exit | Outcome |
|---|---:|---|
| Initial status/fetch/log and reviewed fast-forward to `07727f4` | 0 | Pre-existing diffs preserved |
| First inline MySQL diagnostic with top-level await | 1 | CJS transform limitation; no DB action |
| Async-IIFE MySQL/local-ingest/FRED-presence check | 0 | `SELECT 1` succeeded; no secret output |
| `audit-and-backup.mts` | 0 | 47,901-row backup and full initial audit |
| PowerShell process-evidence JSON parse | 1 | BOM in diagnostic JSON; no operational action |
| Targeted macro/health/vintage tests | 0 | **5 files / 32 tests** |
| `npm run check` before collection | 0 | TypeScript passed |
| Single `macro-fred-fetch.mts --series VIXCLS` | 0 | 83,769 rows; no errors |
| Single `macro-manifest-qa.mts` | 0 | **pass / 0 / 0** |
| `vix-fetch-evidence.mts` | 0 | Manifest, raw and chunk hashes preserved |
| Backfill dry-run | **1** | Expected `partial`: 85,480 planned / 0 inserted / 6 series errors |
| Pre-apply scheduler idle check | **1** | Non-idle; semicolon chaining then allowed apply; see §8 |
| Single backfill apply | **1** | `partial`: **85,480 inserted**, 6 preserved series; no retry |
| `post-backfill-verification.mts` | 0 | **pass**, zero original/new-row mismatches |
| Frozen probability evaluation | 0 | Complete 3 company + 6 nested reports; JSON parsed before DB close |
| Source manuals/check/full test/build/diff gates | 0 | **121 files / 689 tests**; TypeScript/build passed; established chunk warnings |
| Source commit `991f046` and ordinary push | 0 | `07727f4..991f046`, fast-forward |

No failed collector was rerun. The dry-run and apply have separate evidence directories and their expected partial exit codes are not represented as successful full remediation.

## 14. Verification and core evidence hashes

Targeted suites: **5 files / 32 tests passed**. Source full gates: `npm run check`, **121 files / 689 tests passed**, `npm run build` with established chunk-size warnings, `git diff --check` passed. Documentation-only final gates are run separately before the documentation commit; historical counts are never substituted for fresh results.

Core artifacts:

- backup `backup-macro-points.json`: 9,983,065 bytes, SHA256 `5622b2d965a0bfbde5d734c4aafc39bd5731293804a40b13d809fd8bfdd613fd`;
- evaluation `macro-probability-evaluation.json`: 716,149 bytes, SHA256 `8dacdf8938141a93ed88f44654c3daa29f48f6da32878b4bbfbaf8ee10d77d11`;
- evaluation Markdown: 3,637 bytes, SHA256 `f7a4ff63d431940dfa9facec5cc801c6b85a985fc2a184f1d87baf8e805522e4`;
- VIX normalized archive: SHA256 `3a6e70bb948505e2d743790f7a66114241a79cc65ae9f33a2483f45c6ee195c6`;
- VIX raw observations: SHA256 `7323926ca0c3eef639746be3b4687ac6eedf6533982e3f7403f868a573c72526`;
- BAML normalized archive: SHA256 `dd245e720d8ea2e45ba876018e97ab3599d4f15aefd5237e42060cda24507fda`;
- BAML raw observations: SHA256 `5ba494eca6975e515406bf5fd9247a3971811ccc9a7bc65a8a0f111bd6e631ee`.

`evidence-index.json` covers audit, backup, manifests, VIX raw/normalized/chunks, dry-run/apply, verification, evaluation, logs, source gates and Project State before/after. `evidence-verification.json` records the final count and mismatches; the final handoff includes those actual results.

## 15. Remaining blockers and next safe action

1. **Five exact legacy-window conflicts remain.** They need an owner-reviewed evidence decision; this block did not change their values or realtime ends.
2. **`FEDFUNDS` has no official normalized archive.** A separate reviewed targeted collection is needed; `DFF` is not an equivalent replacement. No such collection was run here.
3. Only two of eight curated series have current eligible rows. T10Y2Y still has 485/485 missing evaluated anchors; VIX has 97 and HY has 401 missing anchors. No anchor has complete three-series coverage.
4. A command-chain guard error allowed apply after non-idle detection. It is documented above and must not be repeated; future operational commands should make the apply strictly conditional on the idle check.
5. The full FRED archive is limited to 2000 onward by protocol, VIX vintages begin in 2010 and HY has a short official history. These are coverage limitations, not reasons to infer values.

The next safe block is **reviewed resolution of the five exact conflicts plus a separately authorized official FEDFUNDS archive collection**, followed by a fresh backup and one reviewed backfill/evaluation. Only after the remaining macro blocker is resolved should the queue proceed to **Statements netDebt/ROE/ROA historical rebuild/evaluation**, then F-15/F-16, Atlas coverage from documented exposure and production/security findings.

No full FRED refresh, SEC/13F collection, 13F/Statements/Atlas rebuild, F-15/F-16 work, factor/model/regime promotion, schema change, credential access, production URL or production action was performed.
