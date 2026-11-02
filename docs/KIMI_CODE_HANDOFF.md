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

After Kimi Code finishes a block, update this file with actual timestamps, evidence, test results, commit ID and the next safe action. Other agent sessions will read the repository state rather than assuming access to the local VS Code session history.
