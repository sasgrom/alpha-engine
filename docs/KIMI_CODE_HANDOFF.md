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
- Latest full verification before this handoff: 105 test files, 580 tests passing, TypeScript check and production build successful.

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
