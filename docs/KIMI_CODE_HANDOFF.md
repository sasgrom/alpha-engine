# Kimi Code Handoff — Alpha Engine

Updated: 2026-11-03. This file is the repository-based communication channel between local Kimi Code and other agent sessions. Update it after every verified work block.

## 1. Current architecture

- Cloud control plane plus home Windows worker.
- Home collection and scoring use local MySQL, local Ollama and D:-only raw archives.
- Only reviewed data may reach production. No default direct-to-production collection.
- Research is availability-anchored and point-in-time correct; no look-ahead bias.

## 2. Latest verified code state

Read `git log -10` for authoritative commit state. Recent completed blocks:

- `8708234` — Daily operations health report.
- `fc1987b` — Availability-anchored shock calibration and unit-safe Scenario Engine baselines.
- Daily report: `/workers` opens a health view with scheduler heartbeat, per-ticker same-day Schwab evidence, Feature Lab source hash, job outcomes and remediation actions.
- Daily health artifacts are local and ignored by Git: `public/reports/daily-operations.json` and `.md`.
- Latest full verification before this handoff: 108 test files, 589 tests passing, TypeScript check and production build successful. See section 12 for the full local audit evidence.

## 3. Actual evidence caveat

The last Schwab snapshot visible in the agent workspace was not collected today:

- latest raw capture: `2026-10-31T21:14:11.285Z`;
- normalized snapshot: `2026-10-31T21:55:20.775Z`;
- historical coverage: 51/51 tickers, 120,698 contracts, zero manifest errors.

That workspace did not contain the home Schwab token, raw manifest or scheduler state. Do not assume the home machine has the same state. Inspect local artifacts and report what is actually present.

## 4. First safe actions on the home machine

```powershell
git status --short --branch
git pull --rebase origin main
npm install --no-audit --no-fund
npx tsx scripts/build-daily-operations-report.mts
```

If the tree is dirty, stop before `git pull --rebase` and identify the files. Do not reset or stash automatically.

Then inspect the report:

- scheduler should be online;
- Schwab should show 51/51 complete captures for the current UTC date;
- Feature Lab should match the current normalized snapshot hash;
- failed checks should link to the relevant job and log.

If Schwab is stale, use `/workers` → Jobs & schedules → Schwab Feature Lab materialization → Run chain (3 steps), provided the scheduler is online. Refresh Schwab market context separately when required. Rebuild the daily report afterward.

## 5. Automation state

Configured in the registry, subject to the home scheduler actually running:

- hourly Stocktwits and Schwab Context;
- daily EDGAR, EX-99, companyfacts, Schwab chains, Expectations, morning digest and daily operations health;
- dependency-triggered series, factors, Analytics, normalized Schwab data, Feature Lab and UI build;
- Monday/Thursday 13F refresh;
- Schwab token keepalive every two days.

Deliberately not automatic:

- paused tone, cohort extraction and legacy Cboe lanes;
- FRED/OFAC, macro QA, scenario and shock-calibration builders;
- MySQL backup/restore;
- production apply, which remains a reviewed manual action;
- GDELT, which remains frozen.

## 6. Research queue

1. Verify home shock calibration and Scenario Lab presets against the real FRED archive.
2. Continue with availability-anchored macro event studies.
3. Only afterward consider regime/probability work and require out-of-sample validation before promotion.
4. Do not fabricate missing exposure, hedge, geography or forecast parameters.

## 7. Return handoff

### 2026-11-03 — daily operations check

- Verified from the repository root on the home Windows machine. Current commit: `bd68088af3394c2129a0da17ca5650c9697c99e7` (`bd68088`, `main` matching `origin/main` at inspection time).
- Commands completed: `git status --short --branch`, `git log -10 --oneline --decorate`, `git rev-parse HEAD`, and `npx tsx scripts/build-daily-operations-report.mts`.
- Report generated at `2026-11-02T23:51:30.791Z` for UTC date `2026-11-02`: status `critical`, with 15 OK checks, 1 warning and 4 errors. Artifacts: `public/reports/daily-operations.json` and `.md` (ignored local files).
- Scheduler was online with heartbeat `2026-11-02T23:51:26.313Z`, no current job and zero queued jobs.
- Schwab raw evidence was complete for the report UTC date: 51/51 tickers, 122,532 contracts, 51/51 readable latest chains and zero manifest errors. Latest capture: `2026-11-02T12:02:10.897Z`.
- Unresolved checks: Feature Lab source hash does not match the current normalized snapshot (features generated `2026-10-31T21:55:25.199Z`); Schwab context is stale at 57/58 endpoints with one error (generated `2026-10-31T21:55:30.954Z`) and has no recorded scheduler run; Stocktwits hourly exited with code 1 at `2026-11-02T23:30:12.709Z`; Feature Lab has not completed after its successful parent.
- Tests/build were not run for this operations-report and documentation-only block. The 105 test files / 580 tests and successful TypeScript/build result in section 2 are earlier handoff evidence, not fresh verification.
- Uncommitted work before this handoff edit: untracked `public/reports/shock-calibration.json` and `public/reports/shock-calibration.md`. This handoff update is also intentionally uncommitted pending owner review. No files were reset or stashed.
- No collectors were started, no production action was taken and no code was changed during the operations check. Only the requested local report and this handoff were written.
- Next safe action: with the existing scheduler online and idle, use `/workers` → Jobs & schedules → Schwab Feature Lab materialization → Run chain (3 steps), then rebuild the daily operations report. Inspect the Stocktwits failed-job log before any rerun; do not start a duplicate scheduler or terminal collector chain.

## 8. Local Kimi Code handshake

- Local time: `2026-11-02 16:26:46 -0800 (PST)`.
- Git status (`git status --short --branch`): `main...origin/main`; modified `docs/KIMI_CODE_HANDOFF.md` and `public/reports/schwab-context.json`; untracked `public/reports/shock-calibration.json` and `public/reports/shock-calibration.md`. Only the handoff is intended for this commit; generated and untracked files remain uncommitted.
- Fresh daily report generated at `2026-11-03T00:25:08.436Z`: scheduler `online`, heartbeat `2026-11-03T00:24:56.950Z`, no current job and zero queued jobs. Report status remains `critical`: 4 OK, 1 warning, 1 error and 14 not-yet-due/parent-waiting checks.
- Schwab captured today: `51/51` for report UTC date `2026-11-03`; latest capture `2026-11-03T00:10:50.992Z`, 122,218 contracts, zero manifest errors and current Feature Lab source lineage.
- HEAD: [`bd68088af3394c2129a0da17ca5650c9697c99e7`](https://github.com/sasgrom/alpha-engine/commit/bd68088af3394c2129a0da17ca5650c9697c99e7).
- Owner-authorized collector follow-up completed sequentially while the scheduler was idle: `schwab-fetch`, normalized market-data build, Feature Lab build, context build and daily report. Schwab REST completed 51/51; User Preference HTTP 401 still blocks only streaming setup. Context is fresh but remains 57/58 because `hours/option` returned HTTP 400 (`markets param cannot be null or empty`).
- Stocktwits was not blindly rerun: its failed-job log shows a deterministic startup error because `./lib/universe` does not export `loadUniverse`; no network request can fix that code error.
- Verification: `npm run check` passed; `npm test -- --run` passed with 105 test files and 580 tests; `npm run build` passed with chunk-size warnings only.
- Next safe action: review the Stocktwits export mismatch and Schwab `hours/option` request mapping as separate code changes before further reruns. Do not start GDELT, paused lanes, a duplicate scheduler or any production action.

## 9. Owner autonomy directive — 2026-11-03

- The owner explicitly authorized autonomous routine work: diagnose and fix bugs, add tests, run local collectors and builders, verify evidence, update documentation, and make verified source commits with ordinary fast-forward pushes to `main`.
- Do not ask for confirmation for routine implementation choices, collector execution, local builds or source delivery. Use short progress updates and stop only for the explicit boundaries in `AGENTS.md` section 6.
- Retry the same failing step at most twice, then diagnose the evidence instead of blindly retrying. Never start duplicate schedulers, servers or collectors.
- Immediate authorized work: fix the Stocktwits `loadUniverse` export mismatch and Schwab `hours/option` request mapping as separate changes; run their targeted tests and collectors; regenerate the daily report; complete the full verification gates; update this handoff and push the source changes.
- Production apply/deployment, cloud collection, credentials, schema/storage migration, deletion, paused GPU lanes, new external services and history-changing Git operations still require an explicit owner decision.

## 10. Return handoff — Stocktwits and Schwab Context repair

### 2026-11-03T02:17:50Z — verified and ready for source delivery

- Block baseline: `963e6bc` (`main` matched `origin/main` at inspection). No production apply/deployment, schema/storage change, paused lane or GDELT action was performed.
- Stocktwits: restored `UniverseEntry` and `loadUniverse()` in `worker/lib/universe.ts` while preserving `dedupeExpectationUniverse`. Added `worker/lib/universe.test.ts`, which imports and loads the real committed snapshot. The collector now sends both deterministic and LLM probation rows to the home ingest endpoint instead of forcing deterministic rows to production.
- Schwab: added the production-used `schwabMarketHoursPath()` mapping and changed both context tasks to `markets?markets=equity|option`; `hours/option` no longer uses the failing `/markets/option` path. Updated `docs/SCHWAB_STREAMING_TZ.md` and added a regression assertion for both mappings.
- Targeted verification passed: Stocktwits/universe suites `79/79`; Schwab context/request suites `10/10`.
- The running scheduler predated the current registry and had no active job or queued work. Restarted the existing `AlphaEngine-Operations-Scheduler` task after terminating its detached old process tree; the new state started at `2026-11-03T02:07:05.040Z` with 56 registered jobs and one execution lane. No duplicate scheduler was started.
- Stocktwits manual run `1793671775058-stocktwits-hourly`: exit 0, `2026-11-03T02:09:35.058Z` → `2026-11-03T02:11:02.213Z`. Log confirms 10 deterministic and 5 LLM probation rows accepted by local ingest, zero duplicates.
- Schwab Context manual run `1793671865062-schwab-context-hourly`: exit 0, `2026-11-03T02:11:05.062Z` → `2026-11-03T02:11:09.695Z`; 58/58 endpoints complete, zero errors. The existing collector refreshed its access token normally; no credential value was inspected or printed.
- Final daily report generated at `2026-11-03T02:17:48.982Z`: status `ok`, 7 OK / 0 warning / 0 error / 13 not-yet-due or parent-waiting checks. Scheduler heartbeat `2026-11-03T02:17:35.100Z`, no current job and zero queued jobs.
- Schwab evidence for UTC date `2026-11-03`: 51/51 tickers captured today, 51/51 readable latest chains, 122,218 contracts and zero manifest errors; latest capture `2026-11-03T00:10:50.992Z`. Feature Lab generated `2026-11-03T00:10:58.298Z` and matches the normalized source hash. Context generated `2026-11-03T02:11:09.615Z` with 58/58 coverage and zero errors. No failed checks remain; pending checks are future schedule/dependency work, not failures.
- Full gates passed: `npm run check`; `npm test -- --run` with 106 test files and 582 tests; `npm run build` with only the established chunk-size warnings; `git diff --check` with no whitespace errors.
- Source delivery is limited to the two collector fixes, their regression tests, the Schwab technical note and this handoff. `public/reports/schwab-context.json`, untracked `public/reports/shock-calibration.json` / `.md`, ignored daily reports, raw archives and build outputs are intentionally excluded from the source commit. No additional uncommitted source work remains outside this block.
- Next safe action: leave the single scheduler running its normal registry. No immediate collector repair remains. Production transfer still requires a separate explicit owner review.
## 11. Macro Ops and first-release event study — 2026-11-03

- Added eight Macro Ops registry jobs: weekly FRED/ALFRED, daily OFAC, independent daily manifest QA, company exposure after research factors, daily pilot SEC evidence, and dependency-triggered scenarios, shock calibration and macro event study. Registry now contains 64 jobs.
- Daily Operations now validates artifact-level FRED coverage and weekly freshness, OFAC daily freshness, macro QA, and scenario/calibration/event-study lineage in addition to scheduler status.
- Added `scripts/build-macro-event-study.mts`: first-release observations only, baseline known at event eligibility, next-observation-day outcomes, signed rate/credit changes, oil/USD log returns, chronological 70/30 discovery/OOS, minimum five events per split and 500-replicate moving-block CI95. Outputs include per-event baseline and outcome vintage IDs.
- Verification completed after rebase onto `f7e5abb` collector fixes: 108 test files and 589 tests passed; `npm run check` and `npm run build` passed. A separate synthetic CLI archive also produced 20 eligible events, 80 observations and chronological 14/6 split; synthetic reports were removed and are not treated as live evidence.
- Updated English code comments, `docs/MACRO_DATA.md`, RU/EN manuals, `docs/LLM_CONTEXT.md`, generated operations runbook and bundled manuals.
- No real home FRED/OFAC refresh was run in this workspace and no production action was taken. Next home action: pull this commit, refresh only missing macro inputs, run the Macro Ops chain, inspect `macro-event-study.json` and regenerate the daily operations report with `--macro-root D:\research\alpha-engine\macro`.

## 12. Full local project audit — 2026-11-03T03:53:07Z

- Audited commit: `1b001ce4d0c86b4b86317971f1e23f3353d1f6d7`. The detailed 338-line report is `docs/PROJECT_AUDIT_2026-11-03.md`; it contains 23 confirmed findings (P0 1 / P1 12 / P2 8 / P3 2), four explicitly unconfirmed suspicions and eight intentional/non-bug cases.
- Highest-priority finding: `computeCompanyFactors` consumes latest-vintage values while `materializeFactorPoints` assigns first-filed availability. This is a confirmed look-ahead mechanism; affected research should be reevaluated only after targeted correction and local reviewed rematerialization.
- Other confirmed areas: period-level factor availability, 13F and macro vintage dates, composite exposure alignment, public static owner reports, production-default ingest fallback, archive pagination/deduplication, scheduler singleton/child ownership, Statements null/TTM semantics, Stocktwits false-success behavior and weak admin password policy.
- Verification on the audited commit: `npm run check` passed; `npm test -- --run` passed 108 test files / 589 tests; `npm run build` passed with chunk-size warnings. `npm run lint` failed with 168 errors and one warning. `npm audit` reported 24 advisories (1 low, 11 moderate, 12 high); package manifests were unchanged by the two commits preceding this audit.
- Pure read-only diagnostics reproduced missing-debt `netDebt=-100`, non-consecutive numeric TTM, early composite availability, mismatched-period ratios, extended-hours Schwab opening range and shrinking Schwab coverage denominator. Anonymous local HTTP checks returned 200 for three owner report JSON paths while `auth.me` returned 401.
- No source code, tests, configuration, credentials or generated production data were changed. No collectors, GPU jobs, GDELT, DB writes, migrations, production apply/deployment or cloud collection were run.
- Final status before audit delivery: modified `docs/KIMI_CODE_HANDOFF.md` and pre-existing `public/reports/schwab-context.json`; untracked new `docs/PROJECT_AUDIT_2026-11-03.md` plus pre-existing `public/reports/shock-calibration.json` and `.md`. Only the audit report and this handoff are included in the audit commit; generated reports are excluded.
- Next action for the following agent: use the report's ordered F-01…F-23 plan. Fix availability/correctness first with targeted regression tests; do not introduce new models/factors or broad refactors, and do not treat suspicions as confirmed without reproduction.

## 13. Macro Transmission Atlas — 2026-11-03

- Added `scripts/build-macro-transmission-atlas.mts` and the `macro-transmission-atlas` dependency job after first-release event study and research factors. Registry now contains 65 jobs. Daily Operations also checks Atlas artifact lineage and coverage.
- Atlas rebuilds available, non-stale exposure at each event eligibility, normalizes oil revenue/cost and fuel through operating income, and computes post-close market-model abnormal returns. Debt burden is explicitly a proxy, not a floating-rate share.
- Company models include intercept, shock, exposure, shock × exposure and sector fixed effects. Discovery coefficients and sector levels are learned only on the earliest 70% of events and frozen for OOS. Interaction CI95 uses 500 event-cluster bootstrap replicates.
- Coverage gates: 30 rows, 10 events, 5 companies and full-rank design; `pilot` vs `full_sample` is reported separately from predictive value. OOS reports MAE, RMSE and R² against discovery mean, including negative values without suppression.
- Synthetic end-to-end verification produced 3,840 aligned records and all 16 studies with discovery fit and OOS evaluation. Full combined suite: 109 test files and 592 tests passed; TypeScript check and production build passed.
- Updated English comments, `docs/MACRO_DATA.md` §15, RU/EN manuals, `docs/LLM_CONTEXT.md`, operations runbook and bundled manuals. No real home Atlas run or production action was taken. Next home action: build the real macro event study, then Atlas, inspect coverage before interpreting coefficients and regenerate daily operations.
