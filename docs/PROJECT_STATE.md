# Alpha Engine — Project State and Owner Workflow

> Reviewed snapshot: **2026-11-04**. This document explains the operating model and the current implementation queue. Live collection status belongs to `/project-state` and `/workers`; do not treat this snapshot as a live manifest.

## 1. One project, four kinds of progress

Alpha Engine must not collapse these into one “done” percentage:

| Layer | Question | Current reviewed state |
|---|---|---|
| **Code** | Is the implementation committed and tested? | F-01/F-02/F-03/F-04/F-05 complete. S&P 500 incremental collector committed as `f196acf`. Reviewed evidence rebuilds are next. |
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

The six HTTP 404 failures were subsequently traced to **incorrect ticker/CIK mappings**, not missing SEC companies. All 502 ticker mappings were checked against the official SEC `company_tickers_exchange.json` directory on 2026-11-04; exactly those six were wrong and have been corrected. The next daily incremental run will collect the corrected CIKs instead of repeating the same invalid requests.

```text
[done] Code + tests
[done] Real smoke
[done] Controlled scheduler reload
[done] Initial backfill — 493 successful, 6 failed
[done] Coverage/health evidence + final documentation
[done] CIK mapping remediation against the SEC directory
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
| Schwab REST/options | Daily collection; context has its own hourly job | Local raw snapshots, normalized reports and Feature Lab | Accounts, orders or production sync |
| FRED | Weekly refresh plus artifact freshness checks | Local macro archive with realtime vintages | Automatic scenario/probability changes |
| OFAC Recent Actions | Daily incremental collection | Local event archive | A complete historical OFAC archive or causal forecast |
| Macro derived research | After successful QA and dependency gates | Local Scenarios, Calibration, Event Study and Atlas reports | Investable alpha or model promotion |
| Production delivery | Separate reviewed owner action only | Explicit reviewed destination | Never a scheduled collector side effect |

## 5. Research state that must stay visible

- Latest reviewed factor rematerialization: **51 companies / 21,489 factor points / 51/51 current-universe coverage**.
- Latest post-facts IC comparison: 2,840 → 2,834 rows, 58 changed Spearman values and 3 sign flips. This is changed descriptive evidence, not repaired alpha.
- Macro Event Study: ready; 47/47 eligible events have outcomes.
- Macro Transmission Atlas: partial; 1,462 records, 24 studies, only two OOS evaluations. Coverage improvement must come from documented exposure evidence, not repeated runs or parameter tuning.
- Historical 13F events and probability/flow evaluations require a separate reviewed rebuild after F-03.
- F-04 replaces the MAX(date)-only macro prior join and date-only dashboard read with one shared bounded selector: `date <= T`, non-null `realtimeStart <= T`, and `(realtimeEnd IS NULL OR realtimeEnd >= T)`, ordered by `date DESC, realtimeStart DESC, id DESC`. Unknown null starts and future revisions are excluded; open-ended vintages and inclusive endpoints are supported; the newest eligible null value stays missing. Historical macro prior, probability and nested evaluations are stale until a separate reviewed rebuild, which was not run.
- F-04 verification: targeted macro/probability suites passed **3 files / 28 tests**; the full suite passed **118 files / 648 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These gates verify correctness code, not refreshed historical research evidence or production readiness.
- F-05 replaces single-component exposure dates with `MAX(sourceFiled)` across every required TTM, debt, ratio and foreign-revenue input. Unknown dates and future revisions fail closed; ratios require identical periods and units. Non-consecutive TTM remains partial for display only, while Scenario and Atlas accept only genuinely available evidence with valid availability. Existing Company Exposure, Scenario and Atlas reports are stale until a separate reviewed rebuild; lower available coverage is a valid result, not a defect to hide.
- F-05 verification: targeted Company Exposure/Scenario/Atlas suites passed **3 files / 31 tests**; the full suite passed **118 files / 657 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These results verify the corrected code, not refreshed research evidence or production readiness.
- S&P 500 mapping remediation is committed separately. The corrected CIKs still belong to the next scheduled daily incremental run; no collection was triggered by F-04 or F-05.

## 6. Next queue

1. Reviewed 13F, macro and exposure rebuilds, each separately authorized.
2. Numeric correctness: F-10, F-11, F-15, F-16.
3. Production/local boundary and access: F-06, F-07, F-13.
4. Operational reliability and later audit findings.

## 7. Where to look

- **`/project-state`** — simple owner workflow, current block, data meanings and next queue.
- **`/workers`** — registered jobs, current scheduler state, logs, Daily Operations and remediation.
- **`/scenario-lab`** — availability-anchored scenarios and calibrated shocks.
- **`docs/OPERATIONS.md`** — exact operational commands and job registry.
- **`docs/PROJECT_AUDIT_2026-11-03.md`** — correctness/security findings and recommended order.

If live home state is unavailable, the UI must say so. It must not invent a completion percentage, healthy status or successful collection run.
