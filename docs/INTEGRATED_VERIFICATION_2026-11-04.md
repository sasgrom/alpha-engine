# Integrated operational / research verification — 2026-11-04

## 1. Scope and baseline

- Baseline HEAD and `origin/main`: `98b64d41b2411c905e7f6aba2a82ccc24eaa3faf` (`Document reviewed exposure rebuild`).
- This block verifies existing operational evidence and evaluates the existing macro prior/probability implementation. It does not authorize production delivery, collection outside schedule, duplicate jobs or model promotion.
- Source changes are limited to schedule-aware Daily Operations reporting and regression tests. Production data, collector crons, research universes, model parameters, thresholds and protocols are unchanged.
- Evidence root, ignored by Git: `worker/.runs/integrated-verification-20261104T084250Z`.
- Atlas was not rebuilt: it remains `partial`, **904 records**, 24 studies, 6 estimated / 18 insufficient, no full_sample and 2 OOS evaluations.

## 2. Operational preflight

| Check | Verified evidence |
|---|---|
| Git | HEAD and `origin/main` matched the baseline. Pre-existing generated/runtime diffs were preserved and excluded. |
| Scheduler | `current=null`, `queue=[]`; heartbeat `2026-11-04T08:39:11.888Z`; one process chain 18324 → 5216 → 16940 → 15548 → 16164. |
| Web | HTTP 200 from `http://127.0.0.1:3000/`; one listener PID 5440, parent cmd 15664. No second server was started. |
| Ingest | Existing `INGEST_URL` classification is local. Its value was not printed. |
| MySQL | `SELECT 1` succeeded through the existing application configuration. No credentials or connection string was printed. |
| Macro | QA `pass`, `derivedCurrent=true`, QA generated `2026-11-03T22:42:38.572Z`. |
| Atlas | `partial`, generated `2026-11-04T07:58:23.230Z`, 904 records / 24 studies. No rebuild or duplicate builder was started. |

Detailed evidence: `preflight.json`. No scheduler reload was necessary or performed.

## 3. Six corrected CIKs: manifest and raw validation

Variant A applies: **all six are collected and valid**. No SEC probe, new collection, scheduler reload or canonical scheduler request was needed.

Each row below passed all of the following:

- manifest exists and ticker matches expected CIK;
- `status=refreshed` with non-null `lastSuccessfulCapture` and `lastSuccessfulIngest`;
- raw payload exists and `payload.cik` matches the expected CIK;
- `factsToRows(payload).length > 0`;
- semantic payload SHA256 and raw-file SHA256 equal manifest `rawSha256`;
- no bounded error is present.

| Ticker | Correct CIK | Fact rows | Last successful capture / ingest UTC | Last relevant form / accession / filing date | Raw SHA256 |
|---|---:|---:|---|---|---|
| TGT | 27419 | 25,319 | 2026-11-04T07:33:01.467Z | 10-Q · `0000027419-26-000042` · 2026-08-28 | `eb15a2cd524e99ff27675db78840d039ec4a68b9cc2dcb10accbcb299933a487` |
| HAS | 46080 | 27,380 | 2026-11-04T07:33:16.440Z | 10-Q · `0000046080-26-000065` · 2026-10-29 | `30d3e0f50432c374da4aa0c841c67dd8689f4eb9c8d9d165fc618b36cc1ceeb0` |
| WELL | 766704 | 37,375 | 2026-11-04T07:34:34.204Z | 10-Q · `0000766704-26-000046` · 2026-10-27 | `064ea0abf437fac5a6ceb48246fdd397e9def28ea09d70289f929ba8ecd22c5a` |
| PH | 76334 | 26,379 | 2026-11-04T07:33:43.510Z | 10-K · `0000076334-26-000105` · 2026-08-21 | `68a9b3259484f47aa5f0c1556cb4446e0cd100821ad6c66be8064a1b7026df0e` |
| TROW | 1113169 | 19,944 | 2026-11-04T07:36:17.144Z | 10-Q · `0001113169-26-000005` · 2026-10-29 | `69f797c3e549f70692a6e3e3dbad3eb2487aa7619e7c275a5427eda87cf3b087` |
| TPR | 1116132 | 25,947 | 2026-11-04T07:36:21.432Z | 10-K · `0001116132-26-000018` · 2026-08-13 | `f778dc6d6092b7f14f730475c9e1f06dd25e4947852b457f0a5fbdbecb6197e9` |

All six manifests use the corrected universe hash `cede4a6dfb3b3f20aecf08bd60ed7cad634e6ac146bfa8d6089cd4ba3a6a28ac`. The current universe includes all corrected CIKs and excludes all six old incorrect CIKs. Old manifests remain preserved as historical failure evidence and were not deleted.

Machine evidence: `cik-checks.json`, plus each individual manifest and raw file in the SHA256 evidence index. Initial backfill history remains separate: 499 processed, 490 refreshed, 3 unchanged and 6 historical failures; those failures are not represented as successful initial-backfill coverage.

## 4. Schwab: actual schedule, not a manual collection

At preflight, local time was `2026-11-04T00:42:08.291-08:00`.

| Job | Effective cron | Next run | Relevant registered last run |
|---|---|---|---|
| `schwab-fetch-daily` | `0 4 * * *` — 04:00 home local | `2026-11-04T12:00:00.000Z` | `1793707214096-schwab-fetch-daily`, done, ended `2026-11-03T12:00:16.171Z` |
| `schwab-context-hourly` | `10 * * * *` — independent hourly context | `2026-11-04T09:10:00.000Z` | `1793779811758-schwab-context-hourly`, done, ended `2026-11-04T08:10:15.767Z` |
| `sp500-facts-daily` | `30 23 * * *` home local | `2026-11-05T07:30:00.000Z` | `1793777546415-sp500-facts-daily`, done, ended `2026-11-04T07:37:14.677Z` |

The 04:00 full-snapshot slot had not occurred during this block. No manual Schwab run, second run or scheduler request was started. Therefore there is no new 51/51 current-day capture to claim. The current state is `awaiting_scheduled_capture`, not successful coverage and not proof of a collector failure.

For a later slot, acceptance remains: 51/51 captures for the actual UTC date, 51/51 readable latest chains, contract count, zero manifest errors and current Feature Lab source hash. Hourly context endpoints and errors are checked independently and cannot substitute for the full snapshot.

## 5. Health semantics and regression verification

### Confirmed problem and correction

Previously, a readable previous complete snapshot plus zero captures before the scheduled slot became `error` and made Daily Operations `critical`. That conflated an expected pre-slot state with an actual missed collection.

`worker/lib/daily-operations-report.ts` now applies:

- with an online scheduler, valid same-day `nextRun`, and a readable previous complete snapshot, missing today's capture is **`pending` / `awaiting_scheduled_capture`** through the next run plus **60 minutes** (`SCHWAB_CAPTURE_GRACE_MS`);
- after that documented grace period, missing successful capture is **`error`**;
- partial coverage is a warning, and zero coverage is never `ok`;
- same-day normalization or readable old chains cannot hide a missed capture after grace;
- hourly context success remains a separate check;
- pending checks make overall health `degraded`, not `ok`, and do not produce a pre-slot manual collection action.

### Regression cases

1. Pre-schedule nextRun with readable previous complete snapshot → pending and not critical.
2. Missed slot beyond 60-minute grace → error.
3. Every expected ticker captured today → ok.
4. Readable previous chains and same-day normalization with 0 captures after grace → error.
5. Fresh hourly context + missing daily snapshot → daily pending before grace / error after grace, context independently ok.

Targeted result: **2 test files / 13 tests passed** (`daily-operations-report` and `macro-operations-health`); `npm run check` passed. Evidence: `health-tests.json`.

## 6. Reviewed macro prior / probability evaluation

### Frozen protocol

- Panel: AAPL 320193, NVDA 1045810, MSFT 789019; logistic `panelCiks` is exactly those three companies.
- Entry points: `evaluateCompany` for each company; `nestedEvaluate` for bayes/logistic with a shared dataset cache.
- No `macro-validation.mts`, AssetGrowth regime substitute, old worktree, parameter tuning or promotion was used.
- Existing production anchors and factor selection; 63-session outcomes; chronological 50% fit / 25% calibration / 25% evaluation inside development; final four-anchor holdout excluded from fit, calibration, thresholding and selection.
- Isotonic PAVA calibration with identity below eight known points; decision threshold 0.5; partial pooling tau 8.
- Non-overlapping 63-session long/cash excess-vs-SPY costs, initial entry from cash, 5bp commission + 10bp slippage per unit turnover.
- Bull/bear regimes from SPY 63-session forward return.
- Macro selection: `latestEligibleMacroPoint` with `date <= anchor`, non-null `realtimeStart <= anchor`, and `realtimeEnd IS NULL OR realtimeEnd >= anchor`, ordered by `date DESC, realtimeStart DESC, id DESC`.
- Coverage scope: 485 unique evaluated anchors from company probability points and cached nested anchor datasets; 1,455 anchor/series selections.
- Comparison mode: **historical comparison only**, no previous DB snapshot and no direct same-DB pre/post claim.

The frozen protocol is stored in `macro-protocol.json`.

### Company probability reports

| Ticker | Evaluated anchors | Current anchor | Current P | Macro prior | Backtest baseline up | Hit ≥60% | Hit <60% |
|---|---:|---|---:|---:|---:|---:|---:|
| AAPL | 211 | 2026-11-03 | 94.8239% | 50% | 60.6635% | 59.0909% | 60.8466% |
| NVDA | 176 | 2026-10-22 | 79.8096% | 50% | 68.75% | 62.7907% | 70.6767% |
| MSFT | 224 | 2026-10-28 | 86.5666% | 50% | 56.25% | 45.0980% | 59.5376% |

These are current descriptive evaluations, not selected trading signals.

### Nested accuracy, costs, holdout and pooling

| Ticker | Model | n | Accuracy | Balanced | Up acc | Down acc | Majority | Cost return | Max DD | Holdout n / accuracy | Holdout return | Pooling rows / intercept |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| AAPL | bayes | 53 | 45.2830% | 50.0000% | 45.2830% | — | 54.7170% | 12.2834% | 23.1703% | 4 / 75% | 7.6707% | bayes |
| AAPL | logistic | 53 | 54.7170% | 57.1839% | 50.0000% | 69.2308% | 54.7170% | −2.9052% | 23.1703% | 4 / 25% | 0% | 318 / 99 · 0.835886 |
| NVDA | bayes | 43 | 55.8140% | 49.5370% | 62.5000% | 36.3636% | 62.7907% | 36.6532% | 19.5495% | 4 / 100% | 5.8290% | bayes |
| NVDA | logistic | 43 | 62.7907% | 50.0000% | 62.7907% | — | 62.7907% | 89.4698% | 19.3000% | 4 / 100% | 5.8290% | 310 / 84 · 0.502696 |
| MSFT | bayes | 55 | 49.0909% | 51.5406% | 39.3939% | 63.6364% | 61.8182% | −25.2499% | 25.2499% | 4 / 100% | 24.1404% | bayes |
| MSFT | logistic | 55 | 38.1818% | 50.0000% | 38.1818% | — | 61.8182% | −38.1097% | 38.1097% | 4 / 100% | 24.1404% | 238 / 107 · 0.142877 |

Pooling row format is panel training rows / target-known rows, followed by the shrunk intercept. Holdout `n=4` is too small to select a model or claim robust performance, particularly where all calls are up.

### Regime accuracy

| Ticker | Model | Bull n / accuracy | Bear n / accuracy |
|---|---|---|---|
| AAPL | bayes | 46 / 50.0000% | 7 / 14.2857% |
| AAPL | logistic | 46 / 54.3478% | 7 / 57.1429% |
| NVDA | bayes | 38 / 57.8947% | 5 / 40.0000% |
| NVDA | logistic | 38 / 65.7895% | 5 / 40.0000% |
| MSFT | bayes | 43 / 48.8372% | 12 / 50.0000% |
| MSFT | logistic | 43 / 34.8837% | 12 / 50.0000% |

### Macro vintage coverage

Current `asOf=2026-11-04` has **no eligible vintage** for VIXCLS, BAMLH0A0HYM2 or T10Y2Y. Their current selected ID/date/realtimeStart/realtimeEnd are therefore all null; no value was invented.

| Series | Stored rows | Observation range | realtimeStart range | realtimeEnd range | Current eligible |
|---|---:|---|---|---|---|
| VIXCLS | 9,599 | 1990-01-02 → 2026-10-16 | 2026-10-19 only | 2026-10-19 only | none |
| BAMLH0A0HYM2 | 792 | 2023-10-20 → 2026-10-16 | 2026-10-19 only | 2026-10-19 only | none |
| T10Y2Y | 11,512 | 1976-06-01 → 2026-10-19 | 2026-10-19 only | 2026-10-19 only | none |

All three have non-null start fields, but every stored window has `realtimeStart = realtimeEnd = 2026-10-19`. Earlier anchors cannot use that future start, and later anchors are beyond the ended window.

A boundary probe on the inclusive anchor `2026-10-19` does return valid evidence:

| DB id | Series | Observation date | realtimeStart | realtimeEnd | Value |
|---:|---|---|---|---|---:|
| 43160 | VIXCLS | 2026-10-16 | 2026-10-19 | 2026-10-19 | 19.99 |
| 33561 | BAMLH0A0HYM2 | 2026-10-16 | 2026-10-19 | 2026-10-19 | 3.31 |
| 47694 | T10Y2Y | 2026-10-19 | 2026-10-19 | 2026-10-19 | 0.38 |

Evaluation anchor coverage:

- 485 unique evaluated anchors / 1,455 checks;
- **1,455 missing eligible rows**;
- 0 eligible rows with null values;
- **0 selected vintages after anchor**.

Consequently, `macroPrior()` uses its existing neutral **0.5 fallback**. This is not evidence of a valid current macro regime or repaired macro alpha. A separate reviewed vintage-data remediation would be needed to improve coverage; no collector or backfill was started here.

`macro-db-coverage.json` records the metadata checks. An initial aggregate diagnostic failed without a useful SQL cause; read-only schema and alternate aggregate queries established the above evidence without modifying schema or data.

### Historical comparison, not direct pre/post

The following compares current evaluation accuracy with the older documented nested results. It is **not a direct same-DB pre/post comparison** and does not isolate the effect of F-04 from other data changes.

| Ticker / model | Historical documented accuracy | Current accuracy | Historical holdout | Current holdout |
|---|---:|---:|---:|---:|
| AAPL / bayes | 47.1% | 45.2830% | 25% | 75% |
| AAPL / logistic | 41.2% | 54.7170% | 25% | 25% |
| NVDA / bayes | 64.8% | 55.8140% | 50% | 100% |
| NVDA / logistic | 64.8% | 62.7907% | 50% | 100% |
| MSFT / bayes | 57.7% | 49.0909% | 0% | 100% |
| MSFT / logistic | 42.3% | 38.1818% | 0% | 100% |

Different samples and the neutral macro fallback prevent causal attribution. No best result was selected, no model was promoted and no threshold was adjusted.

## 7. Daily Operations after the health fix

Final artifact generated `2026-11-04T08:58:55.248Z`:

- overall: **degraded**, **14 OK / 1 warning / 0 errors / 23 pending**;
- scheduler: online, heartbeat `2026-11-04T08:58:41.945Z`, `currentJobId=null`, `queuedJobs=0`;
- Schwab check: `pending`, detail `awaiting_scheduled_capture · next full snapshot 2026-11-04T12:00:00.000Z with a 60-minute grace period · 0/51 captured today · 51/51 readable latest chains · 122,218 contracts · 0 manifest errors`;
- context: 58/58 endpoints, zero errors, independent of the full snapshot;
- macro: QA `pass`, `derivedCurrent=true`;
- Atlas: current with QA but `partial` / 904 records, so its warning remains;
- jobs failed today: 0. The previous day's Daily Digest server failure remains historical and was not retried.

No pre-slot collector was started to make this status look better.

## 8. Command and process integrity

Main operational/research commands:

| Command | Exit | Evidence |
|---|---:|---|
| Baseline/fetch, scheduler/process, HTTP, local-ingest and MySQL checks | 0 | `preflight.json` |
| Per-CIK manifest/raw/factsToRows/SHA256 validation | 0 | `cik-checks.json` |
| Targeted health tests | 0 | 2 files / 13 tests, `health-tests.json` |
| `npx tsx worker/.runs/integrated-verification-20261104T084250Z/macro-prior-probability-evaluation.mts` | 0 | `logs/06-macro-evaluation.log`, JSON/Markdown and hashes |
| Read-only macro metadata and boundary probes | 0 after diagnostic failure | `macro-db-coverage.json` |
| `npx tsx scripts/build-daily-operations-report.mts --macro-root D:/research/alpha-engine/macro` | 0 | `logs/07-daily-health-after-fix.log` |

The evaluation process completed in about 19 seconds with exit code 0. It wrote and parsed the complete JSON before closing the DB pool and exiting. There was no timeout, no manual process kill and no second evaluation.

Output hashes:

- `macro-evaluation.json`: 405,910 bytes, SHA256 `8a80b1bd829a237bf8d6a968ec34de578d1496d707e52f4fb9472b36018266b4`;
- `macro-evaluation.md`: 2,803 bytes after null-display formatting, SHA256 `374421f36a6d76816859d5af59a71efa283087f004119011887a9ed29d2fffba`.

Final verification gates passed: `npm run check`, **118 test files / 673 tests**, `npm run build` with established chunk-size warnings, and `git diff --check`.

The complete command ledger, source/test logs, Project State before/after snapshots and all per-CIK artifacts are indexed separately with SHA256. Final gate results and index verification are recorded in `command-ledger.json`, `evidence-index.json` and `evidence-verification.json` after the checks finish.

## 9. Remaining blockers and next reviewed block

- Schwab has no new current-day full snapshot yet; it is awaiting the scheduled 04:00 local slot. No capture success is claimed.
- Current macro prior has no eligible vintage for the evaluated anchors. The neutral fallback is visible and cannot be described as repaired macro evidence.
- Atlas remains partial at 904 records, with 18 insufficient studies and only two OOS evaluations.
- Small holdouts and always-up baselines do not support promotion, even where current holdout accuracy is high.
- Next: **reviewed 13F event/flow/probability rebuild**, then F-15/F-16 and production/security findings. No 13F rebuild, production apply/deploy/sync, migration or production URL was used in this block.
