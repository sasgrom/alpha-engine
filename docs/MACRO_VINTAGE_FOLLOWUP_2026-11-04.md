# Reviewed macro vintage follow-up — 2026-11-04

## 1. Scope and actual outcome

- Reviewed baseline: `e65a26afecaed19e3036c6c7a0a9eb87ce86b034` (`Document partial macro vintage remediation`). HEAD and `origin/main` matched; pre-existing generated/runtime diffs were preserved.
- Source commit, pushed by ordinary fast-forward: **`ed939f307be66d5120193a914ae0ad6abd2c173f`** — `Add reviewed macro window remediation`.
- Evidence root, excluded from Git: `worker/.runs/macro-vintage-followup-20261104T181640Z`.
- Completed: exact-ID repair of five erroneous one-day vintage closures, backed by official normalized FRED evidence and one committed transaction.
- Also completed: collector registry correction for monthly FEDFUNDS, comma-separated backfill series support, read-only coverage verification and frozen probability evaluation.
- **Not completed:** official FEDFUNDS archive collection and the six-series follow-up backfill. The only allowed FEDFUNDS command failed before any network request because its registry entry was missing. No retry was made, no archive exists, and no six-series apply was started.
- Overall macro remediation therefore remains **partial**, not complete. No repaired alpha, model promotion or production readiness is claimed.

## 2. Fail-closed guard evidence

Every operational apply/collector command was a separate tool invocation. No apply followed a failed guard in the same shell chain.

| Time UTC | Guard / action | Result |
|---|---|---|
| 18:16:40 | Initial combined read-only guard | **pass**: scheduler idle/current, no macro jobs, one web listener and scheduler chain, MySQL 133,381 rows, local ingest, clean QA |
| 18:32:15 | Exact-ID dry-run | Five evidence-backed diffs, zero mismatches, zero DB writes |
| 18:32:40 | Complete backup before exact repair | 133,381 rows with SHA256 and fingerprint |
| 18:33:00 | Guard before first exact apply | **fail**: scheduler non-idle. **Apply did not run.** |
| 18:33–18:34 | Read-only wait | Scheduled Stocktwits and queued Alpha Bridge completed naturally; no kill or state edit |
| 18:34:51 | Full guard repeated after natural idle | **pass** |
| 18:39:54 | Full guard after timestamp-normalization fix | **pass** before the successful exact transaction |
| 18:42:34 | Full guard before one FEDFUNDS command | **pass**; the collector subsequently failed on missing registry mapping before network activity |

The first exact apply stopped before its first UPDATE because the raw locked timestamp representation differed from the Date-based plan. The later successful transaction occurred only after proving equivalent UTC values, adding normalization and a regression test, and passing a fresh guard. No failed guard was bypassed and no process was killed.

## 3. Exact-ID diff and backup hashes

The dry-run checked each ID against official normalized rows: series, observationPeriod, realtimeStart, value and `supersededAt=null`. Legacy `realtimeEnd` had to equal `realtimeStart`. Any mismatch would have blocked all five updates.

| ID | Series | observationPeriod | realtimeStart | Value | realtimeEnd before → after |
|---:|---|---|---|---:|---|
| 44671 | DGS10 | 2026-10-16 | 2026-10-19 | 5.09 | 2026-10-19 → **NULL** |
| 46182 | DGS2 | 2026-10-16 | 2026-10-19 | 4.74 | 2026-10-19 → **NULL** |
| 47694 | T10Y2Y | 2026-10-19 | 2026-10-19 | 0.38 | 2026-10-19 → **NULL** |
| 31824 | CPIAUCSL | 2026-09-01 | 2026-10-14 | 336.298 | 2026-10-14 → **NULL** |
| 32769 | UNRATE | 2026-09-01 | 2026-10-02 | 4.2 | 2026-10-02 → **NULL** |

No `date`, `realtimeStart`, `value`, `fetchedAt` or other row was changed. The saved plan fingerprint was `74d17eae0ed459220281d4dfb7acde7241d4bed397f9a9f2268be8bb1a79ccdc`.

| Backup | Rows | Bytes | SHA256 | Exact table fingerprint |
|---|---:|---:|---|---|
| Before exact repair | 133,381 | 27,912,648 | `8cf67f91e327f69bba141869633fa03fbfd555df20b6a3c65cefdd1ee07561c5` | `45b28ffa709c8f77579c25e624d4b04637609e1fee17af31f53d6f0fb2a8bf9b` |
| After exact repair | 133,381 | 27,912,608 | `84a1374be251e7ed9e50d73decdd9554dd3ad9b122ccb4e0f4d4b7175a889ca9` | `7f327db46a249f32eb1c80000748e6adb41526c96bf250d15c1ef2a9db06efc0` |

The only committed exact-ID transaction updated **five rows**. Post-verification is **pass**:

- changed rows: **5**;
- unchanged rows: **133,376**;
- new rows: **0**;
- unexpected row/field changes: **0**;
- duplicate vintage groups: **0**;
- availability inversions and null realtime starts: **0 / 0**;
- all five exact IDs now have official open-ended windows.

The earlier failed attempt did not issue an UPDATE. It exposed that raw MySQL returns `fetchedAt` as `2026-10-19 19:44:01`, while the Date-based read returns `2026-10-19T19:44:01.000Z`. UTC normalization was added for comparison only, with a regression test. No timestamp was rewritten.

The original apply artifact has top-level `status="planned"` because the saved plan spread overwrote the computed status. Its `apply.updatedRows=5` and independent `exact-id-post-verification.json` is `pass`. The CLI field ordering was corrected in the source commit; no additional apply was performed to regenerate a prettier status.

## 4. FEDFUNDS official archive: failed before collection

Exactly one command was attempted:

```text
npx tsx worker/macro-fred-fetch.mts --series FEDFUNDS
```

Result: **exit 1**.

```text
Unknown FRED series FEDFUNDS; add it to macro-sources.ts deliberately.
```

`selectMacroSeries` runs before `prepareMacroRoot` and before any network request. The failure therefore did not contact FRED and did not create a manifest entry, raw directory or normalized archive. `DFF` was not substituted and the command was not retried.

| Check | Evidence |
|---|---|
| Network request sent | **No** — registry selection failed first |
| Manifest `FEDFUNDS` entry | Absent |
| `raw/fred/FEDFUNDS` directory | Absent |
| `normalized/fred/FEDFUNDS.json` | Absent |
| Official rows/vintages | **Unavailable**; no values invented |
| Raw/normalized hashes | **Unavailable**; no hash invented |
| Retry count | **0** |
| Post-fetch QA | Not run because fetch did not succeed |

The source registry now distinguishes monthly `FEDFUNDS` (`rates` / `effective_federal_funds_monthly`) from daily `DFF` (`effective_federal_funds`). Complete future manifests, QA and health expect **22 series**, but no 22-series collection or QA pass is claimed. The existing 21-series QA is historical evidence only. A separate reviewed targeted fetch is required after this source correction.

## 5. Six-series follow-up backfill: not run

The required official FEDFUNDS archive is missing. Running an apply without it would silently shrink the requested six-series scope, so **no follow-up dry-run or apply was executed**.

| Series | Follow-up inserted rows | Reason |
|---|---:|---|
| DGS10 | 0 | Six-series apply blocked by missing FEDFUNDS archive |
| DGS2 | 0 | Same blocker |
| T10Y2Y | 0 | Same blocker |
| FEDFUNDS | 0 | One targeted fetch failed before collection; no retry |
| CPIAUCSL | 0 | Six-series apply blocked by missing FEDFUNDS archive |
| UNRATE | 0 | Same blocker |
| **Total follow-up rows** | **0** | **No six-series backfill run** |

The total table remains **133,381 rows**: 47,901 original rows, 85,480 previously restored rows and only the five exact realtimeEnd changes in this block. VIXCLS and BAMLH0A0HYM2 were not backfilled again. The new comma-separated series parser is tested, but no live follow-up apply used it.

## 6. Coverage verification

Read-only verification compared the current table with both the initial 47,901-row backup and the fresh pre-exact backup.

- **0 missing original IDs** from the initial 47,901;
- **0 unexpected original row/value mismatches**;
- exactly **five approved realtimeEnd changes**;
- selected-after-anchor in fixed probes: **0**;
- duplicate or conflicting vintage groups: **0**;
- availability inversions: **0**;
- null realtime starts: **0**.

| Series | Rows | Current selected ID / observation / start / end / value | Current status |
|---|---:|---|---|
| DGS10 | 11,511 | 44671 · 2026-10-16 · 2026-10-19 · NULL · 5.09 | eligible |
| DGS2 | 11,511 | 46182 · 2026-10-16 · 2026-10-19 · NULL · 4.74 | eligible |
| T10Y2Y | 11,512 | 47694 · 2026-10-19 · 2026-10-19 · NULL · 0.38 | eligible |
| FEDFUNDS | 936 | none | **missing official monthly archive** |
| CPIAUCSL | 1,026 | 31824 · 2026-09-01 · 2026-10-14 · NULL · 336.298 | eligible |
| UNRATE | 1,014 | 32769 · 2026-09-01 · 2026-10-02 · NULL · 4.2 | eligible |
| BAMLH0A0HYM2 | 2,503 | 61711 · 2026-11-02 · 2026-11-02 · NULL · 3.43 | eligible |
| VIXCLS | 93,368 | 145480 · 2026-11-02 · 2026-11-02 · NULL · 21.15 | eligible |

`latestMacro(asOf)` returns **seven series** with current realtime windows. FEDFUNDS has no current value and no neutral/current substitute was introduced. Current 7/8 eligibility does **not** mean the missing six-series historical backfill happened.

## 7. Frozen probability evaluation

The existing frozen protocol was preserved: `evaluateCompany` for AAPL 320193, NVDA 1045810 and MSFT 789019; `nestedEvaluate` for the same panel with bayes/logistic; `latestEligibleMacroPoint` and production `macroPriorAt` for macro coverage. No `macro-validation.mts` substitute was used.

Parameters remain unchanged: 63-session horizon; chronological 50% fit / 25% calibration / 25% evaluation; final four-anchor holdout excluded from fit/calibration/thresholding/selection; isotonic PAVA identity below eight known points; threshold 0.5; pooling tau 8; non-overlapping long/cash excess-vs-SPY, initial cash, 5bp commission + 10bp slippage; bull/bear by SPY 63-session return. Models, weights, pooling, universes and evaluation protocol were unchanged.

The 716,208-byte JSON was completely written, parsed and hashed before the DB pool closed. The process exited 0 in about 25 seconds, without timeout or another evaluation.

| Coverage | Result |
|---|---:|
| Unique anchors / checks | 485 / 1,455 |
| Eligible selections | 472 |
| Missing selections | 983 |
| Complete three-series anchors | **0** |
| Selected-after-anchor | **0** |
| Anchors with no eligible series | 97 |
| Anchors missing at least one series | 485 |

Per-series evaluated coverage: VIXCLS **388 eligible / 97 missing**, BAMLH0A0HYM2 **84 / 401**, T10Y2Y **0 / 485**. The exact T10Y2Y current window is now open-ended (id 47694, value 0.38), but evaluated anchors predate its `2026-10-19` availability. Without the blocked historical backfill, curve coverage cannot improve retroactively.

Macro prior distribution is unchanged from the previous partial evaluation: **0.54 × 224**, **0.42 × 35**, **0.50 × 226**. There are 259 non-neutral prior anchors; current company-level macro prior remains **0.50** for all three companies.

## 8. Company and nested metrics

| Ticker | Anchors | Current P | Current macro prior | Backtest baseline up | Hit ≥60% | Hit <60% |
|---|---:|---:|---:|---:|---:|---:|
| AAPL | 211 | 94.2217% | 50% | 61.6114% | 58.3333% | 62.0321% |
| NVDA | 176 | 66.2406% | 50% | 69.8864% | 62.2222% | 72.5191% |
| MSFT | 224 | 82.8598% | 50% | 56.2500% | 47.4576% | 59.3939% |

| Ticker / model | Accuracy / balanced | Up / down accuracy | Always-up / majority | Cost return / max DD | Holdout acc / return | Pooling |
|---|---|---|---|---|---|---|
| AAPL bayes | 49.0566% / 50.0000% | 49.0566% / — | 49.0566% / 50.9434% | 9.8303% / 21.9507% | 75% / 8.8876% | bayes |
| AAPL logistic | 54.7170% / 55.1994% | 52.5000% / 61.5385% | 49.0566% / 50.9434% | −5.0282% / 21.9507% | 25% / 0% | 318/99 · 0.813084 |
| NVDA bayes | 32.5581% / 31.5271% | 50.0000% / 17.3913% | 67.4419% / 67.4419% | 64.1608% / 3.3785% | 100% / 4.1076% | bayes |
| NVDA logistic | 67.4419% / 50.0000% | 67.4419% / — | 67.4419% / 67.4419% | 104.3092% / 14.4502% | 100% / 4.1076% | 310/84 · 0.481908 |
| MSFT bayes | 50.9091% / 54.8319% | 41.6667% / 68.4211% | 38.1818% / 61.8182% | −22.9173% / 22.9173% | 100% / 28.1268% | bayes |
| MSFT logistic | 38.1818% / 50.0000% | 38.1818% / — | 38.1818% / 61.8182% | −35.5847% / 35.5847% | 100% / 28.1268% | 238/107 · 0.138182 |

Regime accuracy:

| Ticker / model | Bull n / accuracy | Bear n / accuracy |
|---|---|---|
| AAPL bayes | 46 / 54.3478% | 7 / 14.2857% |
| AAPL logistic | 46 / 54.3478% | 7 / 57.1429% |
| NVDA bayes | 38 / 36.8421% | 5 / 0% |
| NVDA logistic | 38 / 71.0526% | 5 / 40% |
| MSFT bayes | 43 / 51.1628% | 12 / 50% |
| MSFT logistic | 43 / 34.8837% | 12 / 50% |

Costs use non-overlapping windows, not sums of overlapping 63-session returns. Four-anchor holdouts and always-up predictions are not evidence for choosing a model.

## 9. Historical comparison only

The comparison source is the previous partial evaluation at `worker/.runs/macro-vintage-remediation-20261104T121416Z/macro-probability-evaluation.json`, SHA256 `8dacdf8938141a93ed88f44654c3daa29f48f6da32878b4bbfbaf8ee10d77d11`.

| Ticker / model | Previous partial accuracy | Current accuracy | Previous / current holdout |
|---|---:|---:|---|
| AAPL bayes | 49.0566% | 49.0566% | 75% / 75% |
| AAPL logistic | 54.7170% | 54.7170% | 25% / 25% |
| NVDA bayes | 32.5581% | 32.5581% | 100% / 100% |
| NVDA logistic | 67.4419% | 67.4419% | 100% / 100% |
| MSFT bayes | 50.9091% | 50.9091% | 100% / 100% |
| MSFT logistic | 38.1818% | 38.1818% | 100% / 100% |

These are historical comparisons, not direct same-DB pre/post or causal attribution. No old worktree was used and no best result was selected. The unchanged nested metrics are consistent with no new historical six-series backfill; they are not proof that the remaining work is unnecessary.

## 10. Commands, failures and fixes

| Command / check | Exit | Outcome |
|---|---:|---|
| Baseline/fetch and initial unified guard | 0 | Reviewed HEAD matched; all prerequisites passed |
| First targeted fixture suite | 1 | Two fake-driver failures; no real SQL or DB mutation |
| SQL trace and corrected StringChunk test harness | 0 | Exact fake-driver cause established; production transaction not weakened |
| Exact-ID dry-run | 0 | Five planned diffs / zero mismatches |
| Complete backup before exact repair | 0 | 133,381 rows, SHA256 and fingerprint |
| First guard before exact apply | **1** | Non-idle scheduler; **apply not run** |
| Read-only wait and full guard retry | 0 | Natural idle followed by a new complete pass |
| First exact apply attempt | **1** | Stopped before first UPDATE on raw timestamp representation mismatch |
| UTC-normalization regression and targeted tests | 0 | **3 files / 26 tests passed** at that stage |
| Guard after normalization fix | 0 | Full pass before exact apply |
| Successful exact apply | 0 | One committed transaction, **5 rows**, independent post-check pass |
| Independent exact post-check | 0 | 5 changed / 133,376 unchanged / 0 new / 0 unexpected |
| Guard before FEDFUNDS | 0 | Full pass |
| Single `macro-fred-fetch.mts --series FEDFUNDS` | **1** | Missing registry entry; failed before network; no retry |
| Six-series follow-up backfill | **not run** | Official FEDFUNDS archive absent |
| Read-only coverage verification | 0 | Partial: 7/8 current eligible; all original IDs accounted for |
| Frozen probability evaluation | 0 | Complete JSON/Markdown; no timeout or repeat |
| Source targeted tests | 0 | **5 files / 31 tests** |
| Source full gates | 0 | **122 files / 698 tests**, TypeScript/build and diff check |
| Source commit/push | 0 | `ed939f3`, ordinary fast-forward |

## 11. Verification and hashes

Source targeted suites passed **5 files / 31 tests**, including exact planned diffs, mismatch rejection, rollback, raw timestamp normalization, other-row preservation, backup fingerprint, comma-separated parsing and monthly/daily registry distinction. Source full gates passed `npm run check`, **122 files / 698 tests**, `npm run build` with established chunk warnings, and `git diff --check`.

Core evidence hashes:

- before-exact backup: `8cf67f91e327f69bba141869633fa03fbfd555df20b6a3c65cefdd1ee07561c5`;
- after-exact backup: `84a1374be251e7ed9e50d73decdd9554dd3ad9b122ccb4e0f4d4b7175a889ca9`;
- probability JSON: 716,208 bytes, SHA256 `972f8cd954bc98e7efcb1dda2f96014a9cba6446e541957397bb0856e57a7326`;
- probability Markdown: 3,681 bytes, SHA256 `d0ab8c1569a6bb439d967710e9a7546307287c9567195d1524ba4a72c7795d95`.

The SHA256 evidence index covers guards, dry-run/plan, both backups, failed apply, successful apply, exact post-check, FEDFUNDS failure, coverage, evaluation, command logs, tests, source/docs delivery and Project State before/after. The final verification records actual checked counts and any mismatches; no historical count is assumed.

## 12. Remaining blockers and next safe action

1. **Monthly FEDFUNDS archive is still absent.** The source registry is corrected for the next reviewed run, but no successful collection exists.
2. **Six-series backfill has not run.** DGS10, DGS2, T10Y2Y, FEDFUNDS, CPIAUCSL and UNRATE received zero new rows in this block. Their five exact current conflicts are resolved, but historical normalized vintages have not been materialized by this follow-up.
3. Current macro coverage is **7/8**, while evaluated curve history remains 0/485. No anchor has complete three-series evidence.
4. Project State must remain **partial**. The next safe block is one newly reviewed targeted FEDFUNDS fetch after the registry fix, then clean QA, a fresh backup and one reviewed six-series backfill with a strict fail-closed guard. Only after those blockers are proven resolved should the queue advance to **Statements netDebt/ROE/ROA historical rebuild/evaluation**, then F-15/F-16, Atlas coverage and production/security.

No full FRED refresh, SEC/13F/Statements/Atlas rebuild, F-15/F-16 work, VIXCLS/BAMLH0A0HYM2 repeat backfill, schema change, DFF substitution, production apply/deploy/sync, reset/stash/hard reset/force-push or credential inspection occurred.
