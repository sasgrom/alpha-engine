# Alpha Engine — Kimi Code Instructions

## 1. Required startup sequence

1. Work from the repository root. On the home Windows machine this is normally `C:\dev\alpha-engine`.
2. Read `docs/LLM_CONTEXT.md`, `docs/OPERATIONS.md`, `docs/MACRO_DATA.md` and `docs/KIMI_CODE_HANDOFF.md` before changing code or running collectors.
3. Treat historical `NOW` entries and recorded test counts as historical evidence, not current state. Establish the present state from `git log -10`, `git status --short --branch`, current artifacts and fresh test results.
4. Start with read-only inspection. Do not pull, rebase, install dependencies, start services or run collectors while the working tree state is unclear.

## 2. Non-negotiable project boundaries

- Home collection and scoring → local review → reviewed production sync. Never add default direct-to-production collection.
- Only explicitly reviewed data may reach production. Production apply commands are manual owner actions, never scheduled agent actions.
- Research must remain availability-anchored and point-in-time correct. Never use future availability, retrospective smoothing or revised future data in historical signals.
- Never modify `api/lib/`, `api/kimi/`, `.env`, infrastructure scripts or credential files.
- Never use `db:push --force`, drop tables or perform unreviewed schema changes. Inserts are limited to 500 rows per batch.
- Use port 3000 only and exactly one web server. Do not start a second scheduler or duplicate an already running collector.
- Keep raw archives on the large external D: drive with the existing realpath-aware guards. MySQL remains on C: until backup and restore testing is complete.
- LLM keys and provider credentials never enter the browser, logs, chat, fixtures or committed files.
- Schwab access is market-data only: no orders, accounts, balances, positions or account activity. Do not print or transmit tokens, client secrets, authorization codes or brokerage credentials.
- GDELT is frozen, including manual browser access. Do not send any GDELT requests.
- Code comments, UI strings and test names are English. The Russian manual is the existing sanctioned Russian project artifact.

## 3. Daily operations workflow

1. Build the read-only health report:

   ```powershell
   npx tsx scripts/build-daily-operations-report.mts
   ```

2. Inspect `public/reports/daily-operations.json`. A configured cron is not evidence of collection. Use scheduler heartbeat, per-ticker `capturedAt`, manifest status and report hashes.
3. Healthy Schwab evidence requires every expected ticker to have a complete capture for the report UTC date, readable latest chains, zero manifest errors and Feature Lab lineage matching the current normalized snapshot SHA256.
4. If the scheduler is offline, report that fact. Start the existing `AlphaEngine-Operations-Scheduler` task only after confirming that no scheduler process is already active.
5. If Schwab is stale, prefer the existing scheduler chain from `/workers` so execution remains in one lane. Run the terminal chain only when no overlapping scheduler job is active:

   ```powershell
   npx tsx worker/schwab-fetch.mts --universe research-universe-51.json
   npx tsx worker/build-schwab-market-data.mts
   npx tsx worker/schwab-features.mts
   npx tsx worker/schwab-context.mts
   npx tsx scripts/build-daily-operations-report.mts
   ```

6. Never claim fresh collection until the regenerated report proves it. Preserve failed and partial states instead of hiding them.

## 4. Code-change verification

Run the narrowest relevant tests first, then complete the gates before committing:

```powershell
npm run check
npm test -- --run
npm run build
git diff --check
```

After dependency or snapshot restoration, use `npm install --no-audit --no-fund`. Do not edit the build script to bypass an upstream failure.

## 5. Git and generated artifacts

- No hard reset, force-push or discarding of unreviewed work.
- Do not hand-edit merge conflicts in generated reports when they can be regenerated from source evidence.
- Machine-specific operations reports, raw data, credentials and scheduler state remain ignored and uncommitted.
- Commit source changes separately from reviewed generated-data deliveries.
- Ask the owner before any production apply, force operation, history rewrite or deployment.

## 6. Stop and ask the owner

Stop for an explicit owner decision before:

- production apply or cloud collection;
- schema changes, data deletion or storage migration;
- reading or rotating credentials;
- enabling paused GPU lanes or starting a long extraction;
- installing new MCP servers, plugins or external services;
- enabling Never Ask / fully unattended permissions or disabling dangerous-command guards;
- promoting a model, probability engine or factor without the required out-of-sample evidence.

## 7. Handoff protocol

At the end of a work block, update `docs/KIMI_CODE_HANDOFF.md` with:

- actual verified state and evidence timestamps;
- commands completed and their results;
- current test/build status;
- uncommitted or unpushed work, if any;
- the next safe action and explicit blockers.

The handoff is the shared channel between Kimi Code and other agent sessions. Do not invent shared memory or claim that one client can see another client's private session history.
