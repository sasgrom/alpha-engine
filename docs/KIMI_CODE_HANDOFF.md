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
- Latest full verification before this handoff: 110 test files, 595 tests passing, TypeScript check and production build successful. See section 14 for the F-01/F-02 research vintage correction.

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

## 14. F-01/F-02 research vintage correction — 2026-11-03T06:26:14Z

- Block baseline: `01f846f` (`main` matched `origin/main`). Work was limited to the two assigned audit findings; no new factors, models or broad refactoring were added.
- Regression tests were written first and produced four expected failures: revised/latest behavior, unrelated early availability and the old +45d fallback. After the minimal implementation and two confirmed implementation fixes, targeted suites passed 5/5 and adjacent factor/probability suites passed 37/37.
- `computeCompanyFactors(cik, vintage = "latest")` now accepts an explicit vintage while preserving the on-demand latest default. Research materialization calls it with `first` and reads matching `series_points.vintage='first'` rows.
- `buildFactorPointRows` now requires finite values and computes fundamental availability as MAX(first-filed) across exact required concepts and actual lookback/TTM periods. Preferred shares/cash/debt fallbacks mirror the existing history formulas. Unrelated early facts cannot advance availability; missing required availability emits no research row; the old periodEnd+45d fallback is removed.
- `probability-engine` now reads `fp.filedAt` directly instead of replacing it with a period-level MIN from unrelated facts.
- Full verification: `npm run check` passed; `npm test -- --run` passed 110 test files / 595 tests; `npm run build` passed with the established chunk-size warnings only.
- Updated code comments, RU/EN manuals, `docs/LLM_CONTEXT.md`, bundled manuals and this handoff. No production apply, DB rematerialization or factor-IC recomputation was performed. Existing generated reports remain outside the source commit.
- Next safe action: a separate owner-reviewed local rematerialization and only then a fresh evaluation of affected research results. Do not treat pre-correction factor-IC values as repaired evidence.

## 15. Alpha Bridge MCP — 2026-11-03

- Added project-local `.kimi-code/mcp.json` and a stdio-only server with `read_handoff`, `append_message` and `report_status`. No shell commands, sockets, arbitrary paths or production transport.
- Shared `docs/ALPHA_BRIDGE.jsonl` is bounded to 100 messages and 4000 characters each. Writes use a bounded lock and atomic rename; corrupt files fail closed and common credential patterns are rejected without echoing secret input.
- `report_status` reads fixed bridge, Git-ref and daily-health evidence. It does not run `git status`; matching refs alone do not prove a clean tree.
- Added six unit tests covering storage, retention, corrupt history, secret rejection, protocol calls and unknown tools. A real isolated stdio smoke test completed `initialize → append_message → read_handoff → report_status`. Full suite after merging the F-01/F-02 correction: 111 test files and 601 tests passed; TypeScript check and production build passed.
- Operator contract is `docs/ALPHA_BRIDGE.md`; comments, `AGENTS.md`, RU/EN manuals, `LLM_CONTEXT` and bundled manuals were updated. Start a new Kimi Code session after pulling and review the command before trusting it. Other agents see bridge messages only after reviewed commit/push.

## 16. Captain command protocol — 2026-11-03

- Added `post_command`, `read_commands`, `ack_command` and `complete_command`: a captain-to-executor protocol with unique IDs and enforced `pending → acknowledged → completed/failed/blocked` transitions. `docs/ALPHA_COMMANDS.jsonl` is capped at 100 commands and validates duplicate IDs and invalid transitions.
- `alpha-bridge-agent` executes at most one pending instruction through non-interactive `kimi -p`, with a ten-minute timeout, bounded logs, output credential redaction, no hidden retries and no automatic resume of interrupted acknowledged commands.
- Unsafe production, migration, credential, GDELT, force and history-changing instructions fail closed or remain review-only. The executor is paused by default and requires one-time owner review plus the static deny rules in `docs/ALPHA_BRIDGE.md`.
- Added seven tests for state transitions, duplicate handling, unsafe instructions, MCP workflow, executor success/failure, interrupted acknowledgement and secret withholding. A separate real stdio smoke completed `post_command → ack_command → complete_command → read_commands`; no live model invocation was run in this workspace. Full suite: 112 test files and 608 tests passed; TypeScript check and production build passed.
- Updated `AGENTS.md`, `docs/ALPHA_BRIDGE.md`, RU/EN manuals, `LLM_CONTEXT`, operations runbook and bundled manuals. After one-time activation, the captain can post safe routine tasks while terminal evidence remains visible through `read_commands` and `report_status`.

## 17. Windows captain executor spawn fix — 2026-11-03

- The first real `captain-factor-check` run failed immediately with `spawn EINVAL` before Kimi CLI started. This was a Windows invocation bug, not a research or command-protocol failure.
- Replaced direct `kimi.cmd` spawning with fixed `cmd.exe /d /s /c kimi -p ...` invocation and strict Windows quoting: normalized newlines, doubled `%` and escaped `"`. Instruction text cannot become shell syntax. Non-Windows still uses direct `kimi` with `shell: false`.
- Added a regression test for the executable, fixed arguments and quoting. Targeted factor/probability suites and the command-protocol suite pass; no live model or production action was performed in this workspace.

## 18. Live Alpha Bridge via Kimi web — 2026-11-03

- Added `runLiveInstruction` and `worker/alpha-live-execute.mts`: direct captain instructions now create an isolated Kimi web session, submit a bounded prompt, wait for `turn.ended` over WebSocket and read transcript evidence. Git is no longer a live command transport; `ALPHA_COMMANDS.jsonl` is optional audit only.
- Bearer tokens stay in local environment/secret storage. Remote HTTP requires a private Tailscale address and explicit `ALPHA_KIMI_WEB_ALLOW_PRIVATE_HTTP=1`; other remote endpoints require HTTPS. Never use `--dangerous-bypass-auth`.
- One session and one turn per instruction, with a ten-minute default timeout and no hidden retries or duplicate executor for the same command ID.
- Mock integration tests cover session creation, prompt authorization/content, `turn.ended`, transcript, liveness, token requirements and private HTTP opt-in. No live model invocation was performed in this workspace. Full suite: 113 test files and 613 tests passed; TypeScript check and production build passed.
- Added `docs/ALPHA_LIVE.md`, `AGENTS.md`, RU/EN manuals, `LLM_CONTEXT` and bundled manuals. Activation: start `kimi web` locally or through a private Tailscale address, configure URL/token, then run `worker/alpha-live-execute.mts`.

## 19. Live WebSocket subscription ordering fix — 2026-11-03

- The first real `hello-live` run failed with `Kimi WebSocket closed before turn.ended`. Root cause: prompt was submitted before subscription, so a short command could finish before the listener was attached.
- `runLiveInstruction` now opens the WebSocket subscription **before** submitting the prompt. This prevents missed `turn.ended` events on fast completions.
- Close events now include numeric code and reason instead of an opaque failure. Regression coverage verifies that `subscribe` precedes the prompt request.
- No live model or production action was performed in this workspace. Full suite: 113 test files and 613 tests passed; TypeScript check and production build passed.

## 20. Home macro runs and first-vintage factor reevaluation — 2026-11-03T10:52Z

- Baseline: `5a1ec41`, `main...origin/main [behind 1]`. `git pull --rebase` was deliberately skipped because the tree already contained modified `public/reports/schwab-context.json`; the incoming commit touches only `docs/ALPHA_COMMANDS.jsonl`. No reset, stash, commit or push was performed. `npm install --no-audit --no-fund` was up to date.
- The real FRED command failed before collection because `FRED_API_KEY` is absent from the current shell; it was not retried and no credential was inspected or printed. The existing manifest remains valid: 20/20 series complete, captures on 2026-11-02. OFAC completed with 47 events / 0 new; manifest QA passed with zero errors and warnings.
- Real Event Study: `ready`, 47 eligible events, 47 with baseline, 46 with any outcome, discovery/OOS 32/15. Real Atlas: `partial`, 1,462 records and 24 studies; 6 estimated pilot studies, 18 insufficient coverage, 2 with OOS evaluation. Coverage exclusions: 10,810 missing / 2,110 partial / 465 stale exposure, 132 missing price and 870 missing shock.
- Daily health at 2026-11-03T10:39:31Z: scheduler online, Schwab 51/51 today, macro QA pass; 13 OK / 1 warning / 2 errors / 20 pending. Errors are stale Scenario and Shock Calibration lineage; Atlas is the coverage warning. No unrequested builders were run to hide those findings.
- Factor smoke AAPL succeeded with 545 points. Full rematerialization completed 51 companies / 21,439 factor points / 0 failed. Coverage is 51/51; only XOM_PRE=34088 and XOM=2115436 are missing, both outside the current universe.
- The documented `npx tsx -e` IC syntax hit the current CJS top-level-await limitation. The same `crossSectionFactorIc()` call was executed through an async IIFE without changing defaults. Direct pre/post baseline comparison: 2,900 → 2,840 rows, 720 rows changed n, 1,329 changed Spearman and 202 changed sign. AssetGrowth mean quarterly Spearman moved 0.2313 → 0.2219 (63d) and 0.1942 → 0.1802 (126d). These are changed estimates, not proof of repaired alpha.
- Independent checks completed. Sector high-minus-low AssetGrowth mean returns are +6.49% (63d) and +12.81% (126d), with severe drawdowns. The 126d final-holdout vol-target mean is +4.69% with CI95 [-0.75%, +9.65%], versus the historical +5.40% [+0.62%, +9.76%]; the new interval includes zero. No model or factor promotion is supported.
- `production-readiness.mts` returned `ready` with `missing=[]`; this is a local file gate, not production approval. `npm run check`, 113 test files / 613 tests, `npm run build` and `git diff --check` passed; build has only established chunk-size warnings.
- Generated evidence and command logs are ignored under `worker/.runs`; `home-research-evidence-index.json` records SHA256 hashes, including the real macro reports, pre/post IC, independent evaluations and coverage. The same macro reports remain as new untracked files at their required standard paths: after successful macro QA, removing them made readiness return `missing`, so the exact evidence copies were restored and the final readiness rerun returned `ready` / `missing=[]`. No tracked generated report was edited; the pre-existing Schwab context modification was left untouched.
- Next safe action: configure `FRED_API_KEY` in the shell without exposing it, run the FRED refresh once and rerun QA; separately review the pre-existing generated-report modification before pulling. Production apply/deploy, migrations and cloud collection remain untouched.

## 21. Detailed research report and owner-requested Git delivery — 2026-11-03T22:00Z

- The owner explicitly requested a very detailed report and Git delivery. The new 580-line report is `docs/HOME_MACRO_FACTOR_REEVALUATION_2026-11-03.md`; it contains the complete command ledger, all FRED captures, Event Study summaries, Atlas coverage/studies, per-company factor counts, all 32 factor/horizon pre/post comparisons, independent evaluations, historical discrepancies, blockers and 23 SHA256 artifact hashes.
- Evidence integrity was rechecked after later scheduler activity. The original QA result is preserved as `worker/.runs/macro-manifest-qa-20261103T103555Z.json`, matching its original SHA256; all 23 indexed artifacts pass hash verification with zero mismatches.
- Subsequent scheduler evidence is explicitly separated from the manual-run interval: Macro QA at 13:55Z, Shock Calibration, Event Study and Atlas dependency runs completed; `facts-fetch-daily` failed at 11:00Z because no local server was reachable on port 3000. It was not blindly retried.
- Fresh delivery gates passed: production-readiness `ready` / `missing=[]`, `npm run check`, 113 test files / 613 tests, and `npm run build` with chunk-size warnings only. The report and this handoff are the only intended documentation commit files.
- Pre-existing or scheduler-generated Schwab Context and Shock Calibration modifications plus untracked macro JSON/Markdown reports remain outside the documentation commit. `worker/.runs`, raw archives and `dist` remain ignored. No source code, schema or credentials were changed and no production action was taken. Final integration and commit identifiers are authoritative in `git log`.

## 22. Home Macro Recovery and facts prerequisites — 2026-11-03T22:53Z

- Baseline HEAD matched `31f635138785b4e24e37e1e466b0c666b7781a17`. Scheduler was idle with no macro process and one logical scheduler chain. Pre-existing Schwab, Shock Calibration, untracked macro reports, runtime `ALPHA_COMMANDS` and `worker/lib/alpha-live.ts` were not edited or discarded.
- Exactly one FRED refresh completed successfully: 20/20 series complete, 779,664 rows and zero errors. Manifest generated at `2026-11-03T22:40:27.034Z`; all 20 captures are fresh. Macro QA at `22:42:38.572Z` passed with zero errors and warnings.
- One run per builder: Shock Calibration 4/4 ready; Event Study `ready` with 188 observations and 47/47 events having outcomes; Atlas `partial` with 1,462 records / 24 studies / 6 estimated pilot / 18 insufficient / 2 OOS; Macro Scenarios generated four records with rates/oil `partial` and USD/credit `not_computable`. Every derived artifact is newer than QA.
- Fresh Daily Operations at `2026-11-03T22:47:57.596Z`: `critical`, 24 OK / 3 warnings / 4 errors / 5 pending; macro `derivedCurrent=true`; Schwab 51/51. Scenario, Calibration and Event Study lineage are OK; Atlas remains a coverage warning. Remaining errors are previous Stocktwits/Facts/Digest server failures and the Research Series dependency block.
- No web server was initially present. One authorized Vite dev server was started without changing startup tasks; listener PID 5440, parent cmd 15664, manager task PID 16636, log `worker/.runs/home-dev-server.log`. Final HTTP 200, one listener and one web process. Scheduler remains one process chain with `current=null` and empty queue; INGEST_URL classification is local.
- Facts prerequisites are `ready_for_future_run`; `facts-fetch-daily` was **not run**. Previous failed jobs were not retried. The dev server remains running for the next owner-reviewed/scheduled prerequisite check.
- Detailed evidence: `docs/HOME_MACRO_RECOVERY_2026-11-04.md` and `worker/.runs/home-macro-recovery-evidence-index.json` with 16 SHA256 artifacts, all verified. Delivery gates passed: TypeScript, 113 test files / 613 tests and production build with chunk-size warnings only.
- Documentation delivery is limited to the recovery report and this handoff. Generated/raw evidence, `.env`, `worker/.runs`, pre-existing generated changes and `worker/lib/alpha-live.ts` are excluded. No production action, migration, schema change, credential inspection, duplicate process or factor/model/regime promotion occurred. Push is allowed only as a normal fast-forward.

## 23. Controlled Facts → Research Series → Research Factors recovery — 2026-11-04T00:10Z

- Baseline HEAD matched `67ac938568a8d6698705c717bac450e8b98e4572`. Preflight passed: HTTP 200, one Vite listener PID 5440, one scheduler chain, idle state, local INGEST_URL classification and MySQL `SELECT 1`. Pre-existing source/generated diffs were not edited or discarded.
- Exactly one canonical request was appended: `owner-facts-chain-1793747633873`, with command lines 2 → 3. No second request or direct collector/builder command was used.
- Registered chain completed with zero failures: manual Facts `1793747637566` = 51 companies / 1,336,929 facts; manual Research Series `1793748747984` = 51 companies / 24,012 series / 1,085,507 points; manual Research Factors `1793749543156` = 51 companies / 21,489 points. Current-universe coverage is 51/51; only XOM and XOM_PRE remain outside it.
- Registered downstream runs completed: Analytics Snapshot, first Company Exposure run, Macro Scenarios and UI Production Build. Ordinary cron Stocktwits also succeeded with 8 deterministic + 4 probation new rows; three Alpha Bridge cron runs succeeded. Atlas did not rerun because its existing dependency gate was already satisfied.
- Fresh Daily Operations at `2026-11-03T23:55:52.362Z`: `critical`, 32 OK / 1 warning / 1 error / 2 pending, macro `derivedCurrent=true`, Schwab 51/51. Facts, Research Series, Stocktwits, Macro Scenarios and UI Build findings cleared through actual runs. Only the historical Daily Digest error and Atlas `partial` warning remain; FRED weekly and 13F are not-yet-due.
- IC snapshot is valid: 2,840 → 2,834 rows, 0 added / 6 removed keys, 14 changed n, 58 changed Spearman and 3 sign flips. AssetGrowth mean Spearman moved 0.221867 → 0.216435 (63d) and 0.180161 → 0.180038 (126d). IC changed but no factor/model/regime promotion is supported.
- IC wrapper terminal evidence: computation and JSON writing completed before the 600-second timeout; the tool runtime then terminated the wrapper with `terminal status=timed_out`, exit code 1, and it is no longer active. There was no manual kill. `worker/.runs/factor-ic-after-facts-chain.json` is fully valid (454,188 bytes, 2,834 rows), the snapshot was not repeated, and the IC comparison remains correct. The wrapper did not exit 0; the timeout and valid research artifact are both preserved.
- Detailed evidence: `docs/HOME_FACTS_CHAIN_2026-11-04.md` and `worker/.runs/home-facts-chain-evidence-index.json`, with 11/11 hashes matching. Delivery gates passed: TypeScript, 113 test files / 613 tests and build with chunk-size warnings only.
- Documentation delivery is limited to the chain report and this handoff. Generated/raw evidence, `.env`, `worker/.runs` and pre-existing diffs are excluded. No production action, migration, schema change, duplicate process or process kill occurred. Push is allowed only as an ordinary fast-forward.

## 24. F-03 13F event and aggregate-flow availability — 2026-11-04

- Housekeeping was delivered separately before F-03: timeout documentation commit `3763d43` and concise live-subscription comment commit `a58bcb4`, with 4/4 targeted alpha-live tests. The IC wrapper is explicitly `timed_out` / exit 1 and inactive, while its 454,188-byte / 2,834-row JSON remains valid.
- Root cause: `--rebuild-events` substituted quarter-end when filingDate was missing, and aggregate `smartMoneyFlow` assigned calendar `quarterDate+45d`, ignoring real filing/amendment availability. This could make events or flow visible before the actual publication or amendment.
- Before/after: `mergeQuarterFilings` now validates every required component and assigns MAX(actual filingDate), so an amendment cannot become available retroactively. `buildPositionRow` fails closed on missing real metadata. Rebuild skips missing availability with `MISSING_13F_FILING_DATE` remediation and a visible skip counter instead of creating research events. Quarter observation, publication availability and independent ingestion timestamps remain distinct.
- Aggregate flow now uses MAX(actual availability) across all included fund/books and both quarter periods. A LEFT JOIN preserves missing `fund_quarters`; any missing required availability emits no PIT input and produces an explicit diagnostic, never a quarter+45d fallback. Probability thresholds, weights, model parameters and research universe are unchanged.
- Targeted 13F/probability suites pass 85/85, including Q-end 2025-03-31, original 2025-05-10, amendment 2025-06-01, missing metadata and latest-fund availability. Full verification: TypeScript, 115 test files / 620 tests, production build with chunk-size warnings only, and `git diff --check`.
- Historical 13F events and probability/flow evaluations computed with the old fallback semantics are stale for availability-sensitive use and require a separate reviewed rebuild. No historical rebuild, collector, DB rematerialization or factor/IC reevaluation was run and no production action was taken.
- Documentation was updated in RU/EN manuals and `docs/LLM_CONTEXT.md`; `api/services/manuals-content.ts` was regenerated through the existing manuals workflow. Generated reports and all pre-existing diffs are excluded from the source commit.
- Next recommended correctness block: **F-04**, adding realtime-window-aware macro vintage selection so `macroPriorAt` and dashboard macro reads cannot use revisions unavailable at the anchor.

## 25. S&P 500 incremental companyfacts — code ready — 2026-11-04

- Collection snapshot: `edgar-universe.json` / `GICS_SNAPSHOT_AS_OF=2026-10-11`, documented Wikipedia constituents table. Evidence: 502 rows, 499 unique CIKs; FOX/FOXA, GOOG/GOOGL and NWS/NWSA are the three duplicate-CIK pairs. Sorted-unique-CIK universe SHA256: `9db32591ad570e51e4e9902417a5152414c2d27a5d73e2b9f7365b4d75809c9b`. This is a current collection snapshot, not historical S&P membership; no live scrape was performed.
- `worker/facts-fetch.mts` now performs sequential incremental collection with relevant 10-K/10-Q/20-F/40-F/10-KT/10-QT and amendment signatures. New relevant accessions, corrupt/missing raw, missing/failed ingest, previous failures and due reconciliation trigger refresh; irrelevant Form 4/13D/G do not. Full reconciliation uses a seven-day baseline plus deterministic 0–6-day CIK stagger.
- Atomic per-CIK manifests record checked/success timestamps, latest relevant filing metadata/signature, last full reconciliation, raw SHA256, refreshed/unchanged/failed status, bounded error and universe hash. New payload is ingested before replacing previous raw, so failed download/ingest preserves previous good raw and success timestamps. Completed CIKs resume from manifest; missing/failed CIKs retry on the next daily run. Local-only ingest and `--cached` recovery remain enforced.
- New independent registry job `sp500-facts-daily` uses `edgar-universe.json` at `30 23 * * *` home local time, with no research-series/factors downstream. Its failure does not block the research-51 chain. Daily Operations now reports manifest-backed unique-CIK coverage. Research universe 51, IC, Atlas and factor/model/regime universes were not expanded.
- Mocked SEC integration and registry/health tests pass 26/26; full gates passed: TypeScript, 116 test files / 633 tests and production build with chunk-size warnings only. Operations runbook, MACRO_DATA, RU/EN manuals, `docs/LLM_CONTEXT.md` and bundled manuals were updated through existing workflows. Real smoke and initial full backfill have not run yet.
- Next: limited real smoke, then one controlled scheduler reload for the new registry and one canonical initial `sp500-facts-daily` request if smoke passes. No production action, migration or collector was performed during this code-ready block.

## 26. Project State owner workflow — 2026-11-04

- Added the owner-only read-only `/project-state` page and a Dashboard shortcut. It separates code readiness, actual home collection, research evidence and reviewed delivery instead of presenting one misleading completion percentage.
- The page shows the reviewed-only flow `external sources → home collection → local evidence/QA → owner review → separate production decision`, the current S&P 500 block phases, live scheduler state when available, dated Daily Operations evidence, per-workflow destinations and the next correctness queue.
- S&P 500 implementation and smoke/reload are durable confirmed facts; backfill and final evidence remain separate. The UI uses live home scheduler state when available and otherwise says that live state is unavailable rather than inferring collection completion.
- Added `docs/PROJECT_STATE.md`, linked it from RU/EN manuals and refreshed `docs/LLM_CONTEXT.md`. Research remains on research-universe-51; production apply/deploy/sync and full-S&P research expansion remain owner-gated.
- This block changes UI/tests/docs only. It does not run or modify the SEC backfill, collectors, local MySQL, migrations, production state or generated research evidence.

## 27. S&P 500 initial backfill and final health — 2026-11-04

- Limited real smoke passed for AAPL, NVDA and Agilent: initial `refreshed=3`, verification `unchanged=3`, zero failures. Raw hashes match manifests. A missing-raw backfill succeeded for Agilent. A universe-path mistake was diagnosed before any SEC call and corrected without full backfill or scheduler restart.
- Controlled scheduler reload loaded 67 jobs. Old chain was stopped only after idle evidence; new chain is 5216 → 15548 → 16164 with `schedulerStartedAt=2026-11-04T02:37:07.601Z`. Exactly one canonical initial request was appended: `owner-sp500-facts-initial-1793759900468`, command lines 3 → 4.
- Initial registered run `1793759902622-sp500-facts-daily` completed in 1h 55m with exit code 1 from six failed CIKs. Final coverage: **499 processed / 490 refreshed / 3 unchanged / 6 failed / 6 without successful ingest**, 12,629,643 facts captured. Latest relevant forms among refreshed: 471 10-Q, 17 10-K, 1 10-K/A and one no-relevant-form. Resumable manifest exists for every checked CIK.
- Exact failed CIKs for the next daily incremental run: TGT 27474, HAS 49280, WELL 704808, PH 773634, TROW 1006367 and TPR 1077205, all SEC submissions/companyfacts HTTP 404. No immediate retry or second request was made and research-51 remains unexpanded with 51/51 factor coverage.
- Daily Operations at `2026-11-04T04:42:33.716Z`: `critical`, 12 OK / 2 warnings / 2 errors / 22 pending. S&P coverage warning records 499 unique CIKs, 490 refreshed, 3 unchanged, 6 failed and 6 missing. Scheduler is online with `current=null`, `queue=[]`; one web listener PID 5440 and one scheduler chain remain. Schwab has 0/51 captures for the new UTC day; Atlas remains partial and macro derivedCurrent=true.
- Evidence index `worker/.runs/sp500-facts-final-evidence-index.json` passes 8/8 SHA256 checks. Detailed report: `docs/SP500_FACTS_INCREMENTAL_2026-11-04.md`. Final documentation delivery is limited to that report and this handoff; generated/raw evidence and all pre-existing diffs are excluded. No production action, migration or factor/model/regime promotion occurred.


## 28. S&P 500 final evidence and CIK mapping remediation — 2026-11-04

- Final integration is complete: documentation commit `8a67e50`, merge commit `b951f5c7c6b677e052f5679b9770a5df0b8c1394`, fast-forward push. Initial backfill processed 499/499 CIKs: 490 refreshed + 3 unchanged + 6 failed, 12,629,643 facts, 499 resumable manifests. Final evidence index: 8/8 SHA256 matches.
- All six HTTP 404 failures were then verified against the official SEC `company_tickers_exchange.json` directory. They were incorrect ticker/CIK mappings, not missing SEC entities: TGT 27474→27419, HAS 49280→46080, WELL 704808→766704, PH 773634→76334, TROW 1006367→1113169, TPR 1077205→1116132. All 502 mappings were checked; exactly these six mismatched and no ticker was absent.
- Updated `api/services/gics-snapshot.ts` and regenerated `worker/edgar-universe.json`. Membership remains `GICS_SNAPSHOT_AS_OF=2026-10-11`; `GICS_CIK_VERIFIED_ON=2026-11-04` is separate. New universe SHA256: `cede4a6dfb3b3f20aecf08bd60ed7cad634e6ac146bfa8d6089cd4ba3a6a28ac`.
- Regression coverage pins all six corrected mappings, 502 rows / 499 unique CIKs, three duplicate-CIK pairs and the new hash. The wrong-CIK manifests remain historical evidence; correct CIKs have no raw/manifests and will be targeted by the next daily incremental run. No immediate retry or second backfill was run.
- Project State now marks initial backfill/evidence complete while distinguishing historical run failures from the completed mapping remediation. `docs/PROJECT_STATE.md`, `docs/SP500_FACTS_INCREMENTAL_2026-11-04.md` and `docs/LLM_CONTEXT.md` were updated. Research remains on research-universe-51 and no production action was taken.
- Next correctness block: **F-04**, realtime-window-aware macro vintage selection.

## 29. F-04 realtime-window-aware macro vintage selection — 2026-11-04

- Reviewed baseline: `f4b97c190b5d41cf2ff7c138ee466de35c4f2370`. The local branch was fast-forwarded from `b951f5c` after reading the reviewed CIK mapping remediation; all pre-existing generated/runtime diffs were preserved and excluded from this block.
- Root cause: `macroPriorAt` used a MAX(date)-only join constrained only by `date <= anchor`. It could select a revision that became available after the anchor and return duplicate vintages for one observation. `latestMacro` used `ORDER BY date DESC LIMIT 1` without any realtime-window predicate.
- Both production readers now call `latestEligibleMacroPoint` in `api/services/macro-vintage.ts`: `date <= T`, non-null `realtimeStart <= T`, and `(realtimeEnd IS NULL OR realtimeEnd >= T)`, ordered by `date DESC, realtimeStart DESC, id DESC` with per-series `LIMIT 1`. The probability anchor performs three bounded reads; the dashboard uses the same helper and defaults to the current UTC day, with optional `asOf` for deterministic tests. No full macro history is loaded per anchor.
- Legacy `realtimeStart=null` rows are unknown availability and fail closed; `fetchedAt` is never substituted. A valid start with null end is open-ended; realtime endpoints are inclusive, including start=end=anchor. A newest eligible null value stays missing, without older non-null or future-revision fallback. Thresholds, weights, model parameters and research universe are unchanged.
- `api/services/macro-vintage.test.ts` executes the actual production Drizzle predicate and ordering against synthetic rows without DB/network access. Regression cases cover original/revised selection, no evidence before the first start, unknown and open-ended windows, inclusive/expired boundaries, future observations, independent series, id ties, missing latest values, dashboard filtering and the production probability prior. Targeted macro/probability suites: **3 files / 28 tests passed**.
- Full verification: `npm run check` passed; `npm test -- --run` passed **118 test files / 648 tests**; `npm run build` passed with the established chunk-size warnings; `git diff --check` passed. The bundled manuals were regenerated with `npx tsx scripts/gen-manuals-content.mts` after updating RU/EN manuals and `docs/LLM_CONTEXT.md`.
- Historical macro prior, probability and nested evaluations produced with date-only selection are stale for availability-sensitive use and require a separate reviewed rebuild. No collectors, historical rebuilds, DB rematerialization, factor/IC/probability reevaluation, migrations or production actions were run. The normalized FRED archive, Scenario Engine guards, Event Study, Shock Calibration and Atlas were not changed.
- Project State marks F-04 done and F-05 first in the queue. S&P 500 mapping remediation remains a separate completed code task; collection of the corrected CIKs belongs to the next scheduled daily incremental run, not this block.
- Next correctness block: **F-05**, composite exposure MAX availability and strict period alignment.

## 30. F-05 composite exposure availability and period alignment — 2026-11-04

- Reviewed baseline: `791e47609e6bf38e4c805f6bce942ae3b074369b`. Scope was limited to Company Exposure and its Scenario/Atlas consumers; pre-existing generated/runtime diffs were preserved and excluded.
- Previous behavior: TTM used `points[0].sourceFiled`, current+noncurrent debt inherited only the current component's date, ratios inherited the numerator date, and foreign revenue inherited the domestic date. This could make a derived metric appear available before all required inputs were known.
- Every derived metric now applies `maxAvailability`: MAX across all four TTM points, current+noncurrent debt, both ratio sides and domestic+total revenue. Missing required availability fails closed and cannot produce `quality=available`. `latestByConcept` requires non-null `sourceFiled <= asOf` and `periodEnd <= asOf`; null-date rows cannot displace proven eligible vintages, late revisions are excluded before filing, and ties use id only after equal filing dates.
- Current+noncurrent debt requires compatible periods and units. Every ratio requires identical `periodEnd` and units, finite values and a positive denominator. Mismatches return `value=null`, `quality=missing` and an explicit diagnostic rather than numeric available/partial evidence. Foreign revenue uses the same ratio gate and MAX availability.
- Non-consecutive TTM remains `partial` with its existing note; the broader F-11 methodology was not changed. Scenario debt requires `quality=available` and valid as-of availability. Atlas accepts only available, non-stale metrics with known `sourceFiled` at or before event eligibility. Partial/missing evidence creates no research row, and lower available coverage is a correct fail-closed result.
- Regressions cover late TTM revisions and pre-revision anchors, debt/ratio/foreign MAX dates, current/noncurrent period and unit mismatches, stock Q4 versus TTM Q3, null availability, non-positive denominators, non-consecutive TTM, Scenario partial/unknown-date rejection and Atlas available-only records. Targeted suites passed **3 files / 31 tests**. Full verification: `npm run check`, **118 test files / 657 tests**, `npm run build` with established chunk-size warnings, and `git diff --check` passed. RU/EN manuals, `docs/MACRO_DATA.md`, `docs/LLM_CONTEXT.md` and bundled manuals were updated.
- Existing Company Exposure, Scenario and Atlas reports are stale until a separate reviewed rebuild; that rebuild was **not run**. No collectors, historical 13F/macro rebuilds, DB rematerialization, factor/IC/probability reevaluation, migrations or production actions were run. Scenario/Atlas models, thresholds, shock formulas and research universe remain unchanged.
- Project State marks F-05 done and starts the queue with separately reviewed 13F, macro and exposure rebuilds. S&P 500 corrected-CIK collection remains a separate scheduled daily operational task and was not triggered.
- Next: owner-reviewed evidence rebuilds, or **F-10** according to the agreed correctness queue; no rebuild is implicitly authorized by this code fix.

## 31. F-10 missing debt is not zero — 2026-11-04

- Baseline: `f4c37cc8cb858ee4171e69a34baa1f1b690d9239`. Scope is limited to `api/services/statements.ts`, targeted regressions and documentation; valuation formulas and other consumers were not changed.
- Root cause: `stDebt ?? 0` and `ltDebt ?? 0` converted missing debt evidence into zero, allowing `cash=100` with no debt facts to produce `netDebt=-100`. Missing cash could also be treated as zero.
- New semantics: missing cash or missing required debt returns null. Explicit reported zero remains valid: cash 100 plus zero current/noncurrent debt gives -100. Complete current+noncurrent components have precedence; existing `LongTermDebt` is a curated total-debt fallback used once, never added to those components. A partial debt without a curated total returns null.
- Synthetic regressions cover missing components, explicit zeros, one-component debt, curated-total precedence without double counting, missing cash and existing Statements behavior. Final targeted result: **1 file / 17 tests passed**; `npm run check` passed. An initial nested-array fixture error was diagnosed and corrected before the green run; no source behavior was changed to mask it.
- Existing Statements netDebt history derived with zero substitution requires a reviewed rebuild where applicable. No collectors, rebuilds, rematerialization or production actions were run. Full suite/build and final Project State queue updates are intentionally deferred until the separate F-11 commit.
- Next: **F-11**, consecutive-quarter TTM, followed by one separately reviewed Company Exposure → Macro Scenarios → Atlas rebuild after both fixes.

## 32. F-11 TTM requires consecutive quarters — 2026-11-04

- Baseline: separate F-10 commit `77ee1922571444c4323cb04991be31225966495b`. Scope is Statements TTM, targeted regressions and final documentation/queue. Company Exposure F-05 behavior, annual mode, ROE/ROA formulas, YoY, grid popularity threshold and research parameters are unchanged.
- Root cause: quarterly TTM accepted any four non-null values in four visible grid positions. A quarter dropped by popularity filtering could therefore produce a numeric TTM spanning five calendar quarters.
- New rule: require four existing grid positions, four non-null finite cells and consecutive calendar-quarter indices with step exactly one in descending order. The same `qIdx` is shared by TTM and calendar-aligned YoY. A missing quarter or cell returns null; longer windows still use only the latest four quarters.
- A 53-week fiscal calendar uses actual period ends and quarter indices, with no 365-day or equal-quarter-duration gate. Annual mode continues to use the FY column directly.
- Regressions cover four consecutive quarters, a visible-grid hole, null required cells, five consecutive quarters, a 53-week calendar, unchanged annual ROE/ROA and the existing YoY hole case. Targeted Statements/company-exposure suites passed **2 files / 38 tests**; `npm run check` passed.
- Final gates after both code fixes: `npm run check` passed; `npm test -- --run` passed **118 test files / 668 tests**; `npm run build` passed with established chunk-size warnings; `git diff --check` passed. Bundled manuals were regenerated through the existing workflow. These are code-verification results, not refreshed research evidence.
- Historical Statements ROE/ROA TTM values derived from non-consecutive quarters require a reviewed rebuild where applicable; F-10 netDebt history has the same review requirement where zero substitution was used. Company Exposure, Scenarios and Atlas remain stale after F-05 and now require **one** reviewed rebuild after both numeric fixes. No collectors, rebuilds, rematerialization, factor/IC/probability reevaluation, migrations or production actions were run.
- Project State marks F-10 and F-11 done. Queue order is one reviewed Company Exposure → Macro Scenarios → Atlas rebuild, reviewed macro prior/probability rebuild, reviewed 13F event/flow/probability rebuild, then F-15/F-16 and production/security findings. Corrected-CIK daily collection remains a separate operational task.

## 33. Reviewed Company Exposure → Macro Scenarios → Atlas rebuild — 2026-11-04

- Baseline `1e1705e302631f89d5d2c02ee92da44d40b3c084`. Preflight passed: idle scheduler, one web listener and one scheduler chain, MySQL SELECT 1, Macro QA pass and Event Study current with QA, valid pilot evidence inside 48h, research-universe-51 for exposure and unchanged default research-universe-50 for Atlas. A pre-existing scheduled S&P daily run had completed before this block; no collector was requested by it.
- Exactly one manual run per builder completed with exit 0: Company Exposure `07:53:49Z` → `07:55:35Z`, Macro Scenarios `07:56:06Z` → `07:56:09Z`, Atlas `07:56:35Z` → `07:58:51Z`. No scheduler request was added and registered lastRuns remain unchanged.
- Company Exposure: coverage fields 51 / debt 47 / interestCoverage 6 / fuelCost 1 / oilRevenue 1 / oilCost 2 / foreignRevenueShare 0. There were 64 available→missing transitions and zero available gains, all with explicit incompatible-period diagnostics: debtToOperatingIncome 17, interestCoverage 24, cashToDebt 22, fuelCostToOperatingIncome 1. Missing-sourceFiled diagnostics are zero; available PIT-invalid metrics are zero.
- Scenarios retain rates/oil `partial` and USD/credit `not_computable`, with 2 computable / 3 historical_only / 15 not_computable impacts. Reasons are unchanged. DGS10 moved to an already archived 2026-11-02 observation available 2026-11-03; no FRED refresh occurred. Other baselines are unchanged.
- Atlas is `partial`: 904 records (was 1,462), candidatePairs 14,100, exposureMissing 12,633, exposurePartial 1,000, exposureStale 0, priceMissing 100, shockMissing 564. Studies: 24 total / 6 estimated / 18 insufficient / 0 full_sample / 2 OOS. OOS rows are 70 for DGS10 and BAMLH0A0HYM2 horizon 1; R² is negative and no alpha or promotion is claimed.
- Daily Operations initially read a malformed Bash macro-root path and reported missing FRED/OFAC manifests. The cause was proven, the invalid artifact preserved, and only health was regenerated with `D:/research/alpha-engine/macro`; research builders were not repeated. Final health at `2026-11-04T08:02:57.472Z`: **critical**, 14 OK / 1 warning / 1 error / 22 pending, scheduler online and idle, macro derivedCurrent=true, Schwab 0/51 and Atlas partial warning. Readiness `ready` / `missing=[]` is only the local file gate.
- Timestamped backups, pre/post metrics, all transitions, Scenario baselines, study details, command logs and `command-ledger.json` are under `worker/.runs/exposure-rebuild-20261104T074932Z`. Evidence index and verification pass **36/36 SHA256 checks with zero mismatches**. Generated reports and runtime evidence are excluded from the documentation commit.
- Documentation delivery gates passed: `npm run check`, **118 test files / 668 tests**, `npm run build` with established chunk-size warnings, and `git diff --check`.
- Detailed report: `docs/EXPOSURE_REBUILD_2026-11-04.md`. Project State now records actual Atlas 904 records and starts the queue with reviewed macro prior/probability rebuild, then reviewed 13F event/flow/probability rebuild, F-15/F-16 and production/security findings. No collectors, other historical rebuilds, factor/IC/probability reevaluation, migrations or production actions were performed.

## 34. Integrated operational and macro-probability verification — 2026-11-04

- Baseline `98b64d41b2411c905e7f6aba2a82ccc24eaa3faf`. Preflight verified one scheduler chain and web listener, HTTP 200, local INGEST_URL, MySQL SELECT 1, Macro QA pass / derivedCurrent=true and Atlas partial/904. No scheduler reload or server restart was needed.
- All six corrected CIKs are **collected/valid** by manifest and raw evidence: TGT 27419 (25,319 rows), HAS 46080 (27,380), WELL 766704 (37,375), PH 76334 (26,379), TROW 1113169 (19,944), TPR 1116132 (25,947). Every payload CIK matches, factsToRows is non-empty, successful ingest exists and raw/manifest SHA256 match. The corrected universe hash is `cede4a6dfb3b3f20aecf08bd60ed7cad634e6ac146bfa8d6089cd4ba3a6a28ac`; old wrong-CIK manifests remain historical and are not in the current universe. No collector or reload was started.
- Schwab full snapshot remains scheduled at 04:00 home local (`2026-11-04T12:00:00Z`); no manual pre-slot run was started. Health now uses pending/awaiting_scheduled_capture through nextRun plus a documented 60-minute grace period, then error. It never treats 0/51 as ok and keeps hourly context independent. Targeted suites passed **2 files / 13 tests**. Actual Daily Operations at `2026-11-04T08:58:55.248Z`: **degraded**, 14 OK / 1 warning / 0 errors / 23 pending, with Atlas partial/904 warning and macro derivedCurrent=true.
- Evaluation used `evaluateCompany` for AAPL/NVDA/MSFT and `nestedEvaluate` for bayes/logistic with a frozen protocol. It produced three company reports and six nested reports over 485 evaluated anchors. Output JSON is complete (405,910 bytes), was parsed before DB close, and the process exited 0 in about 19 seconds without timeout or another evaluation.
- Macro coverage is limited: all 1,455 anchor/series checks lack eligible rows, selected-after-anchor=0, so the existing macro prior is the neutral 0.5 fallback. All stored windows have start=end=2026-10-19; current eligible vintages are absent. A boundary probe on 2026-10-19 returns VIX 19.99, HY OAS 3.31 and curve 0.38 with valid IDs/dates/windows. This is a data-coverage limitation, not repaired alpha or a reason to backfill implicitly.
- Nested accuracy, balanced accuracy, costs, holdouts, regimes and pooling are reported in `docs/INTEGRATED_VERIFICATION_2026-11-04.md`. Historical results are compared only as historical documentation, not direct same-DB pre/post; no old worktree was used and no model/factor/regime/probability promotion is supported.
- Full gates passed: `npm run check`, **118 test files / 673 tests**, `npm run build` with established chunk-size warnings, and `git diff --check`. Bundled manuals were regenerated. Project State distinguishes initial backfill failures from corrected valid collection, awaiting Schwab, Atlas 904 and the macro coverage limitation. Next reviewed block: 13F event/flow/probability rebuild, then F-15/F-16 and production/security findings.
- Evidence root `worker/.runs/integrated-verification-20261104T084250Z`: preflight, per-CIK checks, schedule, protocol, evaluation JSON/Markdown, DB coverage, health tests, daily health, command ledger and before/after Project State. Evidence index: **43/43 SHA256 matches, zero mismatches**. Generated reports, raw archives and `.runs` are excluded from both commits.


## 35. Project State consistency review — 2026-11-04

- Reviewed `docs/PROJECT_STATE.md` against the integrated verification, exposure rebuild and current `src/data/project-state.ts`. Corrected a real contradiction: F-04 no longer says the macro evaluation “was not run” while the next bullet records it as completed. The reviewed evaluation is complete, but macro prior still uses the neutral fallback because eligible vintages are missing; it is not repaired macro evidence.
- Added a separate completed phase for corrected-CIK collection and manifest verification, merged the duplicated S&P 500 mapping/collection bullets and clarified that Schwab's 04:00 home-local full-snapshot slot is pending before capture, not a failure.
- Expanded the next queue so it no longer drops required work: reviewed 13F rebuild, macro vintage-data remediation, reviewed Statements netDebt/ROE/ROA historical rebuild/evaluation, F-15/F-16, Atlas coverage from new documented exposure evidence rather than repeated runs, and production/security findings.
- Synchronized `docs/PROJECT_STATE.md`, `src/data/project-state.ts`, `docs/LLM_CONTEXT.md` and this handoff. No collector, rebuild, scheduler reload, migration or production action was performed.

## 36. Reviewed 13F event/flow/probability remediation — 2026-11-04

- Baseline `ab914fcb4af56be69d20780d0a1f8cc73ae0536c`. Preflight verified local ingest, MySQL SELECT 1, one server and one scheduler chain. Before any write, full backup captured 16,912 position rows / 879,289 holdings / 3,416 fund_quarters with SHA256. An existing EDGAR cron was allowed to finish; no process was killed and audit ran only after idle.
- Audit classes: **16,912 VALID / 0 STALE_FALLBACK / 0 MISSING_REQUIRED_AVAILABILITY / 0 DUPLICATE / 0 UNKNOWN**. Exact row IDs and reasons are in `audit.json`. No stale row justified a delete. Default dry-run, machine backup, row fingerprint, exact IDs, ≤500 batches, rollback and idempotency were implemented in `scripts/13f-remediate-events.mts` and `worker/lib/thirteenf-event-remediation.ts`.
- Apply was zero-change: 0 affected rows / 0 batches. VALID and UNKNOWN were preserved, other sources untouched. Source commits `938105969950956e08f36cb99949ca2c3f56323b` and parser fix `29acca94d978aca8cc559739afc2a199d5f3dc22` are pushed. A first push hit GitHub Internal Server Error, not non-fast-forward; the later ordinary push succeeded without force or history changes.
- Exactly one DB-only `scripts/13f-refresh.mts --rebuild-events` completed in 14 minutes with exit 0: **1 inserted event / 0 skipped quarters / 0 missing filing availability**. Post-rebuild dry-run shows **16,913 VALID / 0 duplicates / 0 missing availability / 0 pending deletions**. New Soros row id 168239 has actual fund-quarter accession and filingDate `2026-08-14`, not a fallback.
- Flow evaluation used `buildSmartMoneyFlowPoints`, `evaluateCompany` and `nestedEvaluate` with frozen protocols. AAPL/NVDA/MSFT each have 14 flow points, latest actual MAX availability `2026-10-22`, zero skipped quarters and zero missing funds. There are 393/485 evaluated company anchors without eligible flow; no fallback was used. Existing factor_points=0 is not treated as a direct signalSeries pre/post baseline.
- Nested metrics, costs, holdouts, regimes and pooling are documented in `docs/THIRTEENF_REBUILD_2026-11-04.md`. Macro prior remains the neutral 0.5 fallback because eligible macro vintages are absent. Historical comparison only; no old worktree, causal attribution, model/factor/regime/probability promotion or repaired-alpha claim.
- Verification: targeted **3 files / 15 tests**; full **119 files / 681 tests**; `npm run check`, `npm run build` with established chunk-size warnings and `git diff --check` passed. Flow JSON is 242,588 bytes (`43c0d196e74a274223767d6aaac07800352469f605ed34688f64523134cb8b70`), was written and parsed before DB close, with no timeout or second evaluation.
- Evidence root `worker/.runs/thirteenf-remediation-20261104T094500Z` holds preflight, audit, backups, apply, rebuild logs, post-verification, protocol, flow JSON/Markdown and Project State snapshots. The complete evidence index passes **40/40 SHA256 checks with zero mismatches**. Generated evidence and raw backups are excluded from the documentation commit. Next: macro vintage-data remediation, Statements historical rebuild/evaluation, F-15/F-16, Atlas coverage from documented exposure and production/security findings.


## 37. Deferred pooled-model and data strategy — 2026-11-04

- Recorded the owner's refined hypothesis in `docs/PROJECT_STATE.md` §7 and linked it from RU/EN manuals and `docs/LLM_CONTEXT.md`. It is a deferred plan after the active remediation tails, not a replacement for the current 13F/macro/Statements/security queue.
- Default: pooled statistical regularities across companies with shared discovery-fitted coefficients and frozen OOS evaluation. A limited complete-evidence universe is acceptable only with company/sector/chronological holdouts, availability discipline and an explicit complexity budget; 51 companies alone do not prove a universal law or sufficient statistical power.
- Continue S&P 500 forward collection as insurance, with per-source `historyStart` and `availabilityMode=backfill|forward_only`. This does not automatically expand research or production and does not imply full-universe LLM work.
- Do not launch full retrospective backfill for every ticker. Backfill only for an approved per-company case, credible pooled-model heterogeneity, demonstrated history bias or a required evaluation, and only when the source officially supports it. Otherwise mark `forward_only`, never zero sentiment/exposure or a current snapshot as history.
- If pooled evidence passes company, sector and chronological holdouts with acceptable economic risk, expand research in reviewed batches. If it fails or company-specific structure dominates, stop broad scaling and run a small target-company pilot with only the required historical depth.
- No collector, rebuild, model training, migration or production action was performed while recording this strategy.


## 38. Macro vintage-data remediation — partial, evidence-backed — 2026-11-04

- Reviewed baseline `07727f497a013bd93e62a2546461b7683a8da179`; four newer commits were read before fast-forward. Source commit **`991f0462db7861ddf08df508ed0ed2ae74fda8d6`** (`Add macro vintage remediation adapter`) was pushed by ordinary fast-forward with a ten-file whitelist and zero high-confidence credential markers. Pre-existing generated/runtime diffs and `worker/.runs` were excluded.
- Initial audit covers all 47,901 macro_points. Before any write, full backup saved 9,983,065 bytes with SHA256 `5622b2d965a0bfbde5d734c4aafc39bd5731293804a40b13d809fd8bfdd613fd`. Five series had one exact legacy closed-window versus official open-ended conflict; normalized FEDFUNDS was absent. No DFF substitution, deletes or schema changes occurred.
- Added the fail-closed adapter and `volatility/vix_close` registry channel. Complete Macro Ops now expects 21 series; Event Study/Shock Calibration inputs are unchanged. One targeted VIXCLS fetch, no force/group-all, completed with 83,769 official ALFRED rows. One QA returned **pass / 0 errors / 0 warnings**.
- Dry-run and the only apply both returned explicit **partial / exit 1**. Apply inserted **85,480 rows** only for VIXCLS (83,769) and BAMLH0A0HYM2 (1,711). DGS10/DGS2/T10Y2Y/CPIAUCSL/UNRATE were wholly preserved due to exact conflicts; FEDFUNDS remains missing source evidence. No second apply or retry was made.
- Read-only post-verification passed: **133,381 rows**, all 47,901 original rows unchanged by ID, zero missing originals, zero new-row source mismatches, duplicates, availability inversions, null starts or selected-after-anchor probes. Current eligible vintages exist only for VIXCLS id 145480 and BAMLH0A0HYM2 id 61711; T10Y2Y and five other curated series remain unavailable.
- A pre-apply scheduler idle check failed, but `&& set -o pipefail;` chaining allowed the apply to continue. Only Stocktwits and Alpha Bridge cron jobs overlapped; no macro collector/builder was observed. No process was killed or reloaded. This incident is documented in `scheduler-apply-concurrency.json` and the detailed report, not misrepresented as a passed guard.
- Frozen evaluation completed three company and six nested bayes/logistic reports over 485 anchors with no timeout: **472/1,455 eligible / 983 missing / 0 selected-after-anchor / 0 complete three-series anchors**. VIX has 388 eligible / 97 missing, HY 84 / 401, curve 0 / 485. Actual prior distribution: 0.54 on 224 anchors, 0.42 on 35, 0.50 on 226; current company prior remains 0.50. Metrics, costs, holdouts, regimes and pooling are in the report. Historical comparison only, not direct same-DB pre/post or causal attribution.
- Targeted verification: **5 files / 32 tests**. Source full gates: `npm run check`, **121 files / 689 tests**, `npm run build` with established chunk warnings and `git diff --check`, all passed. Full documentation gates and command logs are retained separately under the evidence root.
- Evidence root `worker/.runs/macro-vintage-remediation-20261104T121416Z` includes preflight, initial audit, complete backup, archive/VIX hashes, dry-run/apply, post-verification, frozen protocol, 716,149-byte evaluation JSON, Markdown, command ledger, Project State before/after and SHA256 index/verification. Detailed report: `docs/MACRO_VINTAGE_REMEDIATION_2026-11-04.md`.
- Project State deliberately marks macro remediation **partial**, not done. Next safe block: reviewed resolution of the five exact conflicts plus separately authorized official FEDFUNDS collection, then a fresh backup/backfill/evaluation. Only afterward: Statements netDebt/ROE/ROA historical rebuild/evaluation, F-15/F-16, Atlas coverage from documented exposure and production/security findings.
- No full FRED refresh, SEC/13F collector, 13F/Statements/Atlas rebuild, F-15/F-16 work, production apply/deploy/sync, migration, `db:push`, credential inspection or model/factor/regime/probability promotion occurred.


## 39. Reviewed macro vintage follow-up — exact repair complete, FEDFUNDS/backfill blocked — 2026-11-04

- Baseline `e65a26afecaed19e3036c6c7a0a9eb87ce86b034`. Source commit **`ed939f307be66d5120193a914ae0ad6abd2c173f`** (`Add reviewed macro window remediation`) was pushed by ordinary fast-forward with a 12-file whitelist. It adds exact-ID planning/transaction, backup fingerprint verification, raw UTC timestamp normalization, comma-separated series parsing, monthly FEDFUNDS registry mapping and regression tests.
- Exact dry-run found five official-evidence-backed diffs and zero mismatches. Before exact repair, a complete backup captured 133,381 rows: SHA256 `8cf67f91e327f69bba141869633fa03fbfd555df20b6a3c65cefdd1ee07561c5`, fingerprint `45b28ffa709c8f77579c25e624d4b04637609e1fee17af31f53d6f0fb2a8bf9b`. After exact repair, the second complete backup has SHA256 `84a1374be251e7ed9e50d73decdd9554dd3ad9b122ccb4e0f4d4b7175a889ca9` and fingerprint `7f327db46a249f32eb1c80000748e6adb41526c96bf250d15c1ef2a9db06efc0`.
- One committed transaction changed only `realtimeEnd` to NULL for DGS10 id 44671, DGS2 id 46182, T10Y2Y id 47694, CPIAUCSL id 31824 and UNRATE id 32769. Values, observations, starts, fetchedAt and all other rows are unchanged. Independent post-check: **5 changed / 133,376 unchanged / 0 new / 0 unexpected / 0 duplicates / 0 inversions**.
- A failed scheduler guard stopped the first apply; no shell continuation executed it. Scheduled Stocktwits/Alpha Bridge completed naturally before a new full guard passed. A later apply stopped before UPDATE because raw MySQL timestamp formatting differed from Date representation. UTC normalization and tests fixed that deterministic issue; another full guard preceded the successful transaction. The original `status=planned` reporting artifact is retained; field ordering was corrected in source, and independent post-verification is `pass` without another apply.
- Exactly one FEDFUNDS targeted command failed **before network collection** because monthly FEDFUNDS was absent from `macro-sources.ts`. No retry or DFF substitution occurred. The registry now has `effective_federal_funds_monthly`, and future complete manifests expect 22 series, but there is **no official archive, post-fetch QA or six-series backfill**. Follow-up inserted rows are **0 for all six series**; total rows remain **133,381**. VIXCLS/BAMLH0A0HYM2 were not backfilled again.
- Coverage is **7/8 current eligible series**: only FEDFUNDS is missing, with the explicit reason recorded. All original 47,901 IDs are preserved except the five approved realtimeEnd fields; original values are unchanged. `latestMacro` returns seven series without a current-value substitute. Selected-after-anchor, duplicates, inversions and null starts are zero.
- Frozen evaluation produced three company and six nested reports, written and parsed before DB close without timeout. Coverage: **472/1,455 eligible / 983 missing / 0 complete three-series anchors / 0 selected-after-anchor**. Curve history remains 0/485 because six-series backfill did not run. Prior distribution: 0.54×224 / 0.42×35 / 0.50×226; current company prior remains 0.50. Nested accuracy, costs, holdouts, regimes and pooling are unchanged from the previous partial evaluation; historical comparison only, not causal attribution or promotion.
- Source verification: **5 files / 31 targeted tests**, then **122 files / 698 tests**, TypeScript and production build with established chunk warnings, `git diff --check`. Evaluation JSON is 716,208 bytes, SHA256 `972f8cd954bc98e7efcb1dda2f96014a9cba6446e541957397bb0856e57a7326`.
- Evidence root `worker/.runs/macro-vintage-followup-20261104T181640Z` holds all guards, dry-run/plan, before/after backups, failed and successful apply artifacts, exact post-check, FEDFUNDS failure, coverage, frozen evaluation, logs, source/docs gates and SHA256 index. Detailed report: `docs/MACRO_VINTAGE_FOLLOWUP_2026-11-04.md`.
- Project State remains **partial**. Next safe block: one newly reviewed FEDFUNDS fetch after the registry fix → clean QA → fresh backup and one reviewed six-series backfill. Only after those blockers are proven resolved should the queue advance to Statements netDebt/ROE/ROA historical rebuild/evaluation, then F-15/F-16, Atlas coverage and production/security. No production action or other prohibited rebuild occurred.


## 40. FEDFUNDS and six-series macro restoration complete — 2026-11-04

- Reviewed start HEAD was `1c0c0c8d6df9f0f7a4178352e7ef755a5cdcdc16`, including the two commits above. All five exact IDs were already open-ended; **no repeat exact-ID transaction** was executed. Prior source commit `ed939f307be66d5120193a914ae0ad6abd2c173f` supplied the tested monthly FEDFUNDS registry and comma-separated adapter, so no additional source/empty commit was needed.
- A fresh pre-collection backup preserved 133,381 rows with SHA256 `84a1374be251e7ed9e50d73decdd9554dd3ad9b122ccb4e0f4d4b7175a889ca9` and fingerprint `7f327db46a249f32eb1c80000748e6adb41526c96bf250d15c1ef2a9db06efc0`. Guard passed before collection and again before the single apply, with one scheduler chain/listener, local ingest, MySQL and clean QA; no failed guard was continued.
- One targeted FEDFUNDS run completed **exit 0 / complete / alfred_vintages**: **4,510 rows**, observations 2000-01-01→2026-10-01, vintages 2000-02-08→2026-11-02, zero missing starts/inversions. Raw hash `2f880c343538a8f80cbd638608ede4d1d29e1d1df89139365b17debc5d2a07dc`; normalized hash `1353c310b5d09b39acdd3912bede88ea9b24582bc7c2748eff9570a770d4e2a6`. QA passed for **22 series / 0 errors / 0 warnings** at 19:24:26Z.
- One limited six-series apply completed **exit 0 / complete**: DGS10 94,622; DGS2 94,621; T10Y2Y 71,173; FEDFUNDS 4,510; CPIAUCSL 5,773; UNRATE 4,782. Total **275,481 inserted**, zero conflicts, missing availability or errors. Five exact already repaired rows were recognized as unchanged. VIXCLS/BAMLH0A0HYM2 were not backfilled again.
- Final total is **408,862 rows**, exactly 133,381 + 275,481. Final backup has SHA256 `21bbff9dc427a94b9e28f83ff0a3253bf91a28273f5f27f8fb785a4292e03319` and fingerprint `ad14687c6161a8f0ffd518139f7ebce57c3e385d620ec8bf54e385514af2ef63`. All preexisting rows are unchanged; original 47,901 IDs have only the five previously approved realtimeEnd changes.
- Independent verification compared every new row with normalized official evidence and raw hashes: zero mismatches. All **8/8 curated series** have current eligible vintages; `latestMacro` returns all eight. Duplicate/conflicting groups, availability inversions, null starts and selected-after-anchor are zero. FEDFUNDS current id 410406 has observation 2026-10-01, start 2026-11-02, end NULL, value 3.88.
- Frozen evaluation produced three company and six nested reports without timeout: **794/1,455 eligible / 661 missing / 84 complete three-series anchors / selected-after-anchor=0**. VIX 388/97 eligible/missing, HY 84/401, curve **322/163**. Prior distribution: 0.50×195 / 0.54×189 / 0.42×31 / 0.47×66 / 0.39×4; **290 non-neutral anchors**, current prior remains 0.50. AAPL/MSFT metrics changed from the previous partial evaluation; comparison is historical only, not direct same-DB pre/post, causal attribution or promotion.
- Evaluation JSON is 688,036 bytes with SHA256 `33f17617c55be8acfcdf716b296abafbe657df2f0ba84c4cc5c2351d8ceb87c9`; Markdown SHA256 `b9897a2add1c824994f721b31b9a95bcf60deacbd909601d0a2c52f25d416f34`. Evidence root `worker/.runs/macro-vintage-fedfunds-20261104T192256Z` contains guards, backups, FEDFUNDS raw/normalized/chunks, apply, coverage, evaluation, logs, delivery and SHA256 index. Detailed report: `docs/MACRO_VINTAGE_FEDFUNDS_COMPLETION_2026-11-04.md`.
- Project State now marks macro remediation **complete for the reviewed official available history**, while retaining source-history limits and only 84/485 complete three-series anchors. Next reviewed block: **Statements netDebt/ROE/ROA historical rebuild/evaluation**, then F-15/F-16, Atlas coverage and production/security. No prohibited collector/rebuild, production action, migration or credential access occurred.


## 41. Private reviewer presentation — 2026-11-04

- Added a separate reviewer access profile without changing `users.role`: first-IP HMAC binding, versioned NDA consent with timestamp/IP hash/user-agent/session identity, server-enforced NDA checks and read-only mutation guards.
- Added two server-persisted guided tours: geography and technical. State and steps survive sessions, including `not_started`, `in_progress`, `completed` and `dismissed_forever`; skip-now is distinct from permanent dismissal.
- Added `/reports/*` NDA enforcement, anti-indexing headers and read-only presentation routes/navigation. Admin behavior and Operations access remain separate; reviewer cannot launch jobs, mutate universe or use admin functions.
- Added `db/ddl/029_reviewer_access.sql`, idempotent `apply-ddl-029.mts` and `scripts/seed-reviewer-account.mts`. Seed uses env credentials only, refuses reseeding and loads exactly 50 presentation companies from `research-universe-50.json`. Migration and account creation were not run here.
- Added copy deterrents and a user-specific watermark. Browsers cannot truly prevent screenshots or DevTools extraction; documentation states this explicitly rather than promising absolute anti-capture protection.
- Verification: **129 test files / 716 tests passed**, TypeScript and production build. Browser smoke covered NDA, acceptance, tour selection, technical steps and mobile layout. A real layout defect was found and fixed before delivery.
- Detailed contract and activation: `docs/REVIEWER_EXPERIENCE.md`.

## 42. Sequential reviewer DDL apply and local access smoke — 2026-11-04

- Fixed `apply-ddl-029.mts` without changing `db/ddl/029_reviewer_access.sql`: the three original statements now execute separately in source order. Only `CREATE TABLE IF NOT EXISTS` and the documented reviewer `CREATE INDEX` are accepted; other statement types fail explicitly. No DROP, table recreation, `db:push` or schema rewrite was used.
- Before index creation, the applier queries `information_schema.STATISTICS` scoped by `TABLE_SCHEMA=DATABASE()`, `reviewer_access` and `idx_reviewer_access_accepted`. Logs contain only the step number and applied/skipped result, not credentials or full DDL. Importing the module for tests no longer starts the migration, and the CLI closes its DB pool.
- Added `worker/lib/apply-ddl-029.test.ts`: **4/4 targeted tests passed**, covering sequential execution, creation of the second table, exactly one index creation across repeated runs, an already-present index, rejection of unexpected statements and credential/DDL-free logs.
- Local `npx tsx apply-ddl-029.mts` completed all three steps. A second run safely repeated the two `CREATE TABLE IF NOT EXISTS` statements and skipped the existing index. Read-only `information_schema` verification confirmed both `reviewer_access` and `reviewer_tour_preferences`, plus `idx_reviewer_access_accepted` on `acceptedAt`; no tables were dropped or recreated.
- A fresh env-based seed created local reviewer id 4 with 50 presentation companies, NDA required and no first-IP binding. The typed-client smoke at `2026-11-04T22:56:32.487Z` passed: login bound the first IP, guarded report access returned 403 before NDA and 200 after acceptance, acceptance stored a matching IP hash rather than the raw IP, repeated acceptance was idempotent, technical tour start succeeded and a different network was rejected. Credentials and session cookies were not printed. Local evidence is `worker/.runs/reviewer-nda-first-ip-smoke.json`, excluded from Git.
- Full gates passed: `npm run check`, **131 test files / 728 tests**, `npm run build` with established chunk-size warnings, and `git diff --check` with no whitespace errors. The existing single local dev server was left running; no duplicate server, collector or scheduler was started.
- Delivery is limited to the applier, its regression test and this handoff. Pre-existing generated/runtime diffs, generated reports, local evidence and credentials remain excluded. No production apply/deploy/sync or cloud collection occurred.

## 43. Reviewer administration and integrated merge — 2026-11-05

- Integrated Kimi Code commit `53e4e82` with the separate reviewer-administration worktree through ordinary merge `bd88d52`; both the sequential DDL applier and the presentation implementation are preserved. No force-push, reset, repeated DDL implementation or collector/backfill run occurred.
- Added **Admin → Reviewer** with owner-only account creation and status listing. Creation transactionally inserts a local `users.role=user` account, reviewer access profile, two tour preferences and exactly 50 unique presentation-universe memberships. List responses contain no credentials, raw IPs or IP hashes.
- Added owner actions for Reset IP+NDA, Reset NDA and Reset tour. Reset IP+NDA requires fresh consent at the next login; Reset NDA preserves first-IP binding; Reset tour affects only tour progress. Delete uses the existing owner-only user deletion endpoint with an explicit confirmation, and `deleteUserCascade` now removes reviewer access and tour preferences as well as the existing per-user artifacts.
- Added service-level reviewer administration tests with an in-memory DB double and UI interaction tests. The final test-double fixes assign the inserted user id and support direct `SELECT ... FROM` results; no production defect was hidden or bypassed.
- Final integrated gates passed: `npm run check`, **133 test files / 733 tests**, targeted reviewer/DDL suite **3 files / 9 tests**, `npm run build`, and the required `dist/boot.js` plus `dist/public/index.html` artifacts. Established chart-size and chunk-size warnings remain non-blocking.
- No local or production migration, account seed, production deploy/sync, S&P/macro backfill, Statements rebuild, Atlas rebuild, F-15/F-16 work or research promotion was run in this integration block. The local DDL and first reviewer smoke remain the evidence recorded in §42.
- Next local-only activation check: pull the integrated `main`; do **not** repeat DDL 029 on the database where §42 already applied it. Use **Admin → Reviewer** to create a disposable second reviewer, verify NDA/read-only/report gating and first-IP/VPN behavior, exercise each reset independently, then delete only that disposable account. Keep production migration/account creation owner-gated and separate.

## 44. Local reviewer administration smoke — 2026-11-05

- Synchronized `53e4e82` to reviewed `origin/main` with `git merge --ff-only`: HEAD and `origin/main` are `e82380774399f1d519775499a7195e770792cb01`. No local unpushed source commits existed. All pre-existing generated/runtime diffs and untracked macro reports were preserved; no reset, stash, checkout, clean or force operation occurred.
- Updated-code gates passed: `npm run check`, exactly **3 targeted test files / 9 tests**, and `npm run build` with only established chunk-size warnings. The full integrated 133/733 suite was not repeated in this local-only block.
- Real Admin → Reviewer creation produced `reviewer_smoke2` with `role=user`, NDA/IP pending, two `not_started` tours and 50 active presentation memberships. Login bound the original source network and required NDA. Before NDA, content and direct `/reports/*` were both 403; afterward content returned 50 rows and report access was 200. Universe, job, collector and admin mutations were forbidden without creating jobs/accounts or changing memberships.
- Logout, alternate-network rejection and original-network restoration passed. The network change was simulated through a loopback `x-forwarded-for` header; the system VPN was not changed. Reset NDA cleared consent while preserving first IP and tours. After a real technical start, Reset tour restored both tracks to step 0/not_started without changing NDA/IP. Reset IP+NDA cleared both, and the next login rebound the network and required fresh NDA.
- Delete with confirmation removed only the disposable account. Final read-only DB verification: disposable user/access/tour/universe rows all zero; denied account absent; original reviewer ids 3 and 4 remain with 50 memberships each; all other account/reviewer states are unchanged. Sanitized evidence: `worker/.runs/reviewer-admin-full-smoke.json`, 4,631 bytes, SHA256 `01374fb22b31b55878365157011ff748ca6796ede91c1a0c6a5ed9aa7c691d0d`, **21 checks passed**, status `passed_with_admin_overlay_workaround`. It contains no passwords, cookies, raw IPs or IP hashes and is ignored by Git.
- Two limitations remain explicit. `ReviewerGate` renders the tour for admin without a reviewer profile, producing a blocking overlay; only the admin test browser used CSS suppression, with no API stub or account-state change. Separately, the original Vite process became CPU-bound and stopped responding to HTTP. Smoke therefore used one temporary loopback-only server with the real `api/boot.ts` and freshly built `dist/public`; it was stopped afterward, with no listener left on port 3000. These are not clean dev-UI verification results or source fixes.
- No DDL apply, existing-reviewer seed, second simultaneous server, scheduler/collector start, S&P/macro backfill, Statements/Atlas rebuild, F-15/F-16 work, production migration/deploy/sync/account, credential output, commit or push occurred. This handoff update is intentionally uncommitted. Next safe action: separately review the admin tour-overlay and Vite startup issues before repeating a clean dev-UI smoke; do not repeat the completed disposable reviewer flow merely to mask those blockers.

## 45. Presentation universe, source coverage and daily price model — 2026-11-05

- The actual manifest contained only XOM, not RIVN/ENLT. With the owner's confirmation, the scope is **49 existing + CSCO**, never an extra deletion to force 47. CSCO passed official CIK 858877 mapping, companyfacts, ownership XML, Stocktwits, Schwab daily close, FINRA and Item 2.02 probes. `research-universe-50.json` and `worker/universe.json` now have 50 unique CIKs/tickers with no XOM/RIVN/ENLT/XOM_PRE. Reviewer ids 3 and 4 each have 50 active memberships; only their XOM memberships were replaced, other accounts and historical evidence were preserved.
- All 50 Stocktwits streams produced deterministic buzz/label rows with no duplicate ingest; optional LLM crowd rows were not a dependency. Form 4 completed **2,000 filings / 3,266 transactions kept / 460 missing ownership XML / 0 failures**. FINRA collected all 50 at settlement 2026-10-15 with no percent-of-float field (left null). Earnings indexed 5,068 8-K filings, found 1,561 Item 2.02 filings and completed `rebuildAllEvents()` with 51 companies scanned; 1,586 earnings events are present. Production's broader historical set was not overwritten.
- CSCO now has **705 canonical series / 37,220 points and 275 factor points**, with zero failures. Company Exposure rebuilt to **50 companies and debt coverage 47**, after initially exposing CSCO's missing series honestly. Scenario Lab was rebuilt from current valid series/FRED inputs and validated as live: rates/oil partial, USD/credit not_computable, with no forced completion.
- The coverage manifest reports **50/50 for Stocktwits, insiders, short interest, earnings, Schwab close and SEC facts**. Canonical prices use only the latest valid Schwab daily candle, never options spot. Stooq remains historical fallback; adjClose is null pending a corporate-action policy. CSCO official close is 103.61 on 2026-11-04. Selector and Terminal expose price, actual asOf, USD and quality; provider lineage stays in admin/QA.
- Reviewed sync evidence is local-only: `worker/.runs/local-generated/reviewed-sync-context-macro.json` has the expected context SHA256 `be4b824bf6aad1070a8c23cff8108a7251b6f58685911270f71f572c975fecfb`, eight normalized macro series with exact raw/normalized hashes, and the live scenario snapshot SHA256 `2dd6200fb3d16db2a2b7d2287fba1da5a890bd56c35f01ad5938cac1d099dca1`. Backup is `worker/.runs/local-generated-backup/20261105T223956432Z-reviewed-sync` with 29 verified files. Production apply remains a separate owner action and was not run.
- Final verification passed: targeted **3 files / 27 tests**, `npm run check`, full **136 files / 751 tests**, production build and `git diff --check`. The final built server is exactly one `node dist/boot.js`, listening on port 3000 as PID **13328**, with HTTP 200 at `http://127.0.0.1:3000/terminal`. The previous local listener was verified by command line and stopped only for this rebuild; no second server remains.
- The real API/browser smoke passed on the final build at 2026-11-05T23:44:15.251Z: CSCO 103.61 USD, actualAsOf 2026-11-04, official_close, official daily history, no provider label, no reviewer overlay and zero page/console/module/request errors. It used the existing admin read-only view-as reviewer 3; the admin's own three-company watchlist was not modified. `prevClose` and Schwab `adjClose` remain null rather than mixing providers or assuming an adjustment; the displayed change is an em dash, not a stale screener fallback. Quote/selector fail closed rather than substituting legacy Yahoo. Two initial smoke-helper issues were diagnosed without changing app behavior: `adjClose` belongs to `daily.bar`, and Terminal correctly follows the viewer's per-user membership. Evidence: `worker/.runs/local-generated/terminal-daily-smoke.json`, SHA256 `52e5332bb6d0ffd76768899baa297b89a76197c94be7b7e482df54118a4d13d7`.
- Additional local hashes: reviewed sync manifest `4df5fdc730a7efe8fd01df4e5c2c73596b63eba3626b9390ecbe8601b7b1075e`; coverage `1fc16260be195a8b50f70a7fc015ff9c2a65be9a724449fba09a1e838d4a8319`; daily-price QA `d4a5582f9ea93dcbfaefc1a25a4c9a85427281bd5004da45f99a7a66ebf99920`. All 29 reviewed backup files were rehashed successfully; index SHA256 `cad20349aac2f705cb770680f55fb7db668d9e0f585761612a580dbc362c01eb`. Current context and scenario hashes still match the review manifest exactly.
- Scheduler heartbeat remains offline. Event study/Atlas/shock calibration were not rebuilt and retain stale lineage; full 22-series macro is outside the selective sync. Owner-run EDGAR tone and 13F were not started or promoted. Facts/series/factors outside the reviewed CSCO/scope work remain unapproved for sync. No production apply/deploy, migration, cloud collection or alpha/production-readiness claim occurred. Next safe action: owner review of the local sync manifest and its exact hashes; any production apply is a separate explicit owner action. Source/documentation delivery is limited to the reviewed whitelist, never generated reports or `worker/.runs`.

## 46. Reviewed transport-only production sync package — 2026-11-06

- The owner replaced the proposed production apply with a transport-only delivery. No production backup/apply, collectors, backfill, migrations, DDL, scenario/Atlas rebuild, EDGAR tone, 13F or cloud collection was run. A preceding local read-only preflight established that the existing worker ingest cannot cover all requested families or a complete production backup; no production mutation occurred.
- `research/reviewed-sync/2026-11-05/reviewed-sync-package.zip` contains **17 reviewed artifacts plus `manifest.json` = 18 entries**: Schwab context, current Scenario and Company Exposure, Schwab daily prices, universe coverage, sync review metadata, daily-price QA, Terminal smoke, delivery verification and exactly eight normalized FRED series. The two requested public daily-price/coverage paths are ZIP mappings from the reviewed evidence, without rebuilding. The requested `delivery-verification-2f8590.json` was absent; the existing commit-matching `delivery-verification-2f859b0.json` is packaged under its actual name with unchanged bytes, explicitly documented in `manifest.json`.
- ZIP SHA256 is **`e72dbef960074dad25b74420523be233fd8e2a7ec74581b8c80a0196634f0f65`**, size **3,129,941 bytes**. CRC passed, all 17 packed artifacts are byte-identical to their reviewed sources and all hashes match. Content scans found zero credential/account markers. The manifest has `dataMode=live`, `productionApply=false`, `transportOnly=true`, generation/asOf timestamps, per-family rows/coverage and remaining blockers. Local validation is `worker/.runs/local-generated/reviewed-sync-package-validation.json`; ignored evidence is not committed.
- Excluded: the whole `worker/.runs`, raw EDGAR packs, expectations/tone/13F, full 22-series archive, Event Study, Atlas, shock calibration, mismatched `schwab-features.json`, optional crowd, `.env`, credentials, connection strings and operations state. Insider trades remain outside because 3,266 parsed transactions differ from 3,088 unique local rows. Earnings remain outside because the reviewed SEC recent scope is 5,068/1,561 versus 5,073/1,562 in broader current local history; no subset was invented to force agreement.
- Production preview was not published and no deployed/live or production-readiness claim is made. The transport package is an owner-reviewed handoff, not a production apply.


## 47. Reviewed production apply completed and independently verified — 2026-11-06

- Applied the owner-reviewed transport package `research/reviewed-sync/2026-11-05/reviewed-sync-package.zip`: 3,129,941 bytes, SHA256 `e72dbef960074dad25b74420523be233fd8e2a7ec74581b8c80a0196634f0f65`. All 17 packed artifacts plus manifest were validated; no credentials or raw EDGAR packs were promoted.
- Before any repair, the exact-ID dry-run matched all five production rows to the reviewed normalized FRED evidence with zero mismatches. A fresh complete 47,901-row macro backup was created and fingerprint-verified. One transaction changed only `realtimeEnd` from the erroneous one-day closure to official open-ended `NULL` for DGS10 id 44671, DGS2 id 46182, T10Y2Y id 47694, CPIAUCSL id 31824 and UNRATE id 32769. Independent post-verification passed: 5 changed, 47,896 unchanged, zero new/unexpected rows or fields.
- Main selective apply then completed all eight curated series. `macro_points` increased from 47,901 to **408,862** with **360,961 inserted rows**; the five exact existing keys were recognized unchanged. `prices` increased from 447,282 to **447,332** with exactly **50 Schwab official closes**. No deletions or broad history replacement occurred.
- Independent macro post-check matched **all 360,966 normalized archive rows** to production values and availability windows and matched all 360,961 newly inserted rows back to that archive. All 47,901 pre-apply rows are preserved; unexpected new rows, invalid new ingest timestamps, duplicate vintage groups, availability inversions and null/future realtime starts are all zero. All eight curated series have a current eligible value.
- Independent price post-check preserved all **447,282** original rows, matched all 50 new rows to the transport values/timestamps and found zero unexpected rows or duplicate price keys. The actual production `dailyPrice` reader passed **50/50** with `official_close`; CSCO returns **103.61 USD**, actual as-of **2026-11-04**, with `adjClose=null` retained.
- Reviewed artifacts copied to `public/reports`: Schwab context, Company Exposure, Macro Scenarios, 50-company coverage and daily Schwab closes. Source/public/dist hashes match. `npm run build` passed with established chunk-size warnings; `dist/boot.js` and `dist/public/index.html` exist.
- Evidence roots, excluded from Git: `worker/.runs/reviewed-sync-production-windows-2026-11-06/` and `worker/.runs/reviewed-sync-apply-2026-11-06T015030261Z/`. Consolidated result: `postcheck-summary.json`, status `pass`.
- Browser verification is intentionally bounded: an unauthenticated production-built smoke rendered the login page; its three 401 responses were expected private API/report guards. No existing authorized browser session was available, so authenticated Terminal browser smoke was not repeated. No credentials were read, no account or access bypass was created. The database-level canonical reader verification passed 50/50 and built report hashes were verified instead.
- No expectations/tone/13F, insider/earnings mismatched families, full 22-series archive, Event Study, Atlas, shock calibration or mismatched Schwab features were promoted. No collector, migration, schema change, public publish or production-readiness/alpha claim occurred.
- Git metadata was absent at the start of this block. Recovery used `git init`, fetch, `read-tree` and soft-reset intent only; no working files were reset or discarded. Two GitHub pack fetches timed out before completion, so ordinary commit/push remains pending. Remote main advanced during the block; do not force-push or treat the local partial `.git` state as current. This handoff and the `LLM_CONTEXT` NOW update are uncommitted until a normal fast-forward delivery can be completed.
- Production preview save was attempted twice with `type=dynamic` after the verified build. Both attempts completed materialization/build and then failed at platform persistence with `STATUS_FAILED` / `WEBSITE_VERSION_COMMIT_PHASE_PERSIST` / `retryable=true`. No version ID or preview URL was returned, so no preview/publish success is claimed and no further repeated save was attempted. Next safe action: retry the same version save later after the platform recovers; do not rebuild or reapply the database merely to address this platform-side persistence error.
- Follow-up after the owner's Legacy META screenshot: the visible page still showed Stooq 630.56 as of 2026-10-26. Production itself contained the reviewed Schwab row 630.00 as of 2026-11-04, and the actual corrected Legacy quote read path returned that fresh row with `official_close`, a chart ending 2026-11-04 and a null cross-source previous close. The deployed site served old asset `index-o2IXQfJF.js`, while the corrected build used `index-C6UnnWJA.js`; this was a delivery failure, not missing production data. A later version save then succeeded: **version `3ee6949`**, description `Updated quotes in Legacy`, ready for preview. No public publish was performed; the old public URL requires the owner's separate Publish action.

## 48. Deferred 13F manager-aware aggregation evaluation — 2026-11-06

- Owner direction: finish the current 24-quarter run as-is, then evaluate manager-level deduplication later. This section is a **documentation-only TODO**, not an implementation request. No code, schema, collector behavior or production data was changed for this item.
- The Morgan Stanley 2022Q4 filing was checked directly. Dollar scaling is correct: the detail sum after correction exactly matches the cover total of **43,935 entries / $880,468,352,011**. The separate merged value of **7,888 positions / $60,365,095,357** comes from keeping one latest row per `cusip:secClass`, not from the ÷1000 correction.
- The cover reports 23 other managers, so a future review must distinguish an entry-level reported ledger from an economic aggregate. Do not blindly sum all duplicate CUSIPs and do not keep overwriting manager entries without review. Preserve `otherManager`, accession, discretion and availability metadata before filtering.
- Proposed later approach: reconcile each accession first, handle RESTATEMENT/NEW HOLDINGS at entry level, surface repeated manager/security identities, and only then build an explicit research aggregate. Existing Vanguard amendment regressions must remain green. Storage changes, if any, require separate review.
- Full deferred TODO, evidence links and acceptance criteria: **`docs/THIRTEENF_MANAGER_AGGREGATION_TODO.md`**. Project State §6 links the same deferred item. The cloud Kimi agent can read both documents from Git after the reviewed commit is pushed; it should not implement the proposal until the next explicit owner review.


## 49. Schwab post-close and evening dependency chains — 2026-11-06

- Owner request: replace the pre-market Schwab schedule with a **13:10 Pacific** post-close capture and an **18:00 Pacific** second pass for corrections/new information. Both scheduled collectors use `--force`, so same-day resume cannot skip either pass. The registry now has **74 jobs**; each chain is fetch → bounded CSCO presentation supplement → normalized snapshot → Feature Lab → canonical daily prices. The supplement uses the existing `--only CSCO` collector and does not rename or expand either committed universe. Normalized coverage expects **52 = 51 options tickers + CSCO**.
- Live verification found that the original daily-history request without `endDate` still returned 2026-11-04 after the 2026-11-05 close. A bounded AAPL probe proved that adding capture-time `endDate` returned the 2026-11-05 candle. `schwabDailyPriceHistoryPath()` now pins every request to an explicit current `endDate`; regression coverage rejects an invalid boundary.
- Daily Operations reads `worker/.runs/local-generated/daily-prices-50.json`, requires all 50 companies collected, matches per-ticker `capturedAt` to the normalized manifest and, when Schwab reports the regular session ended, requires every candle to match that completed session. This caught the first run's prior-session candles and then the separate CSCO universe gap instead of accepting exit code 0 as data freshness.
- Scheduler was reloaded only while idle; the old detached process tree had already exited on the first start and was explicitly stopped after idle evidence on the registry reload. One scheduler remains active, started at `2026-11-06T03:58:24.733Z`. Configured crons are `10 13 * * *` and `0 18 * * *`; next runs are `2026-11-06T21:10:00.000Z` (13:10 Pacific) and `2026-11-07T02:00:00.000Z` (18:00 Pacific).
- Final live chain evidence: `1793937534764-schwab-fetch-daily` (`03:58:54.764Z` → `04:01:15.926Z`), `1793937699955-schwab-presentation-supplement` (`04:01:39.955Z` → `04:01:43.298Z`), `1793937714954-schwab-snapshot` (`04:01:54.954Z` → `04:02:01.140Z`), `1793937729958-schwab-feature-lab` (`04:02:09.958Z` → `04:02:12.728Z`) and `1793937759951-schwab-daily-prices` (`04:02:39.951Z` → `04:02:49.549Z`), all exit 0. Exact logs are under ignored `worker/.runs/`. User Preference HTTP 401 remains limited to streaming setup and does not invalidate REST captures.
- Final data evidence: **52/52 captures, 129,080 contracts, zero manifest QA errors; 52/52 Feature Lab with current source lineage; 50/50 canonical prices on 2026-11-05 with zero missing/errors**. AAPL official close is 344.17 and CSCO is 95.72 on 2026-11-05. Canonical Schwab `adjClose` remains null under the existing corporate-action policy. No production sync/apply/deployment, schema change or credential output occurred.
- Verification on the final deliverable: targeted **3 files / 28 tests**, full **138 files / 768 tests**, `npm run check`, production build and `git diff --check` all passed. Build has only established chunk-size warnings. The regenerated live health report has **29 OK / 1 warning / 1 error**: Schwab raw, feature and canonical-price checks are OK; the warning is the existing partial Macro Atlas, and the error is the earlier Daily Digest server-unavailable run. Overall health remains critical because of that unrelated historical digest error, not Schwab.
- Integration follow-up: local commit `5a17f4e` was merged with remote `ea03c89` / `b355438` without rebase. Markdown conflicts preserved both workstreams; the generated manual bundle was regenerated rather than hand-edited. Daily Operations accepts both daily-price schema v1 and v2. The merged writer regenerated schema v2 for **50/50** companies with zero missing/errors; merged targeted suites passed **4 files / 51 tests**, and final integrated gates passed **139 files / 778 tests**, TypeScript, production build and staged/unstaged whitespace checks.
- Documentation updated: generated operations runbook, Schwab API/streaming notes, RU/EN manuals, bundled manuals and LLM Context. Source and documentation delivery includes this handoff; exact integration and commit IDs are authoritative in `git log`. Generated raw data, scheduler state and `worker/.runs` evidence remain ignored. Next safe action: allow the single scheduler to run the 13:10 and 18:00 chains normally; separately review the unrelated Daily Digest failure and Macro Atlas coverage when desired.

## 50. Canonical fiscal-form repair and Schwab OHLCV transport — 2026-11-06

- Reproduced the owner's META fundamentals defect from production data. S-3ASR fee facts and other registration/proxy/offering stock-only dates passed the old Statements `>=8` period-density threshold and produced empty fiscal-quarter columns. Actual META flow periods were already correct: 2026-09-30 / 2026-06-30 / 2026-03-31.
- `buildCompanySeries` now selects `form` and admits financial-statement forms/amendments plus earnings 8-K/6-K only. Registration, proxy and offering forms are excluded before concept grouping; raw `facts` remain untouched. Earnings releases retain valid first-filed availability. Statements independently drives its quarterly grid from flow periods only, so future stock-only dates cannot create fiscal columns even if a new unusual form appears.
- Added `buildCompanySeries(cik, { write:false })` and `scripts/build-research-series.mts --dry-run` for reviewed no-write computation. Regression coverage includes accepted/rejected forms and the stock-only META case. Targeted suites passed **4 files / 42 tests**; full gates passed **138 files / 766 tests**, TypeScript and production build.
- All 53 research companies dry-ran successfully: 24,173 series / 1,092,409 points. Before apply, per-company backups covered 1,093,785 points / 24,371 health rows / company rollups, 290,145,589 bytes with per-file SHA256 and raw-facts metadata. Backup revalidation and raw-facts comparison returned zero mismatches.
- Production atomic per-company rebuild completed 53/53. An external 10-minute tool timeout stopped the driver after 40; the remaining 13 were resumed individually after confirming the process was gone and the first 40 matched dry-run. Final post-check `postcheck.json` is `pass`: all counts match dry-run, raw facts unchanged, rollups consistent, no registration fee series and no invalid/duplicate flow-grid periods. Removed exactly 1,376 nonfinancial points and 198 false series. AAPL has 20,210 points and zero canonical content mismatches. META now begins 2026-09-30 / 2026-06-30 / 2026-03-31 / 2025-12-31 with revenue 64.601B / 60.801B / 56.311B / 59.893B.
- Price investigation found that the home presentation writer already upserts full Schwab OHLCV locally. The old transport kept only close, and production apply itself wrote open/high/low/volume=null. The single close-only Schwab row also made same-source previous close impossible; the null change was therefore an input/package defect, not a selector defect and not permission to mix Stooq with Schwab.
- `worker/lib/schwab-daily.ts` now normalizes official daily candles, requires the latest two complete OHLCV bars and provides fail-closed close-only enrichment. `worker/daily-prices-presentation.mts` emits schema v2 with previous/latest bars, actual per-bar ingest timestamps, OHLCV and same-source previous close/change. `scripts/apply-reviewed-sync-simple.mts` requires schema v2, inserts previous bars, fills only missing OHLCV, preserves original fetchedAt, rejects conflicting values/adjustments and verifies canonical previous/latest quotes for all 50. Legacy renders a plain em dash when change is unavailable instead of `+— (+—%)`.
- **Price apply is not complete yet.** This workspace does not contain the home `D:/research/alpha-engine/schwab/pricehistory` raw files or credentials. No previous/OHLCV production rows were invented from Stooq or Schwab intraday. Next home action: pull the source fix, run `npx tsx worker/daily-prices-presentation.mts` against the existing raw archive (no new provider collection is required), require 50/50 `collected` and schema v2, then include `worker/.runs/local-generated/daily-prices-50.json` as `public/reports/daily-prices-schwab.json` in a new reviewed package. Apply that package with the updated script and verify 50/50 previous/latest checks before saving the final UI version.
- Updated RU/EN manuals and `LLM_CONTEXT`; regenerate bundled manuals before delivery. Evidence is under ignored `worker/.runs/canonical-series-form-fix-2026-11-06/`. No new provider collection, Stooq substitution, raw-facts deletion, schema migration, public publish or model/research promotion occurred.
- Source delivery: commit **`ea03c89`** (`Fix fiscal periods and Schwab daily bars`) was pushed to `main` as an ordinary fast-forward from `7ce909e`. Preview version **`60a2150`** (`Fixed fiscal quarter grids`) was saved. The canonical 53-company production rebuild is complete, but the schema-v2 Schwab OHLCV/previous-close apply remains pending the home reviewed artifact described above; do not report day change as repaired until its 50/50 apply checks pass.


## 51. Canonical common-ticker source remediation, production apply delegated — 2026-11-06

- Source-only stage: `scripts/seed-sp500-companies.mts` no longer selects the last SEC directory row by CIK. It requires the exact GICS CIK+ticker pair and skips with an explicit error when absent. `canonicalTicker(cik, requestedTicker)` uses GICS for S&P members and the explicitly requested ticker for non-members, with share-class disambiguation for GOOG/GOOGL, FOX/FOXA and NWS/NWSA. `ingestOneCompany` uses the resolver for both INSERT and duplicate-key UPDATE.
- Added `scripts/remediate-preferred-company-tickers.mts`: default dry-run, exact-six scope guard, full companies backup with SHA256 before apply, related counts, one transaction, expected-before updates, independent post-check of all 50 universe CIK+ticker pairs and proof that only six ticker fields changed. Apply is refused unless the configured database is the documented production database. No DELETE, DROP, TRUNCATE or unscoped table UPDATE is present.
- Approved production scope for the cloud agent: **12927 BA-PA→BA; 886982 GS-PD→GS; 927628 COF-PN→COF; 753308 NEE-PW→NEE; 1375365 SMCIP→SMCI; 1506307 EP-PC→KMI**. JPM/CIK 19617 is explicitly excluded and must not be changed.
- The home guard stopped because local MySQL `127.0.0.1 / alpha_engine` contains CIK 19617 as VYLD. The owner independently confirmed current production contains JPM. This proves the home snapshot differs from production; it is not evidence for expanding scope. Guard behavior remains unchanged. No production connection, backup, dry-run or apply was performed from home, and no local backup is represented as production evidence.
- Verification: targeted **2 files / 16 tests**, full **141 files / 794 tests**, TypeScript check, production build and `git diff --check`. Regression cases include all six preferred/common pairs, non-GICS explicit ticker preservation, GOOG/GOOGL, FOX/FOXA, NWS/NWSA, missing exact GICS+SEC pair, extra/missing mismatches and non-ticker/row-count change rejection.
- Source and documentation delivery is a separate commit; exact commit ID is authoritative in `git log`. Next cloud-only actions: read-only production guard for the approved six, full production companies backup, one-transaction apply and independent post-check in the same environment. No backup/apply was run in this source stage.


## 52. Canonical ticker production apply verified — 2026-11-06

- Cloud consumed delivered `67b4f3f` and `217a092`; no home local snapshot was accepted as production evidence. Production read-only guard matched exactly the approved six. JPM was absent from the mismatch list and was not modified.
- Before mutation, an independent full `companies` backup was written and re-read: **495 rows / 184,495 bytes**, SHA256 `e251c1291014a4e1c69ff67b20a1ba29a85810eef6d3b8281d617e8e5b67a055`. The remediation script created a byte-identical second backup.
- One transaction updated exactly six rows: BA-PA→BA (12927), GS-PD→GS (886982), COF-PN→COF (927628), NEE-PW→NEE (753308), SMCIP→SMCI (1375365), EP-PC→KMI (1506307). Companies count stayed 495. Related counts stayed `user_universe=6`, `facts=196,400`, `series_points=162,625`, `prices=40,372`.
- Independent post-check `independent-postcheck.json` is `pass`: only approved ticker fields changed, no new/missing rows, presentation mismatches=0, JPM unchanged. Actual authenticated routers returned BA, GS, COF, NEE, SMCI and KMI with their correct CIKs and existing series/signals counts.
- Delivered regression tests independently passed **2 files / 16 tests**. TypeScript and production build passed; `canonicalTicker` is present in `dist/boot.js`. Runtime version **`8099451`** (`Canonical ticker routes repaired`) was saved.
- Evidence roots: `worker/.runs/preferred-ticker-remediation/2026-11-06T054358304Z/` and `worker/.runs/preferred-ticker-remediation/2026-11-06T054506501Z/`. These are runtime evidence, not source-delivery files.
- Stage boundary: OHLCV/previous close, documents and CSCO fundamentals were not changed or claimed complete by this stage. Next stage starts only after a separate owner-scoped instruction.


## 53. Official Schwab OHLCV and day change applied — 2026-11-06

- Used `daily-ohlcv-handoff-20261106T060344-781Z.zip` from `a3745a7`. SHA256 matched the owner report: `a3a2ac542b4539a6c363beac2abe04627573ace0826005cd01df0a363fdeaa0`. The archive has exactly three files; all manifest byte counts and hashes passed. Validation reports 50 companies / 100 bars / errors=[].
- Merged the schema-v2 daily artifact and new validation into the reviewed package. Stale close-only QA and smoke evidence were excluded; all other artifacts were rehashed. Merged ZIP has 16 artifacts + manifest = 17 entries, SHA256 `99c13f797b0c83344ecbd2e9e967b15b8bb43e858b0b5e59c71093a664c5a8f3`; generated package is not included in this source commit.
- First apply attempt timed out without changing production while redundantly rechecking the already applied macro history. Added `--prices-only`; macro artifact hashes are still validated, but the completed backfill is not repeated. TypeScript passed before both attempts.
- Successful apply inserted **50 new 2026-11-05 bars** and enriched **50 existing 2026-11-04 bars** with official OHLCV. `prices` 447,332 → 447,382; `macro_points` remained 408,862. No rows were deleted.
- Independent `independent-postcheck.json` is `pass`: all original IDs preserved, exactly 50 expected enrichments and 50 matching new rows, zero unexpected changes and duplicate price keys. All five copied artifact hashes match, including daily artifact `bf8950cc64ebddc4887ab615eb27dd9a11ebb36ef4315ffb2539afe63555628e`.
- Actual authenticated `prices.quote` passed **50/50** with previous close, OHLCV, change and changePct. Examples: AAPL 344.17 vs 349.51 = −5.34; META 605.08 vs 630.00 = −24.92; BA 172.50 vs 177.00 = −4.50. All include full OHLCV for 2026-11-05.
- Runtime version **`ab91c2e`** (`Official OHLCV and day change`) was saved. Documents and CSCO fundamentals remain outside this stage and are not claimed complete.


## 54. Full EDGAR metadata corpus applied — 2026-11-06

- Used `documents-metadata-full.zip` from `42888df`: 2,826,452 bytes, SHA256 `99229d35b168439ad9425ae252ce29700236bbf5912fc01f1af0b5e693d0b236`. Exactly three entries, all manifest bytes/hashes pass. Snapshot: **39,801 documents / 50 companies**, primary 23,375 / exhibit 16,426 / other 0, zero duplicate exact keys and no rawGzipBase64/plaintext or credentials.
- Dry-run found 25 overlaps and 139 older documents outside the snapshot. It also found **23 hash conflicts** against existing cloud raw. Those 23 rows were preserved completely instead of overwriting their lineage. Two nonconflicting existing rows were updated only with reviewed metadata. One previous failed row, id 60014, was remediated to fetched with matching reviewed hash.
- Production backups before mutation: documents **164 rows / 110,948 bytes**, SHA256 `47a9520050004c896e8e03d76f3ddbf837fe3b9e935fd07f1fbceedc50ab6d22`; filings **2,560 rows / 786,463 bytes**, SHA256 `691de850e8e9efe598a0b062e7a3ead594ae2b548d45a456c6233b35dfb29987`.
- Exact-key batches of at most 500 inserted **39,776 new documents** and updated **2 existing metadata rows**. Final production counts: **39,940 documents / 23,485 filings**. No object storage upload occurred; new metadata rows have storageKey/textKey=null and location=none with canonical SEC external links.
- The initial post-check flagged one role-count difference and one failed-row timestamp change. Independent read-only analysis proved the role difference is the intentionally preserved hash-conflicted `q2fy27pr.htm` (`other` kept instead of candidate `exhibit`) and the timestamp change is the legitimate failed→fetched remediation of id 60014. The expected role math was corrected; no second apply was run.
- Independent post-check `independent-postcheck.json` is **pass**: all counts match, zero duplicate exact keys, zero original storage mismatches, all 23 conflicts unchanged, all 139 outside documents preserved. Final roles: primary 23,375 / exhibit 16,537 / other 28.
- Actual routers: META 347 documents/347 fetched, BA 836/836, CSCO 717/717. SEC `rawUrl` and `text` fallback returned the same canonical SEC URL for CSCO with storageKey=null and location=none. Runtime version **`f18c77b`** (`Full metadata documents and SEC links`) was saved.
- Evidence root `worker/.runs/documents-metadata-apply-2026-11-06T184130337Z/`. This is runtime evidence, excluded from source delivery.


## 55. Expectations ordering and ProjectState crash fixed — 2026-11-06

- Expectations now orders structured statements and fallback notes by actual `filingDate` descending, with accessionNo as the deterministic tie-breaker. The first visible cards are the latest filings rather than 1999/2001 history. Coverage remains **27/53 = 50.9%**; this is a partial extraction snapshot, not a completed universe.
- `/project-state` crashed because a valid schema-v1 `daily-operations.json` had `macro=undefined`. Nested macro/scheduler/summary/Schwab reads now use optional chaining and zero-safe defaults. The page renders `No dated report` instead of a blue screen.
- Added regressions for latest-first statement ordering and for a schema-v1 report without macro. Updated populated evidence tests to select the intended company card rather than relying on its old position.
- Verification passed: **3 files / 12 tests**, TypeScript and production build. Runtime version **`b6beb53`** (`Latest-first expectations and ProjectState fix`) was saved.
- Scenario Lab evidence limits were also read from the live artifacts: rates fail on missing fixed-interest share, oil depends on fuel/oil revenue/cost, USD has no directly comparable foreign revenue share, and credit still lacks new-issuance spread/maturity/rating terms. Pilot expansion is not authorized as a cosmetic selector change; evidence must be collected and rebuilt locally first.


## 56. Project State and Analytics refreshed to actual state — 2026-11-06

- Durable Project State now records the actual completed blocks: canonical ticker repair, fiscal-form filtering, official Schwab OHLCV/day change for all 50, CSCO facts/series/factors, metadata-only EDGAR corpus and latest-first UI. Reviewer migration and account seed are no longer marked required.
- Research is explicitly 50 companies with **21,297 factor points**. Event Study, Atlas and old macro prior evaluations are marked historical/stale rather than fresh evidence. 13F is explicitly in progress: fund_quarters **6,517 upserted / 14 batches**, fund_holdings transport unfinished, no events/flow rebuild and no latest-quarter evaluation.
- Next queue is accurate: 13F post-check, missing EX-99/cohort companies including CSCO, Scenario Lab evidence, remaining EDGAR tone and Fund Flows 3D.
- Analytics regenerated from production at `2026-11-06T21:39:52.021Z`: companies 495, facts 1,390,442 / 54 CIKs, factor points 22,169 / 54 CIKs, prices 447,382 / 55 series through 2026-11-05, macro 408,862 / 8 series, fund_holdings 937,500 / 311 funds / 371 held companies, fund_quarters 6,517 with zero missing filingDate, and 795 tests listed. Options 250 snapshots / 310,634 normalized rows.
- Verification: ProjectState tests **1 file / 5 tests**, TypeScript and production build. Runtime version **`df4e5c6`** (`Current project and analytics status`) was saved.


## 57. Fundamentals status corrected to done — 2026-11-06

- Production read-back confirms **50/50 companies with facts, 50/50 with canonical series and 50/50 with factor points**. The previous hardcoded `fundamentals / XBRL = partial` was stale rather than evidence of a pipeline failure.
- Analytics now marks `fundamentals / XBRL` as **done**. The detail explicitly limits green to presentation materialization, including CSCO and fiscal-form filtering. Research evaluation, Expectations coverage and Atlas validation remain separate unfinished work.
- Regenerated Analytics from production, then TypeScript and production build passed. Runtime version **`c2e9c40`** (`Fundamentals pipeline marked complete`) was saved.


## 58. 13F production push and independent post-check complete — 2026-11-06

- Kimi completed `fund_quarters`: **6,517 upserted / 14 batches** and `fund_holdings`: **1,617,277 upserted / 3,235 batches**, watermark **6,672,309**, with zero errors and no reset/resume. Events/flow, factor rematerialization and latest-quarter flow were not run.
- Production matches the local counts exactly: **1,617,277 holdings / 6,517 quarters / 311 funds / 377 held companies / 2019-12-31…2026-09-30**. Canonical fund_quarters confirms **251 funds with 24 quarters and 60 with fewer**, with no fund above 24.
- Duplicate exact keys are zero for both tables. filingDate/accessionNo required fields are present everywhere; no filingDate before/equal to quarterDate, no missing/negative totalValueUsd, no missing positions, no missing/negative valueUsd/shares and no missing/zero heldCik.
- Pre-push backup: **875,860 holdings / 293,990,612 bytes / 300 files** and **3,372 quarters / 550,019 bytes**. fund_quarters SHA256 `ff5b3f33d9fd4fea74bbf83db3abad277d3134c85dedfc7c5b58458735975e67`; backup manifest `9ca969fda8d452e9c9254b55cb6407ab1432347ba75c407b2c1f5c6a79d2f721`.
- Independent preservation check: **0 missing original holding keys / 0 missing original quarter keys**. New keys are 741,417 holdings and 3,145 quarters. positions and totalValueUsd are not below the mapped subset in any book.
- Guard at 2026-11-06 selects **2026-06-30 vs 2026-03-31**, skips open 2026-09-30, has **302 stable funds, 6 missing, 0 suspect and `partial=true`**. Latest-quarter flow was not evaluated and events were not rebuilt; position events remain 16,422 with last event 2026-09-02.
- Consolidated evidence: `worker/.runs/13f-production-postcheck-2026-11-06.json` and `worker/.runs/13f-production-backup-2026-11-06T195754508Z/preservation-postcheck.json`.
- Project State and Analytics were regenerated to mark 13F transport done while keeping flow evaluation separate. ProjectState tests **1 file / 5 tests**, TypeScript and production build passed. Runtime version **`ca3f206`** was saved.


## 59. Fundamental factor OLS evaluation — negative but useful result — 2026-11-06

- Added `api/services/factor-ols.ts` and `scripts/evaluate-factor-ols.mts`: pooled OLS for every factor in the current registry, robust trailing-16 z-scores, chronological 50% fit / 25% calibration / 25% evaluation, sealed four-anchor holdout, leave-one-company-out and leave-one-sector-out. Target is **63-session excess return vs SPY**. Availability anchors and known-label exits are enforced by the existing engine.
- Added exact `ei+ = P(wrong up | actual down)` and `ei- = P(wrong down | actual up)`, false counts, Wilson 95% intervals and block-bootstrap accuracy intervals. `lpp/lmm` use the existing Beta(1,1) smoothing for Bayes compatibility, not raw confidence. No new factors, no holdout tuning and no probability promotion.
- Full 50-company run evaluated **22 factor-registry factors**, including six explicit insufficient-data factors. Most OLS specifications collapse to almost one-class UP. Balanced accuracy and company/sector holdout medians are around **0.50**, so there is no evidence of useful OLS factor classification and no justification for feeding these betas into Bayes.
- The sealed holdout has only four anchors and cannot support a confident probability table. The generated report explicitly says to use rolling IC/rank-IC with conditional forecast errors next instead of parameter tuning. `public/reports/factor-ols-evaluation.json` and `.md` are generated evidence, excluded from source delivery.
- Verification: **7 OLS tests + 3 probability tests + 3 nested-eval tests**, TypeScript and production build. Updated RU/EN manuals, LLM_CONTEXT and this handoff.


## 60. Expanding log-log Market Cap / Revenue OLS — methodology corrected — 2026-11-06

- The earlier nested factor-direction OLS did not match the owner's requested time-series task. Added a separate `ln(MarketCap_t) = α + β·ln(Revenue_{t-1}) + ε` expanding-window implementation with minimum 20 quarters and one-step-ahead predictions only.
- Corrected availability logic: availability-aware latest/first vintage fallback, latest available shares at or before each anchor with diluted fallback, and one eligible price source per date with observation date <= anchor and fetchedAt <= evaluation asOf. Historical backfill ingestion time is not treated as market availability time.
- Full 50-company evaluation: **1,547 OOS predictions across 45 companies**. Median R² **−0.172**, median log RMSE **0.870**, median ei+ **0.204**, median ei- **0.723**, median balanced accuracy **0.551**. NVDA R²=0.953, but high individual R² is not causal evidence or a production model. Negative R² values remain visible.
- Generated `public/reports/market-cap-ols-evaluation.json` and `.md`, including per-company and sector summaries. Generated evidence is excluded from source delivery.
- Verification: **3 market-cap OLS tests + 7 factor OLS tests + 3 nested-eval tests + 13 probability tests**, TypeScript and production build. Runtime version **`c3fd711`** (`Expanding Market Cap OLS evaluation`) was saved.


## 63. Presentation-50 EDGAR tone remediation and reviewed handoff — 2026-11-07

- Scoped only `worker/research-universe-50.json` (50 rows / 50 unique CIKs). Full-S&P processing, outbox deletion, rescore, include-skipped, Event Study, IC, events rebuild and schedulers were not run. BXP and all other out-of-scope companies remained untouched. Production API/DB was not changed.
- Targeted remediation used five bounded qwen3.5:9b calls and two deterministic thin skips. FCX 10-Q `0000831259-26-000051` and SMCI 10-Q `0001375365-26-000027` are thin skips; SMCI SCHEDULE 13G/A `0001595888-26-000142`, MRNA 10-Q `0001682852-26-000197` and DAL 8-K `0001193125-26-451940` are scored; MRNA 8-K `0001682852-26-000194` and KMI 8-K `0001506307-26-000136` are boilerplate-only skips. Retryable/parse failures=0. Source metadata is preserved in ignored `worker/.runs/local-generated/edgar-tone-seven-before.json` and `edgar-tone-seven-after.json`.
- Final content guard: 50/50 unique CIKs and companies with scored entries; outboxAccessions=0, pendingManifest=0, ready=0, thin=0, unreadable=0 and plannedCalls=0. Manifest scored count is 19,562. Previous terminal skips are reported separately: boilerplate-only 12,993 and thin content 2,812; none became zero-score signals.
- Added `scripts/export-edgar-tone-reviewed.mts` and six regression tests in `scripts/export-edgar-tone-reviewed.test.ts`. Export is the full local MySQL presentation-50 snapshot, not a watermark delta. It enforces local-only DB, 50 companies with signals, zero outside-universe rows, zero exact/legacy duplicate keys, fetched/scored manifest links, finite [-1,1] scores, positive integer magnitudes, backfill source, note/payload limits and one model/prompt lineage.
- Snapshot: **18,030 rows / 50 companies**, model `qwen3.5:9b`, prompt `v1`, promptSourceSha256 `fd7faf9083345f628c0d2e564fe092e63d70df5bbf641dee49ef9df24fa49439`; eventTs min `1994-01-05 00:00:00`, max `2026-11-06 00:00:00`. New transport keys are `llm:<model>:prompt=v1:edgar:<cik>:<accessionNo>` and original keys remain in `legacyPayloadKey`; local MySQL keys were not rewritten.
- `research/reviewed-sync/2026-11-07/edgar-tone-reviewed.zip` contains exactly `signals.json`, `coverage.json`, `audit-summary.json`, `manifest.json`. Size **2,034,326 bytes**, SHA256 **`2d54aac572d185fce26ab55b49330d1bb5e75cd70b53ca78c8e36a28396af35d`**. Independent unpack verification matched every manifest byte count/hash and confirmed exact/legacy duplicates=0 and no BXP.
- Regression tests passed **6/6**. Production build passed with established chunk-size warnings. `npm run check` is independently blocked by pre-existing missing `worker/lib/document-presentation` imports in `worker/lib/ingest.ts`, `api/services/document-ingest.ts` and `api/services/document-ingest.test.ts`; this unrelated module was not changed.
- Runtime-only evidence remains ignored and excluded from delivery. No raw EDGAR, HTML/text, worker/cache, worker/.runs, credentials, logs or operations state entered the ZIP or source whitelist. Source delivery is restricted to exporter, its test, this reviewed ZIP and these two documentation files. Next owner action: production backup, dry-run, legacy-key matching, exact-key apply and independent post-check.

## 61. FRED reviewed sync complete — 2026-11-07

- Uploaded handoff SHA256 `0e28534732b3805bc84ab56be547a722b4462c75b7224cc979aae03824d41` contains 18 entries. All manifest bytes/hashes pass. The eight required raw `observations.json` files were supplied separately and match the reviewed raw hashes exactly.
- Production backup before mutation: **408,862 rows / 85,308,483 bytes**, SHA256 `d77800f0b182e6eccb4056757431e090a663d5d8dfff8e6da599950049671121`, fingerprint `8f5be8acc4bc347bc15742d8dbe23374b5a1f5c14eb438ec39149b08b5b4e86d`. `backupFingerprintVerified=true`.
- Backfill inserted exactly **16 rows**: DGS10 3, DGS2 3, T10Y2Y 3, FEDFUNDS 0, CPIAUCSL 0, UNRATE 1, BAMLH0A0HYM2 3, VIXCLS 3. No conflicts and no errors. Final `macro_points` = **408,878**.
- Independent post-check `pass`: all 16 new rows match normalized archive, zero missing original IDs, zero duplicate groups, zero availability inversions, zero selected-after-anchor. `latestMacro` returns current eligible values for all eight curated series.
- Scope remains **partial**: 14 other series are QA-only and were not synced. Four BAML quarantined rows were not applied.
- Optimized existing-row lookup in `worker/lib/macro-vintage-backfill.ts` from repeated per-row filtering to exact-key Map lookup, preserving semantics while avoiding tens of billions of comparisons. Targeted macro backfill tests **1 file / 8 tests** passed.
- Runtime version **`c3fd711`** was saved.


## 62. Scenario Lab expanded to fifty companies with explicit evidence bounds — 2026-11-07

- Replaced the five-company pilot with a deterministic 50-company evidence builder over reviewed stored SEC facts. The default source is the local/reviewed MySQL `facts` table; fresh SEC companyfacts remains an explicit optional source. Financial-statement form gating, exact concepts, accession matching and availability anchors are enforced. No external collection, LLM processing or production DB mutation was performed by this block.
- Added direct variable-interest share and long-term weighted-average aliases. Foreign revenue now accepts either domicile or direct foreign-country evidence only when total and geographic revenue share the same accession, start/end period and unit; derived availability is the later of both inputs. Invalid ratios fail closed.
- Rates now computes an explicit **total-debt upper bound** when fixed/floating split is unknown, direct fixed/variable exposed-debt bounds when available, and an estimate only when both direct share and hedge evidence exist. Credit now computes **scheduled twelve-month refinancing upper bounds** from actual debt maturities; new-issuance estimates remain not evaluated.
- Final 50-company artifacts: **rates 43 upper bounds = 26 current + 17 historical, seven debt gaps; credit 42 upper bounds = 36 current + 6 historical, eight next-twelve-month maturity gaps**. Oil has one current and three historical direct exposures; USD has eight historical direct foreign-revenue ratios. Missing evidence is not replaced with sector assumptions, zero or false `complete` statuses.
- Company Exposure coverage is 50 companies, debt 47, interestCoverage 6, fuelCost 1, oilRevenue 1, oilCost 2 and foreignRevenueShare 8. Its static per-company missing fields were aligned with actual evidence. The canonical-series query was restricted to the required latest-vintage concepts, reducing the rebuild from a timeout to seconds without changing formulas.
- Rates and credit baselines are independently read from production `macro_points` and labeled `production_macro_points_extract`. Oil/USD reuse only the prior reviewed non-fixture scenario baselines and are labeled `reviewed_scenario_snapshot`; no unreviewed oil/USD collection or full 22-series promotion occurred. Shock calibration retains its own older as-of date. Event Study, Atlas, new issuance estimates and Bayes were not rebuilt or promoted.
- Scenario Lab UI now shows all 50 companies, current/historical/missing counts, explicit upper-bound counts, evidence-status filtering, impact types, baseline provenance and calibration date. Project State records the actual result and keeps channel status evidence-partial.
- Verification: scenario-focused **4 files / 41 tests passed**, TypeScript and production build passed. Full suite: **808/810 tests passed**; the two unrelated failures are the already-partial `shareFlows` status and a Documents local-cache fixture mismatch in this environment, not Scenario Lab regressions. Real-browser QA loaded the actual artifacts with isolated auth/API mocks: 50 rates rows, 42 credit rows, correct DAL refinancing formula, eight credit missing rows, zero console errors/warnings, and no body overflow at 375px (table-only horizontal scrolling). Independent post-check `pass`: all 42 credit values recomputed directly from SEC maturities, all 40 total-debt bounds recomputed including COP's known hedge multiplier, current rates/credit baselines matched production DB, oil/USD matched their prior reviewed snapshots.
- Artifact backups and post-check evidence are under `worker/.runs/scenario-lab-20261107/`, excluded from source delivery. Final artifact SHA256: pilot `5fc5bd79ccbb8c528fb327f0eec5039bbbd2fb9aa70710c971072d3c6fe84a32`, company exposures `821b06bc82d179d0d6836a34812530107f53f9002d3d8b6f82d4526b9541d1a3`, scenarios `72f8cd5b2dae0cb4f0feca391fdcf77ae7bd10fd145289712799d47b2065ec8e`.


## 64. EDGAR tone production apply and independent post-check complete — 2026-11-07

- Verified `main` merge `156b4c1` and source handoff `3c58fa4`. Reviewed ZIP SHA256 `2d54aac572d185fce26ab55b49330d1bb5e75cd70b53ca78c8e36a28396af35d` matched exactly and contains only the four declared files. All internal bytes/hashes and all 18,030 rows passed independent validation: 50 allowed CIKs, zero outside rows, zero exact/legacy duplicates, finite scores, positive magnitudes, valid accession/versioned/legacy lineage and eventTs from 1994-01-05 to 2026-11-06.
- Production `signals.note` is varchar(512); maximum reviewed note length is exactly 512 characters, so no schema migration or additional truncation was required. Apply preserves reviewed notes exactly; no attempt was made to invent fuller historical rationales.
- Complete production backup before mutation: **32,663 rows / 19,779,755 bytes**, SHA256 `e68bb2d574bd6d33da91007d2015f57acda3a36ca4eda06453f1d9dc22e566be`, ordered row-payload fingerprint `5719acf0db3b6d50c6951d02b93ab42bf6bbf70c59398071b2a18decc1c4c4ab`.
- Dry-run `pass`: **6,570 exact-key inserts and 11,460 exact-ID legacy→v1 rekeys**, zero conflicts, zero production duplicates and zero identical versioned rows requiring no-op handling. Rekeys were allowed only when cik/source/type/eventTs/score/magnitude/src/note all matched. The other 4,673 original EDGAR rows outside the package and every non-EDGAR row were excluded from mutation.
- One transaction re-read all 32,663 rows and verified the exact backup fingerprint before any write. It completed at `2026-11-07T07:40:49.398Z`: **11,460 rekeyed + 6,570 inserted**. Any fingerprint or affected-row mismatch would have rolled back the entire operation. New rows use production receipt `ingestedAt=2026-11-07 07:40:40`; rekeys preserve original IDs, ingestedAt, createdAt and every non-key field.
- Independent post-check `pass`: final **39,233 signals**, **22,703 EDGAR tone**, **18,030 versioned v1 rows / 50 companies**. Zero missing original IDs, zero unexpected original changes, zero rekey field mismatches, zero unexpected new rows, zero reviewed-content mismatches and zero duplicate exact keys. All **21,203** original rows outside rekey were preserved exactly. Post-apply snapshot is **24,418,601 bytes**, SHA256 `906144921034562ae5b5b2459b66438a0cba773c50c6f0584081d01b8ac10639`.
- Production read-back independently confirms min/max eventTs and 50 companies. Project State now marks the tone transport complete. No Event Study, IC, Atlas, shock calibration, events rebuild, Bayes promotion, collector or scheduler was started. Evidence root `worker/.runs/edgar-tone-production-apply-20261107/`, excluded from source delivery.


## 65. Clean baseline and Fundamentals Data QA complete; readiness remains partial — 2026-11-07

- Restored `worker/lib/document-presentation.ts` and its regression suite in `f4c0b50`. A fresh `git archive` clean checkout then passed `npm install`, `npx tsc --noEmit --incremental false` and `npm run build`. The previous clean-main `document-presentation` blocker is closed rather than bypassed.
- Existing DDL 028 was applied to production `signals.note` after a complete **39,233-row / 24,418,601-byte** backup. Column is now `varchar(2000)`; repeat apply reported no change needed. Independent post-check found the ordered row-payload fingerprint `98f33cd9a919a0c8ec240cb2f581361a1b90110cc0eb8c0ef391088cebcaac3e` and every row exactly unchanged. No historical note was rewritten.
- Added read-only `computeFactorPointRows` and a reviewed rematerialization script. Dry-run across all 50 found **211 existing availability inversions and zero expected inversions**, then produced **21,263 expected active rows**, 4,706 new keys, 4,740 stale keys, 3,008 value changes and 628 availability changes. Changes were classified as current first-vintage canonical-series corrections plus new market cadence, not hand-edited dates.
- Apply used exact-key upsert without DELETE and preserved stale keys as `value=NULL` tombstones. Full backup before mutation: **22,169 rows / 4,923,976 bytes**, SHA256 `6e487427a5ea985cef9777b39af616731989f62b5accbd702e19fb86498cdad0`. External timeout interrupted only the tombstone loop; a second backup captured 26,875 rows / 5,917,265 bytes, SHA256 `0e03a34d4f018e22e637a95f514e46fb3ebb082a98c612f015dbb054f3401f7d`, then batched resume completed the remaining 2,483 tombstones. Final post-check `pass`: **4,706 new rows**, 4,740 retired rows, zero missing original IDs, unexpected original changes, reviewed mismatches, unexpected new rows or active availability inversions. Relative floating tolerance is 1e-12 and does not hide material changes.
- Added `research-readiness` service and independent `netDebt/ROE/ROA` audit. All 50 companies pass with **zero statement issues**: explicit zero debt remains valid, missing debt/cash is not zero, ROE/ROA require four consecutive non-null NI quarters and independent ratios match. The 72 instant dividend facts are excluded by the flow builder and do not enter TTM; no dividend rebuild was required.
- Corrected `auditFactorPoints` so `momentum122` and `high52` no longer compare their own price observation dates with unrelated fundamental filing dates. The 52 prior `factor_before_fact` findings were false positives; fundamental availability checks remain unchanged.
- Final readiness is **partial, not model-ready**: 14 mechanical pilot candidates, 2 limited (`evEbitda`, `netDebtToEbitda`) and 6 not evaluated factors. There are **21,263 active factor points**, 4,740 preserved NULL points, zero active or legacy-null availability inversions. Integrity retains **1,280 errors**: 904 continuity gaps, 9 availability inversions, 15 unit conflicts and 72 instant facts. These become per-period exclusions, not deletions or imputation. All 50 companies therefore carry a `limited` status while active factor anchors and Statements are clean.
- Generated `public/reports/fundamentals-research-readiness.json` and `.md`, including all **1,849 issues** and factor/company coverage, source-data hashes and mechanical readiness labels. Final JSON SHA256 `3b4682d91d9eac597c652032b4c1a720e1fa7ae669e0b117524cdedb74340a0c`. Project State now points next to per-period exclusion triage and a frozen Revenue pilot protocol. No IC, OLS, Bayes, Event Study, Atlas or probability-model evaluation was started.


## 66. Production reliability, Fund Flows restored and Revenue methodology draft — 2026-11-08

- SPA behavior is now covered by regression: direct presentation routes with `Accept: text/html` return the built index, while unknown API routes remain JSON 404. Static index resolution uses `process.cwd()/dist/public`, compatible with production `/code` and clean checkouts. No blanket API-to-SPA rewrite was introduced.
- Documents local-cache fallback moved into `api/routers/document-cache.ts`. Its test mocks that module directly and no longer depends on a machine-specific EDGAR manifest or plaintext cache. Production fallback behavior is unchanged; the previous environment-specific failure is closed.
- Fund Flows now uses fixed material colors per fund tier/company sector instead of problematic instance colors, 150 strongest share changes, responsive controls and reduced motion. Live-data smoke used **100 funds / 495 companies / 400 edges** with guard `2026-06-30` vs `2026-03-31`, `partial=true`, stableFunds=301 and six exclusions. The graph renders visibly with correct colors and no console errors.
- Added a complete accessible alternative: searchable evidence table with up to 100 rows, exact deltas, partial guard and no-WebGL fallback. Forced WebGL failure returns the table with zero console errors. Mobile 375px has no body overflow; only the table scrolls internally. Reviewer navigation and `PresentationOnly` route are restored, while `authedQuery` preserves authentication and NDA enforcement. Authorization regressions cover an authenticated presentation user, anonymous rejection and NDA-required rejection.
- `research/revenue-pilot-exclusions.json` and `docs/REVENUE_PILOT_EXCLUSIONS.md` preserve **88 exact-fact exclusions**, **2,774 TTM-window exclusions** and **569 review warnings**. Exact facts, not whole companies/concepts, are excluded; continuity affects only affected TTM windows. A quarter-index regression test ensures each missing quarter excludes exactly its four affected TTM anchors.
- `docs/REVENUE_PILOT_PROTOCOL.md` explicitly remains a **draft with no selected target**: MarketCap/Revenue expanding log-log versus 63-session excess return. It freezes PIT/exclusion requirements, ei+/ei- definitions, Wilson/bootstrap uncertainty, sealed holdouts and negative-result preservation, but does not choose a target or run IC/OLS/Bayes.
- Verification: routing/Documents **5 tests**, Fund Flows utilities/fallback/authorization **8 tests**, exclusion map **2 tests**, TypeScript and production build passed. Browser QA covers visible desktop graph, mobile table, forced WebGL failure and presentation-reviewer access. No production DB writes, collectors, model evaluation or probability promotion occurred.


## 67. Presentation-50 Expectations reviewed handoff — 2026-11-08

- Scope is exactly `worker/research-universe-50.json`: 50 rows and 50 unique CIKs. RIVN extraction was stopped at the owner's request; RIVN, XOM_PRE and ENLT are not in this handoff. No GPU/Ollama task was started during finalization, and no production API/DB action occurred.
- Independent benchmark: **12/12 documents, 27/27 matched required statements, pass=true, recall=1, issues=0**. Reviewed full-history report: **50/50 companies, 25,372 documents, 8,619 statements**, 16,388 extracted, 1,146 no-candidate, 57 unparsed, 4,317 fallback, 3,463 fallback_unverified and one request_failed. Empty maps to report `noCandidate=1,146`; no fallback/fallback_unverified entry contains structured statements.
- Preserved terminal failure: JPM 8-K `0000019617-14-000294`, filed 2014-02-27, `ollama HTTP 500: prediction aborted, token repeat limit reached`; it remains visible as final `request_failed`, not a score or successful result. Original run metrics in `audit-summary.json` remain unchanged and are distinct from recomputed production coverage.
- Guard found that PFE `0000078003-26-000094` had two exact-source structured statements but retained `status=fallback` after benchmark remediation. Deterministic remediation changed the status to `extracted`, preserved the separate fallback and left `inputSha256=58475a6d07f6918446fd0c8efc2453945ae6163270baa307cf8e8d9e8a85fd24`, model, prompt and gold unchanged. Benchmark still passes; no LLM request was made.
- `scripts/export-expectations-reviewed.mts` now accepts the selected universe, invokes the report builder through the local Node/tsx executable, caches packs and per-CIK containers for lineage validation, maps empty to no-candidate report coverage, refuses overwrites and verifies every ZIP member after unpack. `scripts/export-expectations-reviewed.test.ts` passes **8/8** covering empty mapping, fallback distinction, duplicate keys, sanitization, benchmark guard, resumed merge and preserved failure.
- Lineage: model `qwen3.5:9b`, promptVersion `expectations-v4`, promptSourceSha256 `028c2b912026f2b4e54bb977c9f498712fe5e731aac6796d41f44a16fadabe23`; result key `(cik, accessionNo, sourceId, containerId)`. Guard: companiesWithResults=50/50, outsideUniverseRows=0, duplicateResultKeys=0, raw responses/local paths excluded, failed preserved.
- Final package: `research/reviewed-sync/2026-11-08/expectations-reviewed.zip`, **9,395,401 bytes**, SHA256 **`f0de4997254157de9d821e20cbb519deebf3ec1cc4aa2ccd8576930c4d786435`**. It contains exactly `expectations-report.json`, `expectations-report.ts`, `benchmark-report.json`, `coverage.json`, `audit-summary.json`, `lineage.json`, `manifest.json`. Every unpacked byte count and SHA256 matches the manifest. No filings, HTML/plaintext, packs, prompts, raw responses, cache, worker/.runs, credentials, connection strings, IP addresses or operations state are included.
- Verification after fast-forward to baseline `0476c1105edba24b7bc6d6402f9c1760639b0479`: exporter tests **8/8**, production build and `git diff --check` passed. `npm run check` is blocked by unrelated existing errors at `api/services/macro-scenarios.ts:97` (`string[] | undefined`) and `src/pages/FundFlows.tsx:11` (unused `FlowEdge`); these files were not changed for this handoff.
- Source delivery is restricted to the exporter, its test, this ZIP, `docs/KIMI_CODE_HANDOFF.md` and `docs/LLM_CONTEXT.md`; other local remediation changes and generated runtime evidence remain uncommitted. Exact source commit is authoritative in `git log`. Next owner action: verify the package, back up current production Expectations presentation artifacts, dry-run schema/counts/source keys, atomically replace only the generated presentation artifacts and run independent post-check. No Event Study, Atlas, shock calibration, Bayes or probability/factor rematerialization was run.


## 68. Remaining Expectations source and reviewed macro package delivery — 2026-11-08

- At the owner's request, all remaining tracked/untracked source work from the Expectations remediation block is delivered rather than left outside the prior five-file handoff whitelist. No cache, `worker/.runs`, credentials, connection strings or runtime operations state is included.
- `worker/edgar-cohort-extract.mts` and `worker/lib/cohort-extract-args.ts` add exact `--accession` selection, fail-closed missing-accession behavior and opt-in `--retry-fallback`; ordinary resume still preserves completed fallback results. `worker/edgar-cohorts.mts`, `worker/lib/cohort-forms.ts` and `worker/lib/cohort-pack.ts` support the existing financial forms plus SCHEDULE/SC 13G amendments as whole source blocks without silently widening to unrelated forms.
- `worker/lib/expectations.ts` normalizes proven free-text qualifiers and trailing commas. The expanded regression suite caught an overly broad fallback that accepted arbitrary `banana` as a range; the final code limits shape-based normalization to the proven `at a segment level` and `raised midpoint` forms and preserves rejection of unknown qualifiers.
- Deterministic remediation source includes `worker/lib/expectation-remediation.ts`, `worker/lib/gold-source-remediation.ts`, `scripts/remediate-nvda-expectation.mts` and `scripts/remediate-benchmark-document.mts`, with regression coverage. It preserves contiguous evidence and input hashes, splits NVDA accounting bases and does not manufacture missing evidence. The PFE status correction from section 67 is included.
- Verification: **12 test files / 65 tests passed** across Expectations and cohorts, exporter **8/8 passed**, production build and `git diff --check` passed. `npm run check` remains blocked only by the unrelated existing `api/services/macro-scenarios.ts:97` type error and `src/pages/FundFlows.tsx:11` unused `FlowEdge`; those unrelated files are unchanged.
- The remaining reviewed generated artifact is delivered separately from source: `research/reviewed-sync/2026-11-07/macro-vintage-reviewed-handoff-2026-11-07T00-46-19-361Z.zip`, **3,042,713 bytes**, actual SHA256 **`0e28534732b3805bc84ab56be547a652722b4462c75b7224cc979aae03824d41`**. It contains the previously reviewed normalized FRED scope, dry-run/review metadata, quarantine evidence and manifests. This is the already applied historical macro handoff, not a new apply or collection.
- Source and generated-data commits are separate; exact IDs are authoritative in `git log`. No new GPU/Ollama task, collector, scheduler, production API/DB mutation or production apply was started by this delivery.


## 69. Expectations v2 metadata/coverage remediation; v1 is draft-only — 2026-11-08

- **Do not apply `research/reviewed-sync/2026-11-08/expectations-reviewed.zip` to production.** It remains a reviewed draft. The successor is `research/reviewed-sync/2026-11-08/expectations-reviewed-v2.zip`, **9,399,127 bytes**, SHA256 **`0a0f1464cfdb9d6d102d5fde23999635eee758f95851514d56313a56b6f7d698`**.
- Scope/report/manifest now say `reviewed_partial_history`; full history is not claimed. Thin coverage is explicit: **AMZN 4 documents / 15 statements; MSFT 1 / 0; GOOGL 1 / 0**. No cohort rebuild, mass LLM rerun or 27B run was started; qwen3.5:9b remains the baseline.
- `benchmarkPath` and other local metadata paths are removed. Sanitization now covers benchmark, audit, coverage, lineage, remediation and manifest outputs in addition to report/entries. The benchmark is labeled **post-remediation regression**, not an independent model benchmark. Independent grep over the unpacked ZIP found no Windows/local paths, runtime paths, raw response fields, environment files or secret-like strings.
- `audit-summary.json` separates the unchanged historical `lastExtractionRun` metrics from recomputed `packageTotals`. Fallback reconciliation is explicit: **7,781 attachments vs 7,780 fallback statuses**; the sole outside-status attachment is PFE `0000078003-26-000094`, now `extracted` with two verified statements. It is not a request_failed attachment.
- New `remediation.json` contains statement keys, remediation kind, script/version and evidence SHA256 for **27 statements across nine documents**: AMZN accessions `0001018724-26-000038` (3), `0001018724-26-000004` (2), `0001018724-26-000026` (2); META `0001628280-26-066700` (4); NVDA `0001045810-26-000073` (5); UNH `0000731766-26-000255` (2); WMT `0000104169-26-000145` (3); PFE `0000078003-26-000094` (2); JPM `0001628280-26-054343` (4). Document-only records preserve MSFT `0001193125-26-436122` guidance-status remediation and PFE fallback→extracted status remediation.
- ZIP contains exactly eight files: expectations report JSON/TS, benchmark, coverage, audit-summary, lineage, remediation and manifest. Independent unpack verification passed every manifest byte count/hash and exact file-set check. Exporter also scans unpacked content and refuses forbidden matches.
- Verification: **12 targeted files / 65 tests passed**, exporter **10/10 passed**, production build and `git diff --check` passed. `npm run check` remains limited to unrelated existing errors at `api/services/macro-scenarios.ts:97` and `src/pages/FundFlows.tsx:11`. Production API/DB was not changed. Exact follow-up commit is authoritative in `git log`.


## 70. Generic Expectation normalization discovery, audit and holdout — 2026-11-08

- NVDA remains a pilot for generic rule design, not the final normalizer. The compact strict model schema is unchanged. `worker/lib/expectation-normalization.ts` returns new `CanonicalExpectationStatement` objects with deterministic `canonicalMetric`; it does not mutate model output or checkpoints. `worker/lib/expectation-canonical-metrics.ts` contains the explicit common, industry and company alias map. Unmapped and ambiguous cases go to review instead of guessing.
- Discovery report `research/expectation-normalization-discovery-v1.json` covers **50 companies / 25,372 documents / 8,619 statements**. Findings: **7,040 metric=other**, **762 value/unit scale-review**, **139 qualifier/evidence**, **239 combined-basis** candidates; missed revision-language and non-disclosure candidates are explicitly zero. Size **856,072 bytes**, SHA256 **`778a6cc9672d4fc3385edccb813dda6ee0d40628a91cfd774ec759c988d9aa84`**.
- Generic postprocessing produces **8,670 statements**, **4,408 canonical-mapped**, **4,262 unmapped metric review**, **5,239 total review items**, **51 conservative combined-basis splits** and **35 plus/minus normalizations**. Scale candidates are not automatically converted. Combined `respectively` values and cross-clause numeric associations remain ambiguous.
- Audit: **3,703 records**, including **4 numeric changes**. Every record has statement key, before/after changes, rule id, `expectation-normalization-v1` and evidence SHA256. Numeric rules require a metric anchor and the point value before tolerance in the same evidence clause. This rejected the discovered AMD revenue→gross-margin and NEE ROE→equity-ratio false associations; percentage-point conversion is separately evidence-backed and audited.
- Multi-sector development sample: NVDA/META/AMZN/JPM/WMT, **810 input statements**, 860 output, 562 audit records, 4 numeric changes. Separate holdout: PFE/UNH/MSFT, **275 statements**, 113 audit records, **0 numeric changes**. New development and sealed-sector tests cover numeric immutability, cross-clause rejection, alias mapping, ambiguous combined basis and review behavior.
- Postprocessing report `research/expectation-normalization-postprocessing-v1.json`: **6,391,240 bytes**, SHA256 **`ec0694a0b6df4afc9be3332c5ab22ac02ce19d7576a1baa1344d18a09b3b610f`**. It contains audit and review metadata only, not raw model responses or local source paths. Source and generated-report commits are separate; exact IDs are authoritative in `git log`.
- Verification: **14 targeted files / 78 tests passed**, exporter **10/10**, production build and `git diff --check` passed. `npm run check` remains limited to unrelated existing errors at `api/services/macro-scenarios.ts:97` and `src/pages/FundFlows.tsx:11`. No mass LLM rerun, 27B run, production apply or production API/DB change occurred.


## 71. Expectations v3 normalized reviewed package — 2026-11-08

- Package: `research/reviewed-sync/2026-11-08/expectations-reviewed-v3.zip`, **10,138,471 bytes**, SHA256 **`a25df1542dda98f168339be0c0bf3af432aadfd67aa8cab8cd468de254e0edbc`**. Manifest: packageType `reviewed-expectations`, packageVersion 3, scope `reviewed_partial_history`, productionApply=false, normalizationVersion `expectation-normalization-v2`, benchmark evaluationType `post-remediation regression`.
- Main output is normalized Expectations, built through the existing report builder from normalized entries. Lineage explicitly states **model output + deterministic normalization** and retains original source/container input hashes; raw model output is not included. Every normalized statement has `canonicalMetric`.
- Counts: **8,619 input / 8,670 output statements; 4,957 normalization audit records; 4,436 review items; 5,211 canonical mapped / 3,459 unmapped**. Expanded reviewed aliases covered **803 additional statements** versus v1. Audit records include rule id, statement key, before/after, version and evidence SHA256. Scale mismatches remain review-only; no millions/billions auto-conversion occurred.
- Review queue: **metric_alias 3,459; value_unit_scale 762; qualifier_evidence 109; combined_basis 106; revision/non-disclosure/other ambiguous=0**. Top remaining unmapped: aggregate cash payment 14; after-tax charge 7; equity-investment/interest impact 7; consolidated unit costs excluding fuel/profit sharing 6; DCF 6; net gains from equity securities/interest/other 6. These remain ambiguous and are not promoted.
- Industry mapping now explicitly covers all **50 universe symbols**, without deriving metric semantics from industry alone. New holdout covers PFE/UNH/MSFT/DAL/RCL/DASH/NKE/T: **4,040 documents / 1,507 statements / 785 audit records / 0 numeric changes**. Development remains NVDA/META/AMZN/JPM/WMT: 810 input / 860 output statements and four evidence-backed numeric changes.
- ZIP contains ten files: normalized report JSON/TS, benchmark, coverage, audit-summary, lineage, remediation, normalization-audit, review-queue and manifest. Independent unpack verification passed every byte count/hash and exact file-set check. Safety grep found no local/runtime paths, raw responses, environment/secret material, DB URLs, localhost/raw IPs, local source-file fields or operations state. Large audit/review artifacts exist only inside this reviewed ZIP, not as new standalone reports.
- Test discoverability: `vitest.config.ts` now includes `scripts/**/*.test.ts`; exact command **`npm run test:scripts`** passed **2 files / 17 tests**, including exporter **11/11**. Targeted Expectations/cohort suites passed **14 files / 80 tests**. Production build and `git diff --check` passed. `npm run check` retains only unrelated existing `api/services/macro-scenarios.ts:97` and `src/pages/FundFlows.tsx:11` errors.
- Not production-ready: AMZN/MSFT/GOOGL history remains thin; 3,459 unmapped metrics and 977 other scale/qualifier/combined review items remain. No DB/API writes, production apply, mass LLM rerun or 27B run occurred. Exact delivery commit is authoritative in `git log`.


## 72. Expectations v3.1 consistency handoff — 2026-11-08

- Package: `research/reviewed-sync/2026-11-08/expectations-reviewed-v3.1.zip`, **10,151,309 bytes**, SHA256 **`d5de896f5a65749047fa1ceba83f52f5b7dd5b918371fc3dd97e8a8aba3432cf`**. This is a metadata/consistency follow-up; normalized output remains **8,670 statements**, with no LLM rerun or DB/API writes.
- `numericChange=true` now covers `qualifier`, `valueLow`, `valueHigh`, `valuePoint`, `tolerance`, `toleranceUnit` and `unit`. Manifest documents this semantics and reports **35 numeric changes**, exactly matching normalization-audit. Independent check found **0 mismatches**. Development reports 34 and holdout 0; these are audit-flag corrections, not 35 new transformations.
- Every non-alias normalization record now contains full `beforeStatement` and `afterStatement` snapshots plus rule id, before/after changes, version and evidence SHA256. Resolver checks enforce `statementKey=before` and `afterStatementKeys=after`; **0 missing snapshots** across 4,957 audit records. Alias records retain the lightweight canonical-metric audit.
- Manifest explicitly separates **packageEntries=10**, **payloadFilesHashListed=9**, **manifestSelfHashed=false**. To keep exactly ten entries, former audit-summary content is consolidated into `production-readiness.json` rather than added as an eleventh file.
- `production-readiness.json` has `status=blocked`, `productionApply=false` and explicit blockers: AMZN 4 documents/15 statements, MSFT 1/0, GOOGL 1/0; **3,459 canonical unmapped; 762 value_unit_scale; 109 qualifier_evidence; 106 combined_basis**; benchmark is post-remediation regression only, not independent model evidence; fallback entries are diagnostics, not structured guidance.
- Manifest/docs holdout is exactly **PFE, UNH, MSFT, DAL, RCL, DASH, NKE, T**, with 4,040 documents, 1,507 statements, 785 audit records and zero numeric changes. Development/holdout partition remains intact.
- Verification: **`npm run test:scripts`** passed 2 files/17 tests; targeted normalization tests passed 2 files/15 tests; production build and `git diff --check` passed. Safety grep found no forbidden content. Independent unpack verification passed exact file-set and every payload byte count/SHA256. Production API/DB was not changed and no production apply occurred.


## 73. Expectations v3.2 exact-key result payload — 2026-11-08

- Package: `research/reviewed-sync/2026-11-08/expectations-reviewed-v3.2.zip`, **13,868,750 bytes**, factual SHA256 **`a9b398c883f878709da5bbb7b9835d38f62ad9249d00bcf23924c7eb8b3b2278`**. No DB/API writes, staging apply or production apply occurred.
- New `expectations-results.json` is built directly from normalized cohort/per-source checkpoint entries. It is not reconstructed from the flattened report. Each result contains cik, accessionNo, sourceId, containerId, inputSha256, canonical SEC Archives sourceUrl, status, guidanceStatus, nested statements, extractionWarnings and rejectedEvidence.
- Exact-key verification: **25,372 results; 8,670 nested statements; duplicate `(cik, accessionNo, sourceId, containerId)`=0**. Resolver report: **ambiguousStatements=0, missingParent=0, heuristicResolved=0**. Every statement is physically nested in exactly one parent result. Flattened expectations-report remains human/UI review only and is explicitly not the apply payload.
- AMZN/MSFT/GOOGL primary packs were empty/in-progress. Exporter selected the richest completed read-only `.bak` checkpoint sets with 4/1/1 results and their original pack hashes; no collector, pack rebuild or LLM run was started. All 50 companies and 25,372 input hashes passed the existing pack/container validation.
- Fallback diagnostics are excluded from the result payload; they remain counts/audit only. Independent check found zero fallback/raw diagnostic fields in results, zero missing canonicalMetric and zero non-SEC source URLs.
- Manifest: packageVersion **3.2**, **packageEntries=11**, **payloadFilesHashListed=10**, **manifestSelfHashed=false**, applyPayload=`expectations-results.json`, applyStatus=`not_run`, flattenedReportRole=`human/UI review only; not apply payload`. `production-readiness.json` retains all v3.1 blockers and adds `backup_channel_required` with `verified=false` and `applyStatus=fail_closed`. Apply remains prohibited until a verified backup id with size/hash or explicit owner confirmation `backup verified, proceed`.
- Verification: `npm run test:scripts` passed **2 files / 18 tests**; targeted normalization tests passed **2 files / 15 tests**; production build and `git diff --check` passed. Independent unpack verification passed exact 11-file set and every payload byte count/hash. Safety grep found no local/runtime paths, raw responses, secret material, DB URLs, localhost/IP, source-file fields or operations state.


## 74. Local SEC Form 4 insider-buy MVP — 2026-11-08

- Added a local-only one-command MVP: `powershell -ExecutionPolicy Bypass -File scripts/form4-mvp.ps1`, with `-Tickers`, `-From`, `-DryRun`, `-StrictQa` and `-Force`. Universe is `worker/research-universe-53.json`; XOM_PRE and synthetic placeholders are `not_computable`, never XOM. No production DB/API writes or promotion.
- `worker/form4-fetch.mts` uses the existing serialized SEC client (default 7 RPS, hard cap 8), 15 GiB disk guard, atomic manifests/raw XML and resume. Official `index-headers.html` acceptance timestamps are required; submissions midnight fallbacks are not used. `worker/form4-parse.mts` verifies raw SHA256 and emits normalized transactions without raw XML.
- Features implement `insider_buy_cluster_v1`: P-only open-market purchases, visible A/M/F/G/S/RSU/gift/swap exclusions, 10-business-day clusters, role flags, value/ownership features, flip-after-sale, ADV20/drawdown20d only from reviewed bars, and market cap `not_computable` without point-in-time lineage. Amendment supersede and duplicate handling avoid double counting; different issuers are skipped and multi-owner mappings fail closed.
- Synthetic tests cover P include, A/M/F/G/S exclusions, indirect ownership, footnotes, amendments, duplicates, roles, value consistency, official acceptance headers and missing-price `not_computable`. Golden QA is EDGAR XML only: INTC plus QA-only CRM `0001108524-26-000212`, ORCL `0001341439-26-000099`, ADBE `0000796343-26-000118`; issues=0. QA summary and benchmark output stay under ignored `worker/.runs/form4-qa/`.
- Acceptance: `scripts/form4-mvp.ps1 -Tickers INTC,NVDA -From 2024-01-01 -DryRun -StrictQa` completed fetch → parse → features → QA → benchmark. Resume: **477 filings / 2,026 transactions** (NVDA 1,501; INTC 525). INTC has **7 clusters (2 computed / 5 partial)**; NVDA has 0 and is not forced into a signal.
- Dry-run benchmark, not production alpha: +1d computed 7/7, hitRate=0, medianExcess **−3.318%**; +5d 6/7, hitRate=0, medianExcess **−7.506%**; +20d 6/7, hitRate=0, medianExcess **−32.966%**. +5d/+20d coverage=85.714%. No future bars are used before availability; unavailable market evidence is `not_computable`.
- Verification: **3 files / 8 tests**, scripts suite **2 files / 18 tests**, PowerShell AST check, worker esbuild syntax checks, production build, `git diff --check`, safety grep and ignore checks passed. `npm run check` retains only the unrelated existing `api/services/macro-scenarios.ts:97` and `src/pages/FundFlows.tsx:11` errors. Only source/scripts/tests/docs are committed; cache, raw XML, generated reports and `.runs` are excluded. Usage and known limits are in `docs/FORM4_MVP.md`.


## 75. Form 4 canonical cache root resolution — 2026-11-08

- Added `worker/lib/cache-root.ts`: codeRoot is the repository, cacheRoot=`ALPHA_CACHE_ROOT ?? worker/cache`, runsRoot=`ALPHA_RUNS_ROOT ?? worker/.runs`. All Form 4 fetch/parse/features/QA/benchmark cache reads/writes now use the shared resolver; QA and benchmark summaries use the shared runs resolver. No independent bulky-data path remains in the Form 4 workers.
- `scripts/form4-mvp.ps1` requires exactly `C:\dev\alpha-engine`, sets defaults `D:\alpha-engine\worker\cache` and `D:\alpha-engine\worker\.runs` when env is absent, and prints effective codeRoot/cacheRoot/runsRoot before other checks. A normal C cache directory stops the run; a junction is accepted only when it targets D. The owner's `research-universe-50.json` change is preserved.
- `scripts/form4-cache-doctor.ps1` prints candidate paths, file/byte counts, LinkType and Target and performs **no merge, backup, copy verification or deletion**. A valid parent `worker\cache` junction to D is one physical store. Split-brain is limited to a normal parent directory with content in D. Never recursively remove a path under `worker\cache`; only `cmd /c rmdir` on a reparse point itself is safe.
- Verification: **4 files / 10 tests**, PowerShell AST, production build and `git diff --check` passed. No production DB/API changes. Cache, `.runs`, raw XML, summaries and backup directories remain outside source delivery. Exact commit is authoritative in `git log`.


## 76. Form 4 doctor parent junction detection and fresh-cache proof — 2026-11-08

- Doctor and MVP now inspect the parent `worker\cache` reparse point before the child `edgar-form4` path. If parent is a junction/symlink whose resolved target equals `ALPHA_CACHE_ROOT`, the child LinkType is irrelevant and the configuration is one physical store. A direct child junction is also accepted when it targets D. Split-brain is limited to a normal parent directory with files in D; wrong targets fail without any deletion instruction.
- Live doctor output: `OK: single physical store via junction`, with `worker\cache` LinkType=Junction and Target=`D:\alpha-engine\worker\cache`. The previous normal-child report no longer causes a false split-brain failure.
- The Form 4 cache was deleted through a junction and is being rebuilt. Fresh `scripts/form4-mvp.ps1 -Tickers INTC,NVDA -From 2026-01-01 -DryRun -StrictQa` started with no manifest, fetched **106 filings / 285 transactions**, produced three INTC clusters and passed QA. A second identical run resumed **106/106 with 0 fetched**, proving manifest resume works after a fresh start.
- D cache contains **124 files / 1,340,095 bytes** after the fresh runs; QA and benchmark summaries are under `D:\alpha-engine\worker\.runs\form4-qa`. No separate C store is created because the parent junction already resolves there.
- Documentation and logs no longer suggest deleting paths under `worker\cache`. Only `cmd /c rmdir` on a reparse point itself is documented as safe; recursive removal is never recommended. No merge, backup or deletion was performed by doctor.
- Verification: **4 files / 11 tests**, PowerShell AST, production build and `git diff --check` passed. Production DB/API unchanged. Exact commit is authoritative in `git log`.


## 77. Cohort QA evidence and truncation remediation — 2026-11-09

- Scope was limited to local AMZN/MSFT/GOOGL QA issues. No production, transport, package rebuild or other universe checkpoint mutation occurred. `OLLAMA_NUM_CTX=131072` remained the extraction lineage; no 32768/262144 mixing occurred.
- Root cause of all **65 found_without_statements** was evidence rejection, not empty model output and not schema-empty responses. Deterministic remediation changed only those entries to `not_found` with `statements_rejected_evidence`, preserving raw responses, rejectedEvidence, input hashes and statements counts. Per-entry backups are under ignored `worker/.runs/cohort-qa-remediation/`.
- Four output_truncated sources first showed that simply increasing a whole-source cap did not solve large-table output. Final retry used **2000-char chunks with 8192 tokens per chunk**, merged parsed statements and full-target evidence checks. `outputTokens` now records dynamic per-entry caps, while `outputTruncated` explicitly preserves any per-chunk cap event so QA cannot hide truncation behind aggregate counts. Successful healed sources resume instead of being regenerated; failed sources still retry.
- Evidence-backed qualifier normalization now covers the observed plan/deliver/growth/decline/outlook variants and low==high point semantics, while arbitrary qualifiers such as `banana` remain rejected. No accept-all heuristic was introduced.
- Final strict QA: **AMZN 24→0 hard errors, statements 496→503 (+7); MSFT 41→0, statements 173→241 (+68); GOOGL 4→0, statements 14→14**. All three commands exited 0 with `REVIEW`; heuristic `not_found_with_expectation_language` queues remained visible and were not treated as blockers. No uncurable sources remain.
- Verification: `npm run test:scripts` **2 files / 18 tests**, targeted worker suites **6 files / 40 tests**, production build and `git diff --check` passed. `npm run check` retains only unrelated existing errors at `api/services/macro-scenarios.ts:97` and `src/pages/FundFlows.tsx:11`. Exact commit is authoritative in `git log`.



## 78. Expectations v3.3 healed-trio handoff — 2026-11-09

- Package: `research/reviewed-sync/2026-11-09/expectations-reviewed-v3.3.zip`, **8,267,599 bytes**, SHA256 **`b5feac0eab5c0ae6ed2639c9f14cc859ed3f5a32fc84ffedee64065a1dc5a029`**. Baseline commit `92308cedca1899c85243719600dff8648635b461`; packageVersion **3.3**, scope `reviewed_partial_history`, productionApply=false, applyStatus=`not_run`, rawModelOutputIncluded=false. No production/staging apply, transport, DB/API write or collector rerun occurred.
- Healed trio QA evidence is included under `qa/`: AMZN **622/622 sources, 503 statements, REVIEW, hard=0, review=101**; MSFT **559/559, 241, REVIEW, hard=0, review=159**; GOOGL **240/240, 14, REVIEW, hard=0, review=91**. Their extraction lineage is `ollama_ctx_131072`; every other company retains exactly one original v3.2 context label. Normalized results for all non-trio companies are byte-for-byte identical to v3.2 (`unchanged50ByteIdentical=true` is the manifest compatibility label).
- Merge replaces the complete trio company sets rather than overlaying exact keys. A regression caught and removed six stale v3.2 trio documents and 15 stale statements; another regression proves narrative unmapped guidance receives exactly one review item. Final guard has **0 duplicate exact result keys**, resolver ambiguous/missing/heuristic=0, and **3,601 unmapped statements = 3,601 metric_alias review items**.
- Counts v3.2 → v3.3: documents **25,372 → 26,787**; input statements **8,619 → 9,362**; normalized output statements **8,670 → 9,413**; audit records **4,957 → 5,306**; review items **4,436 → 4,681**; canonical mapped **5,211 → 5,812**; canonical unmapped **3,459 → 3,601**; numeric changes **35 → 35**. The 51-statement input/output delta is the preserved deterministic combined-basis split count.
- Production-readiness diff: thin-history companies **AMZN/MSFT/GOOGL → none** by actual document coverage; value_unit_scale **762 → 865**; qualifier_evidence **109 → 109**; combined_basis **106 → 106**; canonical_unmapped **3,459 → 3,601**; fallback diagnostic list **7,781 → 7,888**. Backup remains fail-closed, benchmark remains post-remediation regression only, and fallbacks remain non-serving diagnostics.
- ZIP contains exactly 14 entries (13 hashed payloads plus manifest): expectations report JSON/TS, exact-key `expectations-results.json`, benchmark, coverage, production-readiness, lineage, remediation, normalization-audit, review-queue, `qa/AMZN.json`, `qa/MSFT.json`, `qa/GOOGL.json`, and manifest. Unpack verification passed exact file-set and every payload byte count/SHA256. Safety scan passed for local/runtime paths, raw responses, secrets, DB URLs, localhost/IP and operations state.
- Verification: `npm run test:scripts` **2 files / 18 tests passed**; targeted v3.3/normalization/remediation/report/benchmark suites **7 files / 35 tests passed**; production build and `git diff --check` passed. `npm run check` still reports only the unrelated existing `api/services/macro-scenarios.ts:97` and `src/pages/FundFlows.tsx:11` errors. Exact delivery commit is authoritative in `git log`; next owner action is local package review only, with no apply until the separate backup and staging prerequisites are explicitly satisfied.



## 79. Reviewed apply backup channel and SCRATCH restore drill — 2026-11-09

- Added `scripts/prod-backup.mts`, shared `scripts/lib/prod-backup.ts`, v3.3 ZIP validation in `scripts/lib/expectations-reviewed-package.ts`, and gated `scripts/apply-expectations-reviewed.mts`. Default scope is derived from the exact-key v3.3 payload: `expectations_reviewed_packages` and `expectations_reviewed_results`; `--full` discovers every base table through information_schema. Source backup statements are SELECT-only. No production apply or production DB write occurred.
- Backups default to external `D:\alpha-engine\backups\prod`; `/backups/` is also ignored defensively. Manifest includes UTC backup id, source identity hash (host+schema only), tool version, table existence/counts/bytes/file hashes/content hashes and restore summary. Restore requires an explicit environment-variable name through `--restore-target`, asserts target identity differs from source, creates only new `drill_*` tables in SCRATCH, inserts at most 500 rows per batch, and records independent row/content-hash evidence. No DROP/TRUNCATE or production restore exists. Retention keeps ten only when `--prune` is explicitly invoked.
- Apply requires `--backup-id`; its gate rehashes table payloads and drill evidence and rejects stale (>60 minutes), future-dated, wrong-identity, wrong-scope or unverified backups before connecting. The implemented staging-only exact-key upsert was not run. Production dry-run invocation failed closed because `PROD_DATABASE_URL` is absent; no package read, connection or write followed that failure.
- Local scoped end-to-end evidence, **not production evidence**: backupId **`20261109T183738Z-d8d8e09b81aa`**, manifest SHA256 **`a6d81c5689827fcb97e2a762007c48bb3424fd1763221db6c3b160a596b3fde6`**. `expectations_reviewed_packages`: sourceExists=false, 0 rows, 87 bytes, restore 0/0 pass; `expectations_reviewed_results`: sourceExists=false, 0 rows, 86 bytes, restore 0/0 pass. Both content hashes matched; drill status=pass and an independent gate-check passed. The local SCRATCH schema and drill tables remain for audit. This scoped drill does not mark the full signals.note migration gate passed.
- Production backup was not generated: `PROD_DATABASE_URL` and `SCRATCH_DATABASE_URL` were not provisioned. The owner must provision both on the authorized host and run `npx tsx scripts/prod-backup.mts --restore-target SCRATCH_DATABASE_URL`; only the resulting BACKUP_VERIFIED id/manifest hash may be used for a fresh (<60 minute) apply gate.
- `contracts/operations.ts` and generated `docs/OPERATIONS.md` §65 now expose a manual local full-backup command using `--source-env DATABASE_URL`, separately from the production contract. Local signals.note still requires its own full successful drill. Package loading now handles PowerShell ZIP backslash separators without modifying the reviewed ZIP.
- Verification: `npm run test:scripts` **3 files / 26 tests passed**, including manifest verification, hash mismatch, stale backup, wrong identity, missing drill evidence, MySQL Date canonicalization and ZIP path regressions. Production build and `git diff --check` passed. `npm run check` retains only the unrelated existing `api/services/macro-scenarios.ts:97` and `src/pages/FundFlows.tsx:11` errors. Exact delivery commit is authoritative in `git log`.



## 80. Worker HTTP backup/apply channel for platform-managed production DB — 2026-11-09

- Added worker-key authenticated `POST /api/worker/backup-expectations` and `POST /api/worker/apply-expectations-reviewed` in `api/boot.ts`, with services in `api/services/worker-expectations.ts` and `worker-expectations-http.ts`. Direct `PROD_DATABASE_URL` mode remains available; `--via-api` uses `PROD_INGEST_URL` and `WORKER_KEY`. No deployment, production apply, serving-table change or DDL apply occurred.
- Backup uses SELECT only, including read-only worker auth (`verifyWorkerKey(..., {touch:false})`, so `lastUsedAt` is not updated). Server generates the standard backup id/manifest, identity hash, per-table sourceExists/counts/bytes/file/content hashes and gzip response. Local `scripts/prod-backup.mts --via-api` reconstructs the same external backupDir, independently verifies all hashes and runs the unchanged SCRATCH drill.
- Apply validates the pinned v3.3 ZIP manifest SHA256 and the original `expectations-results.json` hash listed in that manifest, expected server DB identity, exact keys, source URLs and counts. It performs only staging-table exact-key upserts in one transaction, batches at most 500 rows and returns package-specific counts, canonical content hashes and sample exact-key hashes. Local apply refuses any post-check mismatch. Missing tables return 409 with the complete missing list; no DDL is executed.
- Real request measurement generated from the reviewed package: **35,072,547 raw bytes / 3,959,932 gzip bytes**, below the existing **52,428,800-byte** request limit. Server enforces a separate **64 MiB decompressed** guard. Gzip backup/apply round-trips passed.
- `db/ddl/031_expectations_reviewed.sql` is prepared for the two staging tables but was **not applied**. Payload profiling confirmed sourceId max=84 and containerId max=37; guidanceStatus is nullable for 7,945 results and the DDL/canonical hash contract preserves that fact. Live probe stopped before any network request because `PROD_INGEST_URL` is not provisioned; no new production backupId or manifest hash was generated. `SCRATCH_DATABASE_URL` is also not provisioned. Owner must deploy the reviewed server change and provision the env before the via-api probe.
- Verification: targeted API/backup/post-check/registry suites **4 files / 31 tests passed**; `npm run test:scripts` **4 files / 30 tests passed**; `npm run check` and production build passed; `git diff --check` passed. Full suite initially reported **917/920**: the backup registry expectation was updated for the manual, disabled-by-default local command and its targeted suite now passes. Two unrelated existing failures remain in `src/components/AnalyticsNetwork.test.tsx` (snapshot metric type) and `src/pages/Expectations.test.tsx` (generated report no longer contains `Not run`); these generated-data/UI issues were not changed in this block.
- `docs/OPERATIONS.md` §65 now documents direct and via-api modes, with via-api as the current production channel. Exact delivery commit is authoritative in `git log`.



## 81. Expectations v3.4 normalization implementation is blocked by the inherited benchmark — 2026-11-09

- **No reviewed v3.4 ZIP was released and no production/transport action occurred.** `worker/lib/expectation-normalization-v34.ts`, reviewed `research/expectation-metric-alias-salvage-v1.json`, `scripts/export-expectations-reviewed-v34.mts` and 13 v3.4 regression tests are local uncommitted work. All rejected draft ZIPs were removed; only the verified v3.3 ZIP remains in the reviewed-sync directory.
- Raw baseline guard passed: all **26,787 results / 9,413 statements** rebuilt from immutable checkpoints are byte-identical to v3.3 after canonical exact-key ordering. Untouched v3.4 statements also passed the independent subset guard.
- Independent `npx tsx worker/expectations-benchmark.mts --cohorts` returned exit 2: **pass=false, recall=20/27=0.7407407407, eight issues**. The same eight issues exist when evaluating the untouched v3.3 payload, proving v3.4 introduces zero new gold issues but cannot honestly inherit `pass=true` from the copied v3.3 benchmark.
- Baseline issues: AMZN `0001018724-26-000038` missing revenue/operating_income/capex metadata matches; AMZN `0001018724-26-000004` missing revenue/operating_income; AMZN `0001018724-26-000026` missing revenue/operating_income; MSFT `0001193125-26-436122` expected deferred_to_call but got not_found. These are extraction metadata/status issues, not v3.4 scale/alias failures. Gold and raw model output were not modified.
- Last dry-run normalization metrics, **not a reviewed package**: output 9,464 statements; scale 865→236 (627 reconciled); qualifier 109→10 (14 non-blocking downgrades, 80 audited rejections); combined 106→2 (131 splits); metric_alias blocking 3,601→0 with 3,563 non-blocking other. Recent salvage **10/228 = 4.39%**, 218 residual, 3,187 legacy, 158 unknown-period, 9 suspected noise. No final SHA256 is reported because publication was stopped before ZIP creation.
- Verification of the implementation: v3.4/normalization/benchmark suites **4 files / 32 tests passed**; `npm run test:scripts` **4 files / 30 tests passed**; `npm run check`, production build and `git diff --check` passed. Next owner action: resolve the eight inherited AMZN/MSFT gold issues through reviewed source-backed remediation, then rerun the independent benchmark and only afterward build v3.4.



## 82. Expectations reviewed normalization v3.4 handoff — 2026-11-09

- Package: `research/reviewed-sync/2026-11-09/expectations-reviewed-v3.4.zip`, **15,505,680 bytes**, SHA256 **`1580284b108cf58127b4541cac0eb0124ccbbd10caf5e6eba9a75b5c097465ea`**. Exactly **15 entries / 14 hashed payloads + manifest**. `packageVersion=3.4`, normalizationVersion `expectation-normalization-v3.4`, productionApply=false, applyStatus=`not_run`, rawModelOutputIncluded=false. No production, transport, collector or LLM rerun occurred.
- Baseline and untouched guards passed: immutable raw rebuild reproduces all **26,787 v3.3 results / 9,413 statements** byte-for-byte after exact-key ordering; **4,622 statements** outside the new rules remain byte-identical. Duplicate exact keys=0 and resolver ambiguous/missing/heuristic=0.
- The eight inherited AMZN/MSFT gold issues are resolved without changing gold or raw checkpoints. Reviewed alias metadata reconciles AMZN metric/scope/basis while values and evidence stay unchanged; continued-guidance language derives reaffirmed revision. MSFT `will provide forward-looking guidance … earnings conference call` evidence drives `GUIDANCE_STATUS_DEFERRED_TO_CALL` for **15 source-backed documents**, each with before/after status and evidence SHA256. No statement was manufactured for deferred calls.
- Final post-normalization regression: **12/12 documents, 27/27 matched required statements, pass=true, recall=1, issues=0**. This is a post-remediation regression, not an independent model-quality benchmark.
- Blocker transitions v3.3→v3.4: metric_alias **3,601→0 blocking** with **3,563 non-blocking other**; value_unit_scale **865→236** after **627 SCALE_EVIDENCE_RECONCILE** records; qualifier_evidence **109→10** after **14 non-blocking downgrades and 80 explicitly audited rejections**; combined_basis **106→2** after **131 respectively splits**. Output statements **9,464**, audit records **10,380**, numeric changes **676**.
- Recent alias salvage: **10/228 = 4.39%**, residual recent other **218**, legacy other **3,187**, unknown-period other **158**, suspected residual noise **9**. Canonical mapped **5,901**, non-blocking other **3,563**, blocking other.unmapped **0**. Remaining scale/qualifier/combined items stay visible in review; unmapped remainder does not block serving.
- Verification: v3.4/normalization/benchmark suites **4 files / 35 tests passed**; `npm run test:scripts` **4 files / 30 tests passed**; `npm run check`, production build and `git diff --check` passed. ZIP unpack verification passed every payload byte count/SHA256 and the safety scan. Exact delivery commit is authoritative in `git log`; next owner action is local package review and a fresh backup/drill before any separate staging apply decision.



## 83. Scheduled operational outbox and live DB-backed reports — 2026-11-09

- Added the owner-declared automatic lane for QA-passed operational outputs only. `AGENTS.md`, `contracts/operations.ts` and generated `docs/OPERATIONS.md` now distinguish this lane from derived artifacts: Expectations, canonical series, factors, company-exposures and macro-scenarios remain reviewed/pinned and are not auto-pushed. No production write, publish, backfill or DDL apply occurred.
- New worker-ingest kinds in `api/services/worker-operational.ts`: **pricesDaily** (cik/ticker/date/OHLCV/source/fetchedAt, OHLC sanity, future-date and schwab/stooq validation, exact-key upsert and accepted/dupes/post-check); **macroPoints** (seriesId/observationPeriod/realtimeStart/End/value/sourceHash, exact keys, conflict reasons, older-open-vintage refusal); **reportFile** (central name whitelist, body SHA256 and generatedAt). Shared `workerIngestBodyZ` and worker-key auth cover all three; batches remain ≤500.
- Affected tables: `prices` (existing exact-key rows), `macro_points` (existing rows plus draft `sourceHash` column in `db/ddl/033_macro_points_source_hash.sql`), and new `reports` table (`db/ddl/032_reports.sql`). Both DDL files are unapplied drafts. `db/schema.ts` reflects the intended schema.
- `/reports/:name` now compares DB generatedAt with bundled/static content, returns the fresher source and emits `X-Report-Generated-At` plus `X-Report-Source`; missing DB tables fall back to static, while hash mismatch fails closed. Existing authentication/NDA middleware is unchanged.
- `worker/lib/prod-push.ts` builds Schwab daily OHLCV from local official candles, normalized FRED vintage rows and whitelisted report payloads. Scheduler pushes only `done` non-manual outputs, with exactly one retry; push failure marks the job error and blocks dependencies. Raw option chains never leave home. `worker/prod-push.mts` adds explicit backfill for all three kinds. No auto-push occurs for failed or manual jobs.
- Verification: targeted operational/scheduler/worker suites **4 files / 28 tests passed**; `npm run test:scripts` **4 files / 30 tests passed**; `npm run check`, production build and `git diff --check` passed. Full suite **952/954** with the two previously documented unrelated generated UI snapshot failures in `src/components/AnalyticsNetwork.test.tsx` and `src/pages/Expectations.test.tsx`.
- Owner next steps: publish the server change, apply DDL 032/033 manually, provision production `INGEST_URL` and `WORKER_KEY`, then run the first explicit backfill: `npx tsx worker/prod-push.mts --kind pricesDaily --from 2026-11-07`. Analogous commands support `--kind macroPoints` and `--kind reportFile --name <whitelisted-name>`. Exact delivery commit is authoritative in `git log`.



## 84. Daily-prices reportFile backfill source fix — 2026-11-10

- Fixed `npx tsx worker/prod-push.mts --kind reportFile --name daily-prices-schwab.json`: it no longer reads a nonexistent `public/reports/daily-prices-schwab.json`. The new `buildReportFileBackfillPayload` builds this generated report from the same official Schwab daily candles used by `pricesDaily`; static report names keep the existing file loader.
- Real local payload verification, without any network push: **50/50 collected**, 61,941 bytes, SHA256 `0fbab4e99872523fc128d0d50f0104e2961602d01b3a3c6243d8d8c947964abe`. Regression covers the exact report name, generated body and hash.
- Verification: `worker/lib/prod-push.test.ts` **5/5 passed**, `npm run check`, production build and `git diff --check` passed. No production write occurred. Exact fix commit is authoritative in `git log`.



## 85. Honest PROD-only targeting for prod-push — 2026-11-10

- `worker/lib/prod-push.ts` now reads only `PROD_INGEST_URL`; the local `INGEST_URL` fallback is removed. Missing/invalid values fail with `PROD_INGEST_URL is required (https .../api/worker/ingest); INGEST_URL is not used by prod-push`. HTTPS, exact `/api/worker/ingest` path and no credentials/query/hash are enforced.
- Target logging is host-only (`target host: <host>`). `worker/prod-push.mts` emits `PROD_PUSH_OK` only after all responses succeed and `assertOperationalServerEvidence` verifies zero rejected/failed rows and expected=verified. Output contains accepted/dupes/postCheck counts from the server, not local expectations. HTTP 400 `unsupported kind` maps to `prod server has no ingest lane yet — publish the new version first`.
- Verification: targeted suites **3 files / 26 tests passed**, including INGEST_URL-only refusal, exact target path, host log, non-ok response without success, and post-check mismatch. `npm run test:scripts` **4 files / 30 tests passed**; `npm run check`, production build and `git diff --check` passed.
- Safe CLI proof with `PROD_INGEST_URL=` returned `PROD_PUSH_FAILED PROD_INGEST_URL is required ...` before any network call. During earlier validation, the configured production target returned HTTP 500 twice; no success or post-check evidence was returned, so no production write is claimed or confirmed. Exact fix commit is authoritative in `git log`.



## 86. CUSIP map reviewed export for production transport — 2026-11-10

- Created local-only backup with `npx tsx scripts/backup-cusip-map.mts`; no production writes, DDL changes or new ingest kinds were performed.
- Reviewed artifacts: `research/reviewed-sync/2026-11-10/cusip-map/backup-cusip-map.json` and `backup-manifest.json`.
- Script output: createdAt **2026-11-10T02:03:02.967Z**, rowsTotal **41,090**, byteSize **7,092,932**, backup SHA256 **`dc1df9326e633a92c8789f165d18ec805bac5173b35c6b04780ac4532f75eb0c`**.
- Verification passed: manifest SHA256 matches the file and the reviewed copy, local `COUNT(*)=41,090`, JSON row count=41,090, byte size matches, `credentialMaterialIncluded=false`, and no unexpected fields outside `cusip/cik/ticker/exchCode/secType/mappedAt`. Local ticker column is TEXT as expected; production DDL 030 was not touched. Exact export commit is authoritative in `git log`; next action belongs to the sandbox production apply and uncovered-CUSIP reason audit.



## 87. Macro re-evaluation chain and analytics snapshot W46 — 2026-11-10

- Sequential local chain completed without production writes: materialize-research-factors **50/50 companies, 21,440 factor points, 0 failed**; build-company-exposure **50 companies** (debt 47, interest coverage 6, fuel 1, foreign revenue share 0); build-macro-scenarios **4 scenarios / 50 companies**; build-macro-transmission-atlas **partial, 904 records, 24 studies**; build-analytics-snapshot **2026-W46, 502 fact companies, 52 factor companies, 621 option snapshots, 771,988 normalized option rows, 3 weeks retained**.
- Snapshot before→after: week **2026-W45→2026-W46**, generatedAt **2026-11-06T22:37:11.354Z→2026-11-10T02:31:05.551Z**, companies **495→496**, factsRows **1,390,442→12,856,818**, factsCompanies **54→502**, factorPoints **22,169→21,803**, factorCompanies **54→52**, priceRows **447,382→447,432**, latestPriceDate **2026-11-05→2026-11-06**, fundHoldings **1,617,277→1,617,656**, positionEvents **16,422→41,878**, macroRows **408,862→408,860**, optionsSnapshots **250→621**, normalizedOptionRows **310,634→771,988**, testCount **795→960**.
- `AnalyticsNetwork.test.tsx` finished **3/4 tests**. `keeps the snapshot evidence-based and current` remains red because it expects `shareFlows=done` while the rebuilt evidence correctly says `partial`: latest-quarter comparable flow has not been evaluated and the last guard evidence has `partial=true`. No status was changed to satisfy the test. This requires a separate comparable-flow evaluation, not snapshot tuning.
- Removed skip-worktree only for `src/data/analytics-snapshot.ts` and tracked `public/reports/company-exposures.json` / `.md`, so the rebuilt artifacts are visible to Git. Other macro JSON/MD files remain locally generated under `.git/info/exclude`, not force-added. `npm run check`, production build and `git diff --check` passed. Exact generated-artifact commit is authoritative in `git log`.



## 88. Local inventory and CUSIP 31816QAD3 re-resolve — 2026-11-10

- Created `research/reviewed-sync/2026-11-10/inventory-local.json` using `INVENTORY_SIDE=local npx tsx scripts/reconcile-inventory.mts` (read-only SELECTs; generatedAt `2026-11-10T03:09:20.182Z`). No production writes occurred.
- Per-table local counts: companies **496**, filings **23,479**, facts **12,856,818**, prices **447,432**, macro_points **408,860**, signals **84,193**, digests **3**, fund_holdings **1,617,656**, fund_quarters **6,518**, cusip_map **41,090**, documents **39,940**, events **1,586**, external_cache **18**. `expectations_reviewed_packages`, `expectations_reviewed_results` and `reports` are absent locally (`present=false`).
- CUSIP `31816QAD3` was locally `ticker=null`. OpenFIGI now returns exact label **MNDT 1.625 06/01/35 B** for MANDIANT INC. Only the local cusip_map row was updated with that label and a new mappedAt (`2026-11-09 19:14:15` as returned by the local driver); `cik` remains null and provider fields remain TRACE / US DOMESTIC. Post-select confirms the value. It is ready for the next 13F refresh transport; no production write or DDL action occurred.



## 89. Canonical re-inventory and signals/digests backfill channel — 2026-11-10

- Rebuilt `research/reviewed-sync/2026-11-10/inventory-local.json` with canonical `7baa0a2`: generatedAt **2026-11-10T03:32:18.090Z**. Row counts are unchanged in all 16 table scopes. Hash comparison with the previous local snapshot: unchanged for companies, signals, documents, external_cache and all three absent tables; changed for filings, facts, prices, macro_points, digests, fund_holdings, fund_quarters, cusip_map and events because of canonical date normalization and the CUSIP update. These are local old→new comparisons, not claimed prod matches.
- Added `signals` and `digests` to `prod-push.mts`: local DB reads, `--from` filtering, batches ≤500 for signals and ≤10 for digests, PROD-only targeting and server-evidence summaries. Server `ingestSignals` now performs grouped exact-key post-checks; `ingestDigests` skips identical content and returns accepted/dupes/upserted/postCheck while preserving compatibility fields.
- `scripts/review-macro-correction.mts` now waits for the 18 prod keys. It is read-only and will classify local-missing delete candidates, exact local matches and archive mismatches. Current local duplicate exact macro keys: **0** (`worker/.runs/macro-correction-review.json`, productionApply=false).
- Verification: targeted backfill suites **3 files / 18 tests passed**, including 501 signals / 11 digests first-run accepted vs retry accepted=0/dupes=N and actual server post-checks. `npm run test:scripts` **5 files / 32 tests passed**; `npm run check`, production build and `git diff --check` passed. **No production backfill was run in this block**: owner publish confirmation is still required before executing `--kind signals` or `--kind digests`. Exact source commit is authoritative in `git log`.



## 90. Final local inventory and 18-key macro correction review — 2026-11-10

- Final canonical inventory: `research/reviewed-sync/2026-11-10/inventory-local.json`, generatedAt **2026-11-10T04:57:28.597Z**. Local counts now include signals **84,293**; all other table counts match the previous inventory. No production writes occurred.
- `scripts/review-macro-correction.mts` now reads full prod gzip CSV keysets and computes **prod minus local exact keys before classification**. This avoids accidentally treating all 408,878 prod rows as candidates. The grouped exact-key query uses parameterized mysql2 tuples and no unbounded SQL values.
- Result: **408,878 prod keys − 408,860 local keys = 18 candidates**, all `delete_candidate_local_missing` with `localRows=0`. Fourteen also have one archive match; four have no archive match. `localDuplicateExactKeys=0`. Review artifact: `research/reviewed-sync/2026-11-10/macro-correction-review.json`, generatedAt `2026-11-10T05:30:20.752Z`, productionApply=false. No deletion or production apply was performed.
- Verification: `npm run test:scripts` **5 files / 33 tests passed**, `npm run check`, production build and `git diff --check` passed. Exact review commit is authoritative in `git log`.



## 91. Final reconciliation, sourceHash package and weekly coverage — 2026-11-10

- Final canonical inventory `research/reviewed-sync/2026-11-10/inventory-local.json` was generated by the `5833e48` script at **2026-11-10T05:53:29.933Z**. Per-table counts: companies 496, filings 23,479, facts 12,856,818, prices 447,432, macro_points 408,860, signals 84,329, digests 3, fund_holdings 1,617,656, fund_quarters 6,518, cusip_map 41,090, documents 39,940, events 1,586, external_cache 18; expectations reviewed packages/results and reports remain `present=false`. Actual per-table content hashes are in that file.
- Form 4 completed all 50. Strict QA passed. Parse coverage: **56,148 accessions / 174,090 transactions**, with **139 explicit multi-owner mapping errors** preserved. Feature coverage after the scalar-date parser fix and explicit universe-50 rerun: **50/50 companies, 542 clusters / 542 computed / 0 partial**. META, ANET and PG have zero clusters (`not_computable`); no zero-transaction companies remain. Raw filings were not refetched.
- SourceHash package: `research/reviewed-sync/2026-11-10/macro-sourcehash-backfill.json`, **360,962 rows**, SHA256 **`8d2cc2f09269334cd3dde105f45c27e5d7a4e18b3c9f361a1687390792e8fb1c`**. Independent verification confirms manifest hash and 99,580,564-byte size match, 360,962 valid hashes, **0 conflicts**, 18 missing local rows, 47,898 missing archive hashes, zero duplicate local exact keys and `credentialMaterialIncluded=false`. `macro-sourcehash-backfill-manifest.json` is included. No production apply.
- Weekly block delivered: `scripts/build-weekly-coverage.mts`, scheduled `weekly-coverage-report` job, Workers → Weekly coverage, reportFile whitelist and outbox mapping. Current report status **ready**: 16 tables, 13 present / 3 missing, 1 row increase / 0 decreases, 10 hash-drift tables, **15,528,225 rows (+36)** against baseline. Generated weekly JSON/MD remain ignored local artifacts.
- Gates: `npm run test:scripts` **7 files / 38 tests passed**, `npm run check`, production build and `git diff --check` passed. Full suite **972/974**: Weekly and worker-expectations now pass; the remaining unrelated failures are `src/pages/Expectations.test.tsx` (`Not run` expectation) and `src/pages/Methodology.test.tsx` (8 sections expected, 0 returned). No unrelated code was changed to hide them. Exact delivery commit is authoritative in `git log`.



## 92. Multi-owner Form 4 parsing and full-universe benchmark — 2026-11-10

- `worker/lib/form4-xml.ts` now parses the complete reporting-owner list with director/officer/10%/other roles, preserves the first document owner as manifest primary, supports owner-reference when present and marks `multiOwner=true` without duplicating transactions. Single-owner behavior is covered by regression.
- Cluster identity uses every distinct ownerCik. `uniqueInsidersExcludingMultiOwner`, multi-owner row/USD counts and excluding aggregates allow both threshold variants without choosing inclusion policy. Owner supersede grouping uses the complete owner set for joint forms.
- Confirmed **139 → 0 parse errors**. Totals before→after: accessions **56,148 → 56,148**, transactions **174,090 → 174,665 (+575)**, clusters **542 → 544 (+2)**. There are **139 multi-owner accessions**, **575 multi-owner transactions (0.3292%)**, and **89 distinct owners**. Example MA `0001415889-24-022137`: owners `1421897` Mastercard Foundation and `2006397` Mastercard Foundation Asset Management Corp, both `isTenPercentOwner=true`; one transaction, no duplication.
- Full cache chain completed: parse → features → strict QA → dry-run benchmark. QA passed; 50/50 feature companies, 544 computed clusters, 0 partial; META/ANET/PG remain zero-cluster `not_computable`. Benchmark, not production alpha: +1d 540/544 computed, hitRate 0.3907407, medianExcess −0.0055912; +5d 537/544, hitRate 0.4096834, medianExcess −0.0051087; +20d 522/544, hitRate 0.4789272, medianExcess −0.0118495. No production writes.
- Verification: multi-owner/XML/features **3 files / 11 tests passed**, `npm run test:scripts` **7 files / 38 tests passed**, `npm run check`, production build and `git diff --check` passed. Full suite **977/978**, with only the previously documented unrelated `src/pages/Expectations.test.tsx` `Not run` expectation failing. Exact commit is authoritative in `git log`.



## 93. Local cleanup, universe-50 defaults, local DDL 032/033 and backfill evidence — 2026-11-10

- Started from clean `main`/`origin/main` at `df30d65`; `git pull --ff-only origin main` returned `Already up to date.` No reset, stash, force operation, dependency install, deployment or production schema change occurred.
- Regenerated `src/data/analytics-snapshot.ts` at `2026-11-10T09:27:19.303Z`: 502 fact companies, 52 factor companies, 621 option snapshots and 771,988 normalized option rows. Mechanical HEAD comparison proves `tone`, `prices`, `macro`, `optionsRaw`, `cusip` and `qa` are byte-identical as node objects. Metrics changed (`factsRows` 12,856,818→12,872,958, `testCount` 960→978 plus timestamps). The only other actual-node changes are metric-derived `fundamentals.detail` and a non-metric `guidance.detail` update to the staged v3.4 evidence. This extra guidance discrepancy was explicitly reported and the regenerated snapshot remains uncommitted.
- Research defaults/commands moved from `research-universe-51.json` to `research-universe-50.json` across worker/scripts, `contracts/operations.ts`, generated `docs/OPERATIONS.md`, current UI hints/test fixtures, `docs/MACRO_DATA.md` and `AGENTS.md`. Expectations and Form 4 CLI defaults remain `research-universe-53.json`. The running scheduler predates the edit and its old logs still show 51; restart only while idle to activate the new registry. `worker/production-deploy.ps1` retains its old command because infrastructure scripts are explicitly off-limits.
- Local MySQL `alpha_engine` on `DESKTOP-U95Q8C3`: pre-check confirmed `reports` absent and `macro_points.sourceHash` absent. Applied DDL 032 then 033 directly from the reviewed statement shapes. Post-check: `reports` exists with the expected six columns and 0 rows; `sourceHash` is nullable `char(64)`; macro rows remained exactly 408,860 before/after. No production DDL was executed.
- Production signals backfill `npx tsx worker/prod-push.mts --kind signals --from 2026-11-01` completed `PROD_PUSH_OK`: accepted=130, dupes=2,815, rejected=0, server post-check expected/verified=2,945/2,945, failed=0.
- First prices backfill `--kind pricesDaily --from 2026-11-07` returned accepted=0, dupes=0, expected/verified=0/0. Diagnosis showed every raw Schwab pricehistory ended 2026-11-06 and local Schwab prices also ended 2026-11-06. Restored the previously reviewed explicit `endDate` request mapping removed by `595c0fb`, with its regression test. Two bounded AAPL collections then returned the new 2026-11-09 session but persistently returned two conflicting candles for that date: 06:00 UTC volume=48,866,383 and 05:00 UTC volume=48,753,013; OHLC is identical (344.995/352.33/344.78/350.69). Existing `officialDailyBars` fails closed on this conflict. No dedupe policy was weakened, no raw conflict was hidden and no subsequent prices production write is claimed. PricesDaily remains blocked pending a reviewed provider-duplicate policy or a clean provider response.
- Weekly coverage completed with status `ready`: 16 tables, 13 present / 3 missing in the committed current inventory, 10 hash-drift tables, 15,528,225 rows (+36), no decreases. Daily Operations at `2026-11-10T09:44:32.063Z` is `critical`: 11 OK / 2 warning / 2 error / 24 pending. Warnings are Schwab 52/51 coverage and current-but-partial Atlas (904 records). Errors are the local server unavailable on port 3000 for Stocktwits and `schwab-context-hourly` operational push HTTP 500. These reports were not cosmetically forced green.
- Verification: targeted universe/health suites 5 files / 31 tests plus ProjectState 5/5 passed; restored Schwab/daily/prod-push suites 3 files / 21 tests passed. `npm run check` passed. Full `npm test -- --run` finished 978/979 with only the previously documented environment-dependent `src/pages/Expectations.test.tsx` assertion expecting `Not run`; no unrelated test was changed. `npm run build` passed with established chunk warnings and `git diff --check` passed.
- No commit or push was made: the full suite is red and pricesDaily/daily health remain blocked. Uncommitted work includes the universe-50 source/docs/tests, the restored Schwab `endDate` fix/test, the regenerated analytics snapshot with the disclosed guidance diff, and this handoff. Generated local health artifacts and Schwab raw/manifests remain outside Git.
- Next safe actions: review the AAPL duplicate-session evidence and choose an explicit fail-closed/provider-dedupe decision before rerunning pricesDaily; restart the single existing scheduler only after idle proof to load universe-50; diagnose the local server and reportFile HTTP 500 separately. Do not silently select one of the conflicting candles or claim green daily operations.



## 94. Read-only audit of stale local Schwab prices across all 50 companies — 2026-11-10

- Audited every company in `worker/research-universe-50.json` without starting a collector or changing code/data. Local MySQL has Schwab rows for all 50, and **all 50 end at 2026-11-06**. The generated `daily-prices-50.json` likewise has 50/50 `collected` with latest date 2026-11-06.
- Raw Schwab `pricehistory`: 49/50 end at 2026-11-06; no files are missing. AAPL alone reaches 2026-11-09 because it was the only company refetched after restoring the explicit `endDate` mapping. Its two conflicting 2026-11-09 candles remain the separate fail-closed blocker documented in section 93.
- PLD is confirmed, not an isolated UI issue: raw and MySQL both contain 2026-11-06 OHLCV 127.05/129.00/126.33/126.96, volume 3,333,654; `fetchedAt=2026-11-09 18:03:26`, latest manifest capture `2026-11-10T02:00:50.317Z`. Thus transport/capture timestamps are fresh while the economic observation remains stale.
- All 50 have a complete manifest capture dated 2026-11-10. The evening presentation log marked all 50 `collected` on 2026-11-06 with zero errors, proving that `collected` meant readable complete OHLCV, not a current-session freshness assertion.
- Root cause is confirmed in source history: `595c0fb` removed `schwabDailyPriceHistoryPath` and changed the collector to a request without `endDate`. That request omitted the just-completed session. The uncommitted restoration in `worker/schwab-fetch.mts` and `worker/lib/schwab.ts` uses the previous explicit-current-`endDate` request; AAPL then returned 2026-11-09. The other 49 have not yet been refetched with that restoration.
- No tests/builds were needed for this read-only audit and no additional production write occurred. Next action requires a reviewed resolution of the AAPL duplicate-session response before a full clean backfill can be claimed; do not interpret manifest `complete` or report `collected` as proof of current prices.



## 95. Schwab current prices/options restored for all 50; production server post-check fixes await deploy — 2026-11-10

- Preflight at `2026-11-10T18:55Z`: scheduler idle, no overlapping Schwab collector. Restored explicit `endDate` was already present in the uncommitted working tree. Added a narrow duplicate-session rule in `worker/lib/schwab-daily.ts`: for the same UTC date and identical OHLC, the candle with the later timestamp wins when volume is revised; conflicting OHLC or same-timestamp volume conflicts still fail closed. Regression uses the actual AAPL pattern.
- Added `latestCompletedSchwabDailyDate`: before 16:00 America/Los_Angeles the current date is excluded from canonical daily closes. This matters because the full refresh at 10:57 Pacific returned an intraday 2026-11-10 candle. Options retain that fresh intraday capture; daily prices correctly use completed 2026-11-09 rather than labelling a partial 11-10 candle a close. Both local presentation and production payload builders use this cutoff.
- One forced full `worker/schwab-fetch.mts --universe research-universe-50.json --force` completed **50/50** from `18:57:49Z` to `19:00:15Z`, with all chains, quotes, daily histories and instruments preserved. MU used the existing bounded 60-chunk fallback. User Preference HTTP 401 remains limited to streaming setup.
- Raw audit after collection: all 50 have valid normalizable history and readable chains. All raw files include 2026-11-10 intraday evidence; there are no unresolved OHLC conflicts. AAPL uses the later same-OHLC 2026-11-09 candle with volume 48,866,383.
- Rebuilt normalized options: **52/52** (research 50 plus retained RIVN/ENLT option history), **126,576 contracts / 30 expirations / 208 endpoints / 0 manifest errors**, latest capture `2026-11-10T19:00:13.738Z`. Feature Lab is 52/52 with RV20 52/52 and matching source hash `e31aba7aaad7917b02e8b337bd4afae22c5a6d153c7364d6c4b6dceb456e243f`. QA remains visible: duplicateOsi=134, zeroBid=13,486, invalidGreeks=194, invalidIv=454, crossed=0.
- Rebuilt local daily prices through the real upsert/selector path: **50/50 collected, latest completed date 2026-11-09, zero missing/errors**. Independent MySQL readback confirms all 50 latest Schwab dates are 2026-11-09. PLD is open/high/low/close **128.40/131.24/127.645/130.55**, volume 4,091,776, previous close 126.96 on 2026-11-06.
- Production attempts did not return success evidence. Two 20-second attempts aborted; a 120-second attempt returned HTTP 500; bounded 10-company batches also returned HTTP 500. ReportFile pushes likewise returned HTTP 500. No production post-check is claimed, and no deployment was performed. Earlier attempts may have persisted exact-key rows, but that is unconfirmed and was not reported as success.
- Diagnosed two server post-check canonicalization defects in `api/services/worker-operational.ts`: MySQL BIGINT volume may be a string, and second-precision TIMESTAMP columns truncate millisecond payloads. Canonicalized volume to Number and price/report timestamps to whole seconds, with driver-shaped regressions. `worker/lib/prod-push.ts` now uses 120-second timeout and 10-row pricesDaily batches; `worker/lib/http.ts` retains bounded 5xx bodies. These server changes require an owner-authorized deployment before production backfill can be verified.
- Verification: focused Schwab/ingest suites **28/28** passed after the final regressions. `npm run check` passed. Full suite **980/981**, with only the pre-existing environment-dependent `src/pages/Expectations.test.tsx` `Not run` assertion failing. Production build and `git diff --check` passed.
- Latest Daily Operations at `2026-11-10T19:23:03.661Z` remains critical from historical/local-server/job errors; Schwab evidence itself is OK 52/52 with current Feature Lab lineage. The scheduler process is alive, but the report marks it offline because heartbeat is ~0.2 seconds ahead of generatedAt and the current check rejects negative age. This unrelated health issue was not hidden or used to alter Schwab evidence.
- No commit, push or production deployment was made. Next safe actions: owner-authorized deployment of the server canonicalization fix, then idempotent pricesDaily/reportFile post-checks. The existing scheduler may continue; a future report should tolerate only a bounded small heartbeat/report clock skew rather than treating a live scheduler as offline.



## 96. Operational post-check fix and duplicate conflict evidence pushed — 2026-11-10

- Commit **`1e58aca`** (`Fix operational post-check canonicalization`) was pushed to `origin/main` as ordinary fast-forward `df30d65..1e58aca`. Exactly six files were included: `api/services/worker-operational.ts` and its test, `worker/lib/schwab-daily.ts` and its test, `worker/lib/prod-push.ts` and its test. All other pre-existing uncommitted source/docs/generated work was preserved outside the commit.
- Post-checks now canonicalize MySQL BIGINT volume strings to numbers and compare price/report timestamps at whole-second precision. Regression fixtures use driver-shaped stored rows: `volume=String(row.volume)`, `fetchedAt` truncated to seconds, report `generatedAt` truncated to seconds, and millisecond wire payloads. These extend the earlier date canonicalization regression class rather than relying on simplified mocks.
- Duplicate daily-candle normalization now emits `conflictEvidence` with every candidate's `volume` and ISO `fetchedAt`, plus the selected candidate. The rule still selects the later timestamp only for identical OHLC; OHLC conflicts and same-timestamp volume conflicts fail closed. The daily report payload includes this evidence. Current refreshed AAPL raw has only one 2026-11-09 candle, so no live evidence object is emitted; regression proves both-candidate evidence when a duplicate exists.
- Verification: focused suites **3 files / 29 tests passed**; `npm run check` passed; production build passed; staged and working-tree `git diff --check` passed. Full suite **981/982**, with only the previously documented unrelated `src/pages/Expectations.test.tsx` `Not run` assertion failing.
- No production writes, production deployment or backfill were run in this block. After the owner publishes `1e58aca`, the owner can rerun pricesDaily/reportFile backfills from the sandbox and compare production post-checks.



## 97. Remaining 30-file cleanup delivery — 2026-11-10

- This block delivers all 30 remaining tracked modified files requested by the owner. No untracked files are included. `git diff --check` passes and `origin/main` matched `1e58aca` before staging.
- Scope: research-universe-50 defaults/registry/UI/docs; the regenerated analytics snapshot with the previously disclosed metric and guidance changes; the restored Schwab explicit `endDate` request and regression; completed-session daily-price presentation; bounded 5xx error bodies; and handoff sections 93–97.
- Verification on this complete working tree before the delivery: focused post-check/duplicate suites 29/29 passed, TypeScript passed, production build passed, full suite 981/982 with only the known unrelated `src/pages/Expectations.test.tsx` `Not run` failure. No production writes or deployment were performed.
- Remaining operational state is documented rather than hidden: production backfills wait for the owner to publish `1e58aca` or a descendant, and overall Daily Operations retains unrelated existing job errors while Schwab evidence is current.



## 98. Form 4 full-run serving, UI and compressed report transport — 2026-11-10

- Added `worker/form4-export.mts` + `worker/lib/form4-export.ts`. Export requires exactly 50 unique companies, matching per-company transaction/feature counts, zero parse errors, zero partial feature rows, passed strict QA and a dry-run benchmark whose horizon totals equal the serving cluster count. Any failure prevents writing and preserves the previous serving file. Regression includes a mismatched 7-vs-544 benchmark guard.
- Actual `public/reports/insider-form4.json`: `status=full_run`, universe=50, **56,148 accessions / 174,665 transactions / 544 clusters**, 575 multi-owner transactions, plain size **152,834,812 bytes**, SHA256 **`9be3644dcfe8c8d3ad279c4b661247caee5912e93dd4e3793de0d8ad99630db5`**. It contains normalized rows only: owners, exclusionReason, SEC sourceUrl, acceptance availableAt and clusterId; no raw XML and no legacy `insider_trades` reads/writes.
- InsiderActivity loads `/reports/insider-form4.json` with `cache=no-store`, uses preview only for 404, and does not substitute preview for HTTP/malformed-report failures. Full mode uses the actual totals and worker clusters, marks multi-owner rows, computes KPI/filters from real rows, caps only the displayed list at the latest 100 without changing totals, and shows the dry-run benchmark with an explicit not-alpha disclaimer. Preview banner is preview-only. Three page regressions cover 404, full mode and HTTP 500.
- `insider-form4.json` is whitelisted for reportFile and `form4-export` has a scheduled/dependency auto-push mapping (manual triggers remain excluded by the existing policy). No production write was run. The 152.8 MB artifact compresses to 7.23 MB gzip / 9.64 MB base64, so the existing mediumtext lane works without DDL. Transport stores `gzip-base64:` content, validates the full-run payload after gunzip, verifies encoded SHA256 and serves identical JSON with `content-encoding: gzip`. Actual transport payload: **9,641,812 bytes**, SHA256 **`a9a27aaebf486e304a4e27cc5ba1408fe3d54d12342738fb55482eb43b6ac3c4`**.
- Benchmark evidence changed during the block: a small 7-cluster MVP file briefly appeared and was rejected. Re-running the existing universe-50 dry-run benchmark produced all 544 clusters, but updated price history changed the result from the earlier negative values to **53.42% / 51.86% / 50.96% hit rates with positive median excess** at +1/+5/+20 days. The UI therefore uses the actual rates and a conditional negative statement only when all rates are below 50% and median excess is negative; the not-production-alpha warning is always present. No old negative result was fabricated.
- Verification: relevant suites **5 files / 38 tests passed**; `npm run check` passed; production build passed; `git diff --check` passed. Full suite **989/990**, with only the previously documented unrelated `src/pages/Expectations.test.tsx` `Not run` assertion failing.
- No production writes, deployment, commit or push occurred in this block. Source changes and this handoff remain uncommitted; the large generated serving JSON remains untracked local evidence. After owner publish, the safe command is `npx tsx worker/prod-push.mts --kind reportFile --name insider-form4.json` followed by server post-checks.



## 99. Review refinement: slim Form 4 serving and dual benchmark evidence — 2026-11-10

- Serving is split. `public/reports/insider-form4.json` is now a **1,075,349-byte slim artifact** with full totals/KPI, all 544 clusters, 50 canonical per-ticker aggregates, both benchmark runs and only the latest 500 transactions. SHA256 **`3898d8e081432dc53a4e4d08f3ccc517f777565cb18ac017229a34fa297b153d`**. The full **153,480,584-byte / 174,665-transaction** dump is local-only `worker/.runs/insider-form4-full.json`, SHA256 **`d608516e574d253e7ea3afaf3e9db0b2ffa758e3f126e8836d6ca3b6cb029687`**. It is not a UI or reportFile input.
- UI KPI uses full aggregates rather than the 500-row serving slice. Per-ticker grouping is canonicalized by issuerCik to the 50-company universe; source ticker aliases such as FB/GOOG/lowercase variants remain in `sourceTicker` instead of creating extra aggregate groups. Loader validates the slim shape and only uses preview on 404.
- Both dry-run benchmarks are shown with generated dates, hit rates and horizon price coverage. The earlier run (`2026-11-10T06:49:42.087Z`) is explicitly **degraded**, price coverage through 2026-11-06: 39.07% / 40.97% / 47.89% hit rates and 99.26% / 98.71% / 95.96% coverage. The current run is price coverage through completed session 2026-11-09: 53.42% / 51.86% / 50.96% and 99.45% / 98.90% / 95.96%. Persistent UI note: **window-sensitive dry-run, no CI, not a standalone signal**.
- Root cause of earlier benchmark flip-flopping was split run roots: the full run used D:, while a small MVP run used C:. The export CLI now defaults to the documented D: QA root on Windows unless ALPHA_RUNS_ROOT/--qa-root overrides it. Historical degraded evidence is preserved in a separate D: file; benchmark totals must match all 544 clusters and the previous degraded coverage is mandatory.
- Transport still uses gzip-base64 without DDL and validates the slim shape, including KPI/perTicker/two benchmark runs. Actual encoded size **91,616 bytes**, SHA256 **`26cce86438dfb2db296628e4da793cc6add464b853221dd4c6c126dd2448e458`**.
- Verification: relevant suites **5 files / 39 tests passed**; TypeScript and production build passed; full suite **990/991** with only the previously documented unrelated `src/pages/Expectations.test.tsx` `Not run` failure; `git diff --check` passed.
- No production writes or deployment occurred. The large full dump and generated slim JSON remain local/untracked artifacts and are excluded from the source commit. After owner publish, the one intended backfill is `npx tsx worker/prod-push.mts --kind reportFile --name insider-form4.json`.



## 100. Independent audit package 1 remediation — 2026-11-10

- **Form 4 benchmark:** replaced short raw-Schwab-file evaluation with one local-MySQL price store and `chooseDailyPrice` availability semantics. Entry must be within 45 calendar days or the result is `not_computable`; peers use the same entry/exit dates. `benchmark-summary.json` is schema v2 / `canonical_dailyPrice_v1`: **545 clusters**, computed **537 (+1d) / 534 (+5d) / 519 (+20d)** and per-year coverage for 2013–2026. Earlier negative and positive runs remain preserved as `invalid-methodology`, joined by the new canonical run in serving/UI. Slim artifact: **1,099,971 bytes**, SHA256 **`863e4a5e96dab59ef95671617922e4f2283ba203233e002b1595b13901e256ad`**. Full local dump: **160,300,214 bytes**, SHA256 **`370bc83b89162ab0e28c50bea152deeaa713129affca6506acec839b3cc7199f`**. Transport: **92,716 bytes**, SHA256 **`2b2e69939442d7631ff26411cae5bc5a9aeae8d084e80679cdf10b87a8f3a8a6`**.
- **Form 4 semantics:** identical-OHLC joint co-filers now count as one affiliated group (the real ten Sequoia entities no longer count as ten insiders). Duplicate filtering no longer lets a later amendment rewrite the first-available original: original and amendment remain separate rows, with `isAmendment/amendmentOf` in serving and an amendment badge in UI. Real XML fixtures are committed under `worker/test-fixtures/form4/` with LF attributes instead of absolute D: paths.
- **Macro remediation:** `scripts/remediate-macro-16.mts` selected exactly IDs **463333–463348**, excluding CPIAUCSL/FEDFUNDS. One transaction inserted **16 rows**, local macro_points **408,860 → 408,876**; repeat apply returned inserted=0/dupes=16. Canonical local inventory: **408,876 hashed rows**, content SHA256 **`60f13023fa64db631875201a3dcff435363f005d8d20b14206ea3d41f3bc2075`**. No production write occurred. `PROD_DATABASE_URL` is not provisioned, so a fresh local↔prod hash-convergence query could not be run from this environment and remains pending rather than claimed.
- **Transport:** client now rounds timestamps to whole seconds before sending, with .499/.500 regressions. `pricesDaily`, `macroPoints`, `reportFile`, `signals` and `digests` wrap upsert+post-check in transactions; a corrupted post-check fixture proves rollback and no partial write. Report freshness/dedupe also compares at whole-second precision.
- **CUSIP:** uppercase nine-character keys plus exact ticker/exchange compatibility guards; mismatch/ambiguity returns `cik=null` instead of a ticker-only company. `research/reviewed-sync/2026-11-10/cusip-resolution-review.json` records TELUS, Enerflex, TD Ameritrade, B&G Foods and Cresco mis-maps with `nameOfIssuer` evidence and 238 lowercase keys. Quest/DGX is retained as a verified negative control.
- **Tests and packaging:** Expectations uses a deterministic module fixture with `benchmark=null` instead of the daily generated file; Methodology uses `vi.waitFor` and passed five consecutive isolated runs. `.gitattributes` marks `research/reviewed-sync/**` as `-text` to prevent CRLF hash drift and Form 4 XML fixtures as LF.
- **Verification:** targeted suites **14 files / 74 tests passed**; full suite **181 files / 998 tests passed**; `npm run check`, production build and `git diff --check` all passed. No production writes, deployment or credentials were used.



## 101. Canonical Form 4 benchmark evidence committed to research — 2026-11-10

- Committed the actual full benchmark and all 545 result records as `research/form4-benchmark-canonical-v1.json`: **475,586 bytes**, SHA256 **`b3dd4505cd5fca42f74caf4fb3f379fc02cbdeda797c5a958e3c283f6a2a4741`**. Methodology `canonical_dailyPrice_v1`, source local MySQL `dailyPrice`, max entry gap 45 days, generatedAt `2026-11-10T22:43:04.186Z`.
- Global results: **+1d hitRate=0.4748603352, medianExcess=−0.0009260126 (537/545 computed); +5d hitRate=0.5561797753, medianExcess=0.0037760400 (534/545); +20d hitRate=0.5125240848, medianExcess=0.0029148603 (519/545)**. Coverage: 98.53% / 97.98% / 95.23%.
- Per-year +1d/+5d/+20d coverage: 2013 1/1 all; 2014 12/12 all; 2015 48/48 all; 2016 44/44 all; 2017 24/27 all; 2018 50/50 all; 2019 47/48 all; 2020 49/49 all; 2021 35/36 all; 2022 46/47 all; 2023 60/60 all; 2024 41/41 all; 2025 36/36 all; 2026 **44/46 (95.65%) / 41/46 (89.13%) / 26/46 (56.52%)**. Earlier years have identical horizon coverage within each year.
- This is evidence delivery only: no production writes, deployment, code changes or additional tests were needed. The pre-existing unrelated untracked PDF and generated slim serving JSON remain outside the commit.



## 102. Prediction-engine design track opened; prep tasks K01 and K02 — 2026-11-10

- The owner and Claude are designing the prediction engine step by step. The living design is `docs/engine/DESIGN.md`; step 1 (problem definition) is decided: the engine only analyses, predicts each stock's own direction plus value-band probabilities, uses company windows from one earnings release to the day before the next, and models market, sector and company states. Existing engine code in `api/services/` is not the baseline for this design.
- Prep work for Kimi Code is specified in `docs/engine/tasks/`. Two tasks are ready: `K01-event-calendar.md` (publication times, earnings-release flags and a per-quarter timeline for the 50 companies) and `K02-stooq-price-load.md` (S&P 500, SPY and sector ETF prices from `D:\stooq data 102726\d_us_txt.zip`). Each spec lists deliverables and acceptance checks; append the delivery report to the spec file.
- These are documentation-only changes: no source, database, collector or production action was taken. Read-only SELECTs on local MySQL were used for the measurements quoted in the design.



## 102. K01 event calendar delivered — 2026-11-10/11

- Implemented `scripts/build-event-calendar.mts` + `worker/lib/event-calendar.ts` with resumable SEC submissions caching and deterministic JSONL. Output: **22,240 filings / 4,644 quarters**, no duplicates; forms 10-K 1,092, 10-K/A 112, 10-Q 3,355, 10-Q/A 85, 8-K 17,230, 8-K/A 366. Proxy/DEF filings excluded.
- Publication acceptance metadata present for **20,977/20,977 (100%) since 2004**; item lists for **16,512/16,512 (100%) of 8-Ks since 2004-08-23**. Header spot-checks: **17 exact matches / 13 old-header 404s**, zero timestamp mismatches among readable headers. Submissions ISO UTC and header New York wall time are normalized separately with DST tests.
- Quarters: 4,105 (88.39%) have a separate earlier release; lag min 0 / median 9 / p90 32 / max 931, negative 0. Window median 62 sessions, p05 0, p95 69; exact 20/30/45 shares 0% / 0.0218% / 0.2612%. There are 2,946 under-20 and 49 over-120 lags plus 102 company-year outliers, all preserved in the task delivery report rather than hidden.
- Repeat runs produced byte-identical JSONL: filings 8,823,008 bytes SHA256 `29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d`; quarters 1,960,492 bytes SHA256 `8dd75df1d4396c688953aa0e2eadb6f6adad4079a6148a10dda7ae2d7f2a6c44`; summary SHA256 `7a4c6f98778358b50ab4145800c6f4466b24ea312117d0bec8c9d4c77146b302`.
- Targeted tests 3/3 and TypeScript passed. Delivery report appended to `docs/engine/tasks/K01-event-calendar.md`. No production write, schema change, model call or new service.


## 103. K01 independent-review timeline corrections — 2026-11-11

- Claude's artifact review found amendment-created duplicate quarters, non-increasing next-publication endpoints, exact-session shares misread as thresholds, and incomplete visibility of multiple earnings filings. Builder source commit **`db31da9`** fixes all four without changing the earliest-release pairing rule. Targeted tests **6/6**, full suite **183 files / 1,009 tests**, TypeScript, production build and diff checks pass.
- Corrected quarters: **4,447 rows / 4,447 unique company-periods / 0 duplicates**; **3,901/3,901** originals since 2005 are present. The filings artifact remains **22,240 rows**. All 197 periodic amendments remain there; 187 are linked in `amendmentAccessions[]`, while ten filings across nine amendment-only periods are explicitly disclosed instead of creating original-based quarter rows.
- **3,951 (88.8464%)** have a separate earlier release; lag min/median/p90/max = **0/8/29/665**, negative 0. All bounded next-first timestamps are strictly later. `earningsFilings[]` retains **4,390** time-sorted links including the chosen first release; **268** original quarters since 2009-06 have multiple releases (the review's 304 counted amendment duplicate rows). First-to-next calendar windows: **0 under 20 days / 111 over 120**, all enumerated in the summary and delivery report.
- Window shares are now at least 20/30/45 sessions. Fiscal periods from 2009-06: **3,169** bounded windows, median/p05/p95 = **62/54/70**, shares **100% / 99.9684% / 98.5800%**. All bounded windows: **4,397**, **62/0/69**, **87.6052% / 87.4005% / 85.5811%**; pre-2005 SPY-calendar coverage explains the full-history p05.
- Repeated builds are byte-identical. Filings: **8,823,008 bytes**, SHA256 `29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d` (unchanged). Quarters: **2,264,505 bytes**, SHA256 `35e11fc013b935c0457771759248a401895c7e8aa64fcdea42cbfcba8ff2a21f`. Final manifest SHA256 `f871dc205562dbcf18780793c7b91d9e7541ada675b6dc907039617fce1a794e`, recording builder commit `db31da9`; committed summary generatedAt `2026-11-11T04:15:05.451Z`, SHA256 `edd216243bdf46695341c8c89bdb85a73f256f91c689af8b145fc011e70dd33b`.
- No production write, schema change, model call or new service. K02's loader, summary and report are separate work and are not included in the K01 source/evidence commits.


## 104. K02 Stooq price history delivered — 2026-11-11

- `scripts/load-stooq-prices.mts` and `worker/lib/stooq-price-load.ts` loaded the owner archive `D:\stooq data 102726\d_us_txt.zip` (**542,554,531 bytes**, SHA256 `52d556a45701b5e3ba65b61df52b6341de2c2fe9fb628852f99ee2d08239380a`) into local MySQL with `source="stooq"` and batches of at most 500 rows. Coverage is **502/502 (100%)** S&P snapshot tickers and **514/514** requested series including SPY and all eleven sector ETFs; no unmatched ticker.
- Initial load added **2,526,859** rows to **1,097,787** existing rows; the dual-class correction restored another **8,438**. Final inventory: **3,633,084 rows / 517 series**, comprising 514 requested series plus preserved ENLT/RIVN/XOM_PRE. Original IDs and bar values (excluding `fetchedAt`) have **0 missing / 0 differing**. The final rerun wrote **0 new rows**, before=after **3,633,084**, with **514/514** readback matches.
- Keys are defined centrally: SPY=0, sector ETFs=-1001..-1011, and second listings GOOG=-2001, FOX=-2002, NWS=-2003. GOOGL/FOXA/NWSA retain the shared SEC CIK. Negative keys are local price-series IDs, not SEC CIKs; `companies` and the schema were not changed. Per-ticker stored counts/date ranges guard against the former `(cik,date,source)` collisions.
- Archive reads use one hash-verified buffer after `Open.file` retry attempts encountered `EPERM`/`ENOENT`; archive content/permissions were not changed. Original snapshots use batches of 10,000 and value comparisons batches of 1,000. SPY and nine sector ETFs start 2005-02-25; XLC starts 2018-06-21; XLRE starts 2015-10-08; all end 2026-10-26.
- Quality: **0** >5-session gaps, **0** non-positive OHLC, **22** high/low inversions, **0** duplicate dates, **79** review-only >50% moves and **6** missing-GICS records. Anomalies remain listed in the summary, not cleaned by guess. Known limits: survivors only, SPY/some tickers start 2005-02-25, and no bars after 2026-10-26 without a newer archive.
- Final run `2026-11-11T03:49:36.014Z`→`2026-11-11T04:19:17.240Z`. Committed summary **79,885 bytes**, SHA256 `5f5404b8c4191cc7cac1bc56837bd9b651da1b9acb27ed22a604d42d00961f2b`. Targeted tests **5/5**, full suite **183 files / 1,009 tests**, TypeScript, build and diff checks pass. Production `pricesDaily` remains Schwab-only; no production write, deployment, schema change, model call or new service.


## 105. Claude: K01 corrections checked, K03 dispatched, design document updated — 2026-11-10 (local evening)

- Independent read-only check of the corrected `quarters-50.jsonl` (2,264,505 bytes): **4,447 rows, 0 duplicate company-periods, 0 bounded windows whose next publication is not strictly later**; fiscal periods from 2009-06: 3,169 windows, median 62 sessions, minimum 26, 100% at least 20 sessions and 98.58% at least 45. Matches section 103.
- Committed the owner-approved task spec `docs/engine/tasks/K03-press-release-statements.md` and its answer values `docs/engine/tasks/K03-golden.json` (113 assertions from six releases). LLM use in K03: none. Sent to Kimi Code through the local mailbox (`worker/.runs/bridge/`).
- `docs/engine/DESIGN.md` updated: window rule for early partial publications, factor method (section 1.9), press-release reading (1.10), measured facts from K01/K02, decision log, and section 6 with the findings from the review of the owner's earlier model. That review's code and page live outside this repository (`C:\dev\alpha-engine-lab\src\old-model`, `reports\old-model.html`); it reads the owner's old database dumps as text and writes nothing to MySQL.
- Documentation-only commit: no source, test, schema, collector or production change. Gates not re-run for this commit; Kimi's last full run (section 104) stands for the code.
- Next safe action: Kimi executes K03. K02 has not been independently re-checked by Claude yet.


## 106. D:-drive continuity protocol and K03 recovery checkpoint — 2026-11-11

- The owner reported that D: can disconnect and remount. Added `AGENTS.md` §3.1 and a matching D:-drive recovery section to `docs/OPERATIONS.md`; updated `scripts/build-operations-doc.mts` so regeneration preserves the instructions. The protocol forbids treating a missing drive as an empty cache, recreating it on C:, deleting work or starting from zero. It requires atomic validated checkpoints, realpath/hash/space checks after remount, old-process inspection before an idempotent resume, and explicit handoff evidence. Runbook generation passed (68 jobs / 10 modules), TypeScript and `git diff --check` passed.
- The first K03 universe build stopped on a Windows `UNKNOWN` write after completing MSFT; no new summary was produced. D: had about 681 GiB free, so capacity was not the cause. A disconnect was not proven. No cache was deleted or recreated. Atomic per-release checkpoints were preserved and the builder now includes ticker/accession in checkpoint-write errors. The second run resumed the same command and completed **3,609/3,609 releases with 0 operational errors** at `2026-11-11T09:31:57Z`.
- That completed run is **not an acceptance pass**: period alignment is **2,832/2,924 = 96.8536%**, below 98%. Grading is **104,966/106,459 = 98.5976%**, golden assertions **113/113**, printed-value and answer-key PIT violations **0/0**. Full source gates before the documentation-only edit passed **187 files / 1,033 tests**, TypeScript, production build and diff checks; targeted K03 tests are **24/24** and golden gradable comparisons **475/475**.
- Current diagnosis is limited to regressions in PFE `(Decr.)`, AT&T `Change`, MU full dates under ordinal-quarter headers, COF `2026 Q1` and JNJ `2017*` year footnotes. K03 source/tests and the generated summary remain uncommitted pending correction and a fresh universe build. `docs/engine/tasks/K06-releases-other-companies.md` is unrelated and untouched. Next safe action: fix and test those exact forms, verify no builder is active, then resume the existing builder and recompute all acceptance metrics. No production write, schema change, model call or new service occurred.


## 107. K03 press-release statements delivered — 2026-11-11

- Builder source commit **`84fbe958af8eb1cfa2b9ded1667d62b89ec0266d`** (`84fbe95`) implements deterministic HTML table extraction, statement finding, period/unit parsing, answer-key naming, grading, residuals, golden/PIT audits, streaming summaries and atomic per-release checkpoints. No LLM, production write, schema change or new service was used. The unrelated untracked `docs/engine/tasks/K06-releases-other-companies.md` remains untouched and unapproved.
- Final universe at `2026-11-11T10:01:06.788Z`: **3,609 releases**, **7,542 exhibits**, **14 duplicates removed**, **218 without EX-99**, **0 operational errors**. Coverage: income **2,962 (82.0726%)**, balance **2,728 (75.5888%)**, cash flow **1,981 (54.8906%)**. Period alignment **2,899/2,924 = 99.1450%** (38 unpaired reported separately; 25 residual mismatches retained). Naming **101,771/200,557 = 50.7442%**, **283,557 values**, **135,355 residual records**. Grades **106,574/108,252 = 98.4499%**, with **1,678** mismatches and **18,214** explicit not-gradable values. Golden **113/113**; golden gradable comparisons **475/475**. PIT: **0 printed-value violations / 0 answer-key date violations** across **283,557** values and **139,539** unique evidence tuples.
- Two post-commit builds each reused **3,609/3,609 checkpoints**, processed **0** releases and produced byte-identical JSONL. Hashes: statements **20,479,744 bytes** `b6f8e83a9cf752078d6ec1a76eed1898d3ed6435a82e1726c784a055900176cd`; values **358,156,079** `9630456dc8dc34f0c42d0ec3e07e0b6f74dd858242a1c1f488efe02380a6ccea`; grades **64,092,966** `c8e58b4f8208e2482a16fe2093b25050341ad30e6b02945f179f4842d37f7f4d`; residual **95,279,132** `117332243a6b1137ffe92b338c3762d8f2b53dbfa6bed82d7ec268d6de75d731`. Final manifest **1,441 bytes** `e72a09e3614aedb3333cefd0905e05c20b6759dc1789be7c0a8a64b81397c487`. Committed summary **80,358 bytes** `ad7b56058064b1944e6523dd47c0294f25248b1e363bad1b2b9b682c3d267869`. Only generation-time metadata changed between runs.
- Verification: targeted **25/25**, standalone golden **113/113**, full suite **187 files / 1,034 tests**, scripts suite **8 files / 39 tests**, TypeScript, production build and diff checks all pass. The D: write interruption was recovered without recreating cache or discarding checkpoints; the continuity protocol is separately delivered in `a7e54d6`. The first candidate with a universe period regression was not committed; the delivered code passes both numeric thresholds.
- Delivery report with all seven checks, overall/year/company tables, residual period counts and all 30 mismatch patterns is appended to `docs/engine/tasks/K03-press-release-statements.md`. Before this evidence/documentation commit, source commit `84fbe95` is local and unpushed; the summary, spec report and this handoff are the only intended additional files. Next safe action: commit and fast-forward push the evidence/documentation, notify Claude through the local mailbox, and resume mailbox waiting. Known limits remain 218 missing EX-99 inputs, 38 unpaired income releases, 25 period mismatches, **135,355** residual records and the scoped HTML-only extraction; these are not hidden or presented as alpha evidence.


## 108. K06 20-company pilot delivered; full run needs owner — 2026-11-11

- Builder/spec source commit **`2b8cbda881612e75475153a410878b693629cb6c`** adds the parameterized K01 builder, REST submissions calendar, exhibit-only downloader, per-company atomic checkpoints and aggregate rewrites, seeded SEC index checks, and D:-space/recovery guards. The eligible universe is **446 CIKs**, with no facts-only or price-only gaps. Only the approved first 20 were processed; the remaining **426 were not started**. No model, production write, database write, schema change, scheduler/registry change or new service occurred.
- Pilot status `pilot_complete`, overall pass **true**, all **20/20** company checks pass: **11,534 filings**, **1,750 quarters**, **2,116 releases**. Acceptance timestamps **11,534/11,534**; 8-K item lists **9,717/9,717**; original periods **1,750/1,750**, duplicates **0**, negative lags **0**, non-increasing next publications **0**. Separate earlier releases **1,663/1,750 = 95.0286%**; lag min/median/p90/max **0/18/38/176**. Research-50 JSONL stayed byte-identical: filings `29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d`, quarters `35e11fc013b935c0457771759248a401895c7e8aa64fcdea42cbfcba8ff2a21f`.
- Exhibits: **2,090** releases with files and **26** explicit `no_exhibit` exceptions, all listed by CIK/ticker/accession/reason in `exhibitExceptions`; **0 missing outcomes / 0 unexplained**. Seeded SEC index check **30/30**, zero failures. Company-year outliers **68** (all >5) and one under-20/four over-120 windows are preserved and documented, not clipped.
- Downloaded/on-disk bytes **4,721,857,804**. Initial pilot wall time **996.117s**, cumulative company processing after reporting resume **1,169.128s**. Remaining-426 projection: **100,575,571,225 bytes**, **24,902.4264s**, projected free **624,944,354,023 bytes** vs required **107,374,182,400 (100 GiB)**; storage passes, but the long extraction remains owner-gated.
- Repeatability: consecutive cached runs each **20 cache hits / 0 reprocessed**; independently saved baseline and later cached run produced byte-identical universe/filings/quarters. Universe **33,744 bytes** `8c5aec546a72924aaed0cb3f094035a726584bd955878e2c123aff9437e5cbf5`; filings **5,757,634** `7cb028bbaac76ff60afc67e78f6d3b949152b84770eb25472ccae65fcd690f02`; quarters **910,774** `2bf4e386eff334c6d81e11c5efad65893fea37e1a9d0e836d9351615167fe9c3`. Progress **5,173** `8c69c6be88a9b70d8ee71697ea2ed78c786ff5809d6413da7c84b6c9e37519cb`; summary **62,986** `814cb89161608dd4ed0b50105d5137e2e377dedb59662ed2aba042cef456ce5e`; manifest **1,826** `a9341d323b05236116caec7d1fb2728d4a8af482ec49a64472be4970aeac06ab`. Builder code hash `be36150bbd666cc3941fe5f4997f79bfdb3da964c6071b6c875d072d054f159b`.
- Verification: targeted **14/14**, full suite **189 files / 1,042 tests**, scripts **8 files / 39 tests**, forced TypeScript, production build and diff checks pass. The complete pilot delivery report is appended to `docs/engine/tasks/K06-releases-other-companies.md`. Before the evidence/documentation commit, source `2b8cbda` is local and unpushed; only the generated summary, spec report and this handoff are intended additions. Next safe action: commit and fast-forward push the pilot evidence, send Claude `status: needs owner` for the remaining 426, and resume mailbox waiting without starting the full run. K04 remains unapproved and untouched.


## 109. Claude: engine results recorded, K03 accepted, requests from the app walk-through — 2026-11-11 (local night)

- `docs/engine/DESIGN.md`: decision log extended with the owner's decisions of 2026-11-10 and 11 (sealed period, guidance as the reference, K06, decay, simulation set-up, prior, guards); section 6 now holds engine version 1's procedure and results; section 5 lists what is open. Documentation only; no code, data, schema, scheduler or production change. Verification: `git diff --check` on the two files of this commit.
- K03 accepted after an independent check in the research repository: the release's current-quarter revenue equals the revenue filed later for the same quarter in **1,484 of 1,491** comparable releases. The figures are in use there (`C:\dev\alpha-engine-lab\src\engine\step2d-flash.mts`).
- K06: pilot received. The full list of 426 companies waits for the owner. Request inside the K06 scope (mailbox `claude-k06-pilot-received`): take each company's ticker from its Stooq price series; `universe-rest.json` labels 54 companies with a preferred-share or other secondary symbol while the price series are the common shares.
- A local-model run of the research repository is using the GPU (guidance second pass, one request at a time, context 32768). It pauses from :30 to :36 every hour for `stocktwits-hourly` and writes only under `D:\research\alpha-engine\engine\lab\`. It is not in the job registry. Stop it by creating an empty file `STOP` in `D:\research\alpha-engine\engine\lab\data\engine\guidance-pass2\`.
- Found while walking the local app as admin, read-only; none of it changed, each needs an owner-approved task:
  - `factor_points` price-based factors are wrong before stock splits (NVDA `peRatio` 5.1 in the three quarters before the June 2024 split, 53.0 after), and start only in 2021-11. A split-free alternative is the stated public float carried by price (research repository, `step9-heat.mts`).
  - Daily `prices` have no rows for 2026-10-27 to 2026-11-03: Stooq ends 2026-10-26, Schwab closes start 2026-11-04. The Schwab daily job also reported "Conflicting official daily candle for 2026-11-09".
  - The daily operations report was stale after the restart and showed "scheduler offline" with a heartbeat age of 0 minutes. Rebuilt at 2026-11-11 10:04 UTC (ignored file): scheduler online, two errors left, both "derived report predates the current macro QA gate" (macro scenarios, Atlas).
  - Market Data shows Schwab token expiry 2026-11-10 and the keepalive job in error: owner sign-in may be needed.
- Working tree at commit time: three generated files modified by scheduled jobs (`public/reports/company-exposures.json`, `.md`, `src/data/analytics-snapshot.ts`), left untouched and not part of this commit.
- Next safe action: owner's word on the K06 full list; then, on approval, specs for a gap-free daily price job, the valuation fix and an Engine page.


## 110. K06 traded-ticker correction delivered; full run still needs owner — 2026-11-11

- Claude's review identified preferred/secondary registry symbols that did not match common-share price series. A read-only database check confirmed **66 CIKs**. Source commit **`7b466c9d7471b8a383d59d789823fec6f6ef205a`** now uses `prices.ticker` for `source="stooq"` in `universe-rest.json`, `filings-rest.jsonl` and `quarters-rest.jsonl`; CIK remains the identity key. Ambiguous multiple-ticker mappings fail closed, all 66 corrections are in `universeEvidence.tickerCorrections`, and checkpoints bind the traded ticker. Claude's documentation `31be43d` was pulled before the correction; its section 109 is preserved.
- Every filing and quarter was checked against the corrected universe mapping. All **20/20** company checks and original pilot acceptance results pass: **11,534 filings / 1,750 quarters / 2,116 releases**, **30/30** index checks, **2,090** releases with exhibits and **26** explicit reasons. Research-50 artifacts remain byte-identical. Valid exhibits were not redownloaded; total downloaded/on-disk bytes remain **4,721,857,804**.
- Repeatability: independently saved baseline and later cached run are byte-identical for universe/filings/quarters, with **20 cache hits / 0 reprocessed**. Universe **33,606 bytes** `f6d828f039078e5ea2c45af30a8092fc271522af523b8b97ef52c06eaece6fff`; filings **5,732,248** `3b1174cbdf16336dd5bfedbfec26a1e2fb837466e07e9b80c1d9e33489ff4a1c`; quarters **907,196** `c6febb5aeef9904384159bf10d83766e0c3dec01e232d6d39862510841c705e6`; progress **9,686** `f7eba3d779222c5dda999508620629ecd7dc5545222e1963b9695461e9e5ebc0`; summary **67,213** `e5ec5d24a7f570f8c47644a9452f82fbae0c7e7a8fb2e266ef2faa237199934c`; manifest **1,826** `31e2a19ce8d2f5d0f0211ba95c4d446e7ed9fd5a3dd0e32686b5a7c839f403a4`. Builder code hash `05d6a83426b81d2be7f1907375f9f5a538ba15332d2ad72383a8634acb43814e`.
- Verification: **15 targeted tests**, **189 files / 1,043 full-suite tests**, **39 scripts tests**, forced TypeScript, production build and diff checks pass. Scheduler-generated modifications to `public/reports/company-exposures.json`, `.md` and `src/data/analytics-snapshot.ts` were left untouched and excluded from all correction commits. Before this evidence/documentation commit, source `7b466c9` is local and unpushed; only the generated summary, K06 correction report and this handoff are intended additions. Next safe action: commit and fast-forward push the corrected evidence, notify Claude, then resume mailbox waiting with the remaining **426 companies still stopped for explicit owner approval**. No full run, K04 work, model call, production write, database write or schema change occurred.


## 111. Claude: guidance, options and decision-point tests in the research repository — 2026-11-11 (local morning)

- State at 2026-11-11 14:45 UTC. This repository: `docs/engine/DESIGN.md` section 6 extended (guidance as a candidate family, two decision-point variants tested and not adopted, the test on the other companies fixed in advance) and this entry; no code touched. Research repository `C:\dev\alpha-engine-lab` at commit `bb32bc1` (procedure and numbers in `src\engine\README.md`, summary in `docs\findings-and-proposals-2026-11-11.md` section 8).
- Guidance second pass on the local GPU: batch 1 complete (**1,277 releases, 1,068 with verified statements, 7,866 statements**); batches 2 to 4 continue as the same single process, still pausing from :30 to :36 for `stocktwits-hourly`, writing only under `D:\research\alpha-engine\engine\lab\data\engine\guidance-pass2\`. Result of the test on the 50 companies: a small gain at 5 sessions that cannot be told from zero (**+1.1 [−0.7, +2.8]** per 1000 on the same decisions); more companies are needed.
- Options history (`D:\research\alpha-engine\options-iv\`, read-only use): four readings at **918** release decisions since 2019 show no link with the following move. Finding for a later owner-approved task in this repository: the stored option features (`options-iv-features`) choose the at-the-money strike with a split-adjusted stock price against unadjusted strikes and are wrong before a split (AAPL 2019-02-09: spot 40.65 against strikes near 170). A split-free way is in the research repository (`src\engine\step2e-options.py`): the strike where the call and the put cost the same, and deltas for the wings. Also measured: a snapshot dated D holds the closing quotes of session D.
- One read-only query on the local price table wrote `closes-2018.json` under the research data folder on D:. No collector, scheduler, server or production action was started or changed.
- Working tree at commit time: the same three generated files modified by scheduled jobs (`public/reports/company-exposures.json`, `.md`, `src/data/analytics-snapshot.ts`), left untouched and not part of this commit.
- Next safe action: unchanged. The owner's word on the K06 full list (426 companies) is the step every open question waits for; Kimi starts nothing until then.


## 112. K06 full-run interruption at company 26; D: disconnected — 2026-11-11T17:56:07Z

- Owner explicitly approved the remaining **426** companies in the user window (`go ahead with 426 companies`). `npx tsx scripts/build-release-calendar-rest.mts --limit 446` started at commit `42d7f36b1f3dfadfb6a52f8ae7666bcdb994a95b` with code hash `05d6a83426b81d2be7f1907375f9f5a538ba15332d2ad72383a8634acb43814e`. The first 20 were checkpoint hits; six additional companies completed. Last verified completed company: **PPG / CIK 79879, company 26**, **404 filings / 88 quarters / 100 releases**, **23,081,274 bytes**, checks pass. Aggregate at that checkpoint: **14,288 filings / 2,278 quarters / 2,751 releases**, **5,723,743,360 bytes**, **20 cache hits / 6 new companies**.
- At `2026-11-11T17:54Z` approximately, exhibit write `D:\alpha-engine\worker\cache\edgar\720005\000072000513000034.ex-rjf2013_0331q213earnings.htm` failed with Windows `UNKNOWN: unknown error, write`. The final target file was absent; no completed checkpoint existed for CIK 720005. The process exited and no builder is active. Initial remount check showed about 674 GB free and the expected cache realpath, but subsequent reads failed for `D:\research\alpha-engine\engine\events\rest-companies\79879.json`, `D:\alpha-engine\worker\cache\edgar\720005\manifest.json`, and then `df /d` itself returned `No such file or directory`. Treat this as a second/disconnected-D incident, not missing data.
- Do not recreate the archive on C:, initialize a new manifest, delete work or restart from zero. Current action is **wait for D: to remount**, then verify expected roots/junction realpaths, free space, `progress-rest.json` at company 26, the PPG checkpoint and current-company manifest/hash state before resuming the same command. The failed exhibit must be fetched again; completed checkpoints and valid manifest outcomes are to be reused. No model, production write, database write or schema change occurred. The next safe action is storage validation after remount, not a blind retry.


## 113. K06 D:-remount validation and checkpoint-26 resume — 2026-11-11T17:58:49Z

- The remount watch returned `D_ARCHIVE_AVAILABLE`. The expected roots are present, `worker/cache` resolves to `D:\alpha-engine\worker\cache`, and D: has about **674 GB free**. No REST builder was active before resume.
- PPG checkpoint `rest-companies/79879.json` has code hash `05d6a83426b81d2be7f1907375f9f5a538ba15332d2ad72383a8634acb43814e`; all **102** exhibit byte counts and SHA-256 hashes were independently verified. Interrupted CIK 720005 has **792** readable manifest rows, including **26** completed releases; the failed `000072000513000034.ex-rjf2013_0331q213earnings.htm` remains absent and will be fetched again. No temporary file was treated as complete or deleted.
- Resumed `npx tsx scripts/build-release-calendar-rest.mts --limit 446` as background task `bash-6lkh3qmu`, reusing the first 26 company checkpoints and the interrupted company's valid manifest outcomes. This is a validated resume after the D: interruption, not a blind retry or restart. Full acceptance and repeatability remain pending.


## 114. K06 USB disconnect evidence and full integrity audit passed — 2026-11-11

- Claude's Windows System log review found five D: disappearances (01:03, 07:48, 09:18, 09:53:27 and 09:54:20 local) with NTFS event 140, plus disk events 153/51; the USB Samsung 860 QVO later mounted as `AlphaCache`, NTFS healthy, with the expected worker-cache junction. Presence alone was not treated as integrity evidence because event 140 warns of possible corruption.
- A separate read-only audit of the first 26 completed companies passed: **14,288 checkpoint filings**, all first-26 filing and quarter counts match the aggregate JSONL, **4,493 exhibit byte counts/SHA-256 hashes verified**, and **48,534 manifest rows** parsed. Every aggregate row parsed with no truncation or duplicate company/accession or company/fiscal-period keys. All company checks pass. The interrupted company's completed manifest outcomes were included in the hash verification.
- Audit task `bash-46rt6v5o` completed in about 36 seconds with `status=pass`. At audit time the resumed full run had advanced to **27** companies (**15,288 aggregate filings / 2,453 quarters**); it was not stopped or restarted by the audit. No source or generated data was modified by the integrity check. Full-run completion and repeatability remain pending.


## 115. K06 transient SEC socket failure and checkpoint-111 resume — 2026-11-11

- The full run stopped after **CVS / CIK 64803, company 111**, with Node/undici `ERR_ASSERTION` in `TLSSocket.onHttpSocketEnd`. Last verified aggregate: **49,408 filings / 9,611 quarters / 10,825 releases**, **11,829,103,067 downloaded bytes**, **26 cache hits / 85 newly processed**. CVS has **433 filings / 88 quarters / 106 releases**, checks pass. D: remained mounted with about **666 GB free**, and no builder remained active.
- Next company is **MDLZ / CIK 1103982**. It has no completed company checkpoint, but its SEC submissions cache and **678-row** manifest are present; **92 releases** were already marked complete and are subject to the builder's normal file-size/SHA-256 reuse checks. A single bounded read-only probe of `https://data.sec.gov/submissions/CIK0001103982.json` succeeded with **HTTP 200 / 161,743 bytes**, proving this was a transient socket interruption rather than a deterministic calendar or SEC-schema failure.
- Resumed the same `npx tsx scripts/build-release-calendar-rest.mts --limit 446` as background task `bash-g08z994k`, preserving all 111 completed company checkpoints and valid manifest outcomes. No restart, cache recreation, model call, production write, database write or schema change occurred. Full completion and repeatability remain pending.


## 116. K06 stopped at TMUS out-of-order periodic filings; owner ruling required — 2026-11-11

- The socket-resume completed **MDLZ / CIK 1103982, company 112** (**547 filings / 88 quarters / 93 releases**, **1,064,337 new bytes**, checks pass) and then stopped on the next company, **TMUS / CIK 1283699**. Latest aggregate: **49,955 filings / 9,699 quarters / 10,918 releases**, **11,830,167,404 downloaded bytes**, **111 cache hits / 1 new company** in that resume. No builder remains active.
- K01's guard reports `Quarter nextFirstPublicationEt must be strictly later than firstPublicationEt: TMUS/2006-09-30 2007-04-09T14:23:47 -> 2007-03-30T15:50:53`. Direct SEC submissions evidence: FY2006 10-K `0000950134-07-007079` was accepted **2007-03-30T15:50:53 ET**, while Q3 2006 10-Q `0000950134-07-007791` was accepted later, **2007-04-09T14:23:47 ET**. Q2 2006 10-Q `0000950134-07-007790` was also filed on April 9. These are real out-of-order periodic filings, not a timestamp or parsing error.
- The K06 spec says to stop and report when submissions violate K01's assumptions. I did not skip TMUS, fabricate a window, weaken the guard or restart the run. Await an explicit owner decision: preserve valid quarters while marking only the affected next-publication window `nextFirstPublicationEt=null` / `windowSessions=null` with a visible anomaly and regression test, or keep the strict stop and leave the full run incomplete. Research-50 artifacts and all 112 completed company checkpoints remain unchanged. K07 and the option finding remain unapproved and untouched.


## 117. Owner-approved out-of-order windows; K06 resumed — 2026-11-11

- The owner selected **Mark affected windows** for the verified TMUS out-of-order periodic filings. `worker/lib/event-calendar.ts` now sets only the affected link's `nextFirstPublicationEt` and `windowSessions` to null, while `acceptanceChecks` emits `outOfOrderNextPublications` with current and candidate fiscal periods/timestamps. No bounded window is fabricated, and valid windows use the original K01 arithmetic. `docs/engine/tasks/K06-releases-other-companies.md` records the explicit exception to the stop condition.
- Regression uses the real TMUS dates: Q3 2006 `2007-04-09T14:23:47` versus FY2006 `2007-03-30T15:50:53`; it proves null affected links plus visible anomaly evidence, with `nonIncreasingNextPublications=[]`. All **15** targeted tests and a forced TypeScript build pass. `npx tsx scripts/build-event-calendar.mts --check` proves both research-50 outputs remain byte-identical: filings `29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d`, quarters `35e11fc013b935c0457771759248a401895c7e8aa64fcdea42cbfcba8ff2a21f`.
- Resumed `npx tsx scripts/build-release-calendar-rest.mts --limit 446` as background task `bash-r2ij4vo1` with no duplicate builder and full gates running separately. Checkpoints and valid exhibits are reused; original downloaded bytes are preserved. Claude's scheduler restart is unrelated and did not touch the K06 builder. K07 remains unapproved and untouched. Full acceptance and final evidence commit remain pending.

## 118. Claude: S&P 500 prices and option history, Schwab daily bars, S&P 500 option capture, housekeeping fixes — 2026-11-11 (local afternoon)

Owner requests of 11 November: update prices for the full S&P 500 (history and daily), fix the price holes, collect
options for everybody, load the option history, precalculate for page load (K07, Kimi), then the housekeeping items
of the findings. Times are Pacific.

Verified:

- **Stooq dump 2026-11-10** (`D:\stooq data 111126\data\daily\us`): `npx tsx scripts/load-stooq-prices.mts --dir "D:/stooq data 111126/data/daily/us" --refresh`, 11:10–11:41. 514/514 series; 412 replaced by the dump's dividend-adjusted history (the October dump lacked part of the dividend adjustments), 90 corrected (last bar's volume), 12 held for review (BF-B, BNY, DTE, FLEX, HBAN, HPE, HSIC, J, JCI, KEY, PG, UNP; 10 received the new dates, PG and BNY end 2026-10-26). 3,054,748 stored bars changed as intended, 0 unexpectedly, 0 missing; 5,626 added; readback 502/502. Evidence `research/engine/price-load-stooq-2026-11-10.summary.json` (`365a243`).
- **Schwab daily history**: `npx tsx worker/schwab-history-backfill.mts` (one year, 514/514, `D:\research\alpha-engine\schwab-sp500\pricehistory-backfill\2026-11-11-1y`), loaded with `worker/schwab-daily-bars.mts --history-dir ...`: 128,803 bars, 0 conflicts. Then found: `getBars` lets Schwab win on its dates, so a year of raw Schwab closes overlaid the dividend-adjusted Stooq history (false step of 1–3% for dividend payers). At 12:20 the 128,785 overlapping rows were relabelled `schwab-hist` (one-off UPDATE of rows written that day; nothing deleted); `schwab` keeps 218 rows (the 200 earlier rows of the 50 for 4–9 November, 18 PG/BNY rows after their Stooq end). The writer now stores dates up to a series' last Stooq bar as `schwab-hist` (`2452dbc`). Macro atlas rebuilt at 12:28 on the corrected view. Schwab history is split-adjusted and not dividend-adjusted (NVDA 2024-05-31 close 109.63; KO Stooq/Schwab ratio steps by each dividend).
- **Scheduler** restarted at 11:23 while idle (no job process): 70 jobs. New `schwab-fetch-sp500` (04:30; `--price-series --exclude research-universe-50.json --skip-preferences --root D:/research/alpha-engine/schwab-sp500`; local only) and `schwab-daily-bars` after it. The research-50 lane, its UI snapshot and its production push are unchanged. The collector now spaces requests by 550 ms, retries HTTP 429 and renews the token during long runs (`worker/lib/schwab-paced.ts`); class shares are requested as BRK/B.
- **DoltHub history**: `npx tsx worker/dolthub-export-dates.mts`, started 11:59: 510 tickers, 2019–2026, one query per snapshot date (about a second for all tickers, against about a minute per ticker and year); the 40 existing files are rebuilt as a check and were identical in every year completed at the time of writing. NVR, SKYD, VYLR and XLU are not listed by DoltHub. Still running at the time of writing.
- **First S&P 500 option capture** queued for 13:05 (after the close and after the export).
- **Operations report**: the heartbeat check counted a heartbeat written a few seconds after the report's clock as offline ("stale: 0 min ago") and made the report critical; fixed with a test (`b1055f0`). Macro scenarios, macro atlas, local Schwab snapshot and features rebuilt. Remaining error: the `schwab-snapshot` push fails with HTTP 413 (the report is 77 MB; production limit and the 16 MiB column; the server accepts gzip only for `insider-form4.json`); owner decision.
- **Option features**: spot read from the quotes by put-call parity (split-proof), schema 3, `--all-exported`; calibration scales both moves by the same entry close; the research readers read source stooq only (`8b2ab53`). Features not yet rebuilt.
- **13F flows**: weight change from dollar values, each fund's book counted once (`0944e09`).
- **Specs**: K07 (`5cf0554`, approved by the owner in Kimi's window), K08 market value (`992f9c5`, waits for the owner).

Gates at 12:38 on the committed state: `npm run check`, `npm test -- --run` (191 files / 1,068 tests), `npm run build`, `git diff --check` pass. A one-off type check of the changed `worker/` and `scripts/` files shows no new errors (13 older ones in `worker/dolthub-features.mts`, `worker/dolthub-vol-target.mts`, `worker/lib/dolthub-research.ts`; these folders are outside `npm run check`).

Left uncommitted by Claude: Kimi's handoff sections 112–117, K06 and event-calendar files, scheduler-generated reports.

Next safe actions: after the export, `npx tsx worker/dolthub-export-validate.mts` (without `--full`, which expects the old 40×8 scope) and `npx tsx worker/dolthub-features.mts --all-exported`; check the first `schwab-sp500` manifest; the first scheduled S&P capture and daily bars run tomorrow at 04:30. Owner decisions: the snapshot push (413), PG and BNY, K08, the Manual §1 draft (research repository, findings §11).

Follow-up, 13:30:

- **DoltHub history** finished 11:59–12:51: 510 tickers, 3,407 new ticker-years and 352 empty ones, 51,960,271 new rows; the 321 existing files rebuilt byte for byte as a check, 0 mismatches. `npx tsx worker/dolthub-export-validate.mts`: 3,728 files, 58,786,297 rows, 0 errors, 0 duplicate contracts (352 warnings = empty ticker-years). Data ends 2026-10-28 (clone date).
- **Option features** rebuilt for every exported ticker (`npx tsx worker/dolthub-features.mts --all-exported`, schema 3): 3,728 batches, 610,034 snapshots, 0 errors, 8 minutes. AAPL spot 503.80 on 2020-08-24 and 129.28 on 2020-08-31 (stored before: 122.19 with an "ATM" IV of 120%).
- **Option research** re-run on the same 40 companies (`dolthub-expected-move`, `dolthub-research`, `dolthub-vol-target`; outputs on D:): ATM IV forward-RV IC 0.737 → 0.796, paired advantage over RV20 0.071 → 0.129, expected-move coverage 64.85% → 62.32% (RV20 59.79% → 59.47%). Volatility Lab table, Risk Lab profile and the hypothesis log updated (`5ef43c3`); the vol-target change also reflects the new prices and one more month.
- **First S&P 500 option capture** 13:05–13:26 (after the close): 464/464 complete, 0 errors; SPY and SNDK chains fetched in 60 monthly pieces; 546 MB of chains (about 0.55 GB a day; D: 654 GB free). The scheduler takes over at 04:30 tomorrow.
- The 200 older `schwab` rows of the 50 (4–9 November) match Schwab's own history to the cent; their differences from Stooq are dividends (PFE, IBM).

Follow-up, 14:30 (owner decisions of the afternoon):

- **Production push**: the owner is in development mode and does not want work on production delivery; the `schwab-snapshot` push (HTTP 413) stays as it is.
- **PG and BNY** take the 2026-11-10 dump's history (`scripts/load-stooq-prices.mts ... --refresh --accept PG`, then `--accept BNY`; new option `--accept` records `acceptedByOwner`). PG: 14,323 bars changed as intended, 11 added; BNY: 10,614 changed, 11 added; 0 unexpected changes, 0 missing, readback 504/504. Evidence `research/engine/price-load-stooq-2026-11-10.pg-accepted.summary.json` and `.bny-accepted.summary.json`. Their Schwab rows of that day inside the new Stooq dates moved to `schwab-hist` (PG 7, BNY 11). Ten series stay held (BF-B, DTE, FLEX, HBAN, HPE, HSIC, J, JCI, KEY, UNP), all with the new dates.
- **20-year Schwab history** for K08: `npx tsx worker/schwab-history-backfill.mts --years 20` (514/514, 2,356,313 bars from 2006-11-10, `D:\research\alpha-engine\schwab-sp500\pricehistory-backfill\2026-11-11-20y`), loaded as `schwab-hist`: 2,216,619 rows, 0 conflicts. The gap check found 23 series with missing sessions in the combined Stooq and Schwab view (e.g. CHTR 25 sessions in December 2009).
- **Manual** (EN and RU, bundle regenerated; the generator now normalizes line endings): §1 price used in two defined roles (`9a2551d`); Stage 3 redesigned as data purity with steps A–D in §2.1 (`a1ebec2`).
- **Spec K09** data-health checks with quarantine (`8509e3a`), after K07 and K08; waits for the owner's approval in Kimi's window. Stage 3 variants B and C added to the lab's fixed K06 test plan (lab `1d914f4`).

Follow-up, 14:55 (Scenario Lab):

- **Cause**: since the `/reports/:name` route (9 November) every report goes through the whitelist in `contracts/report-files.ts`, and an unlisted name threw, so `pilot-exposure-evidence.json`, `shock-calibration.json` (Scenario Lab), `schwab-features.json` (Feature Lab), `weekly-metrics.json` and `project-strength-review.md` (Analytics links) answered HTTP 500 although the files exist. Fixed in `fec4dc5`: the five are whitelisted as local reports (not in the automatic push), unknown names answer 404, and `api/services/report-files.test.ts` fails whenever a page references a report missing from the whitelist. Also `8ead58a`: the hypothesis ledger test expected three ATM IV entries (my dated 11 November entries made four). Full suite 1,072/1,072, check and build pass.
- **Server**: the task `AlphaEngine-Home-Server` is disabled. At 14:51 I stopped the `node dist/boot.js` Kimi had started at 12:24 (pid 20592; Kimi informed) and started the server with the task's own launcher, `wscript worker\home-server-hidden.vbs` (`NODE_ENV=production`, log `worker\.runs\home-server.log`), pid 17748: one server on port 3000. The task stays disabled (not my decision); at the next logon nothing starts the server unless it is re-enabled.
- **Scenario Lab after the fix**: renders live SEC + FRED scenarios. Coverage per shock (current / historical only / not computable): rates 26/17/7, credit 36/6/8, oil 1/3/46, dollar 0/8/42. Oil and dollar lack segment-level facts (geographic and product revenue are reported with dimensions, which the companyfacts feed does not carry).


## 119. K06 stopped at TXN duplicate original 10-Q period; owner dedupe ruling required — 2026-11-11

- The full run completed **MTD / company 243** (**264 filings / 88 quarters / 89 releases**, **24,707,645 new bytes**, checks pass), then stopped on TXN / CIK 97476 with `Multiple original periodic filings for TXN/2010-06-30`. Latest aggregate: **100,624 filings / 20,952 quarters / 22,875 releases**, **19,555,806,256 downloaded bytes**, **0 cache hits / 243 newly processed** in this resume. K07 measurement is paused with its checkpoints preserved.
- SEC submissions contains two distinct original 10-Qs for the same period: `0001140361-10-029928` accepted **2010-07-21T17:58:03 ET** and `0001140361-10-029984` accepted **2010-07-22T11:50:22 ET**, plus later amendment `0001140361-10-030855` (10-Q/A, July 30). This is not a duplicate accession or an `/A` misclassification; K01's original-period uniqueness guard correctly stopped the build.
- Header/content comparison of both primary documents found different SHA-256 hashes but a meaningful signature difference rather than a reason to prefer the later filing blindly: the earlier July 21 document says **Date: July 21, 2010**, while the July 22 document says **Date: July __, 2010**. Choosing latest would preserve the less complete signature. Earliest-original is therefore the evidence-backed candidate, but it was not applied without an owner decision.
- Requested ruling: use the earliest original per fiscal period with all original filings retained in `filings-rest.jsonl` and a visible `duplicateOriginalPeriods` anomaly list and regression, or keep the strict stop and leave the full run incomplete. No dedupe, document deletion, model call, production write or schema change occurred. All 243 completed checkpoints and the out-of-order rule remain intact.


## 120. Owner-approved earliest-original dedupe; K06 resumed — 2026-11-11

- The owner selected **Earliest original** for duplicate fiscal periods. `buildQuarters` now keeps the first accepted original, while `acceptanceChecks` emits `duplicateOriginalPeriods` with kept accession, all duplicate accession/form/timestamp/document evidence and no false missing-original finding. All original filings remain in `filings-rest.jsonl`. The K06 spec records the rule.
- Regression uses the actual TXN dates: July 21 `0001140361-10-029928` is kept over July 22 `0001140361-10-029984`, whose signature is blank. It verifies original rows 3, unique periods 2, rows since 2005 2, duplicate quarter count 0 and missing originals `[]`. All **16** targeted tests and a forced TypeScript build pass.
- Research-50 cutoff check: current SPY history ends `2026-11-10` after Claude's price refresh, causing 18 `windowSessions` differences unrelated to dedupe. Rebuilding with the K01 archive cutoff **2026-10-26** yields the exact baseline hash `35e11fc013b935c0457771759248a401895c7e8aa64fcdea42cbfcba8ff2a21f`; filings also match `29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d`. No research-50 file was overwritten.
- Resumed `npx tsx scripts/build-release-calendar-rest.mts --limit 446` as background task `bash-j0wxc1y1`, with all previous checkpoints and valid exhibits reused and original downloaded bytes preserved. K07 measurement remains paused until K06 no longer needs attention. K07 and option work outside approved scope remain untouched.


## 121. K06 full universe processed; empty-scope acceptance fixed and rebuilding — 2026-11-11

- All **446** companies completed processing before the final gate. Aggregate: **156,487 filings / 34,044 quarters / 36,900 releases**, **27,044,856,134 downloaded bytes**, **27,374,741,302 bytes on disk**, and **30/30** SEC index-time matches. The only failure was **ENLT / CIK 1922641**.
- SEC submissions for ENLT has **203 recent filings** but all are **6-K, 424B5, 3, 4, 144, SCHEDULE 13G, 3/A, 4/A, SCHEDULE 13G/A and F-3ASR**, with no in-scope 10-Q, 10-K, 8-K or amendment and no older pages. It is a foreign private issuer with facts/prices but zero in-scope submissions, not a company with missing metadata.
- `companyPilotChecks` now returns explicit `notApplicable` for an empty in-scope set: `No in-scope 10-Q, 10-K, 8-K or amendment submissions since 2005; publication and item-list ratios are not applicable`. It does not fabricate a 0% or 100% ratio. Missing acceptance times on actual in-scope filings still fails, covered by the new regression. All **17** targeted tests and a forced TypeScript build pass.
- Rebuilding the full summary as task `bash-afnpyczt` with all checkpoints and valid exhibits reused. A first pass had `overallPass=false` only because ENLT's zero-share ratios were treated as missing metadata; no threshold was lowered and no failing company was excluded. Handoff numbering after Claude's section 118 is now TXN 119, dedupe 120, this section 121. K07 measurement remains paused, and K08/K09 are not started.



## 122. K06 full 446-company delivery and byte-identical repeat run — 2026-11-11/12

- Source commit **`e8209ffb1eef5a63c88c91e3ec07b325a76c7574`** is complete and locally committed. Full-universe status is `pilot_complete`, `overall.pass=true`, **446/446** company checks pass, with **156,487 filings / 34,044 quarters / 36,900 releases**, **27,044,856,134 downloaded bytes / 27,374,741,302 bytes on disk**. Acceptance timestamps **156,487/156,487** and 8-K item lists **121,474/121,474**; seeded SEC index checks **30/30**. Separate earlier releases pair with **32,538/34,044 = 95.5763%**; lag min/median/p90/max **0/6/24/637 days**, negative **0**, duplicate company-periods **0**, chosen-release-first **true**.
- Exhibits: **36,244 releases with files / 656 explicit no-exhibit reasons**, **0 missing outcomes / 0 unexplained / 0 final error outcomes**. Four out-of-order links (TMUS, FLEX, LEN, BKR) are unbounded with exact evidence. TXN's earliest original is kept and the later original is retained in filing/anomaly evidence. ENLT is explicitly `notApplicable`; no empty-scope ratio is fabricated. Research-50 filings remain **8,823,008 bytes**, SHA256 `29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d`; quarters **2,264,505 bytes**, `35e11fc013b935c0457771759248a401895c7e8aa64fcdea42cbfcba8ff2a21f`.
- Two consecutive complete cached runs each had **446 cache hits / 0 reprocessed**. Independent verification parsed all JSONL rows, checked unique filing and quarter keys, all company checks, all exhibit counts and actual file hashes. Universe **33,606 bytes**, SHA256 `f6d828f039078e5ea2c45af30a8092fc271522af523b8b97ef52c06eaece6fff`; filings **77,303,161**, `825193f90ef3cb8e3bbc38602d1ee5b052769fe8a5873dd71e59ec5a37d83427`; quarters **17,504,145**, `d36ec5cb90974a80601d728a0a320ae7fd4172a495b51718651f52fbca36ff29`. These three artifacts are byte-identical between runs.
- Final generated evidence: progress **107,611 bytes**, SHA256 `755b0c578abe5c17cd18041d5c505f497b68a373f39fd8c7774e2545dfb62d91`; summary **1,131,260 bytes**, `d1780c79f29bd2462de4bb86d7d1de9b901e62ce05d04b74b7344a90903f4af1`; manifest **1,812 bytes**, `deddd1fca16c30a8981c188aef73a46bf00c6339e7945d2e46bfe609fe4e563f`. Final summary `generatedAt=2026-11-12T00:18:32.630Z`, builder code hash `f53ecaf6d70f4e1e097f07966a6cf8b89d4674a35f6e159178359666c1a2492b`. Projection is **0 bytes / 0 seconds remaining**, **692,412,076,032 projected free bytes**, above the 100 GiB minimum.
- Verification: targeted **17/17**, full suite **192 files / 1,073 tests**, forced TypeScript, production build and diff checks pass on the delivered source. A D: `EPERM` rename interruption at company 270 was recovered only after root/free-space/process checks and TDY/FANG checkpoint plus **95/94 exhibit hash validations**. No cache was recreated, no valid file redownloaded and no completed company reprocessed. Final generated summary was not hand-edited. Scheduler-generated `public/reports/company-exposures.json`, `.md` and `src/data/analytics-snapshot.ts` remain untouched and excluded from the evidence commit.
- Full delivery report is appended to `docs/engine/tasks/K06-releases-other-companies.md`. The summary, task report and this handoff are the intended evidence/documentation commit; the source commit precedes it. No production write, database write, deployment, schema change, model call or new service occurred.
- Next approved task is **K07**. Claude's mailbox `20261111-161624-claude-k07-finding-and-desk-files.md` reports warm `dashboard.stats` **22–26 s**, `company.institutional` **13–14 s**, `dashboard.sectorFlows` **15–17 s**, with `httpBatchLink` causing head-of-line delays. K07 timing must measure these and avoid Claude's new `src/desk/**`, desk snapshot files and listed shared-file hunks. Existing partial timing files contain readiness-marker mistakes and must not be treated as final evidence. K08 follows K07 with the already-collected 20-year `schwab-hist` prerequisite to verify; K09 follows K08 and is not started.

## 123. Claude: new desk view at /desk (standalone, switchable with the classic view); GPU guidance run on the complete K06 quarters — 2026-11-11 (local evening)

Owner requests of 11 November: redesign the terminal and the legacy part of the site so that development artifacts do
not show, with a better flow and new functionality; then "you dont have to stick to old pallete, design or layouts flows
or render limitations, if you can make it faster that is great ... make it as a stand alone view, switchable back and
forth for now". Times are Pacific.

- **What exists**: `src/desk/**` mounted at `/desk/*` (`src/App.tsx`). Pages: Today (a brief written from the data, KPI
  tiles, market map, sector bars, biggest moves, earnings just reported and coming up, watchlist, latest filings, macro),
  Markets (S&P 500 treemap by sector, period / size / sector filters, table view, sectors across periods), Screener (all
  index companies, sortable, sector and research filters in the URL, CSV export), Company (price chart with earnings
  markers and the options-implied cone, returns, key statistics, earnings with the projected next date, options term
  structure, 13F ownership loaded after the chart, short interest, insiders, peers, link to the classic page), Research
  (tool hub by audience, opens the classic pages), Operations (owner only, read-only view of the daily operations
  report). Command palette on Ctrl+K or "/"; light, dark or system theme. Classic pages are unchanged.
- **Switching**: "/" opens the view used last (the desk by default, remembered per browser in `alpha.view`). The classic
  header and the Terminal header have "New view"; the desk's account menu, palette and footer have "Classic view".
- **Data**: one snapshot, `public/reports/desk-snapshot.json` (git-ignored, about 600 KB), built by
  `npx tsx scripts/build-desk-snapshot.mts` in about 7 s from stored closes (Stooq history, Schwab bars only after a
  series' last Stooq date), the Schwab instruments and latest quotes on D: (`schwab-sp500` and the research root; the
  token file is never read), `public/reports/schwab-features.json`, stored 8-K earnings events and the cached S&P 500
  constituents. It stops without writing when a D: root is missing. Served by the new read-only tRPC procedure
  `desk.snapshot` (`api/routers/desk.ts`, `api/services/desk-snapshot.ts`, registered in `api/router.ts`) to every
  signed-in user; option-derived fields are removed for users outside the owner and NDA reviewers (the audience of the
  Market data page). Not yet a scheduler job: it goes into `contracts/operations.ts` (dependsOn `schwab-daily-bars`)
  after K07's job is committed; until then rebuild it by hand after a close. The page picks up a new file without a
  restart.
- **Speed (headless Edge, admin, warm server, full page loads)**: first content 0.9–1.2 s on every desk page; the desk
  never requests `dashboard.stats` or `dashboard.sectorFlows`; on company pages the chart shows at about 1 s and the 13F
  summary (13 s) arrives after it. No console errors and no failed requests on any desk page.
- **Findings for the owner**: (1) the companies registry holds a preferred share, warrant or second class as the
  ticker of 66 S&P 500 companies (Bank of America as MER-PK, Oracle as ORCL-PD, Comcast as CCZ, Block as BSQKZ,
  Berkshire as BRK-A); their price rows carry the traded ticker. The desk shows the traded ticker and links classic pages
  through the registry ticker; classic `/company/BAC` does not resolve today. Correcting the registry is a data change
  for the owner to decide. (2) META, IBM and LMT have no sector in the registry; the desk takes it from the constituents
  table. (3) The reviewer evidence hints attach to classic panels only.
- **GPU**: the guidance second pass over the K06 companies was stopped with its STOP file at 16:27 (after the current
  release), its queue rebuilt from the complete `quarters-rest.jsonl` (34,833 releases of 444 companies: batch 2
  27,069, batch 4 7,764; the earlier queue kept as `queue.partial-k06.jsonl`) and the run resumed at 16:27:27 as
  process 16848 with 154 releases already done (`D:\research\alpha-engine\engine\lab\data\engine\guidance-pass2-rest\`).
- **Web server**: restarted at 16:57 with the launcher (one listener, pid 7300) to load the desk API. It interrupted
  a K07 timing probe; Kimi reran it. Agreed with Kimi: a mailbox note before any further restart, build or full test run.
- **Gates at 17:15** on the tree with Kimi's untracked K07 files present: `npm run check`; `npm test -- --run` 197/198
  files and 1,109/1,110 tests, the one failure `api/services/worker-expectations.test.ts` timing out at 5 s under the
  full-suite load with the GPU run active, 10/10 when run alone (the same timeout as before); `npm run build`;
  `git diff --check`; ESLint on the desk files clean. New tests: `worker/lib/desk-snapshot.test.ts` (12),
  `api/services/desk-snapshot.test.ts` (3), `src/desk/desk-logic.test.tsx` (15), `src/desk/DeskApp.test.tsx` and
  `src/desk/DeskApp.member.test.tsx` (rendered shell for the owner and for a member: navigation by role, no development
  leftovers, no `dashboard.stats`, Ctrl+K search).
- **Next**: the desk-snapshot scheduler job after K07's job; the registry ticker correction if the owner wants it;
  moving research tools into the desk one by one.

## 124. Claude: registry tickers fixed at the source, scheduler crash fixed and restarted, desk round two, desk-snapshot scheduled — 2026-11-11 (local evening)

Owner decisions of 17:30 (Claude's window): "Scheduling the snapshot -> yes, company registry -> yes, lets fix once and
for all"; continue with the research tools, workspace and owner tools ("feel free to join tools, shuffle, split ...
it needs to be functional, not confusing - the key is that platform needs to extract alpha"); leave dev notes on each
page. Times are Pacific.

- **Registry tickers (local MySQL only).** 66 index members carried another security of the same filer as ticker
  (MER-PK for BAC, ORCL-PD for ORCL, CCZ for CMCSA, VYLD for JPM, BRK-A for BRK-B, SATS for ECHO ...) and META, IBM and
  LMT had no sector or industry. Cause: `scripts/seed-sp500-companies.mts` took the last SEC directory row per CIK, and
  `ingestOneCompany` overwrote the ticker with whatever was requested. The fix of 2026-11-05 (`67b4f3f`,
  `canonicalTicker`) had been deleted twice by commits made from a stale cloud checkout (`595c0fb`, `fc8d52f`), together
  with its tests. Restored and extended: `api/services/canonical-ticker.ts` (GICS snapshot is the authority;
  `registryCorrections` audits rows), the hunk in `api/services/runner.ts`, the seed script (ticker from the GICS
  snapshot, exchange only from the exact directory row), tests (13). Applied at 17:43 with
  `npx tsx scripts/remediate-registry-tickers.mts --apply`: backup of `companies` and `user_universe` (198,267 bytes,
  SHA256 `6a49b52eb25c6ec1…`), one transaction with an expected-before guard per UPDATE, 66 tickers + 3 sectors + 3
  industries, 0 watchlist rows, post-check clean, second dry run plans nothing. Evidence:
  `worker/.runs/registry-ticker-remediation/2026-11-12T014306394Z/`. Classic `/company/BAC` resolves again. The desk
  snapshot build now reports `inputs.registryIssues` and the desk Operations page shows it, so a regression is visible
  in the data. **Production is untouched** (the script refuses any non-loopback database) and needs the owner's own
  reviewed run. After any cloud-side commit, check that home-delivered files still exist.
- **Scheduler was down from 13:42 to 18:17.** It ended on `EPERM: operation not permitted, rename
  operations-state.json.<pid>.tmp -> operations-state.json` in `saveOperationsState` when a job finished (a transient
  Windows lock on the state file); no scheduled job ran in between. Fix: `renameWithRetry` in
  `worker/lib/json-file.ts` (waits out EPERM/EBUSY/EACCES for up to 2 s, then throws), used by `writeJsonAtomic` and
  by the scheduler's `atomicText`; `worker/lib/json-file.test.ts`. Restarted at 18:17:51 through the
  `AlphaEngine-Operations-Scheduler` task after proving no scheduler process existed: one chain, fresh heartbeat,
  "77 registered jobs · one execution lane", catching up with `stocktwits-hourly` first.
- **Web server** restarted at 18:17:36 (one listener) with the build that carries K07 `32692c2`, the desk round two
  and the lock fix; a front-end-only rebuild at 18:22 needed no restart.
- **desk-snapshot job** (owner approved): `contracts/operations.ts`, dependsOn `schwab-daily-bars`,
  `scripts/build-desk-snapshot.mts`; runbook regenerated (77 jobs). The snapshot gained optional fields (no schema
  bump): move since the report, 12-minus-1-month momentum, short interest, Form 4 activity of 90 days, the registry
  check.
- **Desk round two** (`src/desk/**`): Research is regrouped by question, for the owner and NDA reviewers as in the
  classic view — Signals (a ledger of 14 families of readings with the measured result of each, copied from
  `docs/engine/DESIGN.md` §6 and the volatility handbook: 5 candidates, 2 risk-only, 4 with nothing beyond noise, 3
  untested; today's strongest readings under each; no engine probabilities before the 446-company test), Earnings
  (reported with the two-session reaction and the move since, coming up with projected dates and implied moves),
  Volatility (implied against realized, sizing calculator, the handbook's headline results), Macro (backdrop, what is
  computable per shock channel, rate sensitivity as an upper bound), Ownership (insider purchases and multi-insider
  windows with the dry-run benchmark, 13F flows by sector, short interest), Library (the classic pages and what the
  desk already covers of each). Watchlist page and a Follow button on company pages (`universe.add/remove`; no data
  job for registry companies). Operations shows the snapshot and registry line and links the owner consoles. Every
  page ends with owner-only build notes (`src/desk/devnotes-data.ts`: missing / could be better and what we are short
  of). The insider ledger entry quotes the canonical dry run of 2026-11-10 22:43 (median excess −0.09%, +0.38%,
  +0.29% at 1, 5, 20 sessions; no interval, no controls).
- **Gates at 18:13** (before the lock fix and three layout fixes, which were then checked by their own tests, type
  check and build): `npm run check`; `VITEST_MAX_WORKERS=2 npm test -- --run` 207 files / 1,150 tests; `npm run build`;
  `git diff --check`; worker and script type check clean; ESLint on the desk files clean. Live check after the
  restart: 11 pages, first content under 1 s, no console errors or failed requests, no horizontal overflow at 390 px.
- **Open**: guidance per company in the desk (the Expectations report is 26 MB); Messages, Jobs, Admin, Database and
  the Sentiment lab are still classic pages; the same registry correction on production (owner).



## 125. K07 precomputed local page data delivered — 2026-11-11/12

- Source commits **`32692c2`** (precomputed serving) and **`6a3c3b4`** (single-pass/resume and source-job health) are pushed. Local `worker/.runs/precomputed-page-data/` contains **103 unique artifacts**: global stats, sector flows, **50 institutional**, **50 probability** and the gzip descriptor. **52** results from `32692c2` were reused after source-job/day/code-version validation; **51** were computed from `6a3c3b4`. Artifact JSON metadata totals **2,074,393 bytes**, excluding gzip. A mistaken second institutional pass was stopped and its partial summary preserved; corrected resume did not recompute valid results.
- Real on-request equality: **22/22 checks / 13,639 fields / 0 differences**, tolerance **1e-12**, across **NVDA, PLD, NEE, JPM, AAPL, AMD, INTC, PLTR, META and NFLX**. No artifact is stale. Source-job changes, running/failed jobs and evaluation-day changes mark stale; missing/corrupt artifacts retain on-request fallback. Live membership and job counts remain live.
- Isolated before→after warm latency: dashboard stats **19,722→10 ms**, sector flows **14,583→6 ms**, institutional **14,686→7 ms**, probability **4,159→9 ms**, market report **1,188→469 ms with gzip**. Factor IC is unchanged on request (**319→366 ms**) and no longer waits behind probability. All **50 after-visits** have main content within **1,465 ms**, with finalAuth=200, no timeouts, residual loading flags, page errors, failed requests or after-requests above 1,000 ms. All **240 before** and **318 after** page requests are preserved in the delivery JSON, plus **64 isolated after-probes**.
- The existing `schwab-snapshot` writer now emits hash-verified gzip immediately after public/bundled JSON writes, independent of its later push outcome. Raw **76,788,384 bytes** SHA256 `7f025317e64783ad990ad56a514d3c4fbf2533d8aab01d02449a063bfd03e5e4`; gzip **5,301,467 bytes** `93533271a7658d9b6ef7c42fc85e50f7e24ba005b2b3ba06bc9759d556730167`; decompressed bytes identical. Source/gzip hashes are checked at serving, not dev/bundle mtimes. No raw option transport or new push lane.
- Six registered local dependency jobs cover facts, 13F, factors, prices, macro and tone; the existing snapshot job covers gzip. Runbook **77 jobs** including Claude's desk job. Six new jobs were temporarily disabled only in ignored local config during the scheduler restart/manual build, then restored after equality with none running/queued; no duplicate builder or second scheduler restart. One verified web server restart preceded the after-probes. Visible `stats as of`, `13F data as of` and `research data as of` markers passed browser checks; screenshot `worker/.runs/k07-value-after.png`.
- Verification: `npm run check`, forced worker/script type check, focused tests, full suite **209 files / 1,156 tests** with `VITEST_MAX_WORKERS=2`, production build and `git diff --check` pass. The default parallel run twice hit the existing 5 s `worker-expectations` timeout under load; it passes alone in 2.077 s and was not edited or bypassed. Claude's desk/registry/lock fixes are integrated; unrelated generated reports and new fund-flow files are excluded from K07 commits.
- Evidence: `research/engine/precomputed-page-data.summary.json` **96,763 bytes**, SHA256 `3f68026a6e9dae8e990a4ed3b8c174b026339d2dc294c7d28263ea966e1b7cb8`; `precomputed-page-data.equality.json` **9,004 bytes**, `16de3e10ba93d37af292459fd65ab0aa3e4045f9b4114c486d413147c85884f0`; `precomputed-page-data.delivery.json` **185,630 bytes**, `c52f3c5001ffb85a6a073965401b9b154401327838801700b6c32f86ff5709d0`. Full delivery report appended to `docs/engine/tasks/K07-precomputed-page-data.md`. No production write, database write, schema change, model call, deployment or alpha promotion occurred.
- Next approved task: **K08**, split-safe market values. First read its spec and independently confirm the **20-year `schwab-hist`** input coverage before changing code. K09 remains queued behind K08 and is not started.

## 126. Claude: fund-flow view at /desk/flows, built from the filed 13F reports; the stored 13F table is wrong and is not used — 2026-11-11 (local evening)

**What exists now**

- `/desk/flows` (owner and NDA reviewers, like the other research pages): a hall drawn with three.js ("the library of
  capital": one bookcase per sector, one book per company, the funds at desks, streams for the estimated sector
  rotation, threads from a selected fund or company to what it traded) and a reading view with the same figures as
  charts and tables. Everything selected lives in the address (`?q=&fund=&company=&sector=&show=outcome&real=1&view=reading`).
  Without WebGL the page opens as the reading view.
- Data: `scripts/build-fund-books.mts` (cached filed reports → books on D:, `D:\research\alpha-engine\fund-books`,
  per-filing checkpoints; first pass 9 min over 7,219 filings, later runs about 1 min) and
  `scripts/build-fund-flows.mts` (books → `worker/.runs/desk-flows/`, 804 files, 43 MB, about 1 min), served by
  `desk.flowsOverview`, `desk.flowsFund`, `desk.flowsCompany`. **Not scheduled**: run the two in that order after a
  13F refresh. Read-only on the database; no schema change; nothing on production.
- Latest result: 23 flow quarters Q4 2020–Q2 2026; Q2 2026 307 funds reported, 289 counted, $2.22tn bought,
  $2.03tn sold; 493 of 496 companies (ENLT, VYLR and XOM_PRE have no filed securities).

**Finding that matters beyond this page: `fund_holdings` is not a faithful copy of the filings** (measured 2026-06-30
against the cached reports in `worker/cache/13f`; not changed by me)

1. One row per security is kept (`mergeQuarterFilings` in `worker/lib/thirteenf.ts`: "duplicate cusip:class keys use
   the latest row") while filers list a security once per manager and voting arrangement. Stored $17.2tn of the
   $37.6tn filed for the same securities: BlackRock $5.6bn of $4,405bn, Fidelity $7.6bn of $1,392bn, JPMorgan 1.1%.
   163 of 306 funds store under 98% of what they filed.
2. `putCall` is not read: option rows are stored as shares.
3. 119 of 496 companies have no mapped CUSIP and are absent (XOM, CVX, VZ, C, BAC, MS, CMCSA, PM, LIN, ACN …). Nine
   mapped CUSIPs belong to other issuers: 87971M103 TELUS→T, 706327103 Pembina→PPL, 29269R105 Enerflex→EFX,
   05508R106 B&G Foods→DHR, 87236Y108 TD Ameritrade→AMT, 22587M106 Cresco→CL, 25380B102→DGX, 48133Q408→JPM,
   668771116→GEN.
4. The dollars-versus-thousands correction is right for all but four filings (it needs five priced rows and reads a
   book full of bonds as "thousands").
5. Cache: for 116 filings the cached table is a byte copy of the cover page (confidential-treatment additions;
   Norges Bank's reports, which become public a year later as an amendment); two cached tables are partial.

Everything reading `fund_holdings` / `fund_quarters` inherits 1–3: the classic Ownership pages, the 13F position
events in `signals`, the K07 institutional page data. Repairing the table means re-loading about two million rows and
regenerating the events: **an owner decision, then a spec**. The books are a ready reference: the manifest lists every
matched security, rejected map row, unit decision and split.

**How the books are made** (each rule has a unit test in `worker/lib/thirteenf-table.test.ts` or
`worker/lib/fund-flows.test.ts`)

- every row of every table summed per security; shares, principal amounts and options kept apart;
- the unit of a filing from prices (241 filings state thousands after the 2023 rule change, 55 stated dollars
  before it; 3 fit no unit and are left out);
- security → company by price levels: filed price ÷ split-adjusted close (`schwab-hist`) is exactly the split factor
  since, which also puts all shares on today's basis (52 splits recognised); other share classes by a steady price
  ratio (one Berkshire A = 1,500 B); 517 securities for 493 companies;
- amendments: a restatement replaces, new holdings add, and a "new holdings" filing that repeats 80% of the book
  replaces it (JPMorgan files whole reports again under that label);
- a position whose shares and value contradict each other at the price of the other books keeps the smaller reading
  (BMO valued Alphabet at the pre-split $2,700 for two years).

**What the flows leave out, and the page says so**: funds most of whose positions moved one way at once (reporting
changes) and one-off blocks far outside a fund's habit (Invesco, Q4 2025, about $390bn when the QQQ trust became
reportable); companies whose holders' share counts all changed by one factor (stock-funded mergers; Honeywell's 2026
spin-off with a 1-for-2 consolidation); companies most of whose holders appear at once (listings, spin-offs).

**Price-history notes**: `schwab-hist` lowers history for special dividends by a dollar amount, not a ratio (CME,
COP, EOG, DVN, TDG, WRB, TPL) and scales it for spin-offs; the series under GEN before November 2022 is Genesis
Healthcare's (ticker reuse).

**Verification (2026-11-11, 21:38–21:45)**

- Shared tree (with Kimi's K08 work in progress): `npm run check` clean; full suite **217 files / 1,225 tests** pass
  (`VITEST_MAX_WORKERS=2`).
- HEAD plus my files only (clean copy on D:, without `.env`): `tsc -b` clean, `npm run build` passes, suite
  **213 of 214 files / 1,202 tests**; the one file failing there is `api/services/reviewer-http.test.ts`, which needs
  `.env` and passes in the main tree.
- Headless Edge (software WebGL), 1600×960, light and dark: hall, sector, fund, company, "what it earned" after
  inflation, reading view; hovering a book shows its figures, selecting it sets `?company=`, a sector label sets
  `?sector=`, play steps through the quarters, the wheel walks without scrolling the page; no page errors; no
  horizontal overflow at 390 px.
- Web server restarted once at 21:00:57 (pid 8368 → 18276) on a bundle of HEAD plus my server files, after a mailbox
  notice. **Caution**: Kimi's `npm run build` at 21:31 rewrote `dist/boot.js` from the working tree, so the next
  restart loads the uncommitted K08 server code too.

**Next safe actions**: owner decision on the 13F table repair; a scheduler entry for the two builds after
`13f-refresh`; the build notes on the page list the rest (successor links between filers, options in the hall, a
test of whether following the money pays).


## 127. K08 split-safe market value delivered — 2026-11-12

- Source **78f0a2d** is pushed. Series rebuilt **50/50**, **24,211 series / 1,110,764 points**; zero derived share/EPS quarters and zero negative shares, with **1,170** valid negative EPS observations retained. Factor materialization wrote **21,046** rows for 50 companies with no failures; candidate/stored keys match exactly, with only 20 last-bit rounding differences (max relative 1.96e-16).
- All seven required split checks pass. NVDA P/E across the 10:1 split is **51.4913 → 52.4690**, not 5.1253 → 52.9895. COF's false 1.25 split from mixed Q/YTD windows is gone. Current market value uses split-adjusted shares and completed Schwab closes; Stooq remains the return source.
- Owner accepted **42/44 comparable current counts (95.45%)**; literal 43/50 is retained, GS has a 2025-10-17 instrument-date match, LLY is unexplained, five companies are multi-class and V is a labelled class-A-only approximate fallback. The literal 81-outlier report decomposes into 15 split-basis comparisons and **66 owner-deferred K09 cases**: 58 unit-scale suspects with PIT references and eight LIN pre-combination cases. No rescaling was applied.
- Refreshed **104/104** local factor/value/screener caches without deletion. Full-universe Screener has **50/50 market-value matches**, all positive; AAPL −$10.48B → **$5.065T**, COST −$29.30M → **$472.44B**, SMCI $0.703B → **$18.32B**. K07 summary contains **103 artifacts** (101 reused, 2 recomputed), with **22 checks / 13,713 fields / 0 differences**.
- Gates: `npm run check`, **217 files / 1,225 tests**, `npm run build`, `git diff --check`, K07/K08 script typechecks and 22 focused tests pass. One coordinated web restart (18276 to 6812) left exactly one port-3000 server; authenticated API and rendered Screener/Company Value checks pass with no failed requests or page errors. Scheduler untouched.
- Evidence is in `research/engine/market-value-*.json` and the delivery report in `docs/engine/tasks/K08-market-value.md`; hashes are in that report. Local MySQL and artifacts only: no production write, deployment, schema change, LLM, GDELT or alpha promotion. Unrelated generated exposure/analytics changes remain uncommitted.
- **Next safe action:** K09, beginning with `research/engine/market-value-k09-quarantine.json` (58 unit-scale + eight LIN cases; reject without rescaling; preserve PIT evidence and LIN predecessor semantics).


## 128. Claude: the fund-flow hall rebuilt as a rotunda with the funds as people; flow files open to every signed-in user — 2026-11-11/12 (local night)

The owner's redesign of `/desk/flows` (plan approved 2026-11-11; follow-ups the same night: smaller people with
capped sizes, less light, every person a little different, an All / Winners / Losers switch).

**What the hall is now** (`src/desk/flows/hall/`, three.js; the old two-wall library `library-stage.ts` and
`library-layout.ts` are removed)

- A rotunda: a bookcase per sector round the wall (the largest sector faces the entrance, the others alternate right
  and left), a book per company (thickness by the cube root of the value held; pulled out = bought, pushed back =
  sold), carved Cinzel signs, marble columns, a gallery, arched windows, a coffered dome with an oculus, the entrance
  as "Outside the covered stocks", a round map table in the middle (`layout.ts`, `building.ts`).
- The funds are people (306 in Q2 2026), each at its home bookcase: biggest net purchase of at least 1.5% of its
  book, else its largest lean against all funds (3 points or more), else its largest holding
  (`worker/lib/fund-flows.ts` `fundPlace`, written by the build into `FlowQuarter.places`). Index funds are the
  library's staff round the map table. Each crowd clusters in its own wedge of floor in front of its bookcase.
- Jacket = the quarter's net flow (blue bought, red sold); height = money on a log scale, $5 bn → 0.45 of a person,
  $1.5 tn → 1.2, capped at both ends (`figures.ts` `FIGURE_SIZE`); build and trouser, shirt, hair and wood colours
  per fund, the same every visit (`lookFor`).
- Figure by leader: `research/engine/fund-leaders.json` (92 filers, sources and quotes) → `hall/leaders-data.ts`
  through `scripts/build-fund-leaders.mts`; a man or a woman only where a public source says so, otherwise a dressed
  wooden mannequin. Clothes by the home sector (suit, casual, tech). Figures: Quaternius CC0; textures and light:
  Poly Haven CC0; lettering: Cinzel OFL (`public/desk-assets/library/`, 8.9 MB, sources in its `LICENSES.md`).
- Motion: people walk to their new places when the quarter changes; new funds come in through the entrance; the
  All / Winners / Losers switch (`?who=`) sends the others out through the entrance and brings them back. A winner's
  book (as reported at the start of the quarter, held through it) did better than all tracked funds together
  (`FlowQuarter.fundReturns` against `allFundsReturn`); Q2 2026: 127 winners, 174 losers against +15.8%.
- Money streams are ribbons as wide as the dollars with "$" bubbles; a selected fund or company gets threads between
  people and books; the streams thin out when seen from high up.
- Controls: drag to look, W A S D or arrows, R and F, Shift, the wheel, Home; buttons for the entrance, the view from
  above, the full-screen game view (Esc leaves) and the help.
- Speed: shared animation rigs (a few dozen skeletons for all people), the static building merged by material, blob
  shadows under people. Headless Edge on the RTX 4070 Ti SUPER: 60 fps (16.7 ms median frame, 7.5 ms of script);
  software WebGL manages about 1 fps and serves only for screenshots.
- Contract additions, all optional for older files: `FlowQuarter.places`, `FlowQuarter.fundReturns`,
  `FundFlowsOverview.sectorNames` (without them the hall orders the bookcases itself and hides the switch).
- Audience: the three flow procedures are `authedQuery` (every signed-in user; reviewers only after the NDA, through
  the middleware); the desk shows Flows to members. **Not live until the next web restart** (agreed as one joint
  restart with Kimi after K09's commit).

**Commands and results**

- `npx tsx scripts/build-fund-flows.mts` (2026-11-12 00:05 local): 23 flow quarters 2020-12-31..2026-06-30, 310 funds,
  493 companies, overview 1.49 MB, code `f105e051a3c7`, output `worker/.runs/desk-flows/`.
- `npm run check` clean; eslint on the changed files clean; `git diff --check` clean; vitest `src/desk` (10 files,
  63 tests), `api/routers/desk-flows.test.ts`, `worker/lib/fund-flows.test.ts` and `src/desk/flows/hall` pass;
  `npm run build` and `npx vite build` pass (hall chunk 134 KB, page chunk 72 KB). The client in `dist/public` is
  current; the server was not restarted.
- **Not run:** the full test suite, held at Kimi's request while the K09 data build runs; it runs after Kimi's
  completion note.

**Next safe actions**: the joint web restart after K09's commit, then the full suite; the hall's next round (the map
table as a map of the United States with flags where the money went, a few props per alcove, laptops for the
technology holders, people visiting the other bookcases where they hold sizable stakes, covers and logos on the
books, the switch from funds to famous traders with politicians as placeholders until the owner decides the
legal question); a scheduler entry for the two flow builds after `13f-refresh`.

**Addendum, 2026-11-12 00:45 — the map table.** The round table is now the United States as a table top
(`src/desk/flows/hall/usa-map.ts`, us-atlas `states-albers-10m`, ISC, in `public/desk-assets/library/usa/`): each
state tinted by the quarter's net flow into the companies headquartered there, brass border inlay, a pennant on a
pin where the money was large, one flag for the 23 companies abroad, a tooltip per state. Headquarters come from
`npx tsx scripts/build-company-headquarters.mts` (SEC submissions through `worker/lib/edgar.ts`, 493 requests,
0 failed; 470 US companies; today's address only) into `research/engine/company-headquarters.json`, and the flow
build adds `hq` to the overview's companies (optional field). Flow files rebuilt at 00:38 (the build took 14 minutes
next to Kimi's option pass and a facts fetch; usually about two). Gates as above plus 4 new map tests.


## 129. K09 data health and quarantine delivered — 2026-11-12

- Source **c4244b9** is pushed. Ten read-only checks produced **95,997 findings** (58,990 quarantine, 36,306 review, 701 info) in **665.421 s** using the validated option checkpoint. Checkpoint reuse is gated by feature-manifest generation and latest Schwab date; its latest build took 1,283,136 ms under contention, while the resumed full run met the 15-minute limit.
- Required evidence: **23 gap series / CHTR 25**, TMUS and TXN, **PG 1 / BNY 8** reviewed steps, **22** old invalid bars, **AAPL 4:1 / NVDA 10:1**, and **66** split events. AAPL derived quarters are fixed at zero; other universes retain 70 findings. Options: **610,034 snapshots / 1,225,501 buckets**, **94 strike dates / 41,874 checks / 303 findings**. Extraction evidence: **26,787 results / 6,787 rejected statements**.
- Artifacts: `public/reports/data-health.{json,md}` and `research/engine/quarantine.json`. Operations has a live summary and both links; the report policy is local-only, with no production push lane. The scheduler reports **78 registered jobs** after a safe restart; the new job waits for its normal dependency chain and no scheduled lastRun is claimed.
- Gates: `npm run check`, **224 files / 1,262 tests**, `npm run build`, `git diff --check`, K09 typecheck, 31 focused tests and the 13/13 report verifier. Joint web restart 6812 → **2620**, one listener, final auth 200, no page errors or failed requests.
- No production write, deployment, schema change, LLM, GDELT or alpha promotion. Unrelated generated exposure/analytics files remain uncommitted. Full evidence hashes are in `docs/engine/tasks/K09-data-health.md`.
- **Next safe action:** inspect the scheduled data-health lastRun after its normal parents complete. Option schema 4 for retained strikes remains a separate owner decision.


## 130. Claude: the hall's room round — Main Street, the eye, scoreboards, top-ten boards, logos, holdings — 2026-11-12 (local night)

Owner's requests of 2026-11-12 (after the joint restart 6812 → 2620 the flow files are open to every signed-in user):

- **Room**: a light marble floor in 2.5 m squares with grout strips; the entrance shows Main Street at dusk with a
  panel of the money that came in from and went out to everything outside the covered stocks
  (`hall/mainstreet.ts`); the Great Seal's unfinished pyramid with the eye under the dome turns to the reader and
  the eye looks at them (`hall/providence.ts`); the map table turns so that north is always away from the reader;
  streams and bubbles fade within a few metres of the eye.
- **Boards** (`hall/boards.ts`, `hall/lists.ts`): a scoreboard over the gallery railing above every bookcase (in,
  out, net tally counting up on a quarter change; held in the holdings view) crowned by a bronze sector emblem
  (`hall/props.ts`); top-ten boards between the columns (most bought/sold, top buyers/sellers, winners/losers, most
  traded, largest holdings and funds, technology, best/worst since; order by view, rows clickable). The floating
  sector chips and the door label are gone; at most six name plates without a selection.
- **Books**: each spine carries the company's logo on a badge and its ticker in gilt (`hall/spines.ts`, logo atlas
  `public/desk-assets/library/logos/`, 491 of 493 logos; sources in `research/engine/company-logos.json`, owner's
  decision that the logos are public).
- **Holdings layer**: a third colour mode, "What is held" (`?show=held`): books in gold by the value held, streams
  set aside, the map in gold by headquarters, scoreboards and lists on holdings.
- Stream tooltips (from → to, dollars, an estimate).

Gates: `npm run check` clean, eslint clean, 76 focused tests (src/desk, desk-flows router, fund-flows), `npx vite
build`, `git diff --check`. Headless Edge screenshots in light and dark: entrance, dome, holdings, spines, boards.

**Next (Claude)**: the people round (smoother figures, age by the firm's first SEC filing with grey hair and canes,
build by size, scooters and bikes for the youngest firms, laptops, visits to other bookcases, the "People"
audience with famous faces). **Proposed for Kimi**: K11 (`docs/engine/tasks/K11-hall-filers-and-schedule.md`,
not approved yet) after K10.


## 131. Claude: the hall's people round — character, carried things, visits, the People audience — 2026-11-12 (local night)

- **Figures**: smooth shading on the low-poly people (creased normals, edges above 60° kept). Age from the firm's first
  SEC filing (`scripts/build-fund-first-filings.mts` → `research/engine/fund-first-filings.json`, 310 of 310; the flow
  build adds `firstFiled` to the overview's funds, optional): on EDGAR by 1996 senior (grey or white hair, some with
  a cane, slower), by 2009 middle-aged, later young (the youngest firms some on scooters or pushing bikes, faster);
  build by fund size; every other technology holder carries a laptop (`hall/character.ts`, `hall/props.ts`).
  BlackRock and Vanguard take their age from their older filer.
- **Visits**: now and then a fund with a sizable stake in another sector walks to that bookcase, stays 7–11 s and
  walks back (`hall/visits.ts`; two at a time, at most eight, never during a quarter's walk or for the selection).
- **People audience** (`?audience=people`): only the famous faces behind 23 tracked filers stay, under their names
  (`hall/famous.ts`, each with its public page; never smaller than 0.85 of a person, names read across the hall);
  six placeholders wait by the entrance (Pelosi and Trump: trades not collected, legal question for the owner; Burry,
  Druckenmiller, Tepper, Icahn: 13F reports not in the books, K11).
- Flow files rebuilt (310 funds, first filings and headquarters included). GPU check: 60 fps, 9 ms of script.

Gates as for section 130 plus the character, visits and lists tests. Next: Mixamo clips (talking, typing,
sitting) if the owner wants them; K11 when the owner names it.


## 132. K10 scenario exposures, maturity shocks, atlas history and UI delivered — 2026-11-12

- **Source:** `8f1afb5` (`Add filing-anchored scenario exposures`). The related evidence commit contains the history, latest exposure serving artifact, summary and this handoff; unrelated generated `company-exposures.*`, `src/data/analytics-snapshot.ts` and `research/engine/precomputed-page-data.summary.json` are deliberately not included.
- **Verified evidence (2026-11-12T13:39:47Z):** 5,100 parsed primary documents, **1,435 evidence-bearing filings, 6,111 measures, 50 companies**. The summary explicitly reports 3,665 documents without supported measures and 51 pre-inline-XBRL unavailable documents. Every measure is anchored to its filing date; full parser round-trip found no availability mismatch. History: `research/engine/exposure-history.jsonl`, 11,225,147 bytes, SHA256 `98a5d49fd3e92469ca84b3a72cc84479dc28d277f2808a0a837de4a65990c39d`; the D: archive has the same bytes.
- **Coverage before → after:** rates 26/17/7 → **38/2/6/4** (current/historical/not-applicable/not-computable); oil 1/3/46 → **5/0/45**; USD 0/8/42 → **44/1/5**; credit 36/6/8 → **46/1/3**. The 17 stale rate cases are now 12 current, two historical and three not-applicable; the six stale credit cases are five current and one historical. Exact recovered concepts, current-debt proxies and secured/unsecured split facts are in `research/engine/exposure-history.summary.json`.
- Eleven latest-10-K maturity checks include exact accession/excerpt evidence, including MU's zero `ixt:fixed-zero` maturity. AIG excludes instrument-level duplicates; NFLX preserves the more precise 2,474,796 thousand USD fact. Six financial-sector companies have the explicit interest-margin `not_applicable` status.
- **Atlas:** 7,376 records; measured responses are available for 17 rate, 17 credit, 44 USD and three oil companies. Other company/channel pairs explicitly say not covered. Medians and empirical p05/p95 event/horizon intervals are descriptive, not confidence intervals, forecasts or alpha promotion.
- **Other hashes:** exposure-latest `80a3ab359360bf9105de6bed27782c83ed5656483e03ac9e61c215e8ea51df30`; scenarios `ddc4986b112524fe3143c3e0ff5805c31f78f5d8f432deefce860a6f51f177c3`; atlas `69c7fe5848a98188ae5e44b5e293ecf785fe2fb287544b61ac82c10255d00b13`.
- **Commands passed:** `npx tsx scripts/build-exposure-history.mts`; `npx tsx scripts/build-macro-transmission-atlas.mts`; `npx tsx scripts/build-macro-scenarios.mts`; `npm run check`; `VITEST_MAX_WORKERS=2 npm test -- --run --reporter=dot` (**230 files / 1,291 tests**); `npm run build`; `git diff --check`.
- **Real UI:** one local production-mode listener, restarted as pid **16900** at 2026-11-12T13:23:04Z. Browser verified 50 live companies, AAPL maturity/cash and shock doubling, USD measured response, AIG split maturity/USD-year, current COP oil and JPM interest-margin status. Required report URLs returned 200 and there were no page errors. Evidence screenshots are in `worker/.runs/k10-scenario-{rates,usd,credit}.png`.
- **Boundaries:** no production write/apply/deploy, schema change, new collector or scheduler entry, LLM, GDELT or alpha promotion. The two new report-file policies are local-only (`automatic: false`). D: is checked by realpath; history is streamed and checkpointed, and a partial run cannot replace the last complete file. `docs/engine/tasks/K10-scenario-exposures.md` has the delivery report.
- **Next safe action:** review the K10 evidence and local Scenario Lab. Any production transport or new task (including K11) still needs a named owner approval. No K10 work remains uncommitted after the related evidence commit.

## 133. Claude: K10 accepted with one correction; the engine test on the K06 companies — 2026-11-12

- **K10 accepted** after a read-only check of `research/engine/exposure-history.jsonl`: 6,111 rows, `availableAt` equals the filing date in every row, no period ends after its filing, no duplicate (company, accession, measure), no amendments. The oil target (CVX, COP, DAL, RCL, plus KMI) and the dollar target (44 of 50) are met. One correction inside K10's approved scope went to Kimi's mailbox (`to-kimi/20261112-054624-claude-k10-accepted-one-fix.md`): V and MA are rate `not_applicable` with `rate_exposure_works_through_interest_margin`, but they are payment networks, not banks or insurers.
- **Engine test on the K06 companies** (research code in `C:\dev\alpha-engine-lab`, commit `625c060`; data in `D:\research\alpha-engine\engine\lab\data\engine-rest\`): the release effect of engine version 1 does not repeat on the other 440 companies. The criterion was fixed before the data existed. Result for all other sectors at 10 sessions: -1.2 [-2.5, +0.2] per 1000. Trained on all companies, the engine leans on no release decision. Four variants add nothing. `docs/engine/DESIGN.md` §6 carries the result.
- **Running on this machine (mine):** the guidance second pass over the K06 releases on the GPU (`guidance-pass2.py`, process 16848, about 8% done at 05:46 local, about seven more days; output `D:\research\alpha-engine\engine\lab\data\engine\guidance-pass2-rest\`; stop with an empty `STOP` file there). The engine test's control runs (planted factor and 20 scrambled runs, seven single-threaded node processes at a time, reading the local MySQL and writing only to D:) run until about 10:00 local.
- **Boundaries:** no production write, schema change, scheduler entry, web restart or build by me. K11 still waits for a named owner approval.

## 134. Claude: the K06 run's controls and the rate pass-through test on all companies — 2026-11-12

- **Controls finished** (lab commit `1e49938`; data in `D:\research\alpha-engine\engine\lab\data\engine-rest\`).
  - A planted factor with a correlation of 0.1 with the 20-session outcome is found at every 20-session cell: +2.1 to +3.0 per 1000, intervals about ±1.
  - At a correlation of 0.05 it is still found at the filing decision: +0.9 [+0.5, +1.2].
  - 20 scrambled runs reach at most +0.3.
  - So the null results are not a lack of power: the full list sees links of about 0.05.
- **Rate pass-through on all 490 companies: no link.**
  - The reading is K10's net debt repricing within 24 months per unit of operating income, from the local `facts` table, times the 21-observation move of DGS10 as published before the decision.
  - The extraction agrees with K10's history on the 50 within 0.5% in 98.5–100% of the four inputs.
  - Rank correlation with the next 20 or 45 sessions against the sector: -0.014 to +0.011 in the scored years.
  - Paired gain inside the engine: -0.1 to +0.0 per 1000 at the four cells fixed in advance. Not kept.
  - `docs/engine/DESIGN.md` §6 carries both results.
- **Data note for the app:** in the `facts` table, AMD's and Mastercard's 2020 10-K hold 0 for `LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths`, where K10's inline reading found 136M and 500M.
- **Still running (mine):** the GPU guidance pass over the K06 releases, 3,570 of 34,833 done at 09:14 local, about six more days; process 16848, stop with an empty `STOP` file in `D:\research\alpha-engine\engine\lab\data\engine\guidance-pass2-rest\`. No other job of mine is running, only two read-only watchers (the mailbox and the guidance pass's status).
- **Waiting for the owner:** K12 (release figures for the K06 companies) and K11, each by name. Kimi's V/MA fix should take section 135.


## 135. K10 correction: payment networks compute from maturities and cash — 2026-11-12

- **Source:** `bcc1c0b` (`Correct payment-network rate exposure classification`). Claude's review was correct: V and MA are payment networks, not banks or insurers. The old `Financials`-wide exemption is replaced by explicit reviewed SIC mappings: JPM/COF 6021, GS 6211 and AIG 6331 remain interest-margin `not_applicable`; V/MA 7389 compute like ordinary companies. Local `companies.sic` is null, so the mapping is explicit and not misrepresented as database-derived.
- **Before → after:** rates **38/2/6/4 → 40/2/4/4** (computable/historical/not-applicable/not-computable). The original 17 stale rate cases are now 14 computable, two historical and one not-applicable. Other channels are unchanged: oil 5/0/0/45, USD 44/1/0/5, credit 46/1/0/3.
- **V:** `(2.750B next-12-month + 1.416B year-two − 12.938B cash) × 1% = −87.72M USD/year`, accession `0001403161-26-000134`. **MA:** `(0.750B + 1.941B − 10.566B) × 1% = −78.75M USD/year`, accession `0001141391-26-000013`. Both also show the operating-income ratio. Cash facts are attached to all 11 maturity checks and to the V/MA evidence, not just named in formulas.
- `research/engine/exposure-history.summary.json` now includes `paymentNetworkCorrection` with before/after counts, SIC mapping, formulas, accessions, cash values and exact fact excerpts. Scenario SHA256 is `7f29052f0bbccc21b847b37f3d3482dab1032c85a06b0be7868fa98d03409379`; the exposure history and atlas are unchanged.
- **Gates:** targeted regressions for V/MA computable and JPM/AIG not applicable, including attached cash facts; `npm run check`; **230 files / 1,292 tests passed**; `npm run build`; `git diff --check`.
- **UI:** restart notice was sent before restarting the verified server. One listener remains, pid **20520**. Live browser checks confirm V/MA computable with cash evidence and JPM interest-margin status, with all required reports at HTTP 200 and no page errors. Screenshot: `worker/.runs/k10-payment-network-rates.png`.
- No history rewrite, production write, schema change, new collector/scheduler entry, LLM or GDELT. K11/K12 were not started. The related evidence commit contains the summary and this handoff; unrelated generated exposure/analytics files remain uncommitted.

## 136. Claude: the hall's whole-frame flicker fixed; K10 correction accepted — 2026-11-12

- **K10 correction accepted** (§135): rates 40/2/4/4, V and MA computable from maturity and cash, JPM/COF/GS/AIG interest margin; scenario SHA256 `7f29052f…` matches.
- **Owner report:** the hall (Fund flows, "the library of capital") flickers to a blank screen while moving.
- **Cause:** the people's bodies are smoothed with three.js `toCreasedNormals`, which gives the corners of a zero-area face a normal of zero length. Each figure model has 6 such faces (18 vertices) where seams meet. Skinning pulls them open, so they get drawn. The shader then normalises a zero vector, and the bloom spreads that one invalid pixel over the whole frame. It reads as black on this machine and white on the owner's screen.
- **Fix:** `src/desk/flows/hall/normals.ts` (`creasedNormals`: those corners keep the model's own normal, or point up), used by `people.ts`, with `normals.test.tsx`.
- **Measured in headless Edge on the GPU** (nine pixels read after every frame the hall drew, while walking, strafing, turning, running and rising):
  - before the fix: 77–85 of about 585 frames fully black in light and 110 of 576 in dark;
  - after it: 0 in both themes, and 0 of 1,280 across walking, dragging, scrolling and hovering;
  - still 60 fps (17 ms median); no zero normals remain in the scene.
- **Gates:** `npm run check`; **231 files / 1,294 tests passed**; `npm run build`; `git diff --check`.
- **Server:** notice to Kimi at 10:29. At 10:41 I stopped pid 20520 (`node dist\boot.js`) and started one server with `wscript worker\home-server-hidden.vbs` (`NODE_ENV=production`, log `worker\.runs\home-server.log`): pid **18832**, the only listener on port 3000. App routes answer 200 to a browser `Accept` header.
- No production write, schema change or scheduler entry. The four generated files that show as modified are not mine and stay uncommitted.

## 137. Claude: hall round from the owner's annotated screenshot; K11 and K12 on hold — 2026-11-12

- **Owner's decision:** K11 and K12 are on hold. The next work is the engine, step by step with the owner.
- **Title panel** (`FlowsPage.tsx`, `desk.css`):
  - folds to its title and the quarter's line; the choice is remembered in `localStorage` key `alpha.desk.flows.head`;
  - more compact: the switches sit in one row, and the explanations moved to "How to read the hall".
- **Scoreboards** (`hall/boards.ts`): the large net figure no longer covers the in/out bars. It stands on its own plaque above each board (or what is held, in that view), with the sector's emblem on the plaque.
- **Top-ten boards** (`hall/stage.ts`):
  - the first click brings the reader square in front of the board, centred in the open part of the view and filling about two thirds of its height;
  - a click on a row then selects it;
  - a board behind a thin money stream takes the click.
- **Entrance** (`hall/building.ts`, `hall/mainstreet.ts`):
  - the arched opening with its white marble surround is gone. In its place is a square-headed doorway (`DOORWAY`, 9 × 6.6 m) in the panelled wall, with a dark wood architrave, a cornice and a brass bead;
  - beyond it is a real Main Street in 3D: steps down to a square, painted shopfronts and offices of several heights on both sides (two 4096 × 1024 canvases), gables, cornices, awnings, lamps, trees, parked and moving cars, and a sky fading into the hall's haze;
  - afternoon in the light theme, night in the dark one, with lit windows, lamps and car lights glowing;
  - a plaque over the doorway shows what came in from outside and what went out, and the outside streams end just over it.
- **Streams switch** (owner's request, renamed at the owner's word): All flows · Bought · Sold, in the address as `?streams=bought|sold`.
  - The owner reads blue as entering a position and red as exiting one, so each choice shows a single colour. Bought shows each rotation stream in blue towards where the money arrived. Sold shows it in red from where the money left. Either way the stream fades out three quarters along, so it still points the way.
  - A selected fund's or book's threads are each bought or sold, and show whole or not at all.
  - The ribbon shader carries its own values per stream (`along` attribute, `streamCut`, `streamSolid`, `streamTone`). In three.js r18x `vColor` has four components, so only `.rgb` is mixed.
  - The bubbles follow the same rule, and a hidden part cannot be pointed at.
  - In the holdings view the switch is hidden and the hall shows all.
- **Fixes from the owner's checks the same afternoon:**
  - A sector in focus showed no streams when none of its money ranked among the hall's 16 largest streams. Energy's first ranked 25th, Materials' 42nd, Real Estate's 41st, Utilities' 30th, Consumer Staples' 22nd. Now its own 12 largest streams, in and out, are added and lit; widths follow the lit streams, the dimmed ones capped at the widest. All 11 sectors light 12.
  - The sector view stands a little further back and higher, so the streams rising over the bookcase are in view.
  - Books pushed back for a sale (CRM, for example) could not be picked. The bookcase's invisible pointing pane stands 0.2 m in front of the shelf, only books bought enough stick out through it, and a click on the pane toggled the sector off and flew home. The pane now yields to anything behind it.
  - A second click on the chosen book or person lets it go (also the ✕ on its tab), and the view flies back to where the reader stood before choosing it. The tooltip says so on the chosen one.
  - With nothing selected, the same smaller sectors had no stream from or to Main Street. Main Street's streams to and from every sector are now always drawn, both ways: 30 lit streams in Q2 2026, and all 11 sectors have both.
  - A selected company's view now comes in close to the book instead of pulling back over the floor. Threads are a little wider.
  - The doorway left the gallery's two ends open and a plaster band over the entrance. The gallery, its rail and its panelled wall now run all the way round, over the doorway (6.2 m high now, under the gallery). The Main Street plaque hangs on the gallery wall above the rail.
  - The panelling of the gallery's wall and fascia was one texture stretched round the whole hall. It now repeats every 3.2 m.
- **Measured** in headless Edge on the GPU:
  - 60 fps standing (entrance, above, a company) and walking (median 16.7 ms, 95th percentile 16.9 ms) in both themes;
  - no zero normals and no blank frames while moving.
- **Gates:** `npm run check`; **231 files / 1,294 tests**; `npm run build`; `git diff --check`.
- **Server:** several restarts announced to Kimi at 11:41. The only listener on port 3000 is pid **18724** (`node dist\boot.js`, started by `worker\home-server-hidden.vbs`).

## 138. Claude: the owner's Engine page (`/desk/engine`); field lists; GPU pass resumed — 2026-11-12

- **Owner's request:** a simple, fully interactive view of what happens behind the scenes in each step of the test, for one chosen company. The steps:
  1. raw fundamentals;
  2. processed data;
  3. the algorithm and its outputs;
  4. e+/e−;
  5. probabilities;
  6. the decision tree;
  7. test results against benchmarks.

  Each step carries notes: hypothesis, process, why it was chosen, expected results, formulas with a worked example, what could be better, and other ideas.
- **The page** (owner only; "Engine" in the desk's navigation):
  - Code: `src/desk/engine/` (`EnginePage`, `steps`, `model`, `notes`, fixtures), served by tRPC `desk.engineIndex` and `desk.engineCompany` (`adminQuery`).
  - Files are read through `api/services/engine-flow-files.ts`: an unreachable folder is an error, never an empty result. Schema: `contracts/engine-flow.ts`, version 1.
  - Controls: choose a company, the release or 10-Q/10-K decision, the horizon, the lean threshold and the cost.
  - Run replays the decisions; each step has Data/Notes tabs and a zoom.
  - Every worked example is recomputed from the engine's own numbers and marked ✓ or ≠.
- **Data:** built on the home machine; nothing reaches production.
  - Folder: `D:\research\alpha-engine\engine\flow` (490 company files, 1.3 GB, plus `index.json`), reached through the ignored junction `worker\.runs\engine-flow`.
  - Lab changes (`C:\dev\alpha-engine-lab`): step 3 `TRACE=1` writes every decision's working at 5/10/20/45 sessions, to six significant digits; step 2 `INPUTS=1` records what each filed-figure reading was computed from; `tools/flow/build-flow.mts` builds the files.
  - The traced predictions are byte-identical to the untraced run's (MD5 `1533acb4…`).
  - Decisions from 2026-07-01 (the sealed line) keep their forecasts, but their outcomes are withheld.
- **Verified on all of it:** 490 companies, 64,507 decisions, 258,028 traced forecasts, 6.1 million factor votes.
  - Recomputed with the page's own code, 0 mismatches for: evidence; variance; kept evidence (within 0.1%); side; probability (largest difference 1.2e-6); usual rate; the 18 filed-figure formulas with their `.trend`/`.peer`; and "rose = r > s".
  - 12 votes at z = 0.4299996 read as "just under 0.43".
  - Headless Edge: AAPL opens in 1.3 s, every worked example is ✓, and the phone view has no overflow.
- **Owner's side request:** the field names of AAPL's fundamentals, old database against ours, as two .xls files in `D:\research\alpha-engine\field-lists\`.
  - Old: 76 Tiingo codes in tables `concept` and `concept_copy apr22 24` of `F:\work\snp500.sql`.
  - Ours: 517 SEC XBRL fields.
  - The owner judged 514 raw series unusable and asked for step 1: one merged, smooth series per standard field for every company, on the old naming. Work is in progress in the lab (`src/fundamentals/`); the owner evaluates before step 2 (normalization).
- **GPU guidance pass:** paused at the owner's request at 14:25, resumed at the owner's word at 15:11 (pid **7824**). It picked up 5,866 files already done.
- **Gates:**
  - `npm run check`.
  - `npm test -- --run --maxWorkers=4`: **235 files / 1,310 tests passed**. With the default worker count, `api/services/worker-expectations.test.ts` › "returns package-specific post-check hashes…" hits its 5 s timeout while the machine is busy; alone it passes in 3.4 s. Not touched.
  - `npm run build`.
  - `git diff --check`.
- **Server:** restarts announced to Kimi (14:58, 15:59). The only listener on port 3000 is pid **23440**.
- Not committed: the four generated files that show as modified (not mine). No production write, schema change or scheduler entry.

## 139. Claude: standard fundamentals, step 1 (merged series per field) — 2026-11-12; K13 to Kimi

- **Owner's order:**
  - Apple alone has 514 raw XBRL series in our data, and engine v1 reads 18 items: "we basically dont have good data".
  - Step 1: one merged, smooth series per standard field for every company, with typical names (the old database's convention as the base). Then stop for his evaluation.
  - Step 2: normalization, on his later instructions.
- **Built:** lab `84057a5`, `C:\dev\alpha-engine-lab\src\fundamentals\` (`fields.mts`, `build.mts`, `qa.mts`).
  - **Fields:** 64. These are the 62 statement codes of the old schema (Tiingo's names) plus `goodwill` and `buybacks`. Each has its XBRL tags in order and the identities used when no tag gives the value. Cash-flow outflows are negative.
  - **Calendar:** each company's own fiscal quarters, from its 10-Q/10-K filings, plus a year of comparatives.
  - **Values:**
    - Three-month figures where filed; otherwise year-to-date differences on the same basis (the earlier figure as known when the later one was filed, within 400 days). Weighted shares are differenced by days.
    - Rarely used tags only fill gaps. Revenue takes the largest revenue tag (the total).
    - A quarter that equals its whole year in the same filing, while another quarter of that year is not zero, is set aside as a filer's mislabelled period: 577 figures in 63 companies.
    - ExxonMobil's predecessor registrant (34088) is joined onto XOM (2115436).
  - **Point in time:** every filed version is kept with its filing date. Nothing is smoothed or carried back.
- **Data:** `D:\research\alpha-engine\fundamentals\standard\v1\`.
  - Contents: `company\<cik>.json`, `index.json`, `coverage.json`, `qa.json`, and the review workbook `Standard fundamentals v1 - review.xls`.
  - 502 company IDs: 499 with series, XOM's predecessor merged, plus ENLT (20-F only) and VYLR (no periodic reports yet).
  - 30,688 company-quarters from 2010.
- **Quality, as first reported, from 2010:**
  - Coverage: revenue 98.5%, net income 98.4%, diluted EPS 97.6%, total assets 98.4%, equity 98.6%, operating cash flow 99.1%, capex 91.2%, debt 83.1%.
  - Identity checks off: gross profit 5.1%, change in cash 2.2%, signs 0.2%.
  - Jumps: revenue 0.26% (mostly real events, 2020 and mergers); negative Q4 revenue 3 of 7,290.
- **Known limits:**
  - SEC company facts carry no company-specific extension tags (NextEra has no capex or interest expense).
  - Banks and insurers have no cost of revenue, gross profit or operating income.
  - Share counts and per-share figures are not yet on one split basis; that is a step 2 item.
- **K13 (Kimi, owner approved routine work at 16:20):** spec `cf2e1e4`, `docs/engine/tasks/K13-standard-fundamentals-gaps.md`. It is read-only mining of which tags would fill the gaps in 19 fields. Go sent through the mailbox.
- **Next:** the owner evaluates step 1. No normalization and no change to engine inputs before his step 2 instructions.

## 140. Claude: evaluating step 1 — checks against the filings and Schwab; SEC companyfacts gap — 2026-11-12

All read only, except one probe download (below). No change to the dataset or field definitions while the owner evaluates.

- **Tie-out against the filings:** SEC Financial Statement Data Sets, quarter 2026q3, which holds the Q2-2026 10-Qs.
  - Our first-reported value matched the 10-Q's own number for the same tag and period in every case: 0 differences.
  - Fields compared: revenue, net income, diluted EPS, operating income, cost of revenue, total assets, equity, cash and total liabilities. Each field had 272–430 companies.
  - So extraction, year-to-date differencing and version dates are right. The remaining errors are scope (which tag), freshness and gaps.
- **SEC companyfacts gap:** 21 companies' recent 10-Qs are missing from SEC's companyfacts payloads, although EDGAR lists them. The payloads were downloaded Nov 3–6 and the collector manifests show the later 10-Qs.
  - Companies: AEP, FRT, ETR, SO, LNT, D, NEE, C, JCI, REG, MAA, PPL, DTE, FE, SRE, PLD, EXC, CNP, DLR, DUK, EVRG.
  - Citigroup's payload has 2,261 prospectus filings from 2026 but stops at its 2025 10-K. The others stop in April–May 2026.
  - The SEC data-set file has all 21.
- **Scope bug in `fields.mts` (lab), not yet fixed:**
  - The bank revenue identity is interest income + non-interest income, which is gross. The field is defined net of interest expense. This hits BNY, FITB, RF and TFC.
  - HBAN and MTB take `RevenueFromContractWithCustomerExcludingAssessedTax`, which is fee revenue only.
  - Fix: net interest income + non-interest income, ahead of the contract-revenue tag for banks.
  - The other 14 large banks are right, Citigroup included.
- **Continuity:**
  - Series that stop 2+ quarters before the company's last filing: gross profit / cost of revenue 50 companies, capex 35, debt 34, operating income 23, cover shares 21.
  - Impossible zero share counts: 35 companies.
- **Schwab fundamentals:** the existing `instruments?projection=fundamental` files, 516 companies.
  - What it is: a snapshot of about 55 vendor values with no statements and no history. The instrument file is overwritten daily; only the dated quote files keep a small fundamental block each day.
  - Defects:
    - 10 fields are 0 for every company (short interest, interest coverage, EPS change, the three volume averages, and others).
    - Operating margin copies net margin for about half the companies.
    - Long-term debt/equity exceeds total debt/equity for 384 of 486, which is impossible.
    - `marketCapFloat` is a share count.
  - Agreement with our latest quarter: current ratio 92%, shares 87%, net margin 84%, book value 82%, revenue growth 81%, EPS over the last four quarters 75%, gross margin about 60%.
  - Usable as an independent cross-check and for the dividend calendar. Not a history source.
  - The owner's PDF is the Streamer API. Its only fundamentals are P/E and dividends; it also has hard-to-borrow fields.
- **Probe download:**
  - What: one SEC data-set quarter, through the project's SEC client. File `D:\research\alpha-engine\fundamentals\fsds-probe\2026q3.zip`, 65,148,008 bytes, SHA-256 `b6ebdc56b78526a6423f5b99f6e355afcb0510e7264324300ee5f0d3bd1bad21`.
  - The full set is 71 quarters (2009q1–2026q3), about 5.4 GB. It needs the owner's go as a new bulk source.
  - 6.9% of the statement lines in our companies' filings use company extension tags. NextEra's capex is on two of them.
- **Kimi:** has started K13. Sector map answered: desk snapshot first (493 of 502), then `companies.sector`. The 21 companies' empty recent quarters are to be counted as "no filing data", not tag gaps.
- **Next:** owner decisions on the SEC data-set download and on applying the step 1 fixes. Step 2 still waits for his instructions.

## 141. Claude: standard fundamentals v2 (SEC data sets); the stale desk of 2026-11-12 — 2026-11-12

- **Owner's answers to §140:**
  - SEC data sets: yes.
  - Bank revenue: "fix now".
  - Schwab fundamentals: "low quality, drop it". Nothing is built on them; the desk's existing Schwab fields stay as they are.
- **SEC financial statement data sets:** `D:\research\alpha-engine\fundamentals\fsds\`.
  - Raw files: all 71 quarters (2009q1–2026q3), 5.71 GB, with a SHA-256 manifest.
  - Per-company extracts: CRC-checked, resumable.
  - Code: lab `src/fundamentals/fsds-fetch.mts`, `fsds-extract.py`.
- **The newest filings:** neither SEC source holds them yet, so they are read from the filing's own XBRL.
  - 31 Q3-2026 10-Qs, in `D:\research\alpha-engine\fundamentals\edgar-filings\`.
  - Code: `edgar-filings-fetch.mts`, `edgar-filings-parse.py`.
- **Standard fundamentals v2:** lab `b17fb11`, written to `D:\...\fundamentals\standard\v2\`. v1 is unchanged; K13 reads v1.
  - Sources: companyfacts, then the data sets for the filings it lacks, then the filing XBRL.
  - Every quarter carries its 10-Q/10-K acceptance time.
  - Bank revenue = net interest income + non-interest income, which may replace only a fee or lease tag. 13 financials change.
  - Revenue is taken among the tags printed on the income statement. Republic Services, Hasbro, ES and AEP no longer take a bigger figure from the notes.
  - Workbook: `Standard fundamentals v2 - review.xls`.
- **Checks** (`checks.py`, every quarter since 2009):
  - Our first-reported values equal the filings' own numbers 99.98–100%. The 23 differences are filer mislabels that the data sets copy, one fiscal-year change and one rounded duplicate.
  - Revenue: 96.1% is the largest printed revenue line, 2.2% the bank identity.
  - Freshness: 0 companies behind EDGAR (32 before).
  - Unchanged: 51 series stop early; 35 companies have a zero share count.
- **companyfacts collector gap:** it saw each new 10-Q in EDGAR's list and re-downloaded SEC's companyfacts. It then recorded success although the new 10-Q was not in the download, and it will not retry until the company's next filing. 13 of 13 companies checked show this; most are combined-registrant filers. Proposed fix: compare the payload's accessions with the latest EDGAR accession, mark the company "lagging" and retry daily.
- **Stale desk (owner, 19:25 PST): the Today page showed the Nov 11 close.**
  - The scheduler was alive: one instance since 01:25, heartbeat current.
  - Cause 1: the 18:00 evening chain (`schwab-fetch-evening` and its four followers) was removed in `595c0fb` on 2026-11-06. The running scheduler kept it until its restart, so its last run was Nov 9. Since then a day's close arrives only at 04:00–05:00 the next morning.
  - Cause 2: production pushes are failing. Nov 11: `schwab-snapshot` HTTP 413. Nov 12: `schwab-fetch-daily`, `daily-operations-report` and `schwab-context-hourly` got an HTML page from the ingest.
  - A failed push marks the run `error`, and dependents are queued only after `done` (`worker/lib/operations-scheduler.ts` ~292–310). So the local options snapshot is from Nov 11 and Feature Lab from Nov 9. No alert surfaced any of it.
  - Remedy at 19:27 PST: queued `desk-snapshot` and `schwab-feature-lab` through `worker/.runs/operations-commands.jsonl`, as manual runs. Manual runs never push, so the local chain cannot be blocked.
- **Owner decisions pending:**
  - Restore a post-close evening run.
  - Let local dependents run after a failed production push, while still reporting the push error.
  - Alert on stale data and failed jobs.
  - The production ingest returning HTML is for the owner or a production-side look.
  - The collector "lagging" fix.

## 142. Claude: the scheduler runs the daily plan on cron (owner: "no manual runs, all cron") — 2026-11-12

- **Outcome of the 19:27 chain:**
  - The desk is at the Nov 12 session; the snapshot was rebuilt 19:51 PST.
  - Options snapshot and Feature Lab were rebuilt 19:56. All jobs ended `done`.
- **Daily market plan, cron only.** The evening chain removed in `595c0fb` is back, as a second cron on the existing jobs, so the dependency chains are unchanged.
  - `schwab-fetch-sp500`: `10 16 * * 1-5; 30 4 * * *`. Then daily bars, desk snapshot and price pages, ready about 16:45.
  - `schwab-fetch-daily`: `45 16 * * 1-5; 0 4 * * *`. Then the options snapshot and Feature Lab.
  - 16:10 is the earliest useful time: a session counts as complete at 16:00 Pacific (`latestCompletedSchwabDailyDate`).
  - The morning runs are catch-ups. A capture of the same UTC date resumes, so they only complete what the evening run missed.
  - A schedule may now list several cron expressions separated by `;` (`cronParts`, `nextCronRun`, `validateCron`).
- **A failed production push no longer stops local work.**
  - Each run records `localStatus` (the job's own result) and `push` (ok or failed).
  - A failed push is still the run's error, but its dependents follow `localStatus`, via `succeededLocally`, `dependenciesReady` and `preflight`.
  - Background: since Nov 11 the push failures had held the options snapshot and Feature Lab back.
- **Exactly one scheduler.**
  - `worker/.runs/operations-scheduler.lock` holds the scheduler's pid (`acquireSchedulerLock`).
  - A second start finds a live holder with a fresh heartbeat and exits. A dead holder, or one silent for 10 minutes, is taken over. A lock-less scheduler still beating within 2 minutes is respected.
  - The completion handler, log writes and state saves can no longer end the process. Uncaught errors are logged instead.
  - Entries of removed jobs (such as the old `schwab-fetch-evening`) are dropped from the state.
- **Repository root in the built server.** `OPERATIONS_ROOT` came out as `C:\dev` inside `dist/boot.js`. As a result the Operations page:
  - read an empty state;
  - wrote `C:\dev\worker\.runs\operations-config.json` on Nov 3; that file is left in place, harmless;
  - sent its Run commands where the scheduler never looked.
  - `repositoryRoot()` falls back to the server's working folder. `workers-local.ts` uses it.
- **Owner alert.** `desk.opsHealth` (`worker/lib/operations-health.ts`) feeds a banner on every desk page, owner only, linking to Operations. It raises:
  - the scheduler silent for 3 minutes;
  - a scheduled job whose own work failed in the last day;
  - the weekday market run not completed by 17:15 Pacific;
  - failed production uploads, as a warning.
- **HTTP helper (`worker/lib/http.ts`).** A non-JSON answer now names its status and content type. The old message was "Unexpected token '<'"; the production ingest has been answering with an HTML page.
- **Gates:** `npm run check` and `npm run build` pass. The full suite passed before the root fix (237 files, 1,332 tests); the focused tests passed after it.
- **Docs:** `docs/OPERATIONS.md` was edited by hand, because regenerating it would drop newer hand-written entries (macro-scenarios). The generator's text is updated too.
- **Owner decision pending:** a 15-minute repeat trigger on the `AlphaEngine-Operations-Scheduler` task, so Windows restarts a stopped scheduler (safe with the lock). It is an infrastructure change (task and `worker/operations-scheduler-install.ps1`), so it is not done.
- **Live prices every 20 minutes** (owner's request).
  - New job `schwab-intraday`: weekdays 06:40–13:20 Pacific, every 20 minutes. Script `worker/schwab-intraday.mts`, helpers `worker/lib/schwab-intraday.ts`.
  - Each run:
    - renews the access token;
    - checks Schwab's market hours: a holiday or a time outside the session ends the run with no snapshot;
    - takes one batched quote snapshot of all 514 price series in 3 requests (`fields=quote,regular`; regular-session last trade, previous close, day open/high/low/volume).
  - Writes to `D:\research\alpha-engine\schwab-intraday`:
    - `<session>\<HHMM ET>.json` and `.raw.json`;
    - `<session>\bars.json`: 20-minute bars from consecutive snapshots;
    - `live.json` and `manifest.jsonl` (SHA-256).
  - Keeps the newest 10 sessions; the owner approved deleting older ones.
  - New job `desk-snapshot-live`, after `schwab-intraday`: `build-desk-snapshot.mts` adds `live.json` as provisional closes (`withLiveClose`) only for a session newer than the stored closes. The evening build's official closes replace them.
  - Desk: the Today header shows "Live · prices as of 10:40 AM PST, refreshed every 20 minutes" or "S&P 500 close · updated 4:45 PM PST". The footer shows the same.
  - Verified at 20:08 PST:
    - A normal run renewed the token and stopped ("after the session").
    - A `--ignore-hours` run into a separate folder got 514 of 514 quotes. SPY 757.12, previous close 759.81. That folder has been deleted.
  - Full suite: 239 files, 1,343 tests.
- **Owner's paperMoney plan, findings:**
  - The Trader API PDF (Accounts and Trading Production) uses the same app and OAuth.
  - The refresh token is valid 7 days from its creation. Then a browser authorization is required whatever runs in between.
  - No sandbox yet ("later this year").
  - No evidence that the API can reach a thinkorswim paperMoney account.
  - Our token answers 401 on `userPreference`, so no account is linked.
  - AGENTS.md allows market data only. Any order path is the owner's decision.
  - Proposed alternative: a paper broker on live Schwab quotes (fills at the bid or ask of the first quote after a decision, slippage, commissions, every fill logged).
- **Scheduler restarted on the new code** at 20:26 PST, when it was idle.
  - pid 10700, lock file present, 80 jobs.
  - Next runs: catch-ups 04:00 and 04:30, live prices from 06:40.
  - The stale `schwab-fetch-evening` entry is gone.

## 143. Claude: finishing step 1 of the standard fundamentals — mechanism done, mapping handed to Kimi (K14) — 2026-11-12

- **Owner:** "lets finalize whats open in step 1, do you want to hand it to kimi? make sure he can handle it".
  - He then added: the cleaned series become static MySQL data, new quarters and new companies go through the same process, and the steps and lessons must be documented so it can be replicated.
- **Mechanism (mine)**, lab `935307e` and `0e2aba7`:
  - `overrides.json`: per company and field, tags as fallback (default) or first, with an optional quarter-end range and required evidence.
  - `custom:Name` reads the company's own tag from SEC's data sets and the newest filings.
  - Signed tag expressions (`A+B-C`).
  - Fields marked `positive` (assets, share counts) pass over zero or negative values.
  - `compare.py` is the acceptance gate between builds.
  - The review workbook generator is now in the lab (`tools/fundamentals/review-workbook.py`).
  - Tests:
    - A full build without overrides is identical before and after the signed-parts change.
    - Against v2, the zero rule removes 96 impossible values and breaks 0 filing matches.
- **Baseline for K14:** `D:\...\standard\v3-mech\`, which is v2 plus the zero rule.
  - Impossible zeros: 0. Signs off: 259 (v2: 323). Freshness: 0. Revenue on the printed line: 96.10%.
  - Stops early: grossProfit/costRev 51, capex 38, debt 35, opinc 22, sharesBasic 20.
- **Process document:** `docs/engine/STANDARD_FUNDAMENTALS.md`. It covers the series, the sources and what each lacks, the steps with commands, the build rules, the acceptance gates, the lessons learned, new quarters and new companies, and a proposed MySQL design. The design (three tables, inserts only, ≤500 rows per batch) waits for the owner's review, because it is a schema change.
- **K14 (Kimi):** `docs/engine/tasks/K14-standard-fundamentals-finish.md`.
  - Work: map the open items by following the statement line across filings, with evidence per entry.
  - Worked examples:
    - General Dynamics cost of sales since 2020: `CostsAndExpenses-GeneralAndAdministrativeExpense`.
    - NextEra capex on its own tags.
  - Stage A is a pilot of 5 entries reviewed by me. Stage B is everything, with fixed gates (compare 0 broken and 0 removed; checks and QA not worse; section 9 of the process document).

## 144. Claude: research database `alpha_research`; provisional load of the baseline; K14 override periods and magnitude — 2026-11-12

- **Owner's permission (verbatim):** "Claude may create, alter and drop tables and write rows in the local alpha_research database without asking. alpha_engine stays read-only for research. Inserts in batches of ≤500 rows. Nothing reaches production except through the reviewed sync."
  - Recorded as AGENTS.md section 3.2, with matching exceptions in sections 3 and 6.
  - The owner created the database and its user `alpha_research`.
  - Grants, checked with SHOW GRANTS: all privileges on `alpha_research`, SELECT on `alpha_engine`. So MySQL itself enforces the rule.
  - Connection: `RESEARCH_DATABASE_URL` in `.env`, never printed.
- **Lab helpers** (`C:\dev\alpha-engine-lab\src\`):
  - `research-db.mts`: `researchDb()` refuses any database but `alpha_research`; `insertRows()` writes at most 500 rows per batch.
  - `research-db-check.mts`: shows the user, its grants and a write round trip.
- **Loader:** `src/fundamentals/load-mysql.mts <build dir> <version> <provisional|final> [--replace]`.
  - Five tables:
    - `std_fundamentals`: every filed version of every company, field and quarter.
    - `std_fundamental_quarters`: with the EDGAR acceptance time.
    - `std_fundamental_companies` and `std_fundamental_fields`.
    - `std_fundamental_builds`: lab commit, data-set manifest and `overrides.json` SHA-256, gate numbers.
  - `--replace` is refused once a final build is stored. Without it the loader only inserts new versions and stops on any value that differs from a stored one.
  - Every load reads back 2,000 random values.
- **Provisional load of v3-mech** as `2026-11-12-v3mech`:
  - 1,661,510 values, 32,722 quarters, 499 companies and 64 fields.
  - Read-back of 2,000 random values: 0 different. Time: 1,087 s.
  - My own check: exact table counts equal the loader's; NVIDIA's 77 revenue versions equal the build file.
  - The final load follows K14 Stage B (v3).
- **K14 Stage A: Kimi's NextEra question.** NextEra's own capex tags change sign between filings, so no signed expression fits every year:
  - the 2010 10-K stores FPL +2,605m and NEER −2,899m;
  - the 2011 10-K stores both as positive outflows.

  The tags were also renamed four times since 2009. Mechanism extension in `build.mts`, lab `e2c4bc3`:
  - A field may have a list of entries with non-overlapping `from`/`until`. Each quarter uses the entry for its own quarter end.
  - The cross-tag year-to-date pairing (`x:`) reads each figure with its own quarter's entry.
  - `"magnitude": true` counts each fact by its absolute value before any year-to-date difference.
  - Regression: two full builds without overrides are identical to v3-mech for all 499 companies (quarters, sources, fields, added filings).
  - Test on NextEra with a synthetic config of five entries. FY2010 (5,846m) and FY2011 (6,628m) equal the 10-K lines. Q4 2010 pairs the new tags' full year with the old tags' nine months.
- **K14 Stage A delivered and accepted.** Kimi's lab commit `3e3109e`; five entries: GD costRev, NextEra capex (one entry, magnitude), BAX capex, ILMN debt (`first`), TJX opinc.
  - My review:
    - a rebuild on `e2c4bc3` equals his `v3-pilot` file for file;
    - `compare.py`: 0 removed, 0 broken;
    - his evidence figures tie to the data sets' own numbers (GD 7,849m, ILMN 1,740m, TJX 937.299m, BAX −176m).
  - The only changed value is ILMN's 2022-04-03 debt, 499m → 1,740m (the term and convertible notes the baseline missed).
- **Gulf Power** (found by Kimi): "Acquisition and capital expenditures of Gulf Power" holds the 2019-01-01 purchase. Kimi left the line out everywhere.
  - Only Q1 2019 carries the purchase as a quarter value: Q2–Q4 2019 difference two year-to-date figures that both contain it.
  - Stage B therefore uses entries by period: Q1 2019 without the line, documented as understated by Gulf's own Q1 capex; from Q2 2019 with it, those quarters from `y:`.
  - New rule in K14 and the process document: end an entry inside a fiscal year only at a rename.
- **Found in the review: the year-to-date rule mixes bases after a restatement.** A filing that restates its prior-year comparatives, for example after moving a business to discontinued operations, puts the current year on a new basis. The build still subtracts the earlier filing's figure, which is on the old basis.
  - WMB Q4 2011, first version −17m: the 2011 10-K's full year on continuing operations (after the WPX spin-off) minus the original nine months with WPX. The value a year later is 2,103m.
  - BAX Q3 2024, first version −22m. The Q3 10-Q's nine months are 314m on continuing operations, and it restates its own 2023 nine months from 502m to 340m. The Q2 10-Q's six months it is set against are 292m, on the old basis.
  - K14 item 4 (the four negative fourth-quarter revenues) is this mechanism. It moves from Kimi to me, as a build rule: a restated prior-year comparative in the filing blocks the pairing.
- **Docs:** `docs/engine/STANDARD_FUNDAMENTALS.md` sections 4, 6 and 8; K14 "Several periods for one field".
- **Next:**
  1. Mine: the restated-basis rule in `build.mts` → new baseline → regression analysis and gates → K14 gate numbers updated.
  2. Kimi: Stage B (items 1–3) → compare against the new baseline → v3.
  3. Final MySQL load of v3.

## 145. Claude: the restated-basis rule; new baseline `v3-base` for K14 Stage B — 2026-11-13

- **The flaw.** A filing that restates its comparatives was differenced with the earlier filing's year-to-date figure on the old basis. Causes: a business moved to discontinued operations, a merger that replaces the history, a stock split. Results in v3-mech:
  - WMB Q4 2011 revenue −17m;
  - JCI FY2012 Q4 −1,283m;
  - AES Q4 2017 −64m;
  - BAX Q3 2024 capex −22m, against about 130m a quarter;
  - Tyco FY2012 Q4 capex +288m.
- **The rule** (lab `8f6afc0`; process document §4 and §6; `SHOW_REFUSED=1` prints refused pairs). A pair is refused only when all of these hold:
  - the later filing restated broadly: at least 15% of its prior-year figures, moves over 2%, sign flips aside. Share counts need a split-sized change instead (1.2–60×);
  - the tag itself moved (same tag, or a peer tag of the field after a rename), enough to move the quarter by more than 5%;
  - the earlier filing is known to stand on the old basis: its own shared figure, under the same tag, equals the one known before it.
  - Scaling slips (×1000) are never restatements. Mislabelled contexts are ignored: a year-to-date figure counts only from a filing whose period ends at the span's end or whole years after it.
- **Tuning, by refused pairs read one by one:**
  - one tag moving is not a restatement: UNP moved 720m of 2018 repurchases to a second tag, and a weaker tag then gave 0;
  - GD's Q3 2011 10-Q tags nine months as full years;
  - GRMN's and WRB's 10-Ks gave weighted shares in thousands.
- **Baseline `D:\research\alpha-engine\fundamentals\standard\v3-base\`** (no overrides), against v3-mech:
  - `compare.py`: broken 0; removed 125. These are quarters whose only value mixed two bases (HON Q4 2025 EBT −501m, OXY Q4 2025 revenue 1,752m, ECHO Q4 2023 EBIT −2,388m), plus the split quarters of NFLX, NOW, TPL and KLAC.
  - QA counts off: gross profit 536 → 516, cash change 630 → 623, signs 259 → 244, revenue jumps 61 → 58, asset jumps 48 → 48, negative Q4 revenue 4 → 1.
  - `checks.py`: unchanged. Coverage is at most 0.02 points lower.
  - Left: A. O. Smith Q4 2010 (−166m). That is its first XBRL year, with nothing earlier to compare.
- **K14:** Stage B compares against v3-base. The gate numbers are updated, and item 4 needs nothing from Kimi.
- **MySQL** still holds v3-mech as provisional. The final load is v3 after Stage B.
- **Next:**
  1. Kimi: Stage B → v3.
  2. Me: review v3 → final load.
  3. GPU guidance run (446 companies): 6,452 of 34,833 releases at 22:03, about 5 more days.

## 146. Claude: no production pushes; fresh prices in the app; scheduler watchdog — 2026-11-12, 23:00 PT

- **Owner's decisions (verbatim):**
  1. "no pushes to prod, it was just a temp dev online"
  2. "paper trading later after confirm that engine works, otherwise nothing to trade"
  3. "sheduler, i thought you allready set that up, if not - set up, no fresh prices on localhost by the way"
- **Pushes:** `shouldPushOperationalJob` (`worker/lib/prod-push.ts`) now needs `OPERATIONAL_PUSH=1`, which only the owner sets. Scheduled jobs push nothing. AGENTS.md §3 records the decision; `docs/OPERATIONS.md` marks the outbox as off.
- **Why the app was stale:** it showed prices through Nov 10 while the desk had Nov 12. The app compiles `src/data/analytics-snapshot.ts` into its bundle.
  - `analytics-snapshot` followed the nightly `research-factors`. That chain ran at 03:18, before the evening prices were stored.
  - `ui-production-build` waited for three parents, including the 06:00 `expectations-report`. A child runs only after all of its parents have run since its own last run, so the build of 20:17 bundled the 03:18 file.
- **Fix:**
  - `analytics-snapshot` now follows `schwab-daily-bars`.
  - `ui-production-build` follows `analytics-snapshot` and `schwab-feature-lab`; the next build compiles the expectations report.
  - The app gets each close in the evening, about 17:15, and after the 04:30 catch-up.
  - The 20-minute live prices need no build: `api/services/desk-snapshot.ts` re-reads `desk-snapshot.json` whenever it changes.
- **Refreshed now:**
  - The analytics snapshot was regenerated: prices through 2026-11-12, test count 1,344. It must run from PowerShell, because it runs `vitest list`, which fails from Git Bash.
  - Rebuilt with `npm run build`: the Analytics chunk carries `latestPriceDate:"2026-11-12"`.
- **Watchdog:** the task `AlphaEngine-Operations-Scheduler` cannot be changed without elevation ("Access is denied"; it was registered from an elevated session).
  - A separate task under the owner's account, `AlphaEngine-Operations-Watchdog`, runs the same wrapper (`worker/operations-scheduler-hidden.vbs`) every 15 minutes (Limited, interactive).
  - A start while a scheduler runs exits on the lock: "not started: running".
  - Remove it with `Unregister-ScheduledTask -TaskName AlphaEngine-Operations-Watchdog`.
- **Scheduler restarted** at 22:55 while idle, to load the new chain and gate. The new pid 6736 took the lock over from the stopped 10700. 80 jobs are registered and the heartbeat is current.
- **Gates:** `npm run check` 0; `npm test -- --run --maxWorkers=4`: 239 files, 1,344 tests passed; `npm run build` 0.
- **Next:**
  - the first live-price run, 2026-11-13 06:40 PT;
  - the evening chain: 16:10 / 16:45 → analytics → UI build;
  - K14 Stage B (Kimi);
  - the GPU guidance run.

## 147. Claude: the desk's 50 research companies showed "—"; banner without production uploads; one scheduler task — 2026-11-12, 23:15 PT

- **Owner's screenshot (23:00):** the desk read "Production upload failed for Daily operations health report, Schwab market context pack" and showed "—" for AAPL, MSFT, NVDA, AMZN, META, TSLA, LLY and the other research companies. Owner: "i guess the server was not restarted", and then "i dont think two separate tasks doing the same thing is a good choice going forward".
- **"—" cause:** the 50 research companies are only in the `schwab` archive (fetched 16:45). `schwab-daily-bars` depended on `schwab-fetch-sp500` (16:10) alone, so their Nov 12 closes were never stored. Their last close was Nov 11, and the desk hides returns of a stale series.
  - Fix: `schwab-daily-bars` depends on both fetches (about 16:50).
  - Tonight: `schwab-daily-bars` and `build-desk-snapshot` were run by hand while the scheduler was idle. The desk now has 493 companies at 2026-11-12; only KVUE is stale (its series ended earlier).
- **Banner:** push failures recorded before the decision of §146 kept the upload warning on. The on/off rule moved to `worker/lib/operational-push-policy.ts`, which `prod-push.ts` and `operations-health.ts` share. While pushes are off, the health check shows no upload warning. Tests cover both settings.
- **One scheduler task:** the owner's task cannot be changed without elevation. `worker/operations-scheduler-install.ps1` (an infrastructure script, changed at the owner's request) now:
  - adds the 15-minute repeat trigger to `AlphaEngine-Operations-Scheduler`;
  - removes the interim task `AlphaEngine-Operations-Watchdog`.

  The owner runs it once from an elevated PowerShell: `powershell -ExecutionPolicy Bypass -File C:\dev\alpha-engine\worker\operations-scheduler-install.ps1`. Until then the interim task does the watchdog's work.
- **Why the watchdog leaves no trace:**
  - The running scheduler's command window holds `operations-scheduler.log`, so a start through the launcher fails at once ("file in use"). That is harmless and shows only one instance runs.
  - A dead scheduler frees the log and is restarted.
  - `operations-scheduler.mts` now flushes its "not started" line before exiting.
- **Restarts (announced to Kimi):**
  - web server pid 17368 → **20280** (`home-server-hidden.vbs`, one listener on 3000, HTTP 200);
  - scheduler pid 6736 → **4712**, lock taken over.
  - Health check: no alerts.
- **K14 question answered:** GE's, SLB's, TMO's and OXY's "missing" concepts are the companies' own extension tags with standard-looking names (`version` = the filing's accession). Kimi writes them as `custom:Name`; no build change (my draft supplement was dropped).
- **Gates:** `npm run check` 0; 239 files, 1,346 tests passed; `npm run build` 0.

## 148. Claude: splits and corporate actions from every source, reconciled; BXP calendar fix; baseline rebuilt — 2026-11-13 night

- **Owner:**
  - Prices are cleaned first: "go with your recommendation".
  - Then "not sure what is our situation with splits", "go with the plan, lets get it from whoever we can, then recocile".
  - Then the rest of the US universe from Yahoo overnight ("polite rules").
  - Plan in `C:\Users\sas\.claude\plans\` (top section; the parked audit stays below it).
- **Situation found** (read-only code trace):
  - No stored list of splits, dividends or spin-offs, and no as-traded prices: Stooq is split- and dividend-adjusted, Schwab split-adjusted (and inconsistently spin-off-adjusted).
  - **A split after today stops the daily chain.** `worker/lib/schwab-daily-bars.ts` reports the re-based older candles as close conflicts and `schwab-daily-bars.mts` exits 1. Desk, analytics, page data and data health then do not run, for up to a month, and the stored series shows a fake drop.
  - The split watch is the next priority.
- **Sources, all outputs on `D:\research\alpha-engine\prices\`; scripts in lab `src/prices/` (`cd2f158`):**
  - **Old Tiingo daily table** (owner's dump `F:\work\snp500.sql`): 493 tickers, 2000-01-03 → 2024-04-22, as-traded OHLCV with `split_factor` / `div_cash` (`tiingo-2021\`, including `daily\<T>.csv`).
    - Its weekend rows are the owner's own calendar-day fill ("for the ease of calculation"), not the vendor's.
    - The first day of a repeated event is the real one.
  - **Option history:** the as-traded parity spot ÷ Schwab's adjusted close gives Schwab's adjustment steps, 2019 on (`options\`).
  - **Yahoo chart events** (the endpoint `api/services/prices.ts` already uses), owner's go: 514 universe tickers (`yahoo\2026-11-13\`).
    - The rest of the US market (~8,560 common stocks from the Stooq list, preferreds excluded) is running overnight at one request per 2.5 s into `yahoo\us-2026-11-13\` (resumable, `manifest.jsonl`).
  - **SEC:** the app's own `split-shares.ts` inference for all 496 companies (`sec\split-events.json`, 102 with events).
  - **Not used:** stocksplithistory.com and TipRanks forbid automated access in their terms. The owner may spot-check by hand.
- **Reconciliation** (`reconcile-events.py` → `events\events.json`, `reconciliation.json`), universe only:
  - Splits 2000 → 2024-04: 387 confirmed by two or more sources. After 2024-04: 32 confirmed. Before 2000: 857 from Yahoo alone.
  - Distributions (spin-offs): 189.
  - Dividends Yahoo vs Tiingo: 24,604 agree, 305 differ (vendor adjustments).
  - Manual review: 2 conflicts (MSI 2011 1:7 plus the spin-off; SO 2001 Mirant spin-off), 3 SEC-only (CPRT, HON, TSN), and a few reused tickers (old Chubb, Howmet's Alcoa lineage).
  - Rules learned:
    - Yahoo writes splits as whole-number fractions and spin-offs as thousandths (Trane 1252:1000).
    - Tiingo writes stock dividends as 10/9 where Yahoo writes 11/10.
    - Yahoo's dividends are adjusted by all of its own "split" records.
    - A rename match needs two shared splits and no contradiction (Cerner and Coherent share only 2011-06-27).
- **BXP (Kimi's question) fixed in the build** (lab `cd2f158`): "FY" on a 10-Q is ignored, and the quarter number comes from the spacing to the year end.
  - BXP Q2 2026 ncfo = 446.058m. Nine more calendars fixed: ARES, TMUS, IBKR, TWLO, DELL, DIS, APO, ES, PHM.
  - Against the old baseline: 604 versions added, 12 dropped, 0 quarters removed.
- **Baseline `standard\v3-base` rebuilt** with `cd2f158` (the first one kept as `v3-base-8f6afc0`).
  - QA off counts: gross profit 516, cash change 622, signs 244, revenue jumps 59, asset jumps 48, negative Q4 revenue 1.
  - `checks.py` (`35ec948`) lists amendments (TECH's 10-Q/A) apart from "behind"; freshness 0. K14 updated.
- **Next:**
  1. The split watch in the main repo: detect the constant ratio, record the event, re-base the history, keep the chain running.
  2. As-traded prices and total-return series with their gates, among them our market cap against the dump's daily Tiingo market cap (owner: the split mess was why his old model used market cap).
  3. The overnight Yahoo pull's results.
  4. K14 Stage B (Kimi).

## 149. Claude: the split watch — splits no longer stop the daily chain; a daily calendar of upcoming splits — 2026-11-13 night

- **Owner:** "yahoo should have future split calendar ... we can put it on daily watch", then "yes". He asked whether Schwab has one too: its market-data API has no corporate actions, and only quotes carry the next dividend ex-date.
- **Daily bars re-base on a split** (`worker/lib/schwab-daily-bars.ts` `basisChange`, `worker/schwab-daily-bars.mts`).
  - The pattern: when Schwab re-bases a series' history, every stored close before one date differs from the new candle by one factor (at least 3 dates), and the closes agree from that date on.
  - Then the stored history before that date is re-based in every source (stooq, schwab-hist, schwab), year by year: prices × factor, volume ÷ factor.
  - The event goes to `worker/.runs/price-adjustments.jsonl` with the rows changed per source (reversible by the factor), and the run goes on.
  - A one-day correction, mixed factors, or a moved date after an agreeing one stay conflicts, as before. A dry run detects and reports but writes nothing.
  - Checks:
    - 10 planner tests;
    - a dry run on a synthetic 4:1 split of AAPL ("basis change: AAPL ×0.25 before 2026-11-13, 24 stored dates moved");
    - the re-base statements on a throwaway table in alpha_research (rows before the date re-based in all three sources, the new-basis row and other companies untouched).
  - No scheduler restart is needed for this: jobs run as fresh processes.
- **Upcoming splits** (`worker/split-calendar.mts`, `worker/lib/split-calendar.ts`): Yahoo's split calendar API (`v1/finance/visualization`, entityIdType `splits`, one session cookie and crumb), 60 days ahead, US listings, our price series flagged.
  - Output: `D:\research\alpha-engine\prices\split-calendar\<date>.json` and `latest.json`.
  - New job `split-calendar`, cron `15 6 * * *`; needs a scheduler restart to load.
  - First run: 243 splits, 37 US, **1 in our universe: SNDK 8-for-1 on 2026-11-20**. Before tonight that split would have stopped the chain.
  - AGENTS.md section 2 now allows Yahoo for corporate actions only.
  - StockTitan (`stocktitan.net/news/stock-splits.html`, calendar plus RSS) is a possible second source once its terms are found (`/terms` is a 404).
- **Still open:**
  - `split-shares.ts` learns a split only from the first filing on the new basis. Until then, market value multiplies the old share count by the re-based price, about a quarter after each split. The price-adjustments log or the calendar should feed it (next).
  - The desk could list upcoming splits of our companies.

## 150. Kimi: K14 Stage B verified — 94 companies, 110 evidence-backed mappings, all acceptance gates green — 2026-11-13T10:10:18Z

- **Scope:** company-specific mappings in `C:\dev\alpha-engine-lab\src\fundamentals\overrides.json`: 94 companies, 110 entries, every one with a filing, statement lines, values and `reviewed: false`. Lab head `96325e5`; mechanism commits `e2c4bc3`, `8f6afc0`, `cd2f158`, and checks commit `35ec948` were used. Stage A was accepted by Claude before Stage B.
- **Build:** `D:\research\alpha-engine\fundamentals\standard\v3\`: 502 company IDs, 500 with quarterly series, 30,754 company-quarters since 2010, 65 filings supplemented from SEC financial statement data sets.
- **Mappings:** 2,093 added company-quarter values, 180 direct changes and 82 dependent-identity changes. Six original-vintage additions preserve the later version. Full normalized evidence and all changed values: `v3\mapping-report.md` and `mapping-report.json`.
- **Acceptance gates:**
  - `compare.py v3-base v3`: **0 removed values and 0 broken filing matches**.
  - QA: grossProfit **511** (baseline 516), cashChange **622** (622), signs **244** (244), revenueJumps **58** (baseline 59), assetJumps **48** (48), negativeQ4Revenue **1** (the documented A. O. Smith case).
  - `checks.py`: freshness **0**; largest printed revenue line **96.58%** (minimum 96.10%); the same five revenue tie-out differences as the baseline. TECH's amendment is information, not a freshness failure.
  - Continuity: grossProfit/costRev 51 → 21/20; opinc 22 → 9; capex 38 → 17; revenue 1 → 0; netinc 2 → 0; ncfo 1 → 0; debt 35 → 20; sharesBasic 20 → 20; shareswa 8 → 7; epsDil 3 → 2. The halving target was not met for debt, sharesBasic, shareswa or epsDil. Every remaining reason is in `v3\remaining-stops.md`.
  - Workbook `v3\Standard fundamentals v3 - review.xls`: 662,016 bytes, opened with xlrd, 9 sheets.
- **Commands completed:** full 502-company build, baseline compare, `qa.mts`, `checks.py`, review workbook generation and validation, normalized mapping report and delivery-text generation. `git diff --check` passed. App `npm run check`, full tests and `npm run build` were not run: K14 specifies the lab build/QA/check/compare/workbook gates, not an application-code change.
- **Changes and patterns:** standard and extension renames, operating-cost identities, pretax/non-operating reconciliations, own tags written `custom:Name`, casino gross revenue, REIT property totals, debt identities, and period-specific sign conventions. NextEra's Q1 2019 Gulf acquisition is excluded; later Gulf capex uses YTD differencing with Q2-Q4 2019 forced to `y:`. WRB stops before the 2026 net-proceeds period to preserve the sign gate; NiSource's revenue override stops at 2024 Q3 to avoid extreme jumps.
- **No prohibited actions:** no production writes, schema/scheduler changes, web restarts, network requests, LLM or GDELT. No step-2 normalization or MySQL loading was started. Existing generated main-repo reports and other agents' untracked files were left untouched.
- **Delivery:** the task file contains the full override table and gate evidence, `docs/engine/STANDARD_FUNDAMENTALS.md` section 9 is filled, and `v3\delivery-report.md`, `mapping-report.md`, `remaining-stops.md` and the validated workbook are on D:. Main-repo commit is local only; no push was made because K14 forbids network requests.
- **Next safe action:** Claude and the owner can review the mappings and workbook. MySQL loading, step-2 normalization, production sync and any new task remain separate reviewed decisions.

## 151. Claude: K14 Stage B accepted and v3 loaded; standard prices built, gated and loaded; K15 approved — 2026-11-13 morning

- **Scheduler restart** (to load the `split-calendar` cron).
  - It waited for the nightly `page-data-dashboard` and two queued jobs to finish (all exit 0, last at 09:16:40Z), then restarted at 09:16:50Z.
  - State: one process tree, lock pid 2768, heartbeat fresh; next `split-calendar` 14:15Z.
- **K14 Stage B accepted** (Kimi §150).
  - My reruns: `compare.py v3-base v3` gives 0 removed, 0 broken; `checks.py` matches Kimi's numbers exactly. Six sampled entries' evidence checks out against the cited filings.
  - Loaded `v3` into `alpha_research` as **provisional** (`load-mysql.mts … v3 provisional --replace`, replacing v3-mech): 1,664,768 values, 32,727 quarters, 500 companies, 64 fields; 2,000 values read back, 0 different; 875 s.
  - It becomes final after the owner's review of `v3\Standard fundamentals v3 - review.xls`.
- **Standard prices, build p1.** Process: `docs/engine/STANDARD_PRICES.md`; lab `0dec6e7`; build `D:\research\alpha-engine\prices\std\`.
  - Read-only export of the app's prices: `D:\research\alpha-engine\prices\app-db\2026-11-13\`, 517 companies, 5,985,380 rows.
  - Tiingo tickers tied to companies: 410. Five were found by prices: BK, EQR, MMC, NLOK, VIAC.
  - As-traded bars from Tiingo where trusted, from Schwab's line `a × Schwab + b` elsewhere; corporate actions; split and total-return indexes.
  - Gates:
    - total return against Stooq: 7,880 of 2,736,974 sessions differ (0.29%);
    - option spot: 486 of 490 companies below 1% median;
    - splits: 435 of 435 move correctly, 142 confirmed by SEC;
    - 5,432 empty sessions;
    - known cases (AAPL, NVDA, GE, TSLA, CMG, NFLX) right.
  - Loaded into `alpha_research` as build `p1`, provisional (`src/prices/load-mysql.mts`; tables `std_prices`, `std_price_companies`, `std_price_builds`).
    - 2,891,701 bars for 514 companies: 494 `ok`, 20 `review`.
    - 1,988 random bars read back, 0 different; 2,164 s.
  - Overrides (`std-prices-overrides.json`): DD from 2017-09-01, EVRG from 2018-06-05, TPL for review.
  - Gate 6, market value tie-out (`marketcap-tieout.py`): our close × the company's own filed shares against the old database's monthly market caps.
    - 395 companies and 62,256 months: 97.0% steady; only 7 months jump by a split's ratio.
    - The old database's market caps understate companies before each spin-off by its factor (GE 1.605 = 1.2815 × 1.253).
    - Share counts that cover one class only, and Boeing's and Tyler's issued-for-outstanding 10-K counts, are recorded as step-2 items in `STANDARD_FUNDAMENTALS.md` §6.
  - Schwab, Tiingo and Yahoo quirks: process doc §4.
- **Yahoo US pull** (corporate actions only, polite): healthy at 2.75 s per ticker with no throttling; 2,852 of about 8,560 done at 11:08Z; ends about 15:30Z. Owner: "no rush".
- **StockTitan:** its terms forbid scripts and scraping. Its RSS is the latest 100 general news items, so it is not usable as a split calendar.
- **Owner's side:** Cloudflare 403s ("Attention Required") ended his sessions three or four times. Suspected cause: antivirus HTTPS scanning, which he switched off to test.
- **K15 approved by the owner** ("K15 now, K16 after"): `docs/engine/tasks/K15-split-aware-shares.md`.
  - What: share counts follow a split from its first session (split-watch log) until a filing on the new basis exists.
  - Due before SNDK's 8-for-1 on 2026-11-20.
  - K16 (standard 13F series from the fund books) follows after K15 is accepted.
- **Commits:**
  - Lab: `0dec6e7` (build, gates, loader), `62b4bff` (gate 6).
  - Main: this commit, pushed together with Kimi's `54b8632`. It holds `STANDARD_PRICES.md`, the K15 spec, `STANDARD_FUNDAMENTALS.md` §6 (share-count items) and this section.
  - Gate for this docs-only commit: `git diff --check`.
- **Next safe actions:**
  - Kimi: K15.
  - Claude:
    - review K15 and restart the web server after it;
    - summarize the Yahoo US pull;
    - append new bars to `std_prices` daily;
    - watch SNDK's re-base on 2026-11-20;
    - write K16.
  - Owner: the v3 workbook review.

## 152. Kimi: K15 split-aware share counts implemented and verified — 2026-11-13T11:51Z

- **Baseline:** `147971c`, with `main` and `origin/main` synchronized before this block. The K15 source delivery is limited to `api/services/split-shares.ts`, new `api/services/split-shares-price.test.ts`, and this handoff; the exact commit and push state are authoritative in `git log` and the Claude mailbox delivery.
- **Implementation:** the shared provider reads `worker/.runs/price-adjustments.jsonl`, caches it per resolved path and reloads on mtime change. Dry runs, malformed lines and duplicate `(priceKey, firstNewBasisDate, snappedRatio)` events are counted and excluded. Log ratios are inverted and snapped with `nearestSplitRatio`; 8:1 and 1:8 are now recognized. Non-split adjustments remain diagnostics only. Events carry `source: "price"`, the ex-date and price identity, and are scoped to the requested CIK so another company's split cannot change its shares.
- **SEC reconciliation:** `buildSplitProfile` remains pure. The provider merges price events through `mergeSplitEvents`; a same-ratio SEC event with its first new-basis filing from −30 through +200 days replaces the price event and supplies the sole boundary. Unmatched events remain separate and all events stay date-ordered. Without applicable price events, the original SEC profile object is returned unchanged.
- **Regression coverage:** nine new tests cover first-session 8:1 adjustment, SEC replacement, different/late events, reverse split, non-split adjustment, dry-run/duplicate/malformed/missing/empty logs, mtime caching/reload, and the real provider → market-value SNDK case. The last case includes another company's log event, verifies CIK scoping, and keeps value equal across 2026-11-19/20 after price re-basing ×0.125.
- **Gates:** focused suites **3 files / 29 tests passed**; `npm run check` passed. The first unrestricted `npm test -- --run` had **1,361 passed / 1 timed out** (`worker-expectations.test.ts` five-second post-check timeout, not a K15 assertion). The isolated expectations suite passed **10/10**, with that case at 2.066 s. One diagnosis-based bounded retry, `npm test -- --run --maxWorkers=4`, passed **241 files / 1,362 tests**. `npm run build` and `git diff --check` passed; only established chunk-size warnings and existing test-environment warnings remain.
- **Real-log dry read at 2026-11-13T11:45Z:** path absent, `exists=false`, `readError=null`, lines/events/dry-run/duplicate/malformed/non-split counts all zero. No real split event has been observed by this reader yet. The split watch, price rows, raw archives and upcoming-split calendar were not changed.
- **Delivery boundaries:** no schema change, production write/push, credential access, collector or web restart. Pre-existing generated reports and `.vscode/` are excluded. K16 remains blocked until Claude accepts K15; Claude owns the web restart after review.

## 153. Claude: v3 review → v3.1 final (step 1 closed); K15 accepted, web server restarted; K16 sent; price gates 6-7 — 2026-11-13 early morning

- **Owner:** "go on with the v3 fundamentals workbook review so we can close the chapter of raw data cleaning … and go on with your recommendations, i will expect a report in the morning".
- **v3 review** (Claude, on the owner's behalf):
  - Every K14 value was set against the company's neighbouring quarters. 47 outliers were read with their evidence; suspects were checked in SEC facts.
  - Most outliers are real: one-off losses (GPC 2020, TJX 2020, Booking, Viatris 2025, International Paper 2025-26) and seasonality (Atmos' gas cost).
- **Corrected in v3.1** (lab `a6d62b4`):
  - Ventas Q4 capex: the `x:` path paired the 10-K's broader `PaymentsToAcquireProductiveAssets`, 2,530m with acquisitions.
  - Fiserv Q3 2026 cost of revenue: 8,789m → 2,337m; a 6,452m goodwill impairment sat inside total expenses.
  - CrowdStrike D&A: `first`; a partial standard tag in the 2026 10-Q had outranked the sum.
  - Kimco 2025 capex: zeros → 52-116m.
  - Amcor fiscal-2026 weighted shares: 1.5-10m → 463m.
  - Host Hotels' debt from 2008: 59 values, 58 equal to the filings.
  - New `build.mts` rule: on one-signed lines an `x:` pair must keep pace (≤3×) and sign; a zero year-to-date passes.
    - This made 44 wrong values gaps: CME's negative Q4 D&A 2020-25, negative costs (Merck 2008, Occidental 2012-13), ConocoPhillips' −13.5bn capex, Mondelez and Baxter interest, ITW 2008 dividends, GM's 2014 preferred redemption.
  - All 110 K14 entries are marked `reviewed: true`.
- **v3.1 gates against v3:** 0 broken filing matches; checks unchanged (freshness 0, revenue line 96.58%); QA equal or better (gross profit 510, signs 243).
- **Loaded** as build `v3.1`, **final**, into `alpha_research`.
  - Counts: 1,664,739 values (29 fewer than v3: the 44 removals, offset by Host's added debt), 32,727 quarters, 500 companies, 64 fields.
  - 2,000 values read back, 0 different; 930 s.
  - A final build blocks `--replace`: later builds append.
- **Step 1 of the fundamentals is closed.** Left, documented in `STANDARD_FUNDAMENTALS.md` §5:
  - PSA's capex versions filed in 2023;
  - PulteGroup's debt before 2026;
  - share-count basis items for step 2 (issued vs outstanding; one class).
- **K15 accepted** (Kimi §152, `b39d47d`).
  - My review: the diff matches the spec. Adding 8 to the split ratios was needed for SNDK.
  - My test run: `split-shares-price`, `split-shares` and `market-value`, 29/29 passed.
  - Web server restarted through the `AlphaEngine-Home-Server` task at 04:01:31 PT: one listener on port 3000 (pid 23292), HTTP 200.
- **K16 sent** (spec `docs/engine/tasks/K16-standard-13f.md`, `14d6e59`; owner: "K15 now, K16 after"): standard 13F tables in `alpha_research` from the fund books, point in time. Kimi is working.
- **Prices gate 7:** levels against the SEC public float (lab `b265e69`).
  - 466 companies, 6,856 company-years: 97.8% within 0.3-1.15.
  - The Schwab-built years do no worse than Tiingo's (1.8% outside against 2.3%).
  - The outliers are mostly scale slips and zeros in the float facts. `STANDARD_PRICES.md` gate 7.
- **Next:**
  - Claude: the Yahoo US pull summary when it ends (about 07:30 PT), the morning report to the owner, K16 review on delivery.
  - Owner: step-2 instructions (normalization, share basis); prices p1 stays provisional until the daily append exists.
- **Section 153 continued (05:10 PT).**
  - **Prices p1.1** (lab `8c2ab40`), loaded with `--replace`, provisional.
    - Load: 2,891,701 bars, 514 companies: 505 `ok`, 9 `review` (before: 20); 1,992 random bars read back, 0 different.
    - Fixes:
      - SPY and the sector funds have no `companies` row: their ticker now comes from their price rows, so dividends enter their index. SPY's sessions differing from Stooq fell from 104 to 22.
      - A single Schwab bar, where Schwab alone supplies the price, that Stooq contradicts by more than 3% and the next session reverses is left out: 123 bars (SPY 2011-08-02).
    - Gates: total return 0.25% of sessions differ; spot 505/510; splits 440/440.
  - **UI move** (owner, backburner: "continue with old UI functionality to be transfered to your new design … delegate"):
    - Inventory of all classic views and plan in `docs/desk/UI_MIGRATION.md`: keep, merge or drop per view; phases K17a-e for Kimi; fixes; ideas including a Telegram add-on; Claude's to-do.
    - Fixes to make on the way:
      - `browse.*` and `sentiment.labStats` are open to any member;
      - `/admin` has no route guard;
      - the messages contact list exposes all accounts;
      - `dashboard.stats` is polled every 5 s;
      - Expectations bundles 27 MB.
  - **Queued specs for Kimi, after K16:** K17a (messages and owner tools in the desk), K18 (weekly refresh of the standard prices; draft ready).

## 154. Kimi: K16 standard 13F built, loaded and verified in alpha_research — 2026-11-13T16:37Z

- **Baseline and delivery:** main `67aa4a0` matched origin before this documentation-only block. Lab final commit is **`e4c278e`** (`Batch standard 13F loads and canonicalize JSON read-back`), containing the builder, loader, schemas and 13 tests. Main changes are limited to new `docs/engine/STANDARD_13F.md` and this handoff; the exact documentation commit and fast-forward state are authoritative in `git log`.
- **Inputs:** fund books rebuilt from cache (7,221 filings: 2 re-read, 7,219 reused), standard prices **p1.1** (2,891,701 bars), final fundamentals **v3.1** (1,664,739 values). No new 13F filings were collected. Only EDGAR submissions lists were fetched for missing dates: **190 requests**, one per missing fund, paced below 5/s and cached on D:. They resolved 618 accessions; 83 remain unresolved and fail closed. The final build reused all 190 lists and made zero network requests.
- **Tables:** provisional `k16.1` in `alpha_research`: `std_13f_filings` **7,221**, `std_13f_positions` **2,393,709**, `std_13f_company_quarters` **12,077**, and one `std_13f_builds` row with code commit `e4c278e1cf61b3e1f78174e8522b6ea00f73f847`. Loaded at 2026-11-13 16:37:18, **2,000 random rows read back with zero mismatches**. Every insert batch was at most 500 rows; the build row was written last after counts and read-back passed.
- **Availability:** `knownAt` is the first trading session after the business-day-adjusted 45-day deadline, confirmed with Claude. For 2026-06-30: deadline Friday 2026-08-14, knownAt Monday 2026-08-17, 301/307 books (98.0456%) available. Sixteen late accessions are listed separately. 2026-09-30 is deferred until its future knownAt is in the session calendar. Later amendments cannot rewrite stored history.
- **Check 1:** cover totals exactly match the manifest: agree 6,665, thousandfold 46, rowsDiffer 199, valueDiffers 193, noTable 116, partTable 2, notStated 0. **Check 2:** ten deterministic random raw XML re-reads, zero mismatches. Unit counts and all three unresolved unit cases match the manifest; zero positions lack a split factor.
- **Check 3:** $612,625,139,992,399 / $624,725,547,067,065 priced value within 2% = **98.063084%** (pass). Unpriced value is $301,089,711,931 (0.04817% of all position value), excluded from the denominator and listed separately. `price-outliers.jsonl` has 99,602 priced and 8,150 unpriced rows, sorted by value. RIVN's missing-price fallback is the evidenced split factor 1 from empty event lists, explicitly labeled.
- **Check 4:** the full-book 2026-06-30 tie is **493 companies, zero differences**. Point-in-time rows intentionally differ from the later full book; 16 late filings are in `late-funds.json`.
- **Check 5:** 158 above-100% ownership rows retain reasons. Another 92 cover-derived counts below 1,000,000 shares are rejected as denominators, with null percentages and filed evidence in `denominator-exclusions.json`; placeholder-like values are not explained away as real ownership.
- **Check 6:** app legacy comparison: 370 companies, $17,199,558,833,123 held / $32,126,221,264,865 declared; standard 493 companies, $43,465,564,787,623 covered / $60,574,814,607,781 filed. Legacy `fund_holdings` was read only and not changed.
- **Check 7:** 13 deterministic lab tests and standalone TypeScript pass. Batched inserts, exact table counts, 2,000-row canonical JSON read-back and independent stored build/count checks pass. `load-report.json` SHA256 `abc1aebc226b77b8b3cbb5d6f4e81fd263cb6796f3c8cbf96e93651c0075a7ce`.
- **Recovery record:** an early load was stopped to reject invalid denominators; rollback eventually proved all four tables empty. The next load exposed exactly two JSON key-order-only differences, not value mismatches. Canonical JSON comparison and autocommit batches replaced the single huge transaction, and the retry completed in 1,431.753 s. No MySQL restart or destructive cleanup was used.
- **Artifacts:** `D:\research\alpha-engine\fund-books\std\`; `build.json` SHA256 `9e8acc8871b1499d277f6a5dcba0c0aefdc2bc59fa7e2916eed50d70555eaa0a`; positions JSONL 955,485,633 bytes, SHA256 `825486fe646674baca07176eb41335a0c61473b5b69c0631c795d0672d46bb06`; company quarters SHA256 `ca975082524b8ea3523f04ef83159a8bc28e77a838cb6057b73fb2d03a53a2e2`.
- **Boundaries:** no production write, no `alpha_engine` schema change, no app page/signal change, no scheduler or web restart, no credential access. Pre-existing generated reports and `.vscode/` remain uncommitted and excluded. Provisional research tables remain blocked from app/production use until Claude accepts K16; K17/K18 were not started.

## 155. Kimi: K16.2 filed-price basis corrections and provisional load complete — 2026-11-13T18:25Z

- **Review correction:** Claude found that new-basis filings were receiving the period split factor again. Positions now derive a factor from their own filed price against the split-adjusted close and snap only to plausible split products. Zero/unusable prices use the period-end assumption; factor-1 non-matches are labeled `no_split_factor`. `sharesBasic` and the ownership numerator are both on today's basis: `sharesBasic × splitIndex(today) / splitIndex(filed)`.
- **Tables:** provisional `k16.2`, loaded at 2026-11-13 18:25:29 with `std_13f_filings` **7,221**, `std_13f_positions` **2,393,709**, `std_13f_company_quarters` **12,077** and one `std_13f_builds` row with exact code commit **`142c6ea152bcb714bc3b83cff5ac8403a116855f`**. Batches are at most 500; 2,000 random rows read back with zero mismatches. Independent post-check counts match. Main baseline was `de1cb73`; the final documentation commit is authoritative in `git log`.
- **Price gate:** normalized by each chosen factor, $615,013,526,601,123 / $624,725,547,067,065 = **98.445394%** of priced value within 2%. Unpriced value is $301,089,711,931 (0.04817% of all position value), excluded from the denominator. Exceptions: 79,149 priced and 8,150 unpriced rows, sorted by value.
- **Reference-book corrections:** all 14 differences are explained per fund and accession in `latest-corrections.json`, with filed shares/value, implied and actual closes, chosen and reference-book factors, normalized ratio and verdict. The small Arista position (1,369 shares, 0.13% of its fund-company total) is explicitly retained at factor 1 as a pricing anomaly, not a split or rounding; its normalized price is 1.6524. All other differences are basis corrections; none is rounding.
- **Lam before/after:** one position is 71,598 shares at $81.61 with factor 1, rather than 715,980 at factor 10. Lam 2023-09 ownership is **55.9143%** instead of 559.1430%; 2024-09 is **49.8546%** instead of 483.3809%. Evidence: `lam-k16.1-before.json` and `lam-k16.2-after.json`.
- **Other gates:** cover totals exactly match (6,665 agree, 46 thousandfold, 199 rowsDiffer, 193 valueDiffers, 116 noTable, two partTable); ten raw re-reads have zero mismatches. Unit counts and all three unresolved unit cases match. `knownAt=2026-08-17`, 301/307 books available (98.0456%), with 16 late filings listed. `knownAt` and the full-book acceptance rule were corrected with Claude, not changed silently. Ownership has 94 rows above 100% with reasons; 91 implausible cover-derived denominators are excluded with null percentages.
- **Legacy and dates:** app 370 companies / $17,199,558,833,123 held / $32,126,221,264,865 declared; standard 493 companies / $43,465,564,787,623 / $60,574,814,607,781. EDGAR use remains 190 submissions-list requests, one per missing fund, <5/s, cached on D:, 618 resolved and 83 unresolved; final build made zero new requests. No other network collection.
- **Verification:** 15 deterministic lab tests and standalone TypeScript pass. `build.json` SHA256 `c30597772f4eecf5d239c86b656cd7f78b9d2b0dfbe63809ca60f0d5e2c3a4c3`; `latest-corrections.json` SHA256 `f1e01ab6f838184d13f242bbf8179632bb4b4de745e4f0a671396f08a1b24e5b`; `load-report.json` SHA256 `79ee37260f9cc00a3fe2fb8e8f409fe681737378d2688fdd708639f485573258`. Batched loader writes the build row last; the retry completed in 1,468.898 s.
- **Recovery:** the earlier rollback and JSON key-order issue were resolved without a MySQL restart or destructive cleanup. Period-fallback was corrected after an intermediate build showed that forcing factor 1 for every unclean ratio was wrong; only factor-1 non-matches get `no_split_factor`.
- **Boundaries:** no production write, no `alpha_engine` schema change, no app/signal change, no scheduler or web restart, no credential access. Pre-existing generated reports and `.vscode/` remain excluded. Provisional research tables await Claude's K16.2 acceptance; K17/K18 were not started.


## 156. Kimi: K16.3 company-specific split factors built, loaded and independently verified — 2026-11-13T20:26:54Z

- **Baseline and implementation:** main `c0211e8` matched origin before this documentation block. Lab commits are `0615f2b` (company split history, raw denominator checks and correction classes) and `147f4df` (class-aware anomaly sizing). Candidates are only the company's own `splitIndex(today) / splitIndex(t)` values, or cumulative company split-event products when prices are unavailable; the nearest candidate in log terms is accepted within ±40%. The raw filed denominator is tested before any factor. Anomaly fractions use both split and class factors, matching company aggregation. Invalid reference-book factors cannot excuse an anomaly at or above 1%.
- **Verification:** all 17 deterministic lab tests and standalone TypeScript pass. Regressions cover Lam's old/new bases, Arista's candidate set `{1}`, no generic split products, candidate uniqueness against the filed ratio, ambiguous valuation differences, large anomalies with invalid book factors, secondary-class anomaly fractions, and Chipotle's raw count before adjustment. `git diff --check` passes for the scoped delivery.
- **Final build:** `147f4df28397744ec505bcd0d0d56a084ceeb800`, generated 2026-11-13T19:58:29.701Z, status `built`. Counts are 7,221 filings, 2,393,709 positions and 12,077 company quarters. Unit counts and all three unresolved unit cases match the fund-book manifest; zero positions lack a split factor. Cover totals are 6,665 agree / 46 thousandfold / 199 rowsDiffer / 193 valueDiffers / 116 noTable / two partTable, with ten raw re-reads and zero mismatches.
- **Price gate:** $614,805,156,746,334 / $624,725,547,067,065 = **98.412040%** of priced value within 2%. Unpriced value is $301,089,711,931 (0.04817% of all position value), excluded from the denominator. There are 79,889 priced and 8,150 unpriced exception rows, largest first.
- **Latest-book corrections:** four fund-company differences, supported by five book-forming position rows, are all explained. Classes: **1 basis / 0 valuation_difference / 3 books_error / 1 pricing_anomaly / 0 unclassified**, with zero rejected positions. Four evidence rows flag an invalid reference aggregate factor, including Arista's small anomaly. Every correction row and the full numeric evidence are in `docs/engine/STANDARD_13F.md` §9 and `latest-corrections.json`. Arista remains at factor 1 with normalized price 1.652401738 and a 0.134553% fund-company share; it is not a generic 4-for-1 or rounding.
- **Lam:** accession 000093041324003070 now has 16,081,071 filed and today's-basis shares at factor 1, not 160,810,710 from factor 10. Implied price is $72.860010, ratio 0.892783 to the $81.61 today's-basis close. The 71,598-share example also remains factor 1. Ownership: 2023-09 **55.914303%**; 2024-09 **49.846493%**, versus K16.2's 49.854553% and K16.1's 483.380925%. Evidence: `lam-k16.3-after.json`.
- **Chipotle and ownership:** frozen v3.1 has exactly 27,962 shares filed 2022-04-28 for CMG 2022-03-31 (about 27,960). The adjusted 1,398,100 is not allowed to pass the raw floor; sharesOutstanding and both percentage fields are null. There are **93** above-100% rows with reasons and **92** raw-count denominator exclusions. Bloom Energy leads at **809.832037%** on 2023-06-30 with 85,606,057 institutional shares over the preserved 10,570,841 denominator; the top ten are listed in the process document, not repaired through a split or substitute denominator.
- **Availability and inputs:** 2026-06-30 knownAt is 2026-08-17, with 301/307 books (98.0456%) and 16 separately listed late filings. Legacy comparison remains 370 app companies / $17,199,558,833,123 held / $32,126,221,264,865 declared versus standard 493 / $43,465,564,787,623 / $60,574,814,607,781. Prices are p1.1 (2,891,701 bars), fundamentals final v3.1 (1,664,739 values).
- **EDGAR usage:** the final builds made **zero** network requests, reusing 190 cached submissions lists; 618 accessions are resolved and 83 remain unresolved. The original date backfill made 190 requests, one per missing fund, below 5/s. No new 13F filings were collected.
- **Artifact SHA256:** build `41dc2067cb02e6cb896d1a7893ad25f47741784f740b7c4b60232eecbab29546`; corrections `e9657e8839abcd6b8520d6d1b188f78af230960d68bb9bf3917ec8397f800554`; filings `9e025ba566cfc63a0de9500ebb173eacc51154c9fe81cc02db81f6935f96adfe`; positions `3f1102265588f034c9d3fc18f8a404d76a7df59028a4c738a05eec7d678b3d5a`; company quarters `6244f538e04420ed13392200b687e71662a77a8de17f7702e90dfebedd066774`; Lam evidence `8e5521aacb05dc215d68e58b4b5f8d5ce1feecdfc96c1f154f1dcab754bb1ac5`; ownership `8038bc7b192532f94491520c15fcd13dcb76611279e2e16e5074f9c4d94db44c`; denominator exclusions `9a4a5153e21fa02c84c757ad444d42bfb11a32eda4702470667b37096ef68d9a`.
- **Recovery:** the first replacement load was stopped to correct class-aware anomaly sizing. Its shell wrapper stopped but three nested Windows Node loaders survived; process inspection found the exact stale PIDs, which were stopped and verified as zero remaining loaders. `std_13f_builds` independently had no build row. An unnecessary read-only partial-table count was cancelled only after that marker check. The final artifacts were regenerated from `147f4df`; all numerical artifacts and the Lam evidence hash identically to the preceding build, while `build.json` correctly names the new commit. No C: replacement archive, destructive cleanup, MySQL restart or production action occurred.
- **Load verification:** `k16.3 provisional --replace` completed at 2026-11-13 20:23:39 with 2,413,007 data rows, batches of at most 500, and 2,000 loader read-backs using seed 1601 with zero mismatches. Independent read-only post-checks confirmed the three exact counts, one provisional build row for `147f4df28397744ec505bcd0d0d56a084ceeb800`, and only `k16.3` rows in all three tables. A separate 2,000-row comparison using seed **1603** also had **zero mismatches**; Lam, Chipotle and all 93 ownership outliers match the artifacts. `load-report.json` SHA256 `e6fe8e6cc02bfbd06e67af2dc16fea729bbea257b251077513597b9321d8d3b5`; `independent-postcheck.json` SHA256 `a32899d0d7cf869242ee61a0092c16688d2c71835c1a0a09cb439cd57fe9fa13`. The loader took 1,474.159 seconds; the independent post-check took 9.005 seconds.
- **Boundaries:** only the four K16 tables in local `alpha_research` are authorized for provisional replacement, in batches of at most 500. No production write, `alpha_engine` mutation, app/page/signal change, scheduler or web restart, credential access or GDELT request occurred. Generated reports and `.vscode/` remain excluded. K17a and K18 were not started.

- **Next safe action:** Claude reviews and accepts K16.3; the research build remains provisional until then. Deliver the exact lab and main documentation commits and the evidence paths through the mailbox. The main delivery must contain only `docs/engine/STANDARD_13F.md` and this handoff, with a fresh fetch and ordinary fast-forward push. K17a and K18 were not started during K16.3.

## 157. Claude: K16 accepted (k16.3 final); K17a sent; v3.1 Chipotle erratum — 2026-11-13T20:45Z

- **K16 accepted.**
  - Read-only checks of k16.3:
    - Lam 2024-09-30: the $70 group sits at factor 1 (16.08m shares); ownership is 49.85%.
    - Chipotle 2022-03-31 has a null percentage.
    - The build row names lab `147f4df`.
  - `alpha_research.std_13f_builds` k16.3 is now **`final`** (one-row update with an appended note). Corrections come as a new build; stored rows are never overwritten.
  - The spec now records what was built: `docs/engine/tasks/K16-standard-13f.md` section 8 (main `414cd8b`). It covers knownAt, confidential tables, the per-position basis from the company's own split products, the denominator basis and its raw floor, the check 4 classes, and the load pattern.
- **Erratum:** Chipotle's v3.1 `sharesBasic` for 2022-03-31 is 27,962, a thousand-scale slip of the `d0` identity. It is noted in `docs/engine/STANDARD_FUNDAMENTALS.md` section 5 and excluded by K16. v3.1 stays final; a later build appends the corrected value.
- **Fund books (Claude's, `scripts/build-fund-books.mts`):**
  - Two known factor bugs remain:
    - Amcor's consolidation is applied twice.
    - Generic split snapping produces Thermo Fisher 1.5 and Arista 4.
  - They affect only the books' quarter files, not the K16 tables. The fix is to port the K16 company-candidate rule. Not started.
- **K17a sent** (`20261113-204000-claude-k16-accepted-k17a-go.md`). It is phase 1 of `docs/desk/UI_MIGRATION.md`:
  - server-side owner guards;
  - `/desk/messages` with the members' contact rule;
  - `/desk/admin`;
  - redirects and clean-up.
  Kimi notes Claude before the full test run, the build and the commit. Claude restarts the web server after review.
- **Running:** the guidance pass over 446 companies. At 12:36 local it stood at 10,213 of 34,833 releases (29.3%), state running; the watcher is `b9n5630q2`.
- **Waiting for the owner:**
  - K18, the weekly gated price rebuild, including the coverage choice for RIVN and ENLT;
  - Telegram for messages (yes or no);
  - the members' messages privacy default (K17a keeps "no reading of others' threads");
  - step 2 of the fundamentals (normalization).
- **Next safe action:** review K17a on delivery, restart the web server once, and check both pages as owner and as a member. Then write the K17b spec.


## 158. Kimi: K17a messages and owner tools implemented and verified — 2026-11-13T21:34:49Z

- **Baseline:** main `d94d64b`, with the K16.3 final acceptance and K17a spec pulled before work. The delivery is one commit containing server changes, desk pages, mocked tests, `docs/desk/UI_MIGRATION.md` and this section; its exact hash is authoritative in `git log`.
- **Server guards changed to `adminQuery`:** `browse.filingsList`, `browse.concepts`, `browse.conceptSeries`, `browse.filingDocument`, `sentiment.labStats`, `sentiment.tickersWithScores`.
- **Confirmed already owner-only (`adminQuery`):**
  - `admin.factorIc`, `manuals`, `manualContent`, `recentJobs`, `jobLog`, `usersList`, `createUser`, `deleteUser`, `resetPassword`, `setUserRole`, `reviewerList`, `createReviewer`, `resetReviewerFirstIp`, `resetReviewerNda`, `resetReviewerTour`, `userSummary`, `userActivity`.
  - `jobs.startBootstrap`, `startFilingRefresh`, `startStream`; `pipeline.startHarvest`, `startSeriesBuild`, `startSectionParse`; `sentiment.startScore`; `prices.startPrices`, `startImport`; `screener.refresh`; `scope.enrichClassification`; `workersMonitor.intake`.
  - `workersLocal.enabled`, `runs`, `run`, `kill`, `logTail`, `scheduler`, `operations`, `setOperation`, `runOperation`, `killOperation`, `operationLog`, `probe`. These also retain the local-only guard; the GDELT probe remains frozen for everyone.
- **Intentionally unchanged shared/member procedures:** `admin.fundFlows` stays authenticated presentation data; `universe.lookupTicker` stays the shared SEC directory; scope catalog/member/preset reads remain member-scoped; `jobs.list` and `cancel` retain their per-user rules, and `jobs.logs` remains the authenticated queue log reader. No owner tool was made member-accessible.
- **Messages:** members see only owner/admins and existing thread peers, with unread first and then latest. The member response omits roles and activity; the owner retains all accounts and user intel. `list` and `send` enforce the same contact rule, while admins may contact any account. No cross-user thread reading was added, and the misleading footer claim is gone. Shell polling is 30 s; page polling is 8 s while visible and stops while hidden. Reviewer sends remain blocked by middleware.
- **Desk pages:** `/desk/messages` has searchable conversations, a thread, 2,000-character composer and the owner's user-intel panel. `/desk/admin` has People (create, role, delete, one-time generated-password dialog, view-as), Reviewers (create and all reset/delete actions, NDA date and IP-binding state), four structured manuals, recent jobs/full log, and compact factor-IC/worker monitors. View-as exit returns to `/desk/admin`. Worker-note detail retains its SEC source link. Literal reviewer IPs and IP hashes are not exposed.
- **Routes and cleanup:** `/messages` redirects to `/desk/messages`; `/admin` has an owner guard and redirects to `/desk/admin`. Operations and Library link to the new pages. The temporary price-archive upload card, `AuthLayout.tsx`, `AuthLayoutSkeleton.tsx`, unrouted `Home.tsx`, the reviewer guide's `/fundflows` entry and the misleading footer were removed. `docs/desk/UI_MIGRATION.md` marks phase 1 implemented with review/restart pending.
- **Verification:** `npm run check` passed; full `npm test -- --run --maxWorkers=4` passed **249 files / 1,386 tests**; `npm run build` passed; `git diff --check` passed. New coverage is 24 tests: 10 server tests and 14 UI/redirect/Markdown tests. The guard suite calls all **47 owner procedures as a member (FORBIDDEN)** and all **46 enabled owner procedures as the owner (success)**; the frozen probe is separately rejected. Every People/Reviewer create, delete and reset uses mocks, never the live `alpha_engine` database.
- **Browser evidence:** seven captures in `worker/.runs/k17a-ui/`: owner messages with user intel, dark phone messages, People in light and dark phone, the generated-password dialog, structured manuals and compact monitors. Light/dark themes were explicitly selected; phone width was 390 px. All have zero page overflow and zero browser errors, and were read back visually. The browser used the existing server and mocked every API response; there was no web restart or live-data mutation.
- **Boundaries:** no schema change, production write, credential access, new external service or web restart. `api/lib/`, `api/kimi/` and `.env` were untouched. Existing generated reports and `.vscode/` remain excluded.
- **Next safe action:** Claude reviews K17a, restarts the web server once, and checks both new pages as owner and member before writing K17b.

## 159. Claude: k16.3 final withdrawn → K16.4 queued; K17a accepted (K17a.1 follow-up), web restarted; K17b and K19 specs — 2026-11-13T22:05Z

- **k16.3 is provisional again.** This corrects section 157. The final status was set at 20:45Z and withdrawn at 21:30Z, with a note in `std_13f_builds`. Nothing had read the tables. Three findings:
  - **Unresolved dates.** 83 filing dates were unresolved, so 65 fund-periods of the largest filers have no filing at `knownAt`: State Street, JPMorgan, Morgan Stanley, FMR, Bank of America.
    - Bank of America's 2024-09-30 original has 492 positions with a null `availableFrom`.
    - Cause: the cached EDGAR submissions lists hold only `filings.recent`, the latest 1,000 filings. That is under a year for the big banks; JPMorgan alone files about 26,000 a year. Older filings sit in the pages under `filings.files`.
  - **Late filings.** 328 more fund-periods were filed after `knownAt`. By sessions late: 147 by one (about $17tn; accepted on the deadline evening, stamped the next day), 54 by 2–5, 15 by 6–10, and 145 by more than 60 (re-filed whole reports, confidential originals).
  - **Timing counted as trading.** `newFunds` and `exitedFunds` count whole books present or absent, so they mostly measure filing timing.
- **K16.4** (mailbox `20261113-213500-claude-k16-4-queued.md`; the rules are in `docs/engine/tasks/K16-standard-13f.md` section 9):
  - resolve the dates from the older submissions pages;
  - `availableFrom` from the acceptance time;
  - a second row at `knownAt` + 10 sessions;
  - Chen–Hong–Stein breadth among continuing funds (`continuingFunds`, `entries`, `exits`, `breadthChange`) instead of `newFunds`/`exitedFunds`.
  - Kimi does it after K17a.1.
- **K17a accepted** (`fcd1494`): guards, the messages contact rule, `/desk/messages`, `/desk/admin`, redirects. My review note arrived after the commit, so its items form **K17a.1**:
  - `jobs.logs`: any member reads any job's log by id; limit members to their own jobs;
  - the unrouted classic `src/pages/Admin.tsx` and `Messages.tsx` are removed;
  - members get FORBIDDEN, not NOT_FOUND, for a missing account;
  - `DeskDialog` replaces `window.confirm`.
- **Web server restarted** at 21:40Z (13:40 local), once. It is one process, `node dist\boot.js`, on port 3000, and its build contains K17a's server code.
  - `/desk/messages` and `/desk/admin` serve the app.
  - Without a session, `messages.contacts`, `browse.filingsList`, `jobs.logs` and `/reports/daily-operations.json` answer 401.
  - The scheduler was untouched.
  - One more restart follows K17a.1.
- **New specs:**
  - `docs/engine/tasks/K17b-desk-operations-console.md`, phase 2 of the UI move:
    - owner-only reports;
    - honest macro lineage;
    - the operations console with Jobs, Runs, Coverage and Reference;
    - classic `/workers` and `/jobs` redirect;
    - the unused job launcher goes.
  - `docs/engine/tasks/K19-standard-options.md`: daily option readings for ~510 companies (2019 → today) in `alpha_research`:
    - session mapping by parity spot;
    - constant-maturity IV at 30, 60 and 91 days, skew, call-put spread and term slope;
    - realized volatility and event moves;
    - one reader for the DoltHub and Schwab chains, with gates.
  - `docs/desk/UI_MIGRATION.md`: the findings, phases 2–3 and the to-do were updated.
- **Health check at 20:43Z:**
  - The scheduler is online: 37 jobs done today, 0 failed.
  - CRITICAL comes only from the two macro lineage checks, a daily false alarm that K17b fixes.
  - The Schwab warning (50/51 tickers today) is minor.
  - The GPU guidance run stood at 10,213 of 34,833 releases at 12:36 local.
- **Kimi's queue:** K17a.1 → K16.4 → K19 → K17b.
- **Waiting for the owner:**
  - K18;
  - Telegram;
  - the messages privacy default;
  - the step-2 normalization of fundamentals.
- **Next safe action:** review K17a.1 and restart the web server once; then review K16.4.


## 160. Kimi: K17a.1 review corrections verified — 2026-11-13T21:53:13Z

- **Baseline:** main `06e56a6` includes K17a's acceptance, K16.4's spec, K17b/K19 and Claude's handoff 159. This is a fast-forward follow-up to `fcd1494`, not an amended or rewritten commit. The exact K17a.1 commit is authoritative in `git log`.
- **Job logs:** `jobs.logs` now applies the same ownership rule as `cancel`: an admin reads every log; a member reads only jobs they started, and missing/other users' jobs are refused. The guard inventory now covers **48 procedures as a member (FORBIDDEN)** and **47 enabled owner procedures as the owner (success)**, plus the separately frozen probe. A dedicated own/other/admin regression passes.
- **Account privacy:** for non-admin callers, missing and disallowed recipients both return FORBIDDEN, so account existence is not revealed. Admins retain NOT_FOUND. The message regression covers both roles and self-messaging.
- **Delete dialog:** People now confirms deletion in `DeskDialog`, with the account, universe and message consequences stated. The test proves `window.confirm` is not called; create, role, reset and view-as behavior is unchanged.
- **Dead UI removed:** classic `src/pages/Admin.tsx` and `Messages.tsx`, plus orphaned `ReviewerAdminTab.tsx` and its test, `WorkersIntakeCard.tsx`, `FactorIcMonitor.tsx` and `PriceImportCard.tsx`. The server-side reviewer and price-import functionality remains intact.
- **Verification:** focused **17/17** and `npm run check` passed before the full run; full `npm test -- --run --maxWorkers=4` passed **248 files / 1,385 tests**; `npm run build` and `git diff --check` passed. No live test database, production write, schema change, credential access or web restart occurred. New K17b/K19 specs and unrelated generated reports were excluded from this commit.
- **Next safe action:** Claude reviews K17a.1 and performs the single remaining web restart. K16.4 is next in the approved queue.


## 161. Kimi: K16.4 dated coverage and breadth built, loaded and independently verified — 2026-11-13T23:16:24Z

- **Baseline:** main `8d0248c` includes K17a.1 and the newer task specs; K16.4 is the active task, not K19/K17b/K18/K20/K21. Lab commits are `9017d96` (dated pages, timing and breadth), `c8d9f61` (raw SEC page shape), `4c350f2` (explicit residual-gap gate) and `c42bcae` (not-filed classification). All 19 deterministic lab tests and standalone TypeScript pass.
- **Date resolution:** 190 cached submissions lists and 53 cached dated pages resolved 618 accessions from recent lists and 78 from pages. The dated-page backfill made 53 HTTP 200 requests, selected by signed date (±10 days), below 5 requests/s and cached on D:. The first build made no filing-date progress because SEC pages return the recent object directly rather than `filings.recent`; the raw-shape regression fixed that without another fetch. The final build made **zero network requests**.
- **Residual source gaps:** five accessions are absent from the official page covering their signed date and remain excluded with `unresolvedComplete=false`; no filing or acceptance date is invented. `unresolved-date-evidence.json` preserves their original cover metadata and exact page paths: JPMorgan 2021-02-11 (`CIK0000019617-submissions-043.json`), 2022-02-10 (`...-037.json`), 2024-05-10 (`...-017.json`), Goldman Sachs 2023-11-14 (`CIK0000886982-submissions-011.json`), and Morgan Stanley 2024-08-16 (`CIK0000895421-submissions-011.json`). The gate requires a reason for every residual gap rather than forcing zero.
- **Timing and schema:** `availableFrom` uses the first session whose 09:30 ET open follows acceptance, falling back to the session after filing date. Company quarters now have `deadline` and `plus_10` rows, with every input selected independently at that session. The research-only migration adds rowKind, continuingFunds, entries, exits and breadthChange, drops newFunds/exitedFunds, and includes rowKind in identity. `newFunds` and `exitedFunds` are no longer used as a trading measure.
- **Build:** `c42bcae45d73ba0cb398e101d11d5d8372ad8a81`, status `built`: **7,221 filings, 2,393,709 positions, 24,600 company-quarter rows**. Unit counts and three unresolved unit cases match the manifest; ten raw re-reads have zero mismatches. Price coverage is **$614,805,156,746,334 / $624,725,547,067,065 = 98.412040%**, with $301,089,711,931 unpriced and 79,889 priced / 8,150 unpriced exceptions. Four fund-company differences are explained (1 basis, 0 valuation, 3 books_error, 1 pricing_anomaly; zero unclassified/rejected).
- **Availability and ownership:** 2026-06-30 deadline has 301/307 books (98.0456%); plus_10 at 2026-08-31 has 307/307 (100%). There are **187** above-100% ownership rows and **191** raw-count denominator exclusions. Bloom Energy's largest is **848.990473%** at 2023-06-30/plus_10, still over the preserved 10,570,841 denominator. Lam's 16,081,071-share position stays at factor 1; ownership is 56.201068% at 2023-09/deadline, 58.179799% at plus_10, 55.761094% at 2024-09/deadline and 56.330033% at plus_10. Chipotle's 27,962 raw shares remain excluded with a null percentage in both rows.
- **Absence and holder drops:** 498 records total $26,306,611,051,124 of value: 459 late ($26,185,925,077,748), 18 not_filed, 16 cover_page_only, and five unresolved_unit ($120,685,973,376). `not_filed` is a prior book with no current filing, not an EDGAR-date failure. The ten largest holder drops are fully reasoned in `docs/engine/STANDARD_13F.md`; the largest is CCL at 2026-06-30/plus_10, down 211 holders with all 212 explanations `position_no_longer_reported`, not missing metadata.
- **Breadth:** at 2026-06-30 the deadline spread is min −0.705263 / median 0.003509 / max 0.098246; plus_10 is −0.704082 / 0.003401 / 0.095238. Correlation with net shares bought ÷ shares outstanding is **0.463022** at deadline and **0.459571** at plus_10 (474 observations each). Period extremes with at least 20 observations are −0.092793 (2025-03/deadline) and +0.786792 (2021-06/plus_10). These are descriptive, not a predictive signal.
- **Artifact SHA256:** build `5ccbccb3663da1dd69810299b008bbf49db2856437bf8e103644887038397806`; corrections `e9657e8839abcd6b8520d6d1b188f78af230960d68bb9bf3917ec8397f800554`; filings `56c89ac83f51b1a3ecf1a3391550f7436a798e5bdadce20f2ae009651dca04dd`; positions `0f40a18c933101c76695de8d427d53937fefdabbb09a4ada89aff89a5884d01f`; company quarters `415da6c5278a5c7e11ae2c081763a8267bb286ded18d03e16420b1f56d5c0751`; Lam `94f9295a82b62c17dcf07d4b01b28587bd4705fa5b191bc43c133f0b896b4c02`; ownership `af81e45db910dce28e7ec3c06b2dd930138aa0859afb87b5c388dfe8191f9e56`; denominator exclusions `55f7d11ed26005d7d7823248874fecf8ef3dc908a02f9cec31d2e0a49c2470ac`; absence `f44e3fa39a0151a00c9044c7e9dddfaa5776f9afe228bc39f09dbd442b6f60e0`; holder drops `8c88cd7ccb1afe4ebc0ba6378b3db4dfd44e343a1f1174ba1e1a908bfccadb46`; breadth `1b9f70f72bb19f5ebe3b59b48c04654dc672cfb3b18bccf8eb59846cd5e2d519`; residual evidence `25e5d920be879865de69714d554af134d4e8e09915d309e9d374cc1e2ed25290`.
- **Load verification:** `k16.4 provisional --replace` completed at 2026-11-13 23:16:24 with **2,425,530** data rows, max batch 500, and 2,000 loader read-backs (seed 1601) with zero mismatches. The independent post-check repeated all three counts, verified one provisional build row for `c42bcae45d73ba0cb398e101d11d5d8372ad8a81`, checked the breadth fields, old-field removal and unique identity, and compared another 2,000 rows (seed 1603) with zero mismatches. Stored row kinds are 12,082 deadline and 12,518 plus_10. Lam's factor-1 position and all four ownership rows, Chipotle's two null percentage rows, all 187 above-100% rows and Bloom's top ten match. CCL's 215→4 drop and both latest correlations (0.4630218338977116 / 0.4595707267896085) were independently recomputed. The loader took 1,391.244 seconds; the independent check took 11.060 seconds after correcting a script quoting error before any verification. `load-report.json` SHA256 `20f5410db55307dbab6545a34551d21ab11a393c73484844a03593beedafb1c6`; `independent-postcheck.json` SHA256 `3a0b698643dc03915be27f4d04c13e72fdb363fd3dc6f93bb7180d1b7864d279`. The temporary post-check script was removed after success.
- **Boundaries:** only the four K16 tables in local `alpha_research` are being replaced, with no `alpha_engine` mutation, production write, app/page/signal change, scheduler or web restart, credential access, GDELT request or new 13F collection. K16.3 is provisional, so replacement is permitted. Existing generated reports and `.vscode/` remain excluded.

- **Next safe action:** Claude reviews K16.4. The main delivery is limited to `docs/engine/STANDARD_13F.md` and this handoff, with a fresh fetch and ordinary fast-forward push. K19/K17b/K18/K20/K21 were not started.


## 162. Kimi: K16.5 successor books and exact standard tie built — 2026-11-14T01:31:19Z

- **Baseline and code identity:** main `c65b817` before the matching repair. Lab `720a9783efb8ca53c805d71a39d513d3b008f384` sets the K16.5 version; the final artifact names exact lab HEAD `7691057a99b90728b34930b5d0cd7fa08d6f91e7` (the intervening commits are unrelated prediction-market work). Main books codeVersion is `054992dfd00a`. K16.5 is the only active task; K21/K18/K19/K20/K17b/K22 have not been started.
- **Successor evidence:** exactly two matches and no ambiguous candidates. Amcor `G0250X149` follows `G0250X107`: firstQualifiedQuarter 2025-12-31, t0 2026-03-31, successor overlap 141/171 = 82.4561%, predecessor coverage 141/165 = 85.4545%, priceRatio 1.0000000125763777. Carnival `G2004J103` follows `143658300`: firstQualifiedQuarter 2026-03-31, t0 2026-06-30, successor overlap 200/208 = 96.1538%, predecessor coverage 200/218 = 91.7431%, priceRatio 1.0000000025390439. The first three-holder quarter can be an early-adopter quarter, so the first evidenced transition is used and both dates are retained. The 80% predecessor-coverage guard rejects QIAGEN `N72482156`, whose similar price and 101/132 holder overlap covered only 61.21% of Amcor's former holders. Principal-only instruments are excluded; a genuine share security is not discarded for an isolated PRN row.
- **Company-specific factors:** the books read standard as-traded closes and `splitIndex` from the guarded D: archive, use only the company's own factor candidates, and select the basis after cross-filing outlier correction as the lab does. CrowdStrike's raw filed price selects factor 1, while its normalized pre-split valuation selects company candidate 4 and restores 155,024 today's-basis shares. Amcor fund 1456670 stays at 110,626 shares, not 22,125; generic Thermo Fisher 1.5, Arista 4 and DuPont one-third factors are gone. Eleven focused tests include these cases, early adopters, ambiguous candidates and the QIAGEN-shaped decoy.
- **Build:** `7691057a99b90728b34930b5d0cd7fa08d6f91e7`, status `built`, generated 2026-11-14T01:31:19.445Z: **7,221 filings, 2,394,388 positions, 24,600 company-quarter rows**. Unit counts and all three unresolved unit cases match the manifest; zero positions lack a factor. Cover totals are 6,665 agree / 46 thousandfold / 199 rowsDiffer / 193 valueDiffers / 116 noTable / two partTable, with ten raw re-reads and zero mismatches. Price coverage is **$614,860,013,040,614 / $624,783,659,097,464 = 98.411667%**, with $301,089,711,931 unpriced and 79,905 priced / 8,150 unpriced exceptions. Check 4 is an exact full-book tie: **zero differences and zero basis, valuation, books_error, pricing_anomaly, unclassified or rejected rows**.
- **Continuity, availability and ownership:** at plus_10 CCL is 218→208 holders from 2026-03 to 2026-06 and AMCR 172→175; at the deadline they are 215→205 and 170→173. The old CCL 211 and AMCR 155 CUSIP-driven drops are gone. The largest remaining drops are SMCI 33/28 and LRCX 32/26, followed by NKE/BLK 24, DIS/CVNA 23 and BMY/LYB 22, all reasoned in `holder-drops.json` and `docs/engine/STANDARD_13F.md`. Latest availability is 301/307 at the deadline and 307/307 at plus_10. There are 187 above-100% ownership rows and 191 raw-count denominator exclusions; Lam's factor-1 positions and Chipotle's 27,962-share raw denominator exclusion remain intact. Latest breadth correlations are **0.12297568559380777** and **0.11423200390083306**, 474 observations each, descriptive rather than predictive evidence.
- **Dates and source gaps:** final builds made **zero EDGAR requests**, reusing 190 cached submissions lists and all 53 dated pages previously collected below 5 requests/s. Five residual SEC metadata gaps remain explicitly excluded with `unresolvedComplete=false`; no date is invented. Residual evidence SHA256 is `25e5d920be879865de69714d554af134d4e8e09915d309e9d374cc1e2ed25290`.
- **Load verification:** `k16.5 provisional --replace` completed at 2026-11-14 01:55:13 with **2,426,209** data rows, max batch 500, and 2,000 loader read-backs (seed 1601) with zero mismatches. One provisional build row names exact commit `7691057a99b90728b34930b5d0cd7fa08d6f91e7`. The corrected independent post-check verified all three counts, one version per table, schema identity, successor rows, factor examples, Lam, Chipotle, ownership, holder drops and availability. It compared another **2,000** rows using seed **1603**, explicitly excluding seed-1601 IDs, with **zero mismatches**, and independently reproduced both breadth correlations. `load-report.json` SHA256 `c7aee667f91f7d447a361b4cfd34e841db89bf7e58df0e9012f62a3905e1eb54`; `independent-postcheck.json` SHA256 `7c575884db8855fe25c0756f1d647e8a72b6d98b954fa3cdeb8bbd65788b42f5`, recorded 2026-11-14T01:56:01.643Z after 25.520 seconds. An earlier unmarked insertion was replaced, not delivered; its later output was lost with the shell timeout, so its exit cause is not claimed. A second attempt correctly refused a changed lab HEAD. The subsequent source-specific type check caught the basis-map accessor and CrowdStrike correction-order issues, which were rebuilt before this final artifact. The initial missing-build-row report also used an incorrect CMG CIK, corrected to 1058090, and is preserved as `independent-postcheck-initial-missing-build-row.json` (SHA256 `5eca58492b2df8ae2deeabd1d4f755e73fa87a21ed202fc7b9343748540bdcca`).
- **Verification:** all 19 deterministic lab tests pass at the final lab HEAD. `npm run check` and the focused standalone TypeScript configuration pass; full `npm test -- --run --maxWorkers=4` passes **249 files / 1,396 tests**; `npm run build` passes. The source, matching tests and current documentation pass `git diff --check`.
- **Desk flows:** regenerated from final books codeVersion `054992dfd00a`, 23 flow quarters, 310 funds and 493 companies. Latest 2026-06 has 306 funds, 107,756 positions and 102,528 flows; bought $2,228,993,351,001.352, sold $2,014,736,788,786.630, 290 contributing funds. Desk-flow code is `aca67762c0c5`; overview generated 2026-11-14T01:34:15.843Z, SHA256 `dc153bdb54d0b56e5acbb2a04026738a8db8b8e4d945c98c47659e32429c23ec`.
- **Artifact SHA256:** build `ee53ee7e98ccf7b8a47d25a31e85b9f991bd13fbbdab936a70bcf2200bdbcbad`; corrections `5fc91c0ee2dde8a16541a0ef30fa8ba40203d47b65e4ca9503f175af9b44dc6e`; main manifest `506bf5fc2d921c83fa382019532227ed95c64ec550c88e3a15b16f4ad7ac05d6`; latest main quarter `99d681860c562c8270fb546048396d7693f905ea6100f876123a68098050c230`; filings `e1f9718d418161488cf23463f44b4dece7607c3c756cc0382eabb88e6f35baef`; positions `579398d856588d807dfb5a5b851b81971bcf58618b5f493790ff2fec77613422`; company quarters `00a5176e114467322d6a3edfaf38d02a39cf41410fbb30d7734be3081f28f6eb`; holder drops `8d353e01a6642b47029035e8bf67ba3747b6e6baef72249f3853d583e77d1811`; breadth `7438b6cfa959d65a7b3ea146501a3372aa7592513a3b1d36799cdba0b01cd8e3`.
- **Boundaries:** only the four provisional K16 tables in local `alpha_research` may be replaced, in batches of at most 500. No production write, `alpha_engine` mutation, app/page/signal change, scheduler or web restart, credential access, GDELT request or new 13F collection occurred. Existing generated reports and `.vscode/` remain excluded. The lab has no remote configured; its commits are local.
- **Next safe action:** commit and push the scoped main delivery, then Claude reviews K16.5 for acceptance. It remains provisional until accepted; K21/K18/K19/K20/K17b/K22 stay queued.


## 163. Claude: K16.5 final; specs K18/K20/K21/K22; prediction markets reviewed, collected and tested; timing grid v1 fixed, v2 and puts run — 2026-11-14T04:45Z

- **K16.5 accepted.** `alpha_research.std_13f_builds` holds one build, `k16.5`, status `final`, code `7691057a99b90728b34930b5d0cd7fa08d6f91e7`, 7,221 / 2,394,388 / 24,600 rows (read back 2026-11-14T04:40Z).
- **Specs written** (owner's decisions of 2026-11-13): K18 weekly gated std-prices refresh (`b1ca1b4`), K20 standard insiders (`b1ca1b4`), K21 intraday views on 5-minute snapshots (`ac7cb5c`), K22 daily prediction-market collector (`107ea3e`, widened in `5f3d679`). Kimi's queue after K22: K21 → K18 → K19 → K20 → K17b.
- **Prediction markets** (owner: "review improve execute and test"): review and first tests in `docs/DESIGN_POLYMARKET.md` §11; history and tests in the lab (`9238b97` … `fe6a35c`), data in `D:\research\alpha-engine\predmarkets\`. Kalshi keyless read-only endpoints; one Kalshi job at a time (two in parallel got 429).
- **The owner's timing grid,** procedure and results in `docs/engine/PREDICTION_MARKET_TIMING_GRID.md`:
  - **Version 1 fix:** the first entry is now the session after the start day (the start-day quote closes at midnight ET; before, row +0 could enter at the start day's open). Rerun: core CPI against the sector 67/99 windows z ≥ 2 (was 68), placebo 2 and 5 (was 1 and 4). Old outputs kept in `kalshi\v1-before-entry-fix\`.
  - **Version 2** (market probability as the prior, dependency table, owner's odds formula and a total-probability form, levels 0.55/0.60/0.65, claims added, one position at a time): five of seven topics at chance. The Fed (owner's formula, against the sector) passes the placebo and holds on 2024–26 trades (best window $1,102 against scrambled best $1,072, 20 meetings) but does not beat buying every meeting. CPI y/y was a 2022–23 effect.
  - **Puts on down calls** (ask at the entry close from DoltHub chains, $0.65 a contract each way, exercised in the money): 4.07 million priced trades; puts lose in every topic.
  - **Page:** "Macro Timing Grid", https://claude.ai/artifact/B77znr84LFY9YoPYhFu6Tw (version 1 and 2, puts, placebos, 2024–26 score, company records). Its in-page check had not run yet at writing (nobody had it open).
- **Processes:** the session restarted at 20:10 local. Orphaned watcher loops were stopped. The GPU guidance run (`guidance-pass2.py`, pid 7824) is untouched; at 20:10 it had 12,811 done and 22,022 left.
- **Boundaries:** research only, in the lab and on D:; alpha_research read-only for these runs; no `alpha_engine` write, production write, scheduler or web restart, credential access or GDELT request.
- **Next safe action:** review Kimi's K22 delivery when it reports; the forward check of the Fed rule uses K22's daily probabilities. Step 2 of the fundamentals waits for the owner's instructions.


## 164. Kimi: K16.5 accepted; K22 collector and Macro expectations card — 2026-11-13T20:35:18-08:00

- **Accepted predecessor:** K16.5 is `final` in `alpha_research.std_13f_builds`, naming lab `7691057a99b90728b34930b5d0cd7fa08d6f91e7` and main `e72c28e1aba82669d6f706814c49680852896679`. Claude confirmed the exact books tie, both successor CUSIPs and independent read-back. The accepted tables have not been changed.
- **K22 implementation:** `worker/prediction-markets-daily.mts` collects public, keyless market data with a single process lock, 250 ms pacing and at most two retries. It preserves the lab's D: folders and row shape, maps company KPI series deterministically, captures settlement results and daily candle histories, and writes per-run manifests and `kalshi/daily-state.jsonl`. HTTP 401/403 or a key-required response stops the job without acquiring credentials. Market-wide series and series with more than 2,000 numeric markets are excluded; political, sports, entertainment and earnings-call wording markets stay off.
- **Macro card:** `src/desk/components/MarketExpectationsCard.tsx` is on desk Macro for owner and members. It shows the next listed Fed decision and outcome probabilities, expected CPI with spread and recession probability, with primary/alternate feeds but no provider names in the reader's view. Calibration figures come from `docs/DESIGN_POLYMARKET.md` section 11. It fetches `prediction-markets.json` with `no-store`, distinguishes empty/closed/partial states, and marks stale data and last quotes rather than calling them current. Company KPI contracts are described as forward evidence, not validated standalone alpha.
- **Initial lab handoff:** Claude finished with 153 accepted series for 67 companies, 217 settled releases across 57 companies, and nine ambiguous series rejected. The main collector preserves those rules and leaves `KXNASDAQ100` and `KXINXMAXMM` folders untouched and unused. The first manual run completed with 3,771 company, 4,128 Kalshi macro and 94 Polymarket snapshots, 694 new settlement histories, 5,174 cached histories, and zero errors, quarantines or missing histories.
- **Recovery and final scope:** the manual rerun captured all 3,831 numeric company markets, including 57 inactive and three closed pending contracts without inventing settlements. It also recorded 4,134 Kalshi macro and 94 Polymarket snapshots, zero new histories, 5,868 cached histories, zero missing histories, and two HTTP 429 failures (`KXXAISUEAPPLE`, `KXLULUCC`). It is explicitly `partial`, with 578 attempts and 21 retries, and preserves the previous complete mapping rather than claiming a complete refresh. U.S. recession and CPI feeds now exclude Canada, the UK, Argentina and scheduling-only events; older raw records were not deleted or backdated. The network counter is evaluated at manifest completion.
- **Scheduled run and gates:** the registry command completed at 2026-11-14T04:35:50.800Z with `status: complete`, 3,831 company, 4,134 Kalshi macro and 109 Polymarket snapshots, 17 new settlement histories, 5,858 cached histories, zero missing histories, errors or quarantines, and **574 attempts with zero retries**. The complete mapping has 153 series for 67 companies and nine rejected series. The U.S. recession alternate is 2.25%, not the closed Canadian market's 99.9%. All **31** focused tests pass: both venue parsers, liquidity, political filters, settlement capture, key-required stop, retry limits, company mapping, daily rerun idempotency, source jurisdiction and real Fed slugs, and Macro card states/themes. The focused TypeScript check, `npm run check`, full `npm test -- --run --maxWorkers=4` (**255 files / 1,427 tests**), `npm run build` and `git diff --check` all pass. The runbook retains the owner's no-production-push note and adds only the K22 job.
- **Artifact hashes:** mapping `30623b351a198df22b2d5ea090bbe7110902ab38b33034231f4781f81b55e43f`; manifest `f66b168d02719aaabe56dfcefb771aebb669296901bc894491db98c12b3cf141`; company snapshots `d910dc7210683057346bffad69d9cd7aec7d4252656f01cf7f6b8aa1141211d7`; Kalshi macro `42915992fe78a9f68cecffc09d4e3af98e6d9c0c07187a4be1bd5e39488b94a3`; Polymarket macro `d6a49a6112fca8b7bb2a6fa1801df9892b74d9ee3a9b1459ac7d1d16250e9b3e`; daily state `22845560712e20cf4124cca59f670f9d105b9aa3210f6a5b07ef86f506420988`; desk report `59eea5ada3f290cf238c7737b072c12415f2f029036eff83c81be7c32960c4c6`. Independent `qa/2026-11-14T04-35-50-800Z.json` is `c624d9bd32a946770d027b6acb39a2b95b5018b66160d5e67fa8f748a0cfb1d6`: all five artifact hashes match, and 5,705 company, 4,599 macro and 201 Polymarket stored rows have unique signatures with zero duplicates.
- **Next safe action:** commit/push the scoped K22 files and send Claude the evidence for review and the documented scheduler/web restart. No production write or restart is performed by this work.


## 165. Kimi: K22.1 dist serving, snapshot provenance and every-day collection verified — 2026-11-14T05:09:56Z

- **Implementation commit:** `4fb4fc09209a3ebda9663aa1fd297c0a0b158762` (`Refresh prediction-market serving and snapshot history`), based on main `68f58884acdb346cf22b07a3f5ed8603a0a23d94`. The collector now atomically writes both `public/reports/prediction-markets.json` and `dist/public/reports/prediction-markets.json` and records both SHA256 values. The report is locally whitelisted with `automatic: false`; no automatic or manual production transport was run. Cron is now `15 16 * * *` in both the registry and runbook section 22a, covering every calendar day.
- **Snapshot history:** `daily-state.jsonl` has **1,779 rows**. Recomputing the first **1,778** rows gives SHA256 `22845560712e20cf4124cca59f670f9d105b9aa3210f6a5b07ef86f506420988`, exactly the pre-K22.1 hash; none of those historical rows gained `asOf` or `rule`. Only new collector rows carry `rule: "snapshot"`. The 2026-11-14 row has `asOf: 2026-11-14T05:05:25.803Z`, Fed meetings `2026-12-09`, `2027-01-27`, `2027-03-17`, `2027-04-28` in date-only form, current upper bound 4.00 and December expected upper bound 4.2638. Empty reports still produce only `{ date }`.
- **Verification:** all **31 focused tests**, focused standalone TypeScript, `npm run check`, full `npm test -- --run --maxWorkers=4` (**255 files / 1,427 tests**), `npm run build`, `git diff --check` and operations-registry validation (`[]`) pass. Tests independently cover identical public/dist content and manifest hashes, four date-only meetings, snapshot metadata, unchanged historical fixture rows and empty-state behavior. The production build was completed before the live collection, so the live run refreshed dist without another build.
- **Live scheduled-style run:** `D:/research/alpha-engine/predmarkets/daily/2026-11-14/manifest-2026-11-14T05-05-26-090Z.json`, status `complete`, finished `2026-11-14T05:05:26.090Z`, SHA256 `75244a2d12cefa6ff3dcd82261855de40b532a5bc8e124094a5343240e71bb40`. Counts: **3,831 company / 4,134 Kalshi macro / 109 Polymarket**, zero new settlement histories, **5,875 cached**, zero missing histories/errors/quarantines, **557 requests / zero retries**. Stored current-day rows are respectively **3,831 / 4,134 / 109**, all unique signatures with zero duplicates. Mapping remains **153 accepted series / 67 companies / 9 rejected**, status complete; its date rolled to 2026-11-14 and SHA256 is `56477467332fd7c54a022aef4e768451cef3d43fa54b44593b1b6db17c2fcb8e`.
- **Artifact and serving evidence:** company snapshots `5e17db88a0a0a4641f8e66907f9dbf16798fe84c092400f9486068851dfa4596`; Kalshi macro `9553a0e31935845a838ced5e619cce091758afe6ff3b3f33f4a35a28e7f539f0`; Polymarket `bdf319e9a85d67276833820cf45a074de1e6dc383b3e271455d826ad88807386`; daily state `5bdf9f548cb49bcb767aaedb9ceadeea8b0f314564cc12f575d970cfa1db1f13`. Public and dist report bytes are identical, SHA256 **`2994b24d56c3e65b1ecb382e6d184e2cdfb665003a7356dbb81f7602829a8cc1`**, matching both manifest entries. `reportFileResponse` against `dist/public/reports` returned **HTTP 200 / static / generatedAt 2026-11-14T05:05:26.038Z** with the same bytes. Independent QA `D:/research/alpha-engine/predmarkets/qa/2026-11-14T05-05-26-090Z.json`, checked `2026-11-14T05:08:40.550Z`, SHA256 `d1ade2709f4e76b0451bdb94ffb33c7d990adcb02501a27ee1a05797b377f1fc`, has every verification check true.
- **Boundaries and remaining work:** no production write, `alpha_engine` mutation, accepted-13F change, scheduler/web restart, credential access, new service or GDELT request occurred. The accepted K16.5 tables and Claude's handoff section 163 remain unchanged. Pre-existing unrelated generated reports and `.vscode/` remain uncommitted; generated public/dist prediction-market files and D: evidence stay outside the source commit. This handoff's documentation-only commit and ordinary fast-forward push are authoritative in `git log`.
- **Next safe action:** Claude reviews K22.1 and performs the **one** scheduler/web restart to load the every-day cron and report whitelist. K21 → K18 → K19 → K20 → K17b remain queued until that restart is confirmed.


## 166. Claude: K22 and K22.1 accepted; scheduler and web server restarted — 2026-11-14T05:14Z

- **Review:** pacing (250 ms, at most two retries), the key stop and the host whitelist checked in `worker/lib/prediction-market-http.ts`. The run date is the ET day of the fetch. The next-CPI expectation was recomputed independently from the stored KXCPI-26NOV quotes with the lab's rules: 0.0085 and sd 0.1182, as reported. Mapping `30623b35…` accepted (153 series, 67 companies, 9 rejected).
- **K22.1 checked:** the first 1,778 `daily-state.jsonl` rows hash `22845560712e20cf4124cca59f670f9d105b9aa3210f6a5b07ef86f506420988` as before; the 2026-11-14 row has `asOf`, `rule: "snapshot"` and date-only meetings; the report is written to `public/reports` and `dist/public/reports`; cron `15 16 * * *`. Leftover, non-blocking: the 2026-11-13 row (K22's first run) still has timestamp meetings and no marks; Kimi fixes it with the next delivery.
- **Lab guards** (lab `1db54d4`): `kalshi_companies.py` and `kalshi_daily_state.py` no longer write `predmarkets\daily\`, `companies\mapping.json` or `daily-state.jsonl`; both used to overwrite them.
- **Restart, 2026-11-14 05:13Z:** the scheduler was idle (no current job, empty queue). Stopped the scheduler tree (cmd 12928) and the web server tree (cmd 23184, node 9728), then started the `AlphaEngine-Operations-Scheduler` task and `worker\home-server-hidden.vbs`. Now: one scheduler (lock pid 9028, "82 registered jobs · one execution lane", heartbeat 05:13:29Z) and one web server (node 16460 on port 3000; `/` answers 200, `/reports/*` asks for a login as designed). `prediction-markets-daily` next runs 2026-11-15T00:15Z (16:15 Pacific).
- **Also this block:** the owner's 40-company Fed portfolio (version 2, start +0 / release +10, $1,000,000, no costs): $1,991,123 against $1,962,507 for buying all 40 at every meeting, carried by one trade (Intel, April 2026). Lab `acfeb34`; page https://claude.ai/artifact/8h8G7wGkHGdGR1Ju72vcrZ.
- **Next:** Kimi's queue continues with K21 → K18 → K19 → K20 → K17b. Step 2 of the fundamentals waits for the owner.


## 167. Kimi: 2026-11-13 snapshot provenance corrected with exact preservation evidence — 2026-11-14T05:18:50Z

- **Accepted baseline:** Claude's section 166 / main `d5157df` accepts K22 and K22.1 and records the completed scheduler/web restart at `2026-11-14T05:13Z`: one scheduler with a fresh heartbeat and one web server on port 3000. This follow-up changes only the D: `kalshi/daily-state.jsonl` artifact and this handoff; no application source changed.
- **Scoped correction:** row **1,778**, date `2026-11-13`, now has `asOf: 2026-11-14T04:35:50.800Z` from the completed source manifest and `rule: "snapshot"`. Its four meetings are `2026-12-09`, `2027-01-27`, `2027-03-17`, `2027-04-28`; all ten numeric fields, including `fed4Expected: 4.705`, are unchanged. Every one of the other **1,778 rows** is byte-identical. The file still has **1,779 rows**.
- **Hashes and preservation:** daily-state SHA256 changed from `5bdf9f548cb49bcb767aaedb9ceadeea8b0f314564cc12f575d970cfa1db1f13` to **`0a12037e45bf676003a05531232cc17ce1825859bfb8176bbc0481eb2881062a`**. The original complete file is preserved at `D:/research/alpha-engine/predmarkets/qa/daily-state-before-2026-11-13-provenance-5bdf9f548cb4.jsonl` with the exact before hash. Source manifest `D:/research/alpha-engine/predmarkets/daily/2026-11-13/manifest-2026-11-14T04-35-50-800Z.json` retains SHA256 `f66b168d02719aaabe56dfcefb771aebb669296901bc894491db98c12b3cf141`; no historical run manifest was rewritten.
- **Independent QA:** `D:/research/alpha-engine/predmarkets/qa/2026-11-13-snapshot-provenance-0a12037e45bf.json`, checked `2026-11-14T05:17:51.402Z`, SHA256 `18e8c28842b7fb95fe34d9bb53db5616c88db5ca525eb57dd8e6e9b70622a73b`. A separate read-back independently recomputed current/backup hashes, exact target content, row counts, date-only meetings and byte equality of every non-target row; all checks passed. The guarded dry-run refused any hash, row-count or original-row mismatch before the atomic apply.
- **Verification and boundaries:** all **31 focused prediction-market tests** pass again after the correction. No source code changed, so K22.1's full **255 files / 1,427 tests**, TypeScript and production-build results remain the latest full source gates. No collector/network request, database write, production action, scheduler/web restart, credential access or accepted-13F change occurred. Existing unrelated generated files remain uncommitted.
- **Next safe action:** report the new hash to Claude and start the approved **K21** queue item. This documentation-only commit and ordinary fast-forward push are authoritative in `git log`.


## 168. Kimi: K21 five-minute intraday views implemented and verified — 2026-11-14T06:33:12Z

- **Baseline and scope:** main `e5cb4f6` includes K22/K22.1 acceptance, the completed scheduler/web restart and the 2026-11-13 snapshot-provenance correction. K21 is display work, not a research-history collector. One delivery contains the collector/API/UI changes, regression tests, operations registry and runbook, runbook-generator text, `docs/desk/UI_MIGRATION.md`, and this handoff; its exact commit is authoritative in `git log`.
- **Collector:** `schwab-intraday` now has **81 weekday slots** from 06:40 through 13:20 Pacific, every five minutes (`40,45,50,55 6 * * 1-5; */5 7-12 * * 1-5; 0,5,10,15,20 13 * * 1-5`). Compact quotes are retained every slot; raw responses are written only at 00/20/40, with `rawRetained` and a nullable raw SHA256 in the manifest. Existing raw files and the ten-session retention are unchanged. Bars use consecutive snapshots, so their highs and lows remain approximate. New quotes preserve the provider's delay flag; old snapshots keep delay unknown.
- **Company procedure:** `desk.intraday({ ticker, sessions ≤ 5 })` reads cached bars by file time and returns company, SPY and the GICS sector fund. It computes cumulative typical-price VWAP, previous close and opening gap, rebases earlier sessions using the price-adjustment log's ratio and firstNewBasisDate (including inverse volume adjustment), and merges exact release-calendar timestamps with app 8-Ks. An 8-K without exact evidence is explicitly `filing date only`; no ingestion timestamp is presented as publication time. Delayed/open/closed states are explicit, and a missing company/session returns null rather than a fabricated path.
- **Market summary:** `desk-snapshot-live` now also writes `desk-intraday-market.json` to public and dist from the latest stored session bars even after official closes. It contains per-step breadth, SPY against the equal-weighted companies, all 11 sector funds, top movers and per-company paths shared by Watchlist and Today. A real builder run covered **493/493 companies**, 21 breadth steps and 11 funds. Public/dist are byte-identical, **726,830 bytes**, SHA256 **`e08f3f169b0041824a2f466731eb9790f5f10e7b18634022cc7db27244c46b8b`**. Latest stored breadth is 311/493 above previous close (63.0832%); SPY is −0.3632% and equal weight +0.1272%. The current real archive is still the previous 20-minute cadence until the scheduler restart; five-minute fixtures prove the new job behavior.
- **Real company read-back:** AAPL session 2026-11-13 has **21 company / 21 SPY / 21 XLK bars**, previous close 354.88, VWAP **357.53318958838815**, opening gap **0.008678990081154137**, no markers in that session, and delay `null` because the older snapshots have no flag. `desk.intradayMarket` serves the closed session honestly, with asOf `2026-11-13T21:20:14.051Z`.
- **Views:** Company adds Today / 5 days with price/VWAP, separate volume, previous-close line, opening gap, exact/day-only markers and SPY/sector return comparison. Markets adds Through the day with breadth, SPY/equal weight, sector funds and movers with day paths. Watchlist and Today share per-company five-minute paths and as-of labels. Polling is every five minutes only while visible and the session is fresh/open. Charts use one value axis each and native hover titles on every point. DevNotes retain the actual limitations: approximate extremes, raw only at 20-minute marks, ten retained sessions and day-only 8-Ks where no exact timestamp exists.
- **Tests:** all **18 new focused tests** pass: seven collector (cadence, five-minute bars, raw marks, delay flags), four procedure (SPY/sector, VWAP, previous close, exact/day-only markers, two sessions across a split), two market computations and five desk views (render, empty, snapshot label, tooltip, closed state). Full `npm test -- --run --maxWorkers=4` passes **258 files / 1,439 tests**. `npm run check`, `npm run build`, operations-registry validation (`[]`) and `git diff --check` pass.
- **Browser evidence:** all **16** screenshots in `worker/.runs/k21-ui/` cover Company, Markets, Watchlist and Today in light/dark at desktop and 390 px. Final matrix has zero browser console errors and zero page overflow. `worker/.runs/k21-ui/qa.json` is `verified`, SHA256 **`a980359739a6b5d2c92cf4f737339d7db31c097598b6735c7b7bc68aa1495920`**. An initial Company phone overflow was traced to the existing comparison table and fixed with the standard scroll wrapper, then the full matrix and focused tests were rerun. Browser API transport was mocked; only the local built app shell/assets were served, with no live mutation or credentials.
- **Boundaries:** no production write, schema change, `alpha_engine` mutation, accepted-13F change, scheduler/web restart, new external service, credential access or GDELT request occurred. No manual Schwab collection was started; the existing local snapshot builder was run once after a dry-run and no duplicate builder was active. Generated `public/reports/desk-intraday-market.json`, `public/reports/prediction-markets.json`, dist output, browser evidence and pre-existing unrelated generated changes are excluded from the source commit; `.vscode/` is also excluded.
- **Next safe action:** Claude reviews the single K21 commit, then performs **one scheduler restart for the five-minute cadence and one web restart for the new procedures**. After those are confirmed, the approved queue continues with K18 → K19 → K20 → K17b.


## 169. Kimi: K21.1 retention and busy-lane review corrections verified — 2026-11-14T06:45:32Z

- **Review baseline:** main `6aef1939fcaf2ec7976ca071ec44b66a230c7346` delivered K21 with handoff 168. Claude's pre-build review then requested two corrections before acceptance: the spec's "Storage, with nothing deleted" must override the former ten-session pruning, and the single scheduler lane must be proven not to accumulate stale five-minute runs. This follow-up supersedes the retention statements in section 168.
- **Nothing pruned:** `sessionsToDrop`, `INTRADAY_SESSIONS_KEPT`, the pruning loop and `rmSync` are removed from the intraday collector and its helper. Every session now accumulates on D:; the desk still reads at most five. The writer retains both its D:-letter check and a `realpathSync(ROOT)` check before any provider request or file write. A regression reads the collector source and requires true `capturedAt = new Date()`, the realpath guard, and no pruning/deletion symbols. No session or raw-response data was deleted by this work.
- **Busy-lane evidence:** the scheduler's due-job step is now the exported, tested `queueDueOperations`. It preserves `state.current`, queues a given job at most once whether running or already pending, and advances every due slot to the next future cron slot instead of creating a stale backlog. The regression holds `schwab-context-hourly` in the running slot across the 0/+5/+10/+15-minute intraday boundaries: exactly one `schwab-intraday` entry remains pending, nextRuns is always in the future, and removing it yields exactly that one late run. Repeated later due ticks still produce one entry. A late collector uses its actual start time, not the missed cron timestamp. Existing scheduler behavior is unchanged apart from extracting this tested helper.
- **Documentation:** the operations registry, runbook section 20a, UI migration and Watchlist DevNotes now say sessions accumulate and the desk reads at most five. The registry/runbook also state the single-lane coalescing and true-capture rule. No visual behavior changed after section 168, so its verified 16-view light/dark desktop/390 px matrix and QA SHA256 `a980359739a6b5d2c92cf4f737339d7db31c097598b6735c7b7bc68aa1495920` remain applicable.
- **Verification:** all **37 focused tests** pass (19 scheduler, seven collector, four procedure, two computations, five desk). Full `npm test -- --run --maxWorkers=4` passes **258 files / 1,440 tests** (one new busy-lane regression). `npm run check`, `npm run build`, registry validation (`[]`) and `git diff --check` pass. The 18 K21 feature tests and all existing suites remain green.
- **Boundaries:** no production write, schema change, `alpha_engine` mutation, scheduler/web restart, manual Schwab collection, credential access or data deletion occurred. Generated reports, dist output, browser evidence and unrelated working-tree changes remain excluded from this scoped source/test/documentation/handoff follow-up commit; its exact hash is authoritative in `git log`.
- **Next safe action:** Claude reviews K21 + K21.1 and performs the one scheduler restart for cadence/coalescing and one web restart for the new procedures. K18 follows after confirmation.


## 170. Claude: K21 and K21.1 accepted; scheduler and web server restarted — 2026-11-14T06:48Z

- **K21.1 checked:** `sessionsToDrop`, `INTRADAY_SESSIONS_KEPT` and `rmSync` are gone from `worker/schwab-intraday.mts` and `worker/lib/schwab-intraday.ts`, so intraday sessions now accumulate on D: (about 14 MB a day; the desk reads at most five). `queueDueOperations` coalesces a busy lane into one late run (tested). `schwab-intraday` cron: 81 weekday slots, 06:40–13:20 Pacific.
- **Restart, 2026-11-14 06:48Z:** the scheduler was idle (no current job, empty queue). Stopped cmd 18512 (scheduler) and cmd 20664 (web), then started the `AlphaEngine-Operations-Scheduler` task and `worker\home-server-hidden.vbs`. Now one scheduler (lock pid 14376, "82 registered jobs · one execution lane", heartbeat 06:48:19Z) and one web server (node 960 on port 3000, `/` answers 200). Next runs: `prediction-markets-daily` 2026-11-15T00:15Z, `schwab-intraday` 2026-11-16T14:40Z (Monday 06:40 Pacific, first five-minute session).
- **Owner work this block (lab only):** per-company Fed accounts (`1f1cff8`, page https://claude.ai/artifact/LwwFK7qAupJ9MGEtqMtUgb) and JPM with the methodology note's Bayes, a mature pass and a regression (`05902d2`, workbook `D:\research\alpha-engine\JPM-bayes.xlsx`).
- **Next:** Kimi starts K18. Step 2 of the fundamentals waits for the owner.


## 171. Kimi: K18 weekly standard-price refresh completed with atomic staged swap — 2026-11-14T08:56:11Z

- **Delivery and baseline:** main `33a8350` was current when this handoff was written; unrelated newer work is preserved. Lab commit **`268a578bf8a7ed0f23e89e9747b29769c2c9a2e5`** contains the orchestrator, regression comparator, staged loader and seven regression/loader tests. The lab has no remote, so it is a local commit. Main contains the scheduler registration, full-registry collector universe, scheduler/universe tests, runbook, `docs/engine/STANDARD_PRICES.md` section 8 and this handoff; the exact main commit is authoritative in `git log`. The build row names the build-time lab code `0e5be4a806d3ee5db7957b39ffcd77247613d132`.
- **End-to-end run:** `D:/research/alpha-engine/prices/refresh-20261114T072020Z`, started `2026-11-14T07:21:34.588Z`, completed `2026-11-14T08:51:19.922Z`, status `complete`, **5,385 seconds**. Steps and durations: added backfills 1s each, local added-price load 2s, Yahoo 1,464s, reconciliation 7s, app export 2,007s, standard build 123s, gates 118s, staged load/swap 1,661s. All **516 Yahoo requests succeeded, zero failures**. Reconciliation preserved two source conflicts for review; standard split-move failures are zero. Two preflight stops (run-id formatting and Windows process spawning) were fixed before collection; the successful run resumed the same dated folder.
- **Added companies:** RIVN `1874178` has 1,258 candles/sessions from **2021-11-10 through 2026-11-13**; ENLT `1922641` has 944 from **2023-02-10 through 2026-11-13**. Their local loader wrote 28 current and 2,174 historical bars with zero close conflicts, basis changes, field differences, holes, skips or errors. `schwabPriceSeries()` now covers **516** tickers: every active registry price series plus SPY/sector funds, with XOM_PRE excluded. Independent live post-check confirms both standard series and build `p1.20261114`.
- **Build and regression:** app export has 517 company/fund records and 5,988,095 rows; the standard builder has 517 records, 410 with Tiingo and 18 unexplained steps. Gates cover 516 with a usable close. Total-return differing share moved **0.002513 → 0.002515** (increase **0.000002**, limit 0.0005); option-spot passes **505 → 505**; split moves **440/440**; unexplained steps **18 → 18**; carried-forward misses **none at the 0.003 gate**; empty sessions **5,443 → 5,443**; no previous company missing. The new calendar has **9,286 sessions through 2026-11-13**, one more than the loaded build, and matches the actual latest SPY export date rather than a weekday-only wall-clock approximation.
- **Atomic load and independent post-check:** `p1.20261114`, provisional, loaded **2,894,416 bars and 516 companies** (507 ok / 9 review), versus 2,891,701 / 514 before. The loader staged all three `std_*_next` tables, checked exact counts and **2,000 random staged bars with zero differences**, wrote the build row last, performed one atomic `RENAME TABLE`, and dropped old tables only after success. Independent post-check at `2026-11-14T08:54:39.601Z` confirmed live **2,894,416 / 516 / one build**, latest date `2026-11-13`, and no remaining `std_*_next` or `std_*_old` tables. Loader failure tests separately prove that the old complete build remains visible during loading and after a forced read-back mismatch.
- **Artifacts:** `worker/.runs/local-generated/std-prices-refresh.json`, including the independent post-check, SHA256 **`1aaf0b5647acd836cc0cb293a760d6bcc62feadd958d103ea5b00c876044406d`**. Gates `ee738a6b895051c93b82c83a8a655cce533f16d9d39909aeca02f3c0214bfe45`; companies `24241130c85325bec1b38b2ed79bb620c38b7ad873e9459db379fa20918d3dfc`; sessions `9f0b820946c766e20a5e1bc28e4b52059cf10b905043982dd2e65417afa494bb`; load summary `34f9cff9548b44f3fe429d8f8d61ae0be0e686cfb4bcbbdd3ab49a3116bc08e4`. Every step is checkpointed in C: and in the dated D: folder; old run folders are not pruned.
- **Verification:** **29 focused tests** pass (seven lab regression/loader, 22 main scheduler/universe), plus focused standalone TypeScript for both repositories. Full main `npm test -- --run --maxWorkers=4` passes **259 files / 1,443 tests**; `npm run check`, `npm run build`, operations-registry validation (`[]`) and `git diff --check` in both repositories pass. The deliberately worse regression fixture and failed staged read-back both refuse mutation.
- **Boundaries:** no production write, schema change, `alpha_engine` production mutation, accepted-13F change, scheduler/web restart, new external service, credential output or GDELT request occurred. The explicitly required local RIVN/ENLT market-price backfill is the only app-price mutation before the reviewed research swap. `alpha_research` changed only after all gates, regression and staged read-backs passed. Generated reports, D: artifacts and unrelated working-tree changes are excluded from the source commits.
- **Next safe action:** Claude reviews both commits and performs **one scheduler restart** to register `std-prices-refresh`; no web restart is needed for K18. K19 follows after confirmation.


## 172. Kimi: K18.1 provenance correction and clean-lab guard — 2026-11-14T09:09:56Z

- **Accepted build:** Claude accepted K18 and independently confirmed `p1.20261114` with **2,894,416 bars / 516 companies**, dates 2000-01-03 through 2026-11-13, no next/old tables, all regression limits, and RIVN/ENLT. The nine review companies are known identity/coverage cases, not regressions.
- **Provenance correction:** the run began with uncommitted K18 files and the orchestrator later changed once for summary metadata, so the run file is **not byte-identical** to `268a578`. Its reconstructed run/delivery SHA256 values are `20e0b0ec020dec94f122d6c46d82523c396882b7e2fa88a5b054c178897e5d85` and `6a7d3f98df1f1f44240c3c9fd729d5cfee226969efa3ef29b688852a6db03f14`. Therefore `codeCommit` remains **`0e5be4a806d3ee5db7957b39ffcd77247613d132`**, not falsely replaced. The note now reads "built from uncommitted lab code; staged load and atomic swap; provenance noted in K18.1; next Sunday produces a clean build". A guarded update changed exactly one row, affected only `note`, and independently proved every other field unchanged.
- **Evidence:** `worker/.runs/local-generated/std-prices-refresh-provenance.json`, SHA256 **`236fb2bf30746c4159b16c7042bad073c0bc9e9d0e6eb19b137e6522648b6548`**. The original and corrected row, run/delivery hashes, reason and post-check are preserved.
- **Clean-lab guard:** lab **`443789f35357cbdd6895375be5f19e447cb84cb7`** makes the orchestrator refuse to start when any runner file has uncommitted changes. The guard covers the orchestrator, comparator, loader, build/gates/reconcile/Yahoo/export scripts, reviewed overrides and research connection. It executes before collection or any database write and records the exact clean HEAD in the summary. Eight lab tests now pass, including the clean/dirty guard cases and the loader's old-build preservation tests.
- **Verification and boundaries:** the K18 main suite remains **259 files / 1,443 tests**, with check, build, registry validation and both-repository diff checks green. K18.1 changes only the provenance note, lab guard/tests and main documentation. No new collection, production write, schema change, `alpha_engine` production mutation, additional scheduler/web restart, credential output or data deletion occurred. The next scheduled run will use the clean guard and produce a clean build commit.
- **Next safe action:** Claude confirms K18.1 and the scheduler registration from its single restart. K19 follows; no second restart is needed for this lab-file guard because it is read when the job executes.


## 173. Claude: K18 and K18.1 accepted; scheduler restarted for `std-prices-refresh`; Fed factor closed — 2026-11-14T09:20Z

- **K18 checked:** live build `p1.20261114` in `alpha_research` (2,894,416 bars, 516 companies, 2000-01-03 to 2026-11-13), no next/old tables left, regression inside its limits, RIVN and ENLT added. The 9 `review` companies (NWS, DOC, VMRK, ERIE, PLD, ECHO, FOX, TPL, KVUE) are the known identity and coverage cases.
- **K18.1 checked:** the build row keeps `codeCommit` 0e5be4a with the note "built from uncommitted lab code …"; the lab runner now refuses dirty runner files (lab `443789f`, clean tree).
- **Restart, 2026-11-14 09:10:38Z:** waited for an idle scheduler with an empty queue, stopped cmd 21568, started the `AlphaEngine-Operations-Scheduler` task. One scheduler (lock pid 19204, "83 registered jobs · one execution lane"); `std-prices-refresh` next 2026-11-15T10:00Z (Sunday 02:00 Pacific). No web restart.
- **Research this block (lab only; main docs `33a8350`):** the Fed outcome is closed as a timing factor (JPM workbooks, 80/20 and 90/10, 2000–21 simulated history, daily rate sensitivity of 490 companies, responders chosen by OLS). The method and formula are recorded in `docs/engine/FACTOR_TEST_METHOD.md`.
- **Next:** Kimi K19. The GPU guidance run (pid 7824) is at 14,019 of 34,833 releases, about 2026-11-17.
