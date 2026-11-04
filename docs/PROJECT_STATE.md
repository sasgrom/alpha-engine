# Alpha Engine — Project State and Owner Workflow

> Reviewed snapshot: **2026-11-04**. This document explains the operating model and the current implementation queue. Live collection status belongs to `/project-state` and `/workers`; do not treat this snapshot as a live manifest.

## 1. One project, four kinds of progress

Alpha Engine must not collapse these into one “done” percentage:

| Layer | Question | Current reviewed state |
|---|---|---|
| **Code** | Is the implementation committed and tested? | F-01/F-02/F-03/F-04/F-05/F-10/F-11, the reviewed exposure rebuild, macro evaluation and 13F event/flow/probability remediation are complete. Macro prior remains a neutral fallback because no eligible vintage is available; this is not repaired macro evidence. Macro vintage-data remediation is next. |
| **Data** | Which collectors have actually run and what is their coverage? | Research-51 is covered. S&P 500 initial backfill is a separate run/evidence stage. Schwab, FRED and OFAC have independent schedules and evidence times. |
| **Research** | Are derived artifacts current and strong enough to use? | Research-51 has 21,489 factor points and 51/51 coverage. IC changed after fresh facts. Event Study is ready; Atlas remains partial. No promotion is supported. |
| **Delivery** | Has the owner reviewed and explicitly authorized a destination change? | Production apply/deploy/sync and full-S&P research expansion remain separate owner decisions. |

## 2. Reviewed-only data flow

```text
SEC / Schwab / FRED / OFAC
            │
            ▼
HOME COLLECTION
raw archives + local MySQL
            │
            ▼
AVAILABILITY + VINTAGE QA
coverage, source hashes, first-filed/realtime anchors
            │
            ▼
LOCAL RESEARCH + OWNER REVIEW
factors, event study, Atlas, scenarios, dry-runs
            │
            ▼
SEPARATE OWNER DECISION
reviewed production sync only — never a collector default
```

There is no default direct-to-production collection. A successful collector run does not authorize production sync, a research-universe expansion or model promotion.

## 3. Current implementation block — S&P 500 companyfacts

The implementation, real smoke/scheduler reload and initial backfill evidence are complete. The initial run processed **499/499 CIKs: 490 refreshed + 3 unchanged + 6 failed**. Final documentation was integrated and pushed as `b951f5c`; task completion does not mean 100% successful CIK coverage.

The six HTTP 404 failures were subsequently traced to **incorrect ticker/CIK mappings**, not missing SEC companies. All 502 ticker mappings were checked against the official SEC `company_tickers_exchange.json` directory on 2026-11-04; exactly those six were wrong and have been corrected. A later scheduled incremental run collected the corrected CIKs. Integrated verification confirmed all six as **collected/valid** through manifests, expected payload CIKs, non-empty `factsToRows`, successful ingest and matching SHA256; no additional collector or reload was needed. Initial-backfill failures remain historical evidence.

```text
[done] Code + tests
[done] Real smoke
[done] Controlled scheduler reload
[done] Initial backfill — 493 successful, 6 failed
[done] Coverage/health evidence + final documentation
[done] CIK mapping remediation against the SEC directory
[done] Corrected-CIK collection and manifest verification
```

Collection contract:

- Snapshot: `edgar-universe.json`, GICS as of `2026-10-11`; 502 rows / **499 unique CIKs** after deduplication.
- New job: independent `sp500-facts-daily`, **23:30 home local time**.
- Destination: local raw cache and local MySQL only.
- Per-CIK atomic manifests support resume and next-day retry of missing/failed companies.
- The job does **not** parent `research-series` or `research-factors`; its failures do not block the research-51 chain.
- The current S&P 500 snapshot is a **collection universe**, not historical point-in-time index membership.

The existing research-51 companyfacts job remains independent at 03:00 home local time and feeds `research-series → research-factors`.

## 4. What updates where

| Workflow | Schedule / trigger | Destination | What it does not mean |
|---|---|---|---|
| S&P 500 companyfacts | 23:30 home local + reviewed initial backfill | Raw cache + local MySQL | Full-S&P research or production promotion |
| Research-51 companyfacts | 03:00 home local | Local MySQL → canonical series → factors | A claim of predictive alpha |
| Schwab REST/options | 04:00 home local for the full daily snapshot; independent hourly context; pre-slot is pending, not failure | Local raw snapshots, normalized reports and Feature Lab | Accounts, orders, production sync or a successful capture before it happens |
| FRED | Weekly refresh plus artifact freshness checks | Local macro archive with realtime vintages | Automatic scenario/probability changes |
| OFAC Recent Actions | Daily incremental collection | Local event archive | A complete historical OFAC archive or causal forecast |
| Macro derived research | After successful QA and dependency gates | Local Scenarios, Calibration, Event Study and Atlas reports | Investable alpha or model promotion |
| Production delivery | Separate reviewed owner action only | Explicit reviewed destination | Never a scheduled collector side effect |

## 5. Research state that must stay visible

- Latest reviewed factor rematerialization: **51 companies / 21,489 factor points / 51/51 current-universe coverage**.
- Latest post-facts IC comparison: 2,840 → 2,834 rows, 58 changed Spearman values and 3 sign flips. This is changed descriptive evidence, not repaired alpha.
- Macro Event Study: ready; 47/47 eligible events have outcomes.
- Macro Transmission Atlas: partial; **904 records**, 24 studies, 6 estimated / 18 insufficient, no full_sample and two OOS evaluations. The reviewed fail-closed rebuild reduced records from 1,462; no universe or threshold was changed.
- Reviewed 13F event/flow/probability remediation is complete. Backup covers 16,912 position rows / 879,289 holdings / 3,416 fund_quarters. Audit found **16,912 VALID / 0 STALE_FALLBACK / 0 MISSING_REQUIRED_AVAILABILITY / 0 DUPLICATE / 0 UNKNOWN** and apply affected zero rows. One DB-only rebuild inserted one event with zero missing availability. Post-rebuild: **16,913 VALID / 0 duplicates / 0 missing availability**. Source commits `9381059` and `29acca9` are pushed. Full evidence: `docs/THIRTEENF_REBUILD_2026-11-04.md`.
- The 13F evaluation completed with three company and six nested reports. Each company has 14 flow points with actual MAX availability `2026-10-22`, zero skipped quarters and zero missing funds; 393/485 evaluated anchors per company lack eligible flow. Macro prior remains a neutral fallback because eligible macro vintages are absent. Historical comparison only, not direct same-DB pre/post or repaired alpha.
- 13F verification: targeted remediation suites passed **3 files / 15 tests**; the final full suite passed **119 files / 681 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These gates verify the utility and evidence, not production readiness or alpha.
- F-04 replaces the MAX(date)-only macro prior join and date-only dashboard read with one shared bounded selector: `date <= T`, non-null `realtimeStart <= T`, and `(realtimeEnd IS NULL OR realtimeEnd >= T)`, ordered by `date DESC, realtimeStart DESC, id DESC`. Unknown null starts and future revisions are excluded; open-ended vintages and inclusive endpoints are supported; the newest eligible null value stays missing. A reviewed macro evaluation was subsequently completed; its neutral-fallback coverage limitation is described below.
- F-04 verification: targeted macro/probability suites passed **3 files / 28 tests**; the full suite passed **118 files / 648 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These gates verify correctness code, not refreshed historical research evidence or production readiness.
- F-05 replaces single-component exposure dates with `MAX(sourceFiled)` across every required TTM, debt, ratio and foreign-revenue input. Unknown dates and future revisions fail closed; ratios require identical periods and units. Non-consecutive TTM remains partial for display only, while Scenario and Atlas accept only genuinely available evidence with valid availability. The reviewed rebuild below refreshed these reports; lower available coverage is retained, not hidden.
- F-05 verification: targeted Company Exposure/Scenario/Atlas suites passed **3 files / 31 tests**; the full suite passed **118 files / 657 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These results verify the corrected code, not refreshed research evidence or production readiness.
- F-10 makes missing debt or cash unknown rather than zero; explicit reported zero remains valid. Complete current+noncurrent components take precedence, while curated total debt is a single fallback rather than an extra addend. Historical Statements netDebt history requires a reviewed rebuild where zero substitution was used.
- F-11 requires four existing, non-null finite and calendar-consecutive quarters for quarterly TTM; a grid hole now returns null. Actual period ends support 53-week calendars without a day-count gate. Annual mode, ROE/ROA formulas, YoY and company-exposure F-05 behavior are unchanged. Historical ROE/ROA TTM history requires a reviewed rebuild where applicable.
- F-10/F-11 verification: F-10 targeted Statements passed **17 tests**; F-11 targeted Statements/company-exposure passed **2 files / 38 tests**. The final full suite passed **118 files / 668 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These gates verify code, not rebuilt historical evidence or production readiness.
- The reviewed manual Company Exposure → Macro Scenarios → Atlas rebuild completed once after both numeric fixes. Company Exposure has 51 companies, debt 47, interestCoverage 6, fuelCost 1 and foreignRevenueShare 0; 64 available→missing transitions are documented period mismatches. Scenario statuses are unchanged. Manual runs did not change registered scheduler lastRuns, and the evidence index passes 36/36 SHA256 checks. Full report: `docs/EXPOSURE_REBUILD_2026-11-04.md`.
- Daily Operations at `2026-11-04T08:58:55.248Z` is **degraded**, 14 OK / 1 warning / 0 errors / 23 pending. Schwab is **awaiting_scheduled_capture** for the 04:00 home-local slot with a 60-minute grace period, not a failure and not ok. Hourly context is independently healthy; Atlas partial/904 remains a warning and macro derivedCurrent=true. No pre-slot collector was started.
- S&P 500 mapping remediation and daily collection remain separate operational work. Integrated operational verification confirmed all six corrected CIKs as **collected/valid**, with per-CIK manifest, payload, row-count and SHA256 evidence. The initial backfill's six failures remain historical evidence; old wrong-CIK manifests were not deleted. A pre-existing scheduled daily run completed before this verification; no additional collector or reload was required.
- Macro evaluation completed with three company reports and six nested bayes/logistic reports over 485 evaluated anchors. Accuracy, balanced accuracy, costs, holdouts, regimes and pooling are reported in `docs/INTEGRATED_VERIFICATION_2026-11-04.md`; comparison with older results is historical only, not direct same-DB pre/post. Current macro prior is the neutral 0.5 fallback because all 1,455 anchor/series checks lack eligible vintages; selected-after-anchor is zero. This is a macro coverage limitation, not repaired alpha or promotion.

## 6. Next queue

1. **Macro vintage-data remediation:** required before macro prior can move beyond the neutral fallback; the evaluation is complete, but eligible macro evidence is still missing.
2. **Reviewed Statements netDebt/ROE/ROA historical rebuild or evaluation:** required where missing debt was replaced by zero or non-consecutive quarters produced TTM.
3. Numeric correctness: F-15, F-16.
4. **Atlas coverage:** add new documented exposure evidence instead of repeating runs or tuning thresholds.
5. Production/security findings and the remaining audit queue.

## 7. Where to look

- **`/project-state`** — simple owner workflow, current block, data meanings and next queue.
- **`/workers`** — registered jobs, current scheduler state, logs, Daily Operations and remediation.
- **`/scenario-lab`** — availability-anchored scenarios and calibrated shocks.
- **`docs/OPERATIONS.md`** — exact operational commands and job registry.
- **`docs/PROJECT_AUDIT_2026-11-03.md`** — correctness/security findings and recommended order.

If live home state is unavailable, the UI must say so. It must not invent a completion percentage, healthy status or successful collection run.
