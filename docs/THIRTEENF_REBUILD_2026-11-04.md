# Reviewed 13F event / flow / probability remediation — 2026-11-04

## 1. Scope and delivery status

- Reviewed baseline: `ab914fcb4af56be69d20780d0a1f8cc73ae0536c` (`Clarify project state and remaining queue`).
- Source commits, both pushed with ordinary fast-forward:
  - `938105969950956e08f36cb99949ca2c3f56323b` — `Add reviewed 13F event remediation`;
  - `29acca94d978aca8cc559739afc2a199d5f3dc22` — `Fix 13F remediation CLI parsing`.
- Scope: existing local `fund_holdings`, `fund_quarters` and `signals` only. No SEC collection, `--quarters`, scheduler request, production apply/deploy/sync, migration or schema change was used.
- Actual audit outcome: **16,912 VALID / 0 STALE_FALLBACK / 0 MISSING_REQUIRED_AVAILABILITY / 0 DUPLICATE / 0 UNKNOWN**. No delete was justified.
- Remediation apply: **0 affected rows**, 0 batches.
- Single DB-only `npx tsx scripts/13f-refresh.mts --rebuild-events`: exit code **0**, **1 inserted event**, **0 skipped quarters / missing filing availability**.
- Post-rebuild: **16,913 VALID events**, **0 duplicates**, **0 quarter-end or quarter+45d fallbacks**, **0 missing required availability**.
- Flow/probability evaluation completed with three company reports and six nested reports. No model/factor/regime/probability promotion is supported.
- Evidence root, excluded from Git: `worker/.runs/thirteenf-remediation-20261104T094500Z`.

The one inserted event is not a rewrite of the existing 16,912 events. Existing valid events and all other sources/signalTypes were preserved. No repaired-alpha or production-readiness claim is made.

## 2. Preflight and scheduler evidence

| Check | Evidence |
|---|---|
| Git | After reading the new reviewed commit, local branch was fast-forwarded to `ab914fc`. Pre-existing generated/runtime diffs were preserved and excluded. |
| Scheduler | Initial snapshot: `current=null`, `queue=[]`, heartbeat `2026-11-04T09:41:42.371Z`; one process chain 18324 → 5216 → 16940 → 15548 → 16164. |
| Web | HTTP 200 from `http://127.0.0.1:3000/`; one listener PID 5440, parent cmd 15664. |
| Ingest | Existing `INGEST_URL` classification local; value not printed. |
| MySQL | `SELECT 1` succeeded through existing application configuration; no credentials printed. |
| Backup | Completed before any DB write. No mass deletion or blind `--rebuild-events` was attempted. |

An existing `edgar-fetch-daily` cron (`1793786412744-edgar-fetch-daily`) subsequently became active at `2026-11-04T10:00:12.744Z`. The dry-run/remediation was stopped until terminal state. No process was killed and no duplicate collector was started. Audit started only after the monitor showed `current=null` and `queue=[]`. Evidence: `blocked-scheduler.json` and the existing cron log.

## 3. Mandatory backup

Before any DB mutation, the backup captured complete rows with `id, cik, source, signalType, eventTs, ingestedAt, payloadKey, score, magnitude, note, src`.

| Evidence | Count / bytes | SHA256 |
|---|---:|---|
| `backup-signals.json` — all position rows | 16,912 / 7,784,769 | `07157e2d0341845e8e98c2647d2cfd9f013ad2fa65dbc624c1f8e789bffb16f9` |
| `backup-fund-quarters.json` — fundCik/quarterDate/accessionNo/filingDate | 3,416 / 548,894 | `95bb3337a857fc20123e6b6ecb44c697f5f215703eeae9a99048e08b296706c0` |
| `operations-state.json` | scheduler state before repair | Preserved in the evidence root |
| `audit-backup-signals.json` — independent audit backup | 7,784,769 | `21f630250c99d87856666abcb51e262818a1ba926046d70f5531cd181f3732ab` |
| `post/audit-backup-signals.json` — independent post-rebuild backup | 7,785,223 | `e6cd1ddee4e7b6df3cbcb281421a31078e452c2758577e814d13abeb8e0e1dd7` |

`fund_holdings` contains **879,289 rows**. Backups were not deleted or overwritten; the post-rebuild audit used a separate `post/` directory. `backup-manifest.json` records `beforeAnyDbWrite=true`.

The initial raw-string backup query failed before reading rows. Schema inspection and parameterized queries fixed the diagnostic without any DB write. This was not a collector retry.

## 4. Audit classes and exact outcome

`payloadKey` was parsed as `13f:pos:<fundCik>:<heldCik>:<secClass>:<accessionNo>`. Accession lineage was matched to holdings and fund_quarters before comparing `eventTs` with actual merged-book availability.

| Class | Count | Exact reason / required action |
|---|---:|---|
| A. VALID | **16,912** | `eventTs` matches actual merged-book availability. Preserve without changes. |
| B. STALE_FALLBACK | **0** | No row required replacement by actual availability. |
| C. MISSING_REQUIRED_AVAILABILITY | **0** | No event required exclusion for missing required metadata. |
| D. DUPLICATE | **0** | No duplicate by `cik/source/signalType/eventTs/payloadKey`. |
| E. UNKNOWN | **0** | No unparsed, ambiguous, conflicting or future-dated evidence requiring manual review. |

`audit.json` contains the exact row IDs and reasons for every input row, not only aggregate counts. The independent post-rebuild audit contains **16,913 VALID / 0 / 0 / 0 / 0** and `deleteCandidates=0`, `missingAvailabilityQuarters=0`.

## 5. Safe remediation contract

`worker/lib/thirteenf-event-remediation.ts` and `scripts/13f-remediate-events.mts` implement:

- default **DRY-RUN**, with explicit `--apply` required for mutation;
- a machine backup and SHA256 manifest before any apply;
- a fingerprint check to reject stale apply if the audited rows changed;
- exact-ID deletes only for proven STALE_FALLBACK, MISSING_REQUIRED_AVAILABILITY and noncanonical DUPLICATE rows;
- deterministic lowest-ID canonical preservation for duplicate groups;
- VALID and UNKNOWN rows never deleted or overwritten automatically;
- one transaction, rollback on error, batches of at most 500 IDs;
- before/after reports and idempotent apply with no implicit insertion;
- event creation delegated to the existing DB-only `--rebuild-events`, not to an unreviewed ad hoc writer;
- scope limited to `source='13f' AND signalType='position'` and local MySQL only.

Actual apply returned `dryRun=false`, `batches=0`, `affectedRows=0`, with zero deleted rows for every class. This is the correct result for the all-VALID audit, not a hidden repair.

Regression coverage: **3 targeted files / 15 tests**, including fallback replacement, amendment MAX, missing metadata, duplicate preservation, VALID/UNKNOWN/other-source preservation, rollback, post-apply zero pending and repeated-apply idempotency. Full suite: **119 files / 681 tests**, TypeScript and production build passed with established chunk-size warnings. See `source-tests.json`.

## 6. DB-only event rebuild and post-verification

Exactly one invocation was made after audit and tests:

```text
npx tsx scripts/13f-refresh.mts --rebuild-events
```

It ran from `2026-11-04T10:26:31Z` to `2026-11-04T10:40:24Z` and exited 0:

```text
rebuild-events: 1 rows inserted; 0 quarter(s) skipped for missing filing availability
```

No `--quarters`, `--totals-only`, scheduler request or second rebuild was used. The first fund completed `rebuilt so far 0`; later funds used the shared caches and the process completed normally.

The inserted row is:

- id `168239`, held CIK `1274494`;
- `source='13f'`, `signalType='position'`, `src='backfill'`;
- `eventTs='2026-08-14 00:00:00'`;
- `payloadKey='13f:pos:1029160:1274494:COM:0000902664-26-003507'`;
- note: `Soros Fund Management: new position 100,000 sh ($24M · 0.3% of fund · 0.1% of co · held by 214 funds)`.

Its fund quarter metadata is `fundCik=1029160`, `quarterDate=2026-06-30`, `accessionNo=0000902664-26-003507`, `filingDate=2026-08-14 00:00:00`, exactly matching `eventTs`. This is real filing availability, not quarter-end or quarter+45d.

Read-only verification (`post-rebuild-verification.json` and `post/audit.json`) confirmed:

| Check | Result |
|---|---:|
| Position events before / after | 16,912 → 16,913 |
| New events inserted by rebuild | 1 |
| Duplicate groups by UQ columns | 0 |
| STALE_FALLBACK rows | 0 |
| MISSING_REQUIRED_AVAILABILITY rows | 0 |
| UNKNOWN rows | 0 |
| Fund-quarter metadata with null filingDate | 0 |
| Delete candidates after rebuild | 0 |

## 7. Flow availability protocol and coverage

The frozen protocol in `flow-protocol.json` preserves the production universe/panel, models, thresholds, weights, pooling, anchors, cost model, holdout and regime fields. Evaluation used:

- `evaluateCompany` for AAPL, NVDA and MSFT;
- `nestedEvaluate` for the same three panel CIKs and bayes/logistic;
- `buildSmartMoneyFlowPoints` for aggregate flow availability.

Aggregate availability is `MAX(actual filingDate)` across every required fund/book and both quarters. Missing required metadata produces no PIT flow input. There is no quarter+45d fallback.

| Ticker | Existing factor_points | Computed flow points | Flow observation range | Latest MAX availability | Missing evaluated company anchors | Skipped quarters / missing funds |
|---|---:|---:|---|---|---:|---|
| AAPL | 0 | 14 | 2023-06-30 → 2026-09-30 | **2026-10-22** | 393 / 485 | 0 / 0 |
| NVDA | 0 | 14 | 2023-06-30 → 2026-09-30 | **2026-10-22** | 393 / 485 | 0 / 0 |
| MSFT | 0 | 14 | 2023-06-30 → 2026-09-30 | **2026-10-22** | 393 / 485 | 0 / 0 |

`skippedQuarters=[]` and `missingFundCiks=[]` for all three companies. The 393 ineligible anchors per company occur before the first computed flow availability (`2023-08-14`). They are not replaced with older non-null or estimated flow values.

Existing `factor_points` is **not a snapshot of pre-remediation `signalSeries` output**. Therefore `beforeFactorPointCount=0` must not be interpreted as proof that 14 new flow points were created by this repair. Comparison with older results is historical only, not direct same-DB pre/post.

## 8. Company probability metrics

| Ticker | Anchors | Current anchor | Current P | Macro prior | Backtest baseline up | Hit ≥60% | Hit <60% |
|---|---:|---|---:|---:|---:|---:|---:|
| AAPL | 211 | 2026-11-03 | 94.8239% | 50.0000% | 60.6635% | 59.0909% | 60.8466% |
| NVDA | 176 | 2026-10-22 | 79.8096% | 50.0000% | 68.7500% | 62.7907% | 70.6767% |
| MSFT | 224 | 2026-10-28 | 86.5666% | 50.0000% | 56.2500% | 45.0980% | 59.5376% |

## 9. Nested accuracy, cost, holdout and pooling

| Ticker | Model | n | Accuracy | Balanced | Up acc | Down acc | Majority | Cost return | Max DD | Holdout acc / return | Pooling rows / intercept |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| AAPL | bayes | 53 | 45.2830% | 50.0000% | 45.2830% | — | 54.7170% | 12.2834% | 23.1703% | 75% / 7.6707% | bayes |
| AAPL | logistic | 53 | 54.7170% | 57.1839% | 50.0000% | 69.2308% | 54.7170% | −2.9052% | 23.1703% | 25% / 0.0000% | 318 / 99 · 0.835886 |
| NVDA | bayes | 43 | 55.8140% | 49.5370% | 62.5000% | 36.3636% | 62.7907% | 36.6532% | 19.5495% | 100% / 5.8290% | bayes |
| NVDA | logistic | 43 | 62.7907% | 50.0000% | 62.7907% | — | 62.7907% | 89.4698% | 19.3000% | 100% / 5.8290% | 310 / 84 · 0.502696 |
| MSFT | bayes | 55 | 49.0909% | 51.5406% | 39.3939% | 63.6364% | 61.8182% | −25.2499% | 25.2499% | 100% / 24.1404% | bayes |
| MSFT | logistic | 55 | 38.1818% | 50.0000% | 38.1818% | — | 61.8182% | −38.1097% | 38.1097% | 100% / 24.1404% | 238 / 107 · 0.142877 |

Pooling is shown as panel training rows / target-known rows and shrunk intercept. Four-anchor holdouts are too small to select a winner or infer robust alpha, especially where all predictions are up.

## 10. Regime metrics

| Ticker | Model | Bull n / accuracy | Bear n / accuracy |
|---|---|---|---|
| AAPL | bayes | 46 / 50.0000% | 7 / 14.2857% |
| AAPL | logistic | 46 / 54.3478% | 7 / 57.1429% |
| NVDA | bayes | 38 / 57.8947% | 5 / 40.0000% |
| NVDA | logistic | 38 / 65.7895% | 5 / 40.0000% |
| MSFT | bayes | 43 / 48.8372% | 12 / 50.0000% |
| MSFT | logistic | 43 / 34.8837% | 12 / 50.0000% |

## 11. Macro prior and historical comparison

Current macro vintage selection for VIXCLS, BAMLH0A0HYM2 and T10Y2Y remains empty, consistent with the earlier finding that the only stored windows have `realtimeStart = realtimeEnd = 2026-10-19`. Consequently, the production `macroPrior()` remains the neutral **0.5 fallback**. No macro vintage backfill was started.

Comparisons with older documented nested results are **historical only**, not direct same-DB pre/post and not causal attribution. No previous DB snapshot or old worktree was used. Metrics are descriptive evidence, not a promotion decision.

## 12. Command ledger and failures kept visible

| Command / step | Exit | Result |
|---|---:|---|
| Baseline/fetch, scheduler/process, HTTP, local-ingest and MySQL checks | 0 | One scheduler chain, one listener, local configuration |
| Initial raw-string backup query | 1 | Failed before reading rows; schema and parameterized query diagnosed, no DB mutation |
| Full parameterized signal/fund_quarters backup | 0 | 16,912 events / 879,289 holdings / 3,416 quarters |
| Default dry-run `scripts/13f-remediate-events.mts` | 0 | 16,912 VALID / 0 delete candidates |
| Apply `--apply` | 0 | 0 affected rows / 0 batches |
| Single `scripts/13f-refresh.mts --rebuild-events` | 0 | 1 inserted event / 0 skipped metadata |
| Post-rebuild dry-run and verification queries | 0 | 16,913 VALID / 0 duplicates / 0 missing availability |
| Targeted remediation tests | 0 | 3 files / 15 tests |
| `npm run check` | 0 | TypeScript passed |
| `npm test -- --run` | 0 | 119 files / 681 tests |
| `npm run build` | 0 | Passed with established chunk-size warnings |
| Flow evaluation | 0 after diagnosed import fix | Full JSON and Markdown verified before DB close |

The first dry-run CLI stopped at an esbuild single-line-if transform error, before executing the audit. A minimal reproduction confirmed the syntax issue; a parser-fix source commit was created and the dry-run then passed. The first flow evaluation stopped at a package-path import error before DB connection; `drizzle-orm` was changed to a normal package import and the same evaluation then completed. No research builder or collector was blindly retried.

The first source push at `2026-11-04T10:16:00Z` was rejected by GitHub `Internal Server Error`, not non-fast-forward. No immediate retry was made. After the parser fix and evidence checkpoint, ordinary fast-forward push of both source commits succeeded: `ab914fc..29acca9`.

## 13. Evidence integrity

Complete index `evidence-index.json` and verification `evidence-verification.json`: **40/40 artifacts checked, zero SHA256 mismatches** at `2026-11-04T10:56:01.405Z`.

Core artifacts and hashes:

- `flow-probability-evaluation.json`: **242,588 bytes**, SHA256 `43c0d196e74a274223767d6aaac07800352469f605ed34688f64523134cb8b70`.
- `flow-probability-evaluation.md`: **2,618 bytes**, SHA256 `e8d2c65d2c40966a10c5d0da20195be33d923659ab304da6b45199a8552c4440`.
- `backup-signals.json`: SHA256 `07157e2d0341845e8e98c2647d2cfd9f013ad2fa65dbc624c1f8e789bffb16f9`.
- `backup-fund-quarters.json`: SHA256 `95bb3337a857fc20123e6b6ecb44c697f5f215703eeae9a99048e08b296706c0`.

The JSON was fully written and parsed before the database pool closed. No timeout, manual kill or second evaluation occurred. `flow-probability-evaluation-hashes.json` records both output hashes. `command-ledger.json`, `source-tests.json`, `project-state-before.*`, `project-state-after.*`, `project-state.diff`, `evidence-index.json` and `evidence-verification.json` complete the evidence chain.

## 14. Remaining limitations and next safe block

- Macro prior remains a neutral fallback because eligible macro vintages are absent. This must be remediated separately before relying on macro evidence.
- Flow availability is absent for 393/485 evaluated anchors per company; no fallback was invented.
- Small holdouts and always-up baselines do not support repaired alpha, model promotion or production readiness.
- The next reviewed block is **macro vintage-data remediation**, then **Statements netDebt/ROE/ROA historical rebuild/evaluation**, **F-15/F-16**, **Atlas coverage from new documented exposure evidence**, and **production/security findings**.
- No SEC collectors, Company Exposure/Scenario/Atlas rebuild, Statements rebuild, macro backfill, production apply/deploy/sync, migration or production URL was used.
