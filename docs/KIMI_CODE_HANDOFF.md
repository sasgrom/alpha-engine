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
