# FEDFUNDS and six-series macro vintage completion — 2026-11-04

## 1. Reviewed scope and outcome

- Reviewed HEAD at the start: `1c0c0c8d6df9f0f7a4178352e7ef755a5cdcdc16`, not the older baseline in the repeated request. The newer `ed939f3` and `1c0c0c8` commits were read before acting.
- Existing source commit reused: **`ed939f307be66d5120193a914ae0ad6abd2c173f`**. It already contains exact-ID planning/transaction, monthly FEDFUNDS registry mapping and comma-separated backfill support with tests. No additional source change or empty source commit was needed in this block.
- This block addressed only the remaining FEDFUNDS archive and six-series backfill. **The exact-ID transaction was not repeated:** all five target rows already had `realtimeEnd=NULL` in the current database.
- One targeted FEDFUNDS fetch succeeded and QA passed for 22 registered series. One comma-separated six-series apply inserted **275,481 rows** with zero conflicts/errors.
- Independent coverage verification is **complete**: **408,862 total rows**, **8/8 current eligible series**, **275,481 expected new rows**, zero original/preexisting/source mismatches, duplicates, inversions or selected-after-anchor.
- Evidence root, excluded from Git: `worker/.runs/macro-vintage-fedfunds-20261104T192256Z`.

Macro remediation is now complete for the reviewed eight curated series and their available official FRED/ALFRED history. This does not imply full coverage for every historical anchor, predictive alpha, model promotion or production readiness.

## 2. Existing exact-ID repair and backups

The prior reviewed transaction had already changed only these fields:

| ID | Series | observationPeriod | realtimeStart | Value | Approved change |
|---:|---|---|---|---:|---|
| 44671 | DGS10 | 2026-10-16 | 2026-10-19 | 5.09 | 2026-10-19 → NULL |
| 46182 | DGS2 | 2026-10-16 | 2026-10-19 | 4.74 | 2026-10-19 → NULL |
| 47694 | T10Y2Y | 2026-10-19 | 2026-10-19 | 0.38 | 2026-10-19 → NULL |
| 31824 | CPIAUCSL | 2026-09-01 | 2026-10-14 | 336.298 | 2026-10-14 → NULL |
| 32769 | UNRATE | 2026-09-01 | 2026-10-02 | 4.2 | 2026-10-02 → NULL |

Their current values, dates, starts and `fetchedAt` are unchanged. No second update was executed. The new block used a fresh backup of this already repaired state:

| Backup | Rows | Bytes | SHA256 | Fingerprint |
|---|---:|---:|---|---|
| Before six-series backfill | 133,381 | 27,912,608 | `84a1374be251e7ed9e50d73decdd9554dd3ad9b122ccb4e0f4d4b7175a889ca9` | `7f327db46a249f32eb1c80000748e6adb41526c96bf250d15c1ef2a9db06efc0` |
| After six-series backfill | 408,862 | 85,308,483 | `21bbff9dc427a94b9e28f83ff0a3253bf91a28273f5f27f8fb785a4292e03319` | `ad14687c6161a8f0ffd518139f7ebce57c3e385d620ec8bf54e385514af2ef63` |

The apply verified the pre-backfill SHA256 and exact current-table fingerprint. Post-verification confirmed that every preexisting row remained unchanged. When compared with the original 47,901-row backup, exactly the five already approved realtimeEnd changes were present and there were **zero unexpected value mismatches or missing IDs**.

## 3. Guard evidence

| Stage | Result |
|---|---|
| Reviewed HEAD and current exact-ID rows | All five already open-ended; no repeat apply |
| Guard before backup and FEDFUNDS collection | **pass** at 19:22:56Z: scheduler idle/current, no macro job, one scheduler chain and web listener, MySQL 133,381, local ingest, clean existing QA |
| Guard after successful fetch and QA | **pass** at 19:26:20Z: scheduler still idle, no macro collector/builder, same local prerequisites |
| Six-series dry-run | **complete**, 275,481 planned, 0 conflicts / 0 missing availability / 0 errors |
| Six-series apply | **complete / exit 0**, 275,481 inserted / 0 errors; one invocation only |
| Post-backfill coverage | **complete**, all eight current eligible; all source and preservation checks passed |

No apply followed a failed guard, no scheduler state was manually changed, and no process was killed. No semicolon-separated guard/apply chain was used. The previous exact-ID guard incident was not repeated.

## 4. FEDFUNDS official archive and QA

Exactly one targeted command ran in this new reviewed block:

```text
npx tsx worker/macro-fred-fetch.mts --series FEDFUNDS
```

Result: **exit 0 / complete / alfred_vintages**, with zero collector errors and no `--group all`, `--force` or DFF substitution.

| Evidence | Actual value |
|---|---|
| Normalized vintage rows | **4,510** |
| Observations | **2000-01-01 → 2026-10-01** |
| Official vintages | **2000-02-08 → 2026-11-02** |
| Realtime chunks | 27 yearly chunks; **54 chunk files** |
| Null availability starts | **0** |
| Open-ended rows | **322** |
| Null values | **0** |
| Availability inversions | **0** |
| Normalized SHA256 | `1353c310b5d09b39acdd3912bede88ea9b24582bc7c2748eff9570a770d4e2a6` |
| Raw-observation SHA256 | `2f880c343538a8f80cbd638608ede4d1d29e1d1df89139365b17debc5d2a07dc` |

All three manifest raw artifacts match their actual hashes; the normalized rows use the raw-observation source hash. Detailed raw, normalized and chunk hashes are in `fedfunds-evidence.json`.

The following single `npx tsx worker/macro-manifest-qa.mts` completed **pass / 0 errors / 0 warnings** at **2026-11-04T19:24:26.484Z**, covering **22 registered series**. A repeated full guard after fetch and QA also passed.

## 5. One limited six-series backfill

The exact command was:

```text
npx tsx scripts/backfill-macro-vintages.mts --series DGS10,DGS2,T10Y2Y,FEDFUNDS,CPIAUCSL,UNRATE --apply --out worker/.runs/macro-vintage-fedfunds-20261104T192256Z/apply --backup-manifest worker/.runs/macro-vintage-fedfunds-20261104T192256Z/backup/backup-manifest.json
```

Dry-run and apply returned `complete`, with no conflicting series or silent upsert.

| Series | Inserted rows | Existing identical rows preserved | Conflicts / missing availability |
|---|---:|---:|---|
| DGS10 | **94,622** | 1 | 0 / 0 |
| DGS2 | **94,621** | 1 | 0 / 0 |
| T10Y2Y | **71,173** | 1 | 0 / 0 |
| FEDFUNDS | **4,510** | 0 | 0 / 0 |
| CPIAUCSL | **5,773** | 1 | 0 / 0 |
| UNRATE | **4,782** | 1 | 0 / 0 |
| **Total** | **275,481** | **5** | **0 / 0** |

`remainingBlockers=[]` in the apply result. `VIXCLS` and `BAMLH0A0HYM2` were excluded and created **zero new rows** in this block. `ingestMacroPoints` used batches of at most 500; no DELETE/DROP/TRUNCATE or schema change occurred.

The total table changed from **133,381 to 408,862 rows**, exactly matching the 275,481 inserted rows. A second backup captured that final state with SHA256 and fingerprint shown above.

## 6. Current coverage and evidence integrity

Independent read-only verification compared:

1. the current table with all 133,381 pre-backfill rows;
2. the current table with the original 47,901-row backup;
3. every newly inserted row with its official normalized `observationPeriod`, `availableAt`, `supersededAt` and `value`;
4. normalized and raw source hashes with the apply evidence.

All checks passed:

- **0 preexisting mismatches**;
- **0 missing original IDs or unexpected original value changes**, apart from the five already approved realtimeEnd fields;
- **0 exact new-row source mismatches**;
- **0 normalized/raw hash mismatches**;
- **0 duplicate or conflicting vintage groups**;
- **0 availability inversions**;
- **0 null realtime starts**;
- **0 selected-after-anchor** in fixed probes and the full evaluation;
- **0 new rows** for VIXCLS/BAMLH0A0HYM2.

| Series | Rows after | New rows | Current selected ID / observation / start / end / value |
|---|---:|---:|---|
| DGS10 | 106,133 | 94,622 | 240102 · 2026-11-02 · 2026-11-03 · NULL · 4.91 |
| DGS2 | 106,132 | 94,621 | 334723 · 2026-11-02 · 2026-11-03 · NULL · 4.59 |
| T10Y2Y | 82,685 | 71,173 | 405896 · 2026-11-03 · 2026-11-03 · NULL · 0.34 |
| FEDFUNDS | 5,446 | 4,510 | 410406 · 2026-10-01 · 2026-11-02 · NULL · 3.88 |
| CPIAUCSL | 6,799 | 5,773 | 31824 · 2026-09-01 · 2026-10-14 · NULL · 336.298 |
| UNRATE | 5,796 | 4,782 | 32769 · 2026-09-01 · 2026-10-02 · NULL · 4.2 |
| BAMLH0A0HYM2 | 2,503 | 0 | 61711 · 2026-11-02 · 2026-11-02 · NULL · 3.43 |
| VIXCLS | 93,368 | 0 | 145480 · 2026-11-02 · 2026-11-02 · NULL · 21.15 |

`latestMacro(asOf)` now returns **all eight series** using eligible vintages. No missing series received a neutral/current-value substitute.

## 7. Frozen probability evaluation

The frozen protocol was unchanged: `evaluateCompany` for AAPL 320193, NVDA 1045810 and MSFT 789019; `nestedEvaluate` for the same panel with bayes/logistic; `latestEligibleMacroPoint` and production `macroPriorAt`. No `macro-validation.mts` substitute, model/threshold/weight/pooling/universe/protocol changes or parameter tuning was used.

Parameters: 63-session horizon; chronological 50% fit / 25% calibration / 25% evaluation; final four-anchor holdout excluded from fit/calibration/thresholding/selection; isotonic PAVA identity below eight known points; threshold 0.5; pooling tau 8; non-overlapping long/cash excess-vs-SPY with initial cash and 5bp commission + 10bp slippage; bull/bear from SPY 63-session return.

The evaluation produced three company and six nested reports. JSON and Markdown were fully written, parsed and hashed before database close. It exited 0 in about 30 seconds without timeout or another evaluation.

| Coverage | Previous partial | Current |
|---|---:|---:|
| Unique anchors / checks | 485 / 1,455 | 485 / 1,455 |
| Eligible selections | 472 | **794** |
| Missing selections | 983 | **661** |
| Complete three-series anchors | 0 | **84** |
| Selected-after-anchor | 0 | **0** |
| Anchors missing at least one series | 485 | **401** |
| Anchors with no eligible series | 97 | **97** |

| Series | Eligible anchors | Missing anchors | Current selected ID / date / start / end / value |
|---|---:|---:|---|
| VIXCLS | 388 | 97 | 145480 · 2026-11-02 · 2026-11-02 · NULL · 21.15 |
| BAMLH0A0HYM2 | 84 | 401 | 61711 · 2026-11-02 · 2026-11-02 · NULL · 3.43 |
| T10Y2Y | **322** | **163** | 405896 · 2026-11-03 · 2026-11-03 · NULL · 0.34 |

The prior distribution is now **0.50 × 195**, **0.54 × 189**, **0.42 × 31**, **0.47 × 66**, **0.39 × 4**. There are **290 non-neutral prior anchors**, versus 259 in the previous partial evaluation. Current company-level macro prior remains **0.50** for AAPL/NVDA/MSFT.

## 8. Company and nested metrics

| Ticker | Anchors | Current P | Current macro prior | Backtest baseline up | Hit ≥60% | Hit <60% |
|---|---:|---:|---:|---:|---:|---:|
| AAPL | 211 | 94.2217% | 50% | 61.6114% | 58.3333% | 62.0321% |
| NVDA | 176 | 66.2406% | 50% | 69.8864% | 62.7907% | 72.1805% |
| MSFT | 224 | 82.8598% | 50% | 56.2500% | 48.2759% | 59.0361% |

| Ticker / model | Accuracy / balanced | Up / down accuracy | Always-up / majority | Cost return / max DD | Holdout acc / return | Pooling |
|---|---|---|---|---|---|---|
| AAPL bayes | 47.1698% / 47.3647% | 46.8750% / 47.6190% | 46.8750% / 50.9434% | 25.3501% / 8.4990% | 25% / 0% | bayes |
| AAPL logistic | 58.4906% / 59.0456% | 54.7619% / 72.7273% | 46.8750% / 50.9434% | 11.2836% / 21.9507% | 75% / 8.8876% | 318/99 · 0.813084 |
| NVDA bayes | 32.5581% / 31.5271% | 50.0000% / 17.3913% | 67.4419% / 67.4419% | 64.1608% / 3.3785% | 100% / 4.1076% | bayes |
| NVDA logistic | 67.4419% / 50.0000% | 67.4419% / — | 67.4419% / 67.4419% | 104.3092% / 14.4502% | 100% / 4.1076% | 310/84 · 0.481908 |
| MSFT bayes | 47.2727% / 50.0700% | 38.2353% / 61.9048% | 38.1818% / 61.8182% | −22.9173% / 22.9173% | 100% / 28.1268% | bayes |
| MSFT logistic | 38.1818% / 50.0000% | 38.1818% / — | 38.1818% / 61.8182% | −35.5847% / 35.5847% | 100% / 28.1268% | 238/107 · 0.138182 |

Regime accuracy:

| Ticker / model | Bull n / accuracy | Bear n / accuracy |
|---|---|---|
| AAPL bayes | 46 / 45.6522% | 7 / 57.1429% |
| AAPL logistic | 46 / 58.6957% | 7 / 57.1429% |
| NVDA bayes | 38 / 36.8421% | 5 / 0% |
| NVDA logistic | 38 / 71.0526% | 5 / 40% |
| MSFT bayes | 43 / 48.8372% | 12 / 41.6667% |
| MSFT logistic | 43 / 34.8837% | 12 / 50% |

Costs use only non-overlapping windows, not sums of overlapping 63-session returns. Small four-anchor holdouts and always-up baselines do not justify model selection.

## 9. Historical comparison only

The comparison source is the previous partial evaluation at `worker/.runs/macro-vintage-followup-20261104T181640Z/macro-probability-evaluation.json`, SHA256 `972f8cd954bc98e7efcb1dda2f96014a9cba6446e541957397bb0856e57a7326`.

| Ticker / model | Previous partial accuracy | Current accuracy | Previous → current holdout |
|---|---:|---:|---|
| AAPL bayes | 49.0566% | 47.1698% | 75% → 25% |
| AAPL logistic | 54.7170% | 58.4906% | 25% → 75% |
| NVDA bayes | 32.5581% | 32.5581% | 100% → 100% |
| NVDA logistic | 67.4419% | 67.4419% | 100% → 100% |
| MSFT bayes | 50.9091% | 47.2727% | 100% → 100% |
| MSFT logistic | 38.1818% | 38.1818% | 100% → 100% |

This is **historical comparison only**, not direct same-DB pre/post or causal attribution. No previous complete model-input snapshot or old worktree was used. No best result was selected, and no model/factor/regime/probability was promoted.

## 10. Verification and hashes

Existing source delivery `ed939f3` was already verified with **5 targeted files / 31 tests** and **122 files / 698 full tests**, TypeScript and build. This block made no source-code changes. Fresh documentation gates rerun targeted tests, TypeScript, the full suite, production build and `git diff --check` before the documentation commit; the final ledger records their actual results rather than assuming historical counts.

Core hashes:

- before-backfill backup: `84a1374be251e7ed9e50d73decdd9554dd3ad9b122ccb4e0f4d4b7175a889ca9`;
- after-backfill backup: `21bbff9dc427a94b9e28f83ff0a3253bf91a28273f5f27f8fb785a4292e03319`;
- FEDFUNDS normalized: `1353c310b5d09b39acdd3912bede88ea9b24582bc7c2748eff9570a770d4e2a6`;
- FEDFUNDS raw observations: `2f880c343538a8f80cbd638608ede4d1d29e1d1df89139365b17debc5d2a07dc`;
- probability JSON: 688,036 bytes, SHA256 `33f17617c55be8acfcdf716b296abafbe657df2f0ba84c4cc5c2351d8ceb87c9`;
- probability Markdown: 3,739 bytes, SHA256 `b9897a2add1c824994f721b31b9a95bcf60deacbd909601d0a2c52f25d416f34`.

The evidence index includes guards, both backups, dry-run/apply, FEDFUNDS raw/normalized/chunks, all eight normalized sources, original backup, coverage, evaluation, logs, source/test evidence, documentation gates, delivery and Project State before/after. Final SHA256 verification is recorded separately with its actual count and mismatches.

## 11. Remaining limitations and next safe block

- Official macro archive scope begins in 2000. VIX realtime history begins in 2010, T10Y2Y normalized vintage history begins in 2014, and HY OAS has a short official history. These source limitations remain visible in the 163 missing curve anchors and 401 missing HY anchors; they are not filled with estimates.
- Only 84 of 485 evaluated anchors have complete three-series evidence. Current 8/8 coverage does not mean complete historical three-series coverage.
- Probability results are descriptive evaluations with small holdouts and explicit baselines, not repaired alpha or production approval.

The next reviewed block is **Statements netDebt/ROE/ROA historical rebuild/evaluation**, followed by F-15/F-16, Atlas coverage from documented exposure and production/security findings. Those rebuilds were **not** started here.

No full FRED refresh, SEC/13F/Statements/Atlas rebuild, F-15/F-16 work, VIXCLS/BAMLH0A0HYM2 repeat backfill, schema/model/threshold/pooling/universe/protocol change, production apply/deploy/sync, reset/stash/hard reset/force-push or credential inspection occurred.
