# Home production deployment

Use this only for the home production server on port 3000. It does not deploy to a cloud host and does not upload raw data or generated reports to Git.

## Dry run

```powershell
pwsh -NoProfile -File worker/production-deploy.ps1
```

The dry run prints the workflow without changing the repository, database or server.

## Deploy

```powershell
pwsh -NoProfile -File worker/production-deploy.ps1 -Apply
```

The script performs, in order:

1. Informational readiness check with exact missing files and commands.
2. Main-branch and clean-worktree preflight.
3. `git pull --rebase origin main` (no force-push, no hard reset).
4. Dependency install, TypeScript check, all tests and production build.
5. Pilot evidence, company exposure and macro scenario reports.
6. FRED/OFAC manifest QA and final readiness.

If any step fails, stop and inspect the exact error. Do not retry blindly.

## Start or update the hidden home server

```powershell
pwsh -NoProfile -File worker/production-deploy.ps1 -Apply -StartServer
```

The script uses the existing hidden home-server installer and checks `http://localhost:3000/scenario-lab` for HTTP 200. If the health check fails, inspect `worker\.runs\home-server.log`.

## Readiness only

```powershell
npx tsx scripts/production-readiness.mts
```

This reports missing FRED series, OFAC events, pilot/company exposure reports and the scenario report. It writes no application data except `worker/.runs/production-readiness.json` and never modifies production state.
