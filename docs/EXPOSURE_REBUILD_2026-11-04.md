# Reviewed Company Exposure → Macro Scenarios → Atlas rebuild — 2026-11-04

## 1. Scope and outcome

- Baseline HEAD and `origin/main`: `1e1705e302631f89d5d2c02ee92da44d40b3c084` (`Enforce consecutive TTM quarters`).
- Purpose: one reviewed local evidence rebuild after F-05, F-10 and F-11, using existing local MySQL `series_points`, price history and the normalized macro archive.
- This was **manual reviewed evidence materialization**, not a scheduler operation chain, collection, production delivery or model promotion.
- No SEC/FRED/Schwab collectors, `facts-fetch-daily`, `research-series`, `research-factors`, corrected-CIK manual runs, 13F/probability rebuilds or macro prior/probability rebuilds were started by this work block.
- All three research builders completed exactly once with exit code 0. Atlas now has **904 records / 24 studies / 6 estimated / 18 insufficient / 2 OOS evaluations**, with `full_sample=0` and status `partial`.
- Evidence directory (ignored by Git): `worker/.runs/exposure-rebuild-20261104T074932Z`.
- Final evidence index: **36/36 artifacts checked, zero SHA256 mismatches**.

The reduced exposure and Atlas coverage is retained as a valid fail-closed result. No builder was repeated to obtain a more favorable number, and no universe, threshold, shock, model or protocol was changed.

## 2. Prerequisites and process evidence

| Prerequisite | Verified evidence |
|---|---|
| Git | HEAD and `origin/main` both `1e1705e302631f89d5d2c02ee92da44d40b3c084`; pre-existing generated/runtime diffs preserved. |
| Scheduler | `current=null`, `queue=[]`; heartbeat `2026-11-04T07:46:26.562Z` in the preflight snapshot. |
| Scheduler processes | One logical chain: 18324 → 5216 → 16940 → 15548 → 16164. No active collector or analogous builder. |
| Web server | HTTP 200 from `http://127.0.0.1:3000/`; one listener PID 5440 on `127.0.0.1:3000`, parent cmd PID 15664. |
| MySQL | Existing application configuration returned `SELECT 1` successfully. No connection string or credential was printed. |
| Macro QA | `pass`, 0 errors / 0 warnings, generated `2026-11-03T22:42:38.572Z`; latest input `2026-11-03T22:40:27.034Z`, so QA is current. |
| Event Study | Exists, `ready`, generated `2026-11-03T22:43:36.348Z` after QA; 188 observations, 47/47 eligible events with baseline and outcomes, discovery/OOS 32/15. |
| Pilot exposure evidence | Schema 1, five valid companies, seven present evidence objects checked; generated `2026-11-03T14:05:07.673Z`, age 17.701h at check, inside 48h. Registered run `1793714705004-pilot-exposure-evidence` was `done`, exit 0, ended `2026-11-03T14:05:07.851Z`. |
| Company Exposure universe | Explicit `research-universe-51.json`, resolved by the existing loader to `worker/research-universe-51.json`: 51 rows / 51 unique CIKs, SHA256 `4b6d039b328b261ca7ed975e044355ed170feead7d509ad8420ec5f4ed31435b`. |
| Atlas universe | No override; builder default `research-universe-50.json`, resolved to `worker/research-universe-50.json`: 50 rows / 50 unique CIKs, SHA256 `797e0334ddf88d1d3b944030142082a626d184a809e5e6a4ad2047c65a32ff2d`. |

A pre-existing scheduled `sp500-facts-daily` cron run (`1793777546415-sp500-facts-daily`) had already completed at `2026-11-04T07:37:14.677Z` before this work block. This block did not request it, repeat it or start another collector.

Detailed credential-free preflight evidence: `worker/.runs/exposure-rebuild-20261104T074932Z/preflight.json`.

## 3. Snapshot and command ledger

Eleven pre-rebuild input/report copies were preserved under `worker/.runs/exposure-rebuild-20261104T074932Z/pre`, including Company Exposure JSON/Markdown, Scenarios JSON/Markdown, Atlas JSON/Markdown, Event Study, Daily Operations, pilot evidence, QA and operations state. Their original hashes are in `pre-sha256.json`; the backup copies were not edited or deleted.

### Research and health commands

| Step | Exact command | Start / end UTC | Exit | Log |
|---|---|---|---:|---|
| Company Exposure | `npx tsx scripts/build-company-exposure.mts --universe research-universe-51.json` | 07:53:49.386 / 07:55:35.516 | 0 | `logs/01-company-exposure.log` |
| Macro Scenarios | `npx tsx scripts/build-macro-scenarios.mts` | 07:56:06.341 / 07:56:09.286 | 0 | `logs/02-macro-scenarios.log` |
| Atlas | `npx tsx scripts/build-macro-transmission-atlas.mts` | 07:56:35.472 / 07:58:51.755 | 0 | `logs/03-macro-transmission-atlas.log` |
| Daily Operations, initial path | `npx tsx scripts/build-daily-operations-report.mts --macro-root D:\research\alpha-engine\macro` | 07:59:20.571 / 07:59:23.937 | 0 | `logs/04-daily-operations.log` |
| Local readiness file gate | `npx tsx scripts/production-readiness.mts` | 07:59:35.773 / 07:59:37.598 | 0 | `logs/05-production-readiness.log` |
| Daily Operations, corrected path | `npx tsx scripts/build-daily-operations-report.mts --macro-root D:/research/alpha-engine/macro` | 08:02:55.645 / 08:02:58.840 | 0 | `logs/06-daily-operations-correct-macro-root.log` |

Scheduler `current=null` and `queue=[]` were rechecked immediately before each research builder. No scheduler request was appended. The registered `lastRuns` remained unchanged:

- `company-exposure-evidence`: `1793749768202-company-exposure-evidence`;
- `macro-scenarios`: `1793749918235-macro-scenarios`;
- `macro-transmission-atlas`: `1793714149530-macro-transmission-atlas`;
- `macro-event-study`: `1793714134509-macro-event-study`;
- `pilot-exposure-evidence`: `1793714705004-pilot-exposure-evidence`.

### Material diagnostics, without research-builder retries

1. A read-only universe probe initially used repository-root `research-universe-51.json` and exited 1 with `ENOENT`. The actual loader path is `worker/`; both files were then verified successfully. No collector or builder was involved.
2. The first comparison-helper invocation exited 1 because the helper received report objects instead of their `companies` arrays. Only the generated analysis helper was corrected; no research builder was rerun.
3. The initial Daily Operations invocation returned exit 0 but lacked FRED/OFAC lineage. A focused argument diagnostic showed that Git Bash converted the unquoted backslash path to `D:researchalpha-enginemacro`, resolved as `D:\researchalpha-enginemacro`. The invalid artifact was preserved as `logs/daily-operations-invalid-macro-root.json` and `.md`. Only the health report was regenerated with the equivalent forward-slash path. An earlier unsupported-flag diagnostic exited 9 and was corrected with `--`; no data collector ran.

The machine-readable ledger is `worker/.runs/exposure-rebuild-20261104T074932Z/command-ledger.json`.

## 4. Company Exposure: pre/post coverage

Generated at `2026-11-04T07:55:34.944Z`, as of `2026-11-04T07:53:52.182Z`; 51 companies. The artifact's canonical sorted-CIK universe SHA256 is `f253b8c5622e380bdc0a4e3781157c8d043be756994651b9fb9510eedb27bbbe` (distinct from the source JSON file hash recorded in preflight).

### Report coverage fields

| Field | Before | After | Change |
|---|---:|---:|---:|
| companies | 51 | 51 | 0 |
| debt | 47 | 47 | 0 |
| interestCoverage | 35 | 6 | −29 |
| fuelCost | 2 | 1 | −1 |
| oilRevenue | 1 | 1 | 0 |
| oilCost | 2 | 2 | 0 |
| foreignRevenueShare | 0 | 0 | 0 |

### Available / partial / missing by metric

Each cell is `available / partial / missing`.

| Metric | Before | After |
|---|---|---|
| debt | 43 / 4 / 4 | 43 / 4 / 4 |
| debtToOperatingIncome | 33 / 2 / 16 | 16 / 0 / 35 |
| interestCoverage | 29 / 6 / 16 | 5 / 1 / 45 |
| cashToDebt | 40 / 3 / 8 | 18 / 1 / 32 |
| fuelCostToOperatingIncome | 2 / 0 / 49 | 1 / 0 / 50 |
| oilRevenue | 1 / 0 / 50 | 1 / 0 / 50 |
| oilCost | 2 / 0 / 49 | 2 / 0 / 49 |
| oilRevenueToOperatingIncome | 0 / 0 / 51 | 0 / 0 / 51 |
| oilCostToOperatingIncome | 0 / 0 / 51 | 0 / 0 / 51 |
| foreignRevenueShare | 0 / 0 / 51 | 0 / 0 / 51 |
| foreignDerivativeNotional | 6 / 0 / 45 | 6 / 0 / 45 |

### Companies that ceased to be `available`, and why

There were **64 `available → missing` transitions and zero `available` gains**. All 64 result from incompatible `periodEnd` between required ratio inputs; none is attributed to a missing-sourceFiled diagnostic.

- **Debt / operating income — 17:** AMD, ANET, COST, FCX, FSLR, GOOGL, INTC, JNJ, KMI, LMT, MA, NFLX, PG, SMCI, TSLA, V, WMT. Debt period no longer matched the operating-income TTM period, so no numeric ratio was retained.
- **Operating income / interest expense — 24:** AMT, AMZN, ANET, DAL, DASH, FSLR, GOOGL, HD, KMI, LMT, MA, META, MSFT, MU, NFLX, NVDA, PG, PLD, PLTR, RCL, RIVN, SMCI, T, TSLA. The operating-income TTM endpoint and the interest-expense TTM endpoint differed.
- **Cash / debt — 22:** AMD, COST, CVX, FCX, FSLR, GOOGL, INTC, JNJ, JPM, KMI, LLY, LMT, MA, NFLX, NKE, PFE, PG, RIVN, SMCI, TSLA, V, WMT. Cash and debt belonged to different period ends.
- **Fuel cost / operating income — 1:** RCL, fuel period `2021-12-31` versus operating-income period `2026-09-30`.

Every ticker, before/after sourceFiled, periodEnd, value, quality and exact diagnostic is preserved in `pre-post-comparison.json`. There are **78 post-rebuild period-mismatch diagnostics** in total, including transitions from already partial or missing states and UNH's current/noncurrent debt component mismatch. The 64 count above is restricted to previously available metrics.

Nine additional availability/value changes were `partial → missing`, not available losses: AAPL interestCoverage; CAT debtToOperatingIncome and cashToDebt; FCX interestCoverage; GS cashToDebt; INTC interestCoverage; JNJ interestCoverage; PLTR debtToOperatingIncome; V interestCoverage. Overall, 73 availability timestamps and 73 values changed.

Validation of the new artifact found:

- `sourceFiled` diagnostics: **0**;
- available metrics with missing/future `sourceFiled`, missing/future `periodEnd`: **0**;
- foreign-revenue period mismatch remains explicit for PFE (`2011-04-03` versus `2026-09-27`);
- non-consecutive or otherwise incomplete TTM cannot upgrade a ratio into research evidence.

This is corrected fail-closed coverage, not a claim that the underlying SEC facts improved or deteriorated due to a new collection.

## 5. Macro Scenarios: pre/post

Generated at `2026-11-04T07:56:09.128Z`, as of `2026-11-04T07:56:08.245Z`, `dataMode=live`. Existing pilot evidence, normalized FRED files and the default shocks were used: rates 0.01, oil 0.20, USD 0.05, credit 0.01.

| Channel | Status before → after | Impact statuses before → after | Reasons before → after |
|---|---|---|---|
| rates | partial → partial | computable 1→1; not_computable 4→4 | fixed_interest_share_missing_or_invalid 4→4; hedge_share_unknown_upper_bound 1→1 |
| oil | partial → partial | computable 1→1; historical_only 3→3; not_computable 1→1 | fuel_cost_and_oil_revenue_cost_missing 1→1; hedge_and_pass_through_unknown_gross_exposure 4→4 |
| usd | not_computable → not_computable | not_computable 5→5 | foreign_revenue_share_missing_or_invalid 5→5 |
| credit | not_computable → not_computable | not_computable 5→5 | new_issuance_spread_maturity_and_rating_missing 5→5 |

Across all four channels, impact totals remained **2 computable / 3 historical_only / 15 not_computable**. No missing hedge, geography or issuance assumption was introduced.

### Baseline availability and lineage

| Channel | Before | After | Interpretation |
|---|---|---|---|
| rates / DGS10 | observation `2026-10-30`; available `2026-11-02`; eligible `2026-11-02T23:59:59.999Z`; value 4.94 | observation `2026-11-02`; available `2026-11-03`; eligible `2026-11-03T23:59:59.999Z`; value 4.91 | Later `asOf` selected an already archived observation. No FRED refresh occurred. Source hash is unchanged. |
| oil / DCOILWTICO | observation `2026-10-27`; available `2026-10-28`; value 103.37 | Same observation, availability and value | Unchanged vintage and source hash. |
| usd / DTWEXBGS | observation `2026-10-30`; available `2026-11-02`; value 121.6656 | Same observation, availability and value | Unchanged vintage and source hash. |
| credit / BAMLH0A0HYM2 | observation `2026-11-02`; available `2026-11-02`; value 3.43 | Same observation, availability and value | Unchanged vintage and source hash. |

The corresponding vintage IDs are DGS10 `DGS10|2026-11-02|2026-11-03`, oil `DCOILWTICO|2026-10-27|2026-10-28`, USD `DTWEXBGS|2026-10-30|2026-11-02`, credit `BAMLH0A0HYM2|2026-11-02|2026-11-02`. All baseline `researchEligibleAt` values are at or before the scenario `asOf`.

## 6. Atlas: pre/post coverage and OOS

Generated at `2026-11-04T07:58:23.230Z`, as of the unchanged Event Study cutoff `2026-11-03T22:43:36.348Z`, `dataMode=live`. The builder used its default 50-company universe, the existing Event Study and price history, and frozen discovery/OOS rules.

| Coverage field | Before | After | Change |
|---|---:|---:|---:|
| candidatePairs | 14,100 | 14,100 | 0 |
| exposureMissing | 10,810 | 12,633 | +1,823 |
| exposurePartial | 2,110 | 1,000 | −1,110 |
| exposureStale | 465 | 0 | −465 |
| priceMissing | 132 | 100 | −32 |
| shockMissing | 870 | 564 | −306 |
| records | 1,462 | 904 | −558 |

Debt-burden records fell 1,450 → 892; fuel-cost records remained 12. Oil-revenue, oil-cost and foreign-revenue studies still have no records. Lower `priceMissing` or `shockMissing` is not treated as improved underlying coverage: those counters are evaluated after exposure eligibility, so fewer eligible exposures also reduce downstream attempts. Likewise, zero stale records does not imply fresher fundamentals; incompatible evidence is now excluded earlier.

### Studies

| Metric | Before | After |
|---|---:|---:|
| total | 24 | 24 |
| estimated | 6 | 6 |
| insufficient_coverage | 18 | 18 |
| full_sample | 0 | 0 |
| OOS evaluations | 2 | 2 |

Discovery rows changed as follows, while coverage labels remained `pilot`:

| Study | Horizon 1 | Horizon 5 | Horizon 21 |
|---|---:|---:|---:|
| DGS10 / debt_burden | 185 → 110 | 185 → 110 | 161 → 95 |
| BAMLH0A0HYM2 / debt_burden | 185 → 110 | 185 → 110 | 161 → 95 |

The two OOS evaluations remain:

| Study | OOS rows before → after | OOS R² vs discovery mean before → after |
|---|---:|---:|
| DGS10 / debt_burden / 1 | 103 → 70 | −0.0408498943 → −0.4650530945 |
| BAMLH0A0HYM2 / debt_burden / 1 | 103 → 70 | −0.0649335728 → −0.3276636222 |

No coefficient was selected for a preferred result, no OOS refit occurred, and these measurements do not establish alpha or support model promotion.

## 7. Final health and readiness

The final, corrected Daily Operations artifact was generated at `2026-11-04T08:02:57.472Z`:

- overall status: **critical**, **14 OK / 1 warning / 1 error / 22 pending**;
- scheduler: online, heartbeat `2026-11-04T08:02:56.715Z`, `currentJobId=null`, `queuedJobs=0`;
- Schwab: **0/51 captured today**, latest capture `2026-11-03T00:10:50.992Z`, 122,218 contracts, zero manifest errors; Feature Lab lineage is current, context has zero errors;
- macro: QA `pass`, `derivedCurrent=true`, FRED `2026-11-03T22:40:27.034Z`, OFAC `2026-11-03T13:40:05.339Z`;
- remaining error: Schwab daily evidence 0/51;
- remaining warning: Atlas lineage is current but status is `partial` with 904 records;
- failed jobs recorded by the health report: 0.

The earlier invalid health artifact with two path-induced macro errors was preserved, not hidden. The corrected report has only the genuine remaining Schwab error and Atlas coverage warning.

`production-readiness.mts` returned `ready` with `missing=[]`. This is only the local file-existence gate, not operational health, research validation or production approval.

## 8. Evidence integrity

- Complete index: `worker/.runs/exposure-rebuild-20261104T074932Z/evidence-index.json`.
- Verification result: `worker/.runs/exposure-rebuild-20261104T074932Z/evidence-verification.json`, **36 checked / 0 mismatches**.
- Event Study input and its pre-rebuild backup have the same SHA256: `7184cfd0173d64144d8133b12ebfef35532da12f9f63533b745d2d335b48cbe8`.
- Pilot input and backup also match: `e6d712c6c1ed3d2e23063d392448c9e27b1a674903f81a61c3623a83e300dcaa`.

Key post-rebuild and computed-evidence hashes:

| Artifact | SHA256 |
|---|---|
| `public/reports/company-exposures.json` | `641a6a60561fd12cb7fc86aed097a17d1a93700421f9ff822b554e657c1b5748` |
| `public/reports/company-exposures.md` | `7dcbc963850aaf47fea043aa245aee3076da10edde66121087704070f3ceb07c` |
| `public/reports/macro-scenarios.json` | `ccbe8f3f96883643ded7b6f122a01690822092e3eb74cfe9866f26796136c60a` |
| `public/reports/macro-scenarios.md` | `48fb530b4ccea19b517afcf1230bada90e8d0f0d570fd2143391262e62c3771a` |
| `public/reports/macro-transmission-atlas.json` | `26b8b3924f0a44d87f4f67cb8b6a8432a9649e7d3d88aaae8d3d5c4a6fd70385` |
| `public/reports/macro-transmission-atlas.md` | `f4ece898ea3f55244bf4b93e22dc302506331bf1346e8bd1c214da2e75ac97d2` |
| `public/reports/daily-operations.json` | `a32d96f797bca65bcee431bb2503a89185e71cc3fc6da1f1d2196d12d6464d95` |
| `public/reports/daily-operations.md` | `475e1ff371ad02d8f53edc414b92388bc3934402edad00bcabb774c8cc8dbdff` |
| `pre-metrics.json` | `a927f76b0c3ef3283765c4eb2df6eb4b622a57b728b1a68916d250f5483e79f8` |
| `post-metrics.json` | `f58ba485717e484aa50c93094bdcce99c9f86afb03689b41f6d7d5026e9bf374` |
| `pre-post-comparison.json` | `0e61e44d38ed4bfd148fc61de6e5957ec0fa58583b5bf38e9c30c8f3d0a6deea` |
| `command-ledger.json` | `b37fa6a0630b176286a0a87a8ba66e23c604210a1b399efa9f30fcc758e925c6` |
| `preflight.json` | `d78ba5463f5004bd54d0d00d0bace8b3b1ca93c4e33023fefa5820423d6af8c7` |
| `pre-sha256.json` | `f6e518ff66221a21dee3127757aa450d69401fe337a78b2cc22d561255fd44d5` |
| `logs/01-company-exposure.log` | `b77a31af48e74dce8091a9d2e72f5826f3cd2911dc5c104de420f459ea5f715e` |
| `logs/02-macro-scenarios.log` | `1cee82bf9d9202526aa525693e55f0c8864a56db971a1c49e0915ee86420c682` |
| `logs/03-macro-transmission-atlas.log` | `7db342752696f8c3f54c50c70644d9924dec405256c53351f0a3e8b37e0e269b` |
| `logs/04-daily-operations.log` | `08b327db8356576690ce2024d7ac4cd124af548e2845e585f14d5423e04df282` |
| `logs/05-production-readiness.log` | `12736fac1e20b5a81ba0370f9d020e0350f596fadb796a30c5cf391b9ac9204e` |
| `logs/06-daily-operations-correct-macro-root.log` | `a01d6c43e33041fc47398e20b42c69a4af523c9680dd626b1d214ae7cf728732` |

All generated reports, backups, logs, comparison files and indexes remain under `worker/.runs` or generated report paths and are excluded from the documentation commit.

Documentation delivery gates also passed: `npm run check`, **118 test files / 668 tests**, `npm run build` with established chunk-size warnings, and `git diff --check`. A final verification at `2026-11-04T08:19:23.396Z` rechecked all 36 indexed hashes with zero mismatches. Scheduler heartbeat `2026-11-04T08:19:11.789Z` remained `current=null`, `queue=[]`, and the registered research lastRuns were unchanged.

## 9. Remaining blockers and next safe action

- Atlas remains `partial`: 18 studies lack sufficient coverage, no study is full-sample and only two have OOS evaluations. The appropriate response is not another run or a looser universe.
- Many exposure ratios are unavailable because the underlying periods differ. This must remain visible until suitable compatible evidence exists; it cannot be repaired by repeated materialization.
- USD scenarios remain not computable because direct comparable foreign-revenue evidence is missing. Credit scenarios still need new-issuance spread, maturity and rating evidence.
- Daily health remains critical because Schwab has 0/51 captures for the current UTC day. No Schwab collector was started in this block.
- Statements history affected by earlier F-10/F-11 behavior is separate from this exposure evidence chain and was not independently rematerialized.
- The next reviewed block is **macro prior/probability rebuild after F-04**, followed separately by the reviewed 13F event/flow/probability rebuild, F-15/F-16 and production/security findings.
- Corrected-CIK daily collection remains a separate scheduled operational task. Production apply/deploy/sync, migrations and production URLs were not used.
