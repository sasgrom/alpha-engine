# Alpha Engine — Kimi Code Instructions

## 1. Required startup sequence

1. Work from the repository root. On the home Windows machine this is normally `C:\dev\alpha-engine`.
2. Read `docs/LLM_CONTEXT.md`, `docs/OPERATIONS.md`, `docs/MACRO_DATA.md` and `docs/KIMI_CODE_HANDOFF.md` before changing code or running collectors.
3. Treat historical `NOW` entries and recorded test counts as historical evidence, not current state. Establish the present state from `git log -10`, `git status --short --branch`, current artifacts and fresh test results.
4. Start with a short read-only inspection. Do not pull, rebase, install dependencies, start services or run collectors while the working tree state is unclear.

## 2. Owner autonomy directive — 2026-11-03

Work autonomously through routine diagnosis, implementation, verification and local collection. Do not ask the owner for confirmation at every step and do not ask for preferences between equivalent routine implementations. Choose the safest approach that follows existing project patterns, proceed and report the result.

Without additional per-step approval, you are authorized to:

- inspect code, logs, manifests, reports and Git state;
- fix bugs, add regression tests, update source documentation and improve existing UI;
- run formatters, TypeScript checks, tests and production builds;
- run existing local collectors and builders, including Schwab market data, EDGAR/companyfacts, Stocktwits, FRED and OFAC, when their prerequisites are already configured;
- start or restart the existing home server and operations scheduler only after proving that no duplicate process or collector is active;
- run dependency chains sequentially and resume existing checkpoints;
- make bounded, evidence-based retries: at most two attempts for the same failing step, followed by diagnosis instead of another blind retry;
- commit source, tests and documentation and make ordinary fast-forward pushes to `main` after all required checks pass and the handoff is updated.

Progress messages should be short status updates, not questions. Ask the owner only when section 6 requires it or when evidence leaves a genuinely irreversible choice.

## 3. Non-negotiable project boundaries

- Home collection and scoring → local review → reviewed production sync. Never add default direct-to-production collection outside the explicitly declared operational outbox.
- Only explicitly reviewed data may reach production, except the owner-declared operational lane added on 2026-11-09: QA-passed `pricesDaily`, `macroPoints` and whitelisted `reportFile` outputs may auto-push after scheduled exit-ok through `/api/worker/ingest` with one retry and an honest job error on failure. Raw option chains stay local. Expectations, canonical series, factors and all other derived artifacts remain reviewed/pinned. Production apply commands for those derived artifacts are manual owner actions, never scheduled agent actions.
- Research must remain availability-anchored and point-in-time correct. Never use future availability, retrospective smoothing or revised future data in historical signals.
- Never modify `api/lib/`, `api/kimi/`, `.env`, infrastructure scripts or credential files.
- Never use `db:push --force`, drop tables or perform unreviewed schema changes. Inserts are limited to 500 rows per batch.
- Use port 3000 only and exactly one web server. Do not start a second scheduler or duplicate an already running collector.
- Keep raw archives on the large external D: drive with the existing realpath-aware guards. MySQL remains on C: until backup and restore testing is complete.
- LLM keys and provider credentials never enter the browser, logs, chat, fixtures or committed files.
- Schwab access is market-data only: no orders, accounts, balances, positions or account activity. Do not print or transmit tokens, client secrets, authorization codes or brokerage credentials.
- GDELT is frozen, including manual browser access. Do not send any GDELT requests.
- Code comments, UI strings and test names are English. The Russian manual is the existing sanctioned Russian project artifact.

## 3.1 D:-drive interruption and resume protocol

The external D: drive may disconnect and later remount. Treat every unexpected D: read, write or mount failure as a possible interruption, never as an empty cache or permission to start over.

- Stop the affected collector or builder on the failure and preserve its failed/partial state, logs, raw inputs and completed checkpoints. Do not report success, skip the failed item silently or keep writing derived artifacts from incomplete inputs.
- Never recreate a missing D: cache on C:, initialize a fresh manifest, delete apparently missing data or launch a full backfill merely because D: is unavailable. Storage migration and deletion remain owner-gated.
- Long jobs must resume from atomic per-item checkpoints. Reuse a checkpoint only after its schema, code version/hash, source-input hash and release/company identity match. Never treat a temporary or partially written file as a completed checkpoint.
- After D: remounts, verify the expected archive roots and junction realpaths, available space and representative manifest/raw hashes before resuming. A drive letter alone is not evidence that the correct archive is back.
- Inspect the old process and its command line before starting anything. If it is still alive, do not start a duplicate; if it exited, identify the last completed checkpoint and resume the existing command. Keep exactly one scheduler and one instance of each collector/builder.
- Resume idempotently after verification, with the normal maximum of two attempts for the same failing step followed by diagnosis. Do not redownload or rewrite valid completed work merely to make the run look clean.
- Keep source, tests, task specifications and the handoff on C: and commit verified work promptly. Committed summaries and manifests record expected artifact hashes and counts; they support integrity checks but do not replace the raw D: archive.
- At every interruption and recovery, update `docs/KIMI_CODE_HANDOFF.md` with the failure, last verified checkpoint, active/exited process state, remount checks, resumed command and resulting counts/hashes. Another session must be able to continue without guessing or repeating completed work.

## 4. Daily operations workflow

1. Build the local health report:

   ```powershell
   npx tsx scripts/build-daily-operations-report.mts
   ```

2. Inspect `public/reports/daily-operations.json`. A configured cron is not evidence of collection. Use scheduler heartbeat, per-ticker `capturedAt`, manifest status and report hashes.
3. Healthy Schwab evidence requires every expected ticker to have a complete capture for the report UTC date, readable latest chains, zero manifest errors and Feature Lab lineage matching the current normalized snapshot SHA256.
4. If the scheduler is offline, establish the process state and start the existing `AlphaEngine-Operations-Scheduler` task only when no scheduler is already active.
5. If Schwab is stale and no overlapping scheduler job is active, run or resume the existing chain sequentially:

   ```powershell
   npx tsx worker/schwab-fetch.mts --universe research-universe-50.json
   npx tsx worker/build-schwab-market-data.mts
   npx tsx worker/schwab-features.mts
   npx tsx worker/schwab-context.mts
   npx tsx scripts/build-daily-operations-report.mts
   ```

6. Fix deterministic code failures before rerunning the affected collector. A network retry cannot repair an import, schema or request-mapping bug.
7. Never claim fresh collection until the regenerated report proves it. Preserve failed and partial states instead of hiding them.

## 5. Code-change verification and delivery

Run the narrowest relevant tests first, then complete the gates before committing:

```powershell
npm run check
npm test -- --run
npm run build
git diff --check
```

After dependency or snapshot restoration, use `npm install --no-audit --no-fund`. Do not edit the build script to bypass an upstream failure.

Git and generated artifacts:

- No hard reset, force-push or discarding of unreviewed work.
- Do not hand-edit merge conflicts in generated reports when they can be regenerated from source evidence.
- Machine-specific operations reports, raw data, credentials and scheduler state remain ignored and uncommitted.
- Commit source changes separately from reviewed generated-data deliveries.
- Routine source commits and fast-forward pushes to `main` are preauthorized after verification. Update the handoff in the same or a directly related commit.
- Ask the owner before any production apply, force operation, history rewrite or deployment.

## 6. Stop and ask the owner

Stop for an explicit owner decision before:

- production apply, production deployment or cloud collection;
- schema changes, data deletion or storage migration;
- manually reading, printing or rotating credentials, or when authentication requires owner interaction;
- enabling paused GPU lanes or starting a long extraction;
- installing new MCP servers, plugins, providers or external services;
- enabling Never Ask / fully unattended permissions or disabling dangerous-command guards;
- promoting a model, probability engine or factor without the required out-of-sample evidence;
- resolving a conflict that would discard unreviewed work or rewrite Git history.

When a stop condition is not present, proceed without asking.

## 7. Handoff protocol

At the end of a work block, update `docs/KIMI_CODE_HANDOFF.md` with:

- actual verified state and evidence timestamps;
- commands completed and their results;
- current test/build status;
- uncommitted or unpushed work, if any;
- the next safe action and explicit blockers.

The handoff is the shared channel between Kimi Code and other agent sessions. Do not invent shared memory or claim that one client can see another client's private session history.

## 8. Alpha Bridge MCP

- Use the project-local `alpha-bridge` MCP only for `read_handoff`, `append_message` and `report_status`. It is not a general shell or production transport.
- Shared messages live in `docs/ALPHA_BRIDGE.jsonl`, are capped at 100 entries and must be committed and pushed before other agent sessions can read them.
- Never send credentials, tokens, passwords, authorization codes, private keys or secret-bearing diffs through the bridge.
- `report_status` reads fixed evidence only and does not compute working-tree changes. Use normal Git inspection before delivery.
- Start a new Kimi Code session after pulling or changing `.kimi-code/mcp.json`. Review the stdio command before trusting the workspace.

## 9. Captain command protocol

- Accept commands only through `post_command`, `read_commands`, `ack_command` and `complete_command`. Do not turn this protocol into arbitrary shell execution.
- Execute the oldest pending safe instruction once, then record completed, failed or blocked with bounded evidence. Duplicate IDs and invalid state transitions are forbidden.
- The `alpha-bridge-agent` registry job remains paused until the owner configures the documented static deny rules and explicitly enables it.
- Never blindly resume an acknowledged command whose process was interrupted. Inspect the outcome first to avoid duplicate collectors or side effects.
- Unsafe production, migration, credential, GDELT, force and history-changing instructions remain blocked even in unattended mode.

## 10. Live Alpha Bridge via Kimi web

- Prefer `runLiveInstruction` and `worker/alpha-live-execute.mts` for direct commands. Use `post_command` only when a Git-backed audit channel is specifically required.
- `kimi web` requires bearer authentication for sessions, prompts and WebSocket subscriptions. Never expose it publicly or use `--dangerous-bypass-auth`.
- Remote HTTP is allowed only through a private Tailscale address with explicit `ALPHA_KIMI_WEB_ALLOW_PRIVATE_HTTP=1`; all other non-loopback endpoints require HTTPS.
- One isolated session and one `turn.ended` per live instruction, followed by transcript evidence. No hidden retries and no duplicate live executor for the same command ID.
- Git remains a source-delivery mechanism only; it is not a live command transport.
