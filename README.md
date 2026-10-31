# Alpha Engine

Point-in-time equity research, local-first collection and reviewed production delivery.

## Start here

- **Operations UI:** `/workers` — clickable Run Stack, all scheduled/manual jobs, cron controls, dependency chains, logs and the full runbook.
- **Operations documentation:** [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — generated from the same registry used by the scheduler and UI.
- **System manual:** [`docs/ALPHA_ENGINE_MANUAL_EN.md`](docs/ALPHA_ENGINE_MANUAL_EN.md).
- **Worker details:** [`worker/README.md`](worker/README.md).

## Normal home operation

Use one web server, not both:

```powershell
npm install --no-audit --no-fund
npm run build
$env:NODE_ENV = "production"
node dist/boot.js
```

Install the hidden production server and single scheduler once:

```powershell
powershell -ExecutionPolicy Bypass -File worker\home-server-install.ps1
powershell -ExecutionPolicy Bypass -File worker\operations-scheduler-install.ps1 -DisableLegacyTasks
schtasks /Run /TN AlphaEngine-Home-Server
schtasks /Run /TN AlphaEngine-Operations-Scheduler
```

Both start hidden at logon. For development, stop the production server and use `npm run dev`. For scheduler diagnostics, use `npx tsx worker/operations-scheduler.mts` instead of the Windows task.

## Safety boundaries

- Local Ollama and local MySQL; production receives reviewed data only.
- No default direct-to-production collection and no production apply cron.
- GDELT remains frozen, including manual browser access.
- No orders, account balances or positions from Schwab.
- No credentials in browser code or Git.
- No forced DDL, table drops or unreviewed schema migration.

## Verification

```powershell
npm run check
npm test
npm run build
npx tsx scripts/build-operations-doc.mts
```
