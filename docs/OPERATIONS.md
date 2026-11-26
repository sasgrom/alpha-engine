# Alpha Engine Operations Runbook

Generated from `contracts/operations.ts`. The scheduler, UI and this document share the same job registry.

## 1. Normal home run stack

Use exactly **one** web server on port 3000. The scheduler is a separate process. MySQL and Ollama are independent services.

### Local production server

Normal daily UI and local ingest API.

- **When:** Use for ordinary operation after npm run build. Install the hidden ONLOGON task with worker/home-server-install.ps1; never run it together with the dev server.
- **Input:** dist/public, dist/boot.js and the home .env.
- **Output:** One local application at http://127.0.0.1:3000 and worker/.runs/home-server.log.

```powershell
$env:NODE_ENV = "production"
node dist/boot.js
```

### Development server

Coding with hot module reload.

- **When:** Use only while developing. Stop the production server first; both compete for port 3000 and can split localhost vs 127.0.0.1.
- **Input:** Current TypeScript source.
- **Output:** HMR development UI and the same local API on port 3000.

```powershell
npm run dev
```

### Operations scheduler

The only cron engine for collectors, dependency chains and report builders.

- **When:** Run continuously on the home machine, preferably through the single ONLOGON Windows task from the installer.
- **Input:** worker/.runs/operations-config.json and UI command queue.
- **Output:** One job at a time, persistent next runs, logs and dependency-aware execution.

```powershell
npx tsx worker/operations-scheduler.mts
```

### Local MySQL

Home system of record for collection, scoring and research.

- **When:** Must be healthy before facts, factors, digests, research and reviewed push jobs.
- **Input:** Local schema and home DATABASE_URL.
- **Output:** Local facts, signals, prices, holdings and research points.

```powershell
Windows service — starts with Windows
```

### Local Ollama

GPU inference without cloud LLM charges.

- **When:** Required only for tone, cohort extraction and daily digest. Collectors that do not use a model do not wait for it.
- **Input:** qwen3.5:9b and the existing model configuration.
- **Output:** Local model responses; no API key enters the browser.

```powershell
ollama serve
# health: ollama ps
```

### Home collectors

Fetch public/provider data with local provenance and availability timestamps.

- **When:** After network services are healthy; Schwab and EDGAR are independent, while the scheduler prevents accidental overlap.
- **Input:** SEC, Schwab, Stocktwits and 13F sources.
- **Output:** Raw cache plus local reviewed-ingest candidates.

```powershell
Scheduled from Jobs & schedules
```

### Research and report builders

Materialize series, factors, normalized options and owner-only static reports.

- **When:** Only after parent jobs succeed; research evaluations remain manual.
- **Input:** Local DB and validated raw snapshots.
- **Output:** factor_points, market-data snapshots, Analytics and Expectations artifacts.

```powershell
Dependency-triggered after collectors
```

### Owner review

Check coverage, evidence, QA and dry-run payloads before anything leaves home.

- **When:** After collection/research and before every production apply command.
- **Input:** Local UI, benchmark, reconciliation and dry-run output.
- **Output:** A human review decision; no automatic approval bit.

```powershell
Open /workers → Delivery dry-runs
```

### Worker operational outbox

**Off since 2026-11-13.** Owner: "no pushes to prod, it was just a temp dev online". Scheduled jobs push nothing. `OPERATIONAL_PUSH=1` in the scheduler's environment would be the explicit opt-in if a production site returns (`worker/lib/prod-push.ts`).

Push only QA-passed operational outputs after successful scheduled jobs (when opted in).

- **When:** With the opt-in, automatically after exit-ok for Schwab prices/context, FRED vintages and daily operations. One retry with backoff; failure marks the job error. Manual triggers do not auto-push; use this explicit backfill command instead.
- **Input:** INGEST_URL, WORKER_KEY and local Schwab/FRED/operations artifacts.
- **Output:** pricesDaily, macroPoints and whitelisted reportFile payloads; raw option chains never leave home.

```powershell
npx tsx worker/prod-push.mts --kind pricesDaily --from 2026-11-07
```

### Cloud control plane

Receive operational outbox data and separately reviewed derived artifacts.

- **When:** Automatic push is limited to the declared operational outputs. Expectations, canonical series, factors and other derived artifacts remain reviewed/pinned and are not auto-pushed.
- **Input:** Operational QA-passed outputs or separately reviewed packages.
- **Output:** Production records with exact-key dedupe, conflict refusal and fresher DB/static report selection.

```powershell
Manual reviewed apply for derived artifacts; automatic /api/worker/ingest only for the declared operational lane
```

### D:-drive interruption recovery

The external D: drive can disconnect and remount later. A missing or unreadable D: path is an infrastructure failure, not an empty archive. Stop the affected collector or builder and preserve its logs, raw inputs and completed checkpoints; never initialize a replacement cache on C:, delete supposedly missing data or start a full backfill from zero.

1. Record the failed/partial state honestly. Do not skip the failed item or publish derived output built from incomplete inputs.
2. Reuse only atomic completed checkpoints whose schema, code hash, input hash and company/release identity match. Ignore temporary files as completion evidence and do not delete unreviewed work.
3. After remount, verify expected roots and junction realpaths, free space and representative manifest/raw hashes. The D: drive letter alone does not prove that the right archive is available.
4. Inspect the old process and command line. If it is alive, do not start a duplicate; if it exited, identify the last verified checkpoint. Keep one scheduler and one instance of each collector/builder.
5. Resume the existing idempotent command after verification, with at most two attempts for the same failing step before diagnosis. Do not redownload valid completed work.
6. Regenerate downstream reports and compare counts/hashes before claiming recovery. Record the failure, last verified checkpoint, process state, remount checks, resume command and final evidence in `docs/KIMI_CODE_HANDOFF.md`.

Keep verified source, tests, specifications and handoffs committed on C:. Raw D: artifacts remain outside Git; committed summaries and manifests provide integrity evidence, not a substitute for the raw archive.

## 2. Install hidden startup processes

Run from `C:\dev\alpha-engine` after `git pull` and `npm install --no-audit --no-fund`:

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File worker\home-server-install.ps1
powershell -ExecutionPolicy Bypass -File worker\operations-scheduler-install.ps1 -DisableLegacyTasks
schtasks /Run /TN AlphaEngine-Home-Server
schtasks /Run /TN AlphaEngine-Operations-Scheduler
```

Both installers create hidden `ONLOGON` processes: the production UI and the single cron engine. The scheduler's task also starts every 15 minutes as its watchdog (owner, 2026-11-13). A start while the scheduler runs ends at once (lock and log in use), and a dead scheduler is back within 15 minutes. The installer needs an elevated PowerShell, and it removes the interim second task `AlphaEngine-Operations-Watchdog`. `npm run dev` remains a manual development-only mode. `-DisableLegacyTasks` disables old Stocktwits, GDELT and Digest tasks when present and skips tasks that do not exist, so reruns are idempotent. GDELT remains frozen. Because the hidden launchers detach, Task Scheduler may show Ready rather than Running; verify the server with curl and the scheduler with its heartbeat/log. To inspect or stop the scheduler:

```powershell
schtasks /Query /TN AlphaEngine-Operations-Scheduler /V /FO LIST
schtasks /End /TN AlphaEngine-Operations-Scheduler
```

For an interactive diagnostic run instead of the Windows task:

```powershell
npx tsx worker/operations-scheduler.mts
```

The scheduler reads cron configuration and UI commands every 15 seconds. It runs one job at a time. Dependency children start only after the parent's own work succeeded; a parent whose own work failed blocks its children. A failed operational production push is reported as the run's error, but it does not block local children (the local data is current). A missed cron slot is caught up once after a scheduler outage or sleep; a new or changed schedule starts at its next future slot. Cron uses the home machine's local timezone; a schedule may list several cron expressions separated by `;`.

Daily market plan (cron only, no manual runs): during the session, every five minutes from 06:40 to 13:20 Pacific, schwab-intraday takes live prices and desk-snapshot-live rebuilds the desk with them ("Live · prices as of …"). On weekdays at 16:10 the S&P 500 lane collects the day's closes (a session counts as complete at 16:00 Pacific), then daily bars, the desk snapshot and the price pages are rebuilt (about 16:45); at 16:45 the research-50 options lane follows (normalized snapshot, Feature Lab). The 04:00 and 04:30 runs are catch-ups: a capture of the same UTC date resumes, so they only complete what the evening run missed.

Exactly one scheduler: it holds `worker/.runs/operations-scheduler.lock` (its process id). Another start finds that process alive with a fresh heartbeat and exits at once, so the task may be started again at any time; a lock whose process is gone, or whose scheduler has been silent for ten minutes, is taken over. Unexpected errors are logged in `worker/.runs/operations-scheduler.log` and do not end the scheduler.

The owner sees the operations' health on the desk (a banner on every desk page, linking to Operations): the scheduler not running, a scheduled job whose own work failed in the last day, the weekday market run not completed by 17:15 Pacific, and failed production uploads (a warning: local data is current).

Persistent files, all ignored by Git:

- `worker/.runs/operations-config.json` — enabled flags and cron expressions.
- `worker/.runs/operations-state.json` — heartbeat, queue, next runs and last-run status.
- `worker/.runs/operations-commands.jsonl` — local owner-only UI command queue.
- `worker/.runs/<run-id>.log` — stdout/stderr for each job.

Cloud cannot spawn jobs. Every mutation requires the owner admin role and `LOCAL_WORKER_UI=1` on the home server. If `INGEST_URL` is absent, the scheduler supplies the local ingest URL; it never supplies a production URL.

## 3. Operating modes

- **Scheduled:** enabled by default; cron roots and dependency children form the normal pipeline.
- **Paused:** fully configured but disabled until the owner enables the job in the UI.
- **Manual:** run only on demand; research and dry-run jobs never acquire an automatic cron.
- **Review gate:** documentation-only apply or unfinished work; not UI-runnable.
- **Frozen:** no requests or execution; currently GDELT.

## 4. Registry summary

| Job | Mode | Cron / trigger | Destination |
|---|---|---|---|
| Stocktwits hourly pulse | scheduled | 30 * * * * | Reviewed deterministic rows use the existing direct ingest contract; probation LLM rows follow INGEST_URL. |
| EDGAR filing cache refresh | scheduled | 0 2 * * * | Local raw cache only; no production write. |
| Complete EX-99 expectations cache | scheduled | 20 2 * * * | Local expectations cache only. |
| Companyfacts local snapshot | scheduled | 0 3 * * * | Local MySQL through the local factsSnapshot ingest route; no production write. |
| S&P 500 incremental companyfacts | scheduled | 30 23 * * * | Local MySQL and the D:-only raw cache; no production write and no research-universe expansion. |
| Canonical research series | scheduled | after facts-fetch-daily | Local MySQL. |
| Schwab REST daily snapshot | scheduled | 45 16 * * 1-5; 0 4 * * * | Raw chains remain local; successful scheduled runs automatically push QA-passed daily OHLCV and daily-prices-schwab.json through /api/worker/ingest. |
| Schwab normalized UI snapshot | scheduled | after schwab-fetch-daily | Normalized snapshot automatically pushed as schwab-market-data.json after exit-ok; raw chains and the local gzip stay local. |
| Schwab Feature Lab materialization | scheduled | after schwab-snapshot | Local Feature Lab UI only; no production factor promotion. |
| Schwab market context pack | scheduled | 10 * * * * | schwab-context.json automatically pushed through reportFile after successful scheduled runs; no accounts, orders or full-universe streaming. |
| Schwab REST daily snapshot · S&P 500 and funds | scheduled | 10 16 * * 1-5; 30 4 * * * | Local only: no operational push, no normalized UI snapshot and no production write. |
| Schwab daily bars into local prices | scheduled | after schwab-fetch-sp500 + schwab-fetch-daily | Local MySQL only; no production push (off since 2026-11-13). A split re-bases the stored history instead of stopping the chain. |
| Upcoming stock splits (Yahoo calendar) | scheduled | 15 6 * * * | Local D: only (`prices\split-calendar\`). |
| Desk market snapshot | scheduled | after schwab-daily-bars | Local static UI artifact read by desk.snapshot; no production write and no push lane. |
| Schwab live prices every 5 minutes | scheduled | 40,45,50,55 6 * * 1-5; */5 7-12 * * 1-5; 0,5,10,15,20 13 * * 1-5 | Local only: no production push and no write to the daily price history. |
| Desk snapshot with live prices | scheduled | after schwab-intraday | Local static UI artifact read by desk.snapshot; no production write. |
| Prediction-market expectations daily | scheduled | 15 16 * * * | Local D: archive and local UI artifact only; no production writes or automatic reportFile push. |
| Standard prices weekly gated refresh | scheduled | 0 2 * * 0 | Local D: artifacts and alpha_research only; no production write and no alpha_engine production mutation. |
| FRED and ALFRED vintage refresh | scheduled | 30 5 * * * | Normalized vintage rows automatically pushed through macroPoints after exit-ok; raw FRED chunks stay local. |
| Desk macro card | scheduled | after macro-fred-weekly | Local file read by dashboard.macro; no production write and no database write. |
| Guidance standard daily gated refresh | scheduled | 25 2 * * * | Local D: artifacts only; no production write and no database write. |
| Standard fundamentals daily gated refresh | scheduled | 12 3 * * * | Local D: artifacts only; no production write, no database write (the research database keeps v3.1). |
| Insider standard daily gated refresh | scheduled | 35 3 * * * | Local D: artifacts only; no production write, no database write. |
| Insider standard weekly database load | scheduled | 10 4 * * 0 | Local D: artifacts and alpha_research only; no production write and no alpha_engine mutation. |
| FINRA short interest | scheduled | 25 6 * * * | Local D: archive and a local file read by company.shortInterest and the desk snapshot; no production write and no database write. |
| Desk company files | scheduled | after edgar-fetch-daily | Local files read by the desk procedures; no production write. |
| OFAC daily event refresh | scheduled | 40 5 * * * | Local macro archive only; no production write. |
| Macro manifest and availability QA | scheduled | 55 5 * * * | Local fail-closed QA gate only. |
| Company macro exposure evidence | scheduled | after research-series | Local static evidence only; no production write. |
| Pilot SEC exposure evidence refresh | scheduled | 5 6 * * * | Local static evidence only; no production write. |
| Availability-anchored macro scenarios | scheduled | after macro-manifest-qa + company-exposure-evidence + pilot-exposure-evidence | Local Scenario Lab only; no production write. |
| Historical macro shock calibration | scheduled | after macro-manifest-qa | Local Scenario Lab only; no production write. |
| OFAC first-release macro event study | scheduled | after macro-manifest-qa | Local research artifact only; no production write or probability promotion. |
| Macro Transmission Atlas | scheduled | after macro-event-study + research-series | Local research artifact only; no production write or probability promotion. |
| Production UI rebuild | scheduled | after schwab-daily-bars + schwab-feature-lab | Local production server files only; no cloud deployment. |
| Local morning brief | paused | 15 7 * * * | Local probation when INGEST_URL is set; no automatic reviewed production promotion is added by the scheduler. |
| Daily operations health report | scheduled | 20 7 * * * | daily-operations.json and .md automatically pushed through reportFile after exit-ok and served from the fresher of DB/static. |
| Data health and quarantine | scheduled | after research-series + schwab-daily-bars + edgar-exhibits-daily + schwab-feature-lab | Local read-only QA artifacts; no production write, schema change or retroactive data removal. |
| Weekly coverage and drift report | scheduled | 45 7 * * 1 | weekly-coverage.json and .md automatically pushed through reportFile after exit-ok and exposed in Workers → Weekly coverage. |
| Alpha Bridge captain executor | paused | */2 * * * * | Local command protocol only; no production transport. |
| 13F holdings and full-book refresh | scheduled | 0 5 * * 1,4 | Local MySQL; production transfer is a separate reviewed manual job. |
| Schwab token keepalive | scheduled | 0 2 */2 * * | Local credential store only. |
| Read-only research reconciliation | manual | manual | Console/log only. |
| Fundamental integrity and continuity audit | manual | manual | Read-only QA report; no repairs, deletions or silent interpolation. |
| EDGAR coverage and continuity gap analysis | manual | after fundamental-integrity-audit | Read-only EDGAR remediation manifest. |
| Schwab fundamental gap mapping | manual | after edgar-gap-analysis + schwab-context-hourly | Read-only candidate map for a later reviewed repair plan. |
| Per-company EDGAR remediation and Schwab fallback | manual | after schwab-context-hourly | Local reviewed remediation plan; no automatic value insertion or production sync. |
| DoltHub historical option export | manual | manual | D:-only historical research archive. |
| DoltHub export validation | manual | after dolthub-export | Local QA artifact. |
| Historical option feature materialization | manual | after dolthub-validate | Local historical feature archive. |
| Preregistered option hypothesis research | manual | after dolthub-features | Local research artifacts only. |
| Expected-move calibration | manual | after dolthub-features | Local research artifact. |
| Volatility-target historical replay | manual | after dolthub-features | Local research artifact. |
| Stooq price archive import | manual | manual | Local MySQL; no browser storage credential required. |
| Signals production dry-run | manual | manual | Review console only. |
| Facts production dry-run | manual | manual | Review console only. |
| Reviewed signals production push | blocked | after signals-dry-review | Production only after explicit terminal review. |
| Reviewed facts production push | blocked | after facts-dry-review | Production only after explicit terminal review. |
| Independent-universe and macro-regime validation | manual | manual | Console/log research evidence only. |
| Sector-neutral portfolio evaluation | manual | manual | Console/log research evidence only. |
| Sector volatility-target holdout evaluation | manual | manual | Console/log research evidence only. |
| Frozen research protocol validation | manual | manual | Console/log only. |
| 13F top-300 universe rebuild | manual | manual | Local tracked universe candidate for review; not a daily job. |
| Research coverage expansion | blocked | manual | Blocked pending universe design. |
| signals.note migration gate | blocked | after mysql-backup-restore | Blocked by mysql-backup-restore. |
| Schwab OAuth browser authorization | manual | manual | Interactive terminal/browser flow, not scheduler-runnable. |
| Optional ORATS option lane | blocked | manual | Blocked; no scheduled collection. |
| Legacy cloud ad-hoc job queue | blocked | manual | Blocked from home cron. |
| MySQL backup and restore gate | manual | manual | Manual only; backups outside Git with the last ten retained and pruning only through --prune. |
| Selective AAPL/SPY streaming | blocked | manual | Future local streaming lane only. |
| GDELT collector and backfill | frozen | manual | None. |

## 5. Complete job documentation

> **Retired on 2026-11-24 (handoff 237), with the classic view they fed:** the research factor materialization, the
> six precomputed page-data jobs, the analytics and weekly evidence snapshot and the expectations static report
> (sections 7 to 13, 21 and 22 of this list; the numbers of the other sections are unchanged). Their registry
> entries and scripts are removed, except `scripts/materialize-research-factors.mts`, which stays until the factor
> tables themselves are decided. The morning brief is paused, not removed.
>
> **Also retired on 2026-11-24 (handoff 239), registry entries only:** the paused and manual jobs of the old tone,
> cohort-extraction and Cboe option lanes (39. EDGAR local tone scoring; 52. Availability-anchored tone event study; 53. Tone IC and turnover evaluation; 65. EDGAR tone readiness audit; 43. Legacy Cboe option snapshot; 44. Offline DTE option features; 45. Offline option provider QA; 40. Quarterly cohort pack builder; 41. Cohort LLM extraction; 42. Independent extraction benchmark). Their scripts are still in the repository and can
> be run by hand; none was scheduled.

### 1. Stocktwits hourly pulse

- **ID:** `stocktwits-hourly`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 30 * * * *
- **Dependencies:** none
- **Purpose:** Capture the latest public message window without disturbing EDGAR or the GPU.
- **Input:** worker/universe.json; public 30-message stream per active ticker.
- **Output:** Deterministic buzz and labeled-sentiment rows; optional local-LLM crowd rows when Ollama is available.
- **Destination:** Reviewed deterministic rows use the existing direct ingest contract; probation LLM rows follow INGEST_URL.
- **Requirements:** network, server
- **Operational note:** Reruns dedupe by newest message payload key. The GPU is never a hard dependency for deterministic rows.

```powershell
npx tsx worker/stocktwits.mts
```

### 2. EDGAR filing cache refresh

- **ID:** `edgar-fetch-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 2 * * *
- **Dependencies:** none
- **Purpose:** Incrementally cache new 10-K, 10-Q, 8-K and amendments before any LLM work.
- **Input:** SEC submissions and filing documents; edgar-universe.json; existing per-CIK manifests.
- **Output:** Raw filings and atomic manifests under the EDGAR cache on the large archive drive.
- **Destination:** Local raw cache only; no production write.
- **Requirements:** network, driveD
- **Operational note:** Network-only. Existing manifests make reruns incremental. This is the parent of the paused tone lane.

```powershell
npx tsx worker/edgar-fetch.mts --universe edgar-universe.json
```

### 3. Complete EX-99 expectations cache

- **ID:** `edgar-exhibits-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 20 2 * * *
- **Dependencies:** none
- **Purpose:** Preserve every substantive earnings exhibit, including the main release and supplements.
- **Input:** SEC exhibit-bearing filings for the current 50-name expectations universe.
- **Output:** Hash-linked EX-99 cache with completeness metadata.
- **Destination:** Local expectations cache only.
- **Requirements:** network, driveD
- **Operational note:** Independent from the legacy tone exhibit selection; never reduces documents to the largest exhibit.

```powershell
npx tsx worker/edgar-exhibits.mts --universe research-universe-50.json
```

### 4. Companyfacts local snapshot

- **ID:** `facts-fetch-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 3 * * *
- **Dependencies:** none
- **Purpose:** Refresh SEC XBRL companyfacts into local MySQL with first-filed availability intact.
- **Input:** SEC companyfacts JSON and research-universe-50.json.
- **Output:** One complete, validated facts snapshot per CIK; raw JSON remains cached on D:.
- **Destination:** Local MySQL through the local factsSnapshot ingest route; no production write.
- **Requirements:** network, server, mysql, driveD
- **Operational note:** Requires exactly one reachable local web server on port 3000 and INGEST_URL pointing to it.

```powershell
npx tsx worker/facts-fetch.mts --universe research-universe-50.json
```

### 5. S&P 500 incremental companyfacts

- **ID:** `sp500-facts-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 30 23 * * *
- **Dependencies:** none
- **Purpose:** Collect relevant new SEC companyfacts for the deduplicated S&P 500 snapshot without redundant full downloads.
- **Input:** Deduplicated edgar-universe.json, recent financial/XBRL forms and amendments, shared per-CIK raw cache and atomic manifests.
- **Output:** Resumable per-CIK raw snapshots and manifest transitions with a staggered seven-day full reconciliation baseline.
- **Destination:** Local MySQL and the D:-only raw cache; no production write and no research-universe expansion.
- **Requirements:** network, server, mysql, driveD
- **Operational note:** Independent from research-50: failures never block its dependency chain, and this job has no research-series/factors downstream.

```powershell
npx tsx worker/facts-fetch.mts --universe edgar-universe.json
```

### 6. Canonical research series

- **ID:** `research-series`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `facts-fetch-daily`
- **Purpose:** Convert current local facts into canonical vintage-aware series points.
- **Input:** Local facts snapshots written by facts-fetch-daily.
- **Output:** Atomically replaced series_points per CIK.
- **Destination:** Local MySQL.
- **Requirements:** mysql
- **Operational note:** Dependency-triggered after a successful facts refresh; no SEC request and no arbitrary delay guess.

```powershell
npx tsx scripts/build-research-series.mts --universe research-universe-50.json
```

### 14. Schwab REST daily snapshot

- **ID:** `schwab-fetch-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 45 16 * * 1-5; 0 4 * * *
- **Dependencies:** none
- **Purpose:** Capture chains, quotes, daily price history and instruments with hashes and availability timestamps.
- **Input:** Schwab Market Data Production; local token file; research-universe-50.json.
- **Output:** D:-only raw snapshots and a resumable manifest; User Preference status is recorded separately for streaming setup.
- **Destination:** Raw chains remain local; successful scheduled runs automatically push QA-passed daily OHLCV and daily-prices-schwab.json through /api/worker/ingest.
- **Requirements:** network, driveD
- **Operational note:** Same-day complete tickers resume without redownloading. Automatic operational push is allowed only after exit-ok with one retry; a push failure marks the job error. No raw option chains, accounts or orders leave home. User Preference 401 does not invalidate REST data.

```powershell
npx tsx worker/schwab-fetch.mts --universe research-universe-50.json
```

### 15. Schwab normalized UI snapshot

- **ID:** `schwab-snapshot`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `schwab-fetch-daily`
- **Purpose:** Normalize the latest valid chain per ticker and expose credential-free static data to /market-data.
- **Input:** Latest Schwab manifest entries and raw chains.
- **Output:** public/reports/schwab-market-data.json with OSI IDs, DTE and QA, plus a local hash-verified gzip artifact under worker/.runs/precomputed-page-data.
- **Destination:** Normalized snapshot automatically pushed as schwab-market-data.json after exit-ok; raw chains and the local gzip stay local.
- **Requirements:** review
- **Operational note:** Hash mismatches, truncated chains and provider failures remain visible. Only the normalized report enters the automatic operational lane; no factor promotion. The existing writer also produces local gzip after the public and bundled JSON writes, independent of the later push outcome.

```powershell
npx tsx worker/build-schwab-market-data.mts
```

### 16. Schwab Feature Lab materialization

- **ID:** `schwab-feature-lab`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `schwab-snapshot`
- **Purpose:** Materialize small provider-specific ATM IV, expected-move, DTE, skew, put/call, turnover, spread and RV20 feature snapshots.
- **Input:** Latest normalized Schwab snapshot, raw daily price history and manifest.
- **Output:** public/reports/schwab-features.json and an updated production copy with source-snapshot lineage.
- **Destination:** Local Feature Lab UI only; no production factor promotion.
- **Requirements:** review
- **Operational note:** 0DTE expected move and RV20 remain null when their inputs are insufficient. Skew and IV−RV20 are descriptive, not directional signals.

```powershell
npx tsx worker/schwab-features.mts
```

### 17. Schwab market context pack

- **ID:** `schwab-context-hourly`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 10 * * * *
- **Dependencies:** none
- **Purpose:** Refresh market hours, S&P/Nasdaq/Dow movers, instrument profiles and AAPL/SPY five-minute bars separately from option chains.
- **Input:** Schwab Market Data Production, existing instrument files and the local token.
- **Output:** schwab-context.json with sessions, movers, primitive fundamental fields, intraday VWAP/opening range and per-endpoint provenance.
- **Destination:** schwab-context.json automatically pushed through reportFile after successful scheduled runs; no accounts, orders or full-universe streaming.
- **Requirements:** network, driveD
- **Operational note:** Hourly context is independent of daily option features. Missing endpoints remain visible; push failure marks the job error after one retry. No GPU is used.

```powershell
npx tsx worker/schwab-context.mts
```

### 18. Schwab REST daily snapshot · S&P 500 and funds

- **ID:** `schwab-fetch-sp500`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 10 16 * * 1-5; 30 4 * * *
- **Dependencies:** none
- **Purpose:** Capture chains, quotes, daily price history and instruments for every S&P 500 company outside the research 50 (both listings of dual-class companies), SPY and the eleven sector funds.
- **Input:** Schwab Market Data Production; local token file; edgar-universe.json minus research-universe-50.json, plus the funds.
- **Output:** D:-only raw snapshots under schwab-sp500 with their own resumable manifest.
- **Destination:** Local only: no operational push, no normalized UI snapshot and no production write.
- **Requirements:** network, driveD
- **Operational note:** About 465 tickers in roughly 30 minutes, paced below the provider's limit of 120 requests a minute; the access token is renewed during the run. The research-50 lane, its UI snapshot and its production push are unchanged.

```powershell
npx tsx worker/schwab-fetch.mts --price-series --exclude research-universe-50.json --skip-preferences --root D:/research/alpha-engine/schwab-sp500
```

### 19. Schwab daily bars into local prices

- **ID:** `schwab-daily-bars`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `schwab-fetch-sp500`, `schwab-fetch-daily`. The 50 research companies are only in the `schwab` archive (16:45); the others are in `schwab-sp500` (16:10). After the S&P fetch alone, the 50 stayed a session behind and showed "—" on the desk (2026-11-12). The bars are now stored after both fetches, about 16:50.
- **Purpose:** Store every completed official daily candle of both Schwab archives in local prices, so a day one run misses is filled by the next.
- **Input:** pricehistory files of the schwab and schwab-sp500 archives (about one month each).
- **Output:** Local prices rows (source schwab after each series' last Stooq bar, schwab-hist on dates the Stooq history covers) and worker/.runs/local-generated/schwab-daily-bars.json with inserts, conflicts and holes against SPY's sessions.
- **Destination:** Local MySQL only; the operational pricesDaily push is unchanged.
- **Requirements:** mysql, driveD
- **Operational note:** The app lets Schwab win on its dates, so raw Schwab bars never enter dates of the dividend-adjusted Stooq history (they are kept as schwab-hist). A stored close is never changed: a different close is a conflict and marks the job error; other field differences are listed. One window is the exception (since 2026-11-15): the newest five Schwab candles of a series are finalised by a later Schwab fetch, because an evening fetch can still carry a provisional close and volume, when the close moved by at most 0.5% and no older close moved; each correction is listed in the report.

```powershell
npx tsx worker/schwab-daily-bars.mts
```

### 20. Desk market snapshot

- **ID:** `desk-snapshot`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `schwab-daily-bars`
- **Purpose:** Rebuild the one precomputed file behind the desk view (market map, screener, earnings, research tools) once the day's closes are stored.
- **Input:** Local companies, daily closes (Stooq history, Schwab bars after it), earnings events, short interest, Form 4 rows, the Schwab fundamentals and latest quotes of both archives on D:, and the option features report.
- **Output:** public/reports/desk-snapshot.json and its dist copy: one row per index company with returns, range, fundamentals, earnings dates, option features, plus breadth, sectors and the registry check.
- **Destination:** Local static UI artifact read by desk.snapshot; no production write and no push lane.
- **Requirements:** mysql, driveD
- **Operational note:** Stops without writing when a Schwab archive root is missing, so the previous snapshot stays in place. Option-derived fields reach only the owner and NDA reviewers. Reports registry rows that disagree with the GICS snapshot. During a session the snapshot carries the live prices of schwab-intraday as provisional closes (see 20a and 20b); this evening build replaces them with the official closes.

```powershell
npx tsx scripts/build-desk-snapshot.mts
```

### 20a. Schwab live prices every 5 minutes

- **ID:** `schwab-intraday`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 40,45,50,55 6 * * 1-5; */5 7-12 * * 1-5; 0,5,10,15,20 13 * * 1-5 (every five minutes from 06:40 through 13:20 Pacific, weekdays)
- **Dependencies:** none
- **Purpose:** Current prices of every price series (S&P 500 with both listings of dual-class companies, the research companies, SPY, the sector funds) every five minutes of a trading session, so the desk shows live prices and approximate five-minute paths; each run also keeps the Schwab access token fresh.
- **Input:** Schwab Market Data Production: market hours and batched quotes (about three requests); the local token file; the price-series universe.
- **Output:** D:\research\alpha-engine\schwab-intraday: `<session>\<HHMM>.json` (compact quotes, HHMM US Eastern), `.raw.json` only at 00/20/40 past the hour, `<session>\bars.json` (five-minute bars), `live.json` (the desk's live prices), `manifest.jsonl`.
- **Destination:** Local only: no production push and no write to the daily price history.
- **Requirements:** network, driveD
- **Operational note:** A holiday or a time outside the regular session ends the run without a snapshot. Bars come from consecutive snapshots: open and close are snapshot prices, high and low the day's running extremes when set inside the interval (else the interval's end prices), volume the change in the day's volume. Highs and lows are approximate. Compact snapshots are kept every five minutes, but raw responses are written only at the 20-minute marks; existing raw files are not removed by this change. Sessions accumulate on D: and are never pruned; the desk reads at most five. If another job holds the single execution lane, each intraday job is pending at most once and missed slots advance instead of piling up; a late snapshot keeps its true capturedAt. The refresh token itself still expires seven days after the last browser authorization. `--ignore-hours` with a separate `--root` takes a verification snapshot outside the session.

```powershell
npx tsx worker/schwab-intraday.mts
```

### 20b. Desk snapshot with live prices

- **ID:** `desk-snapshot-live`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `schwab-intraday`
- **Purpose:** Rebuild the desk snapshot after each live-price snapshot, with the session's current prices as provisional closes and the time they are as of; also rebuild the shared intraday market summary from the latest session bars.
- **Input:** Everything desk-snapshot reads, plus D:\research\alpha-engine\schwab-intraday\live.json and the latest session's bars.json and compact snapshots.
- **Output:** public/reports/desk-snapshot.json and desk-intraday-market.json with their dist copies. The desk shows live as-of times, breadth, SPY/equal weight, sector funds, movers and company paths; after the evening run the official closes replace provisional ones while the last intraday session remains named.
- **Destination:** Local static UI artifacts read by desk.snapshot and desk.intradayMarket; no production write.
- **Requirements:** mysql, driveD
- **Operational note:** Live prices count only for a session newer than the stored closes: once the evening run stores the session's official closes, desk-snapshot replaces the provisional ones. The market summary is still rebuilt from the latest stored session bars after that transition, so closed-market views retain their last session. Nothing enters the daily price history.

```powershell
npx tsx scripts/build-desk-snapshot.mts
```

### 22a. Prediction-market expectations daily

- **ID:** `prediction-markets-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 15 16 * * *
- **Dependencies:** none
- **Purpose:** Capture public Fed, CPI and recession probabilities and every mapped company KPI contract, with settlement histories and point-in-time daily expectations.
- **Input:** The reviewed series/company mapping on D:, the local company registry and keyless public market-data endpoints.
- **Output:** D:/research/alpha-engine/predmarkets/daily/<date> venue JSONL, per-run manifests, mapping.json, daily-state.jsonl and the local prediction-markets.json desk artifact.
- **Destination:** Local D: archive and local UI artifact only; no production writes or automatic reportFile push.
- **Requirements:** network, mysql, driveD
- **Operational note:** Runs alone after the initial lab history run. One process lock, at least 250 ms between public requests, at most two retries, and an immediate stop if a key is required. Reruns append only changed quotes and never rewrite settled history. Political, sports, entertainment and earnings-call wording markets stay off. The mapping's accepted and rejected series are part of the delivery review.

```powershell
npx tsx worker/prediction-markets-daily.mts --scheduled-style
```

### 22b. Standard prices weekly gated refresh

- **ID:** `std-prices-refresh`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 2 * * 0
- **Dependencies:** none
- **Purpose:** Rebuild standard prices weekly from the complete current app registry, corporate actions and vendor history, then replace the loaded build only after gates, regression and staged read-back pass.
- **Input:** Local Schwab histories including RIVN and ENLT, Yahoo corporate actions, Tiingo, options/SEC split evidence, the previous loaded standard-price build and the lab's reviewed build logic.
- **Output:** One dated D: refresh folder per run, a regression report, staged read-back evidence, an atomic research-table swap and worker/.runs/local-generated/std-prices-refresh.json.
- **Destination:** Local D: artifacts and alpha_research only; no production write and no alpha_engine production mutation.
- **Requirements:** network, driveD
- **Operational note:** Runs about 70 minutes. A failed step stops the chain with an honest error and no swap. Old run folders and the previous loaded build are preserved until the staged swap; no data is pruned. RIVN and ENLT receive a one-time 20-year Schwab backfill before export. The loader stages std_*_next, checks 2,000 rows, then swaps atomically; a failed read-back leaves the old tables in place. The orchestrator also refuses to start when any lab file it runs has uncommitted changes.

```powershell
npx tsx ../alpha-engine-lab/src/prices/std-prices-refresh.mts
```

### 22b1. Guidance standard daily gated refresh (added 2026-11-24, owner's go)

- **ID:** `std-guidance-refresh` · **Cron:** 25 2 * * * · **Requirements:** network, mysql, driveD (it starts the local model server itself)
- **Command:** `npx tsx ../alpha-engine-lab/src/research/guidance/std-guidance-refresh.mts` (`--limit N` releases a run, `--force`, `--no-publish`, `--no-desk`)
- **Chain:** `npx tsx scripts/build-calendar-addendum.mts` (the quarters and releases since the pinned calendar: paired with their 10-Q or 10-K by the calendar's own rule, or placed one quarter after the last known period end until the report is filed), `guidance-pass2.py queue` and `run` into `guidance-pass2-new` (the local model; Ollama started and stopped for the run), `build_guidance_std.py` with `GUIDANCE_EXTRA`, `GUIDANCE_EXTRA_SESSIONS` and `GUIDANCE_VERSION`, the builder's gates, regression against the published build (no published statement missing, no count lower), pointer `D:/research/alpha-engine/guidance/std/current.json`, desk company files.
- **Operational note:** the original extractions and the g1.2 rules are pinned; only releases are added. To stop a model run cleanly create an empty file `STOP` in `D:/research/alpha-engine/engine/lab/data/engine/guidance-pass2-new/`. Summary: `worker/.runs/local-generated/std-guidance-refresh.json`.

### 22b2. Standard fundamentals daily gated refresh (added 2026-11-24, owner's go)

- **ID:** `std-fundamentals-refresh` · **Cron:** 12 3 * * * · **Requirements:** network, mysql, driveD
- **Command:** `npx tsx ../alpha-engine-lab/src/fundamentals/std-fundamentals-refresh.mts` (`--force` builds on unchanged inputs, `--no-publish` builds and compares only, `--no-desk` skips the desk rebuild)
- **Chain:** the newest filings' own XBRL (`edgar-filings-fetch.mts`, `edgar-filings-parse.py`), an inputs fingerprint (facts table extent, fetched filings, data-set quarters, code, overrides), build into `standard/<rules>-<run id>`, `qa.mts`, `checks.py`, `compare.py` against the published build, regression (same companies, no fewer company-quarters, no last quarter stepping back, nothing removed or broken), pointer `D:/research/alpha-engine/fundamentals/standard/current.json`, desk company files.
- **Operational note:** the rules stay those of the published build (v3.2); a rules change is a reviewed build by hand, after which the pointer is moved. Summary: `worker/.runs/local-generated/std-fundamentals-refresh.json`.

### 22c. Insider standard daily gated refresh (added 2026-11-24, owner's go)

- **ID:** `std-insiders-refresh` · **Cron:** 35 3 * * 1-6 (Monday to Saturday; on Sundays `std-insiders-db-load` runs the same refresh with a full build) · **Requirements:** network, mysql, driveD
- **Command:** `npx tsx ../alpha-engine-lab/src/insiders/std-insiders-refresh.mts` (`--force` rebuilds on an unchanged day, `--no-desk` skips the desk rebuild)
- **Chain:** form fetch through the last completed session (`edgar-insiders.mts`), build with the calendar extended by the app's SPY sessions since the weekly price refresh, the three acceptance commands, regression against the published build (no filing lost, no table smaller, a plausible number of new filings), staged load and swap (`--supersede-final` names the stored final build), independent live check, final status (`finalize-insiders.mts`), pointer `D:/research/alpha-engine/insiders/std/current.json`, desk company files.
- **Incremental since 2026-11-25:** the nightly build carries every company whose fingerprint (its filings, owner groups, prices, sessions up to its latest filing, code) equals the published build's over as hard links, recomputes the rest and five carried ones as a check, writes no table files and removes its working spools; the Sunday `--load` build is full. Verified equivalent to a full build on 761,474 filings (handoff 253).
- **Saved reading of the quarterly sets since 2026-11-25:** every build (nightly and Sunday) replays `D:/research/alpha-engine/insiders/sec-345/reading/<key>/` (2.1 GB: each company's filings from the 83 sets, enriched by the old XML cache and mapped, plus the accession index's input per quarter) instead of reading the sets again. The key hashes the quarters' normalized files, the old cache's manifests and file times, the issuer map, the registry and the reading code; any change makes a fresh reading under a new key (about 2 minutes, once), and old readings are kept. Every file's hash is checked before use; a damaged reading or a folder without its `reading.json` stops the build. `--no-saved-reading` reads as before. Measured 2026-11-24: a build with every company carried over 1.6 minutes (was 9), all recomputed 4 to 6 minutes; equivalent to the old code's build (handoff 254).
- **Since the first runs (2026-11-24):** the nightly job publishes FILES only (about 10 minutes since the incremental build and the saved reading). The research database is loaded by `std-insiders-db-load` (the same script with `--load`, Sundays 04:10): the staged load of 3.6 million rows took about two and a half hours and would hold the lane through the start of live prices. Forms are read through the completed session before the last one, because the SEC publishes a filing's folder up to a day after its index lists it.
- **Operational note:** a run with no new session and an unchanged price calendar ends as "unchanged". A failed step stops the chain; before the swap the stored build is untouched, and the pointer names the previous build until the new one is final. A full (Sunday) build folder is about 4.9 GB, a nightly incremental one about 0.5 GB of its own (2.4 GB when every company is recomputed), and nothing is pruned: free space on D: is checked (40 GiB) and retention is the owner's decision. Summary: `worker/.runs/local-generated/std-insiders-refresh.json`.

### 22d. FINRA short interest (added 2026-11-24, owner's go)

- **ID:** `finra-short-interest` · **Cron:** 25 6 * * * · **Requirements:** network, mysql, driveD
- **Command:** `npx tsx worker/finra-short-interest.mts` (`--no-fetch` rebuilds the desk file only, `--dry-run` writes nothing)
- **Operational note:** asks only for settlement files the archive lacks (the 15th and the last business day of a month, published about seven business days later); a date not out yet is asked again the next day. Stored files are never rewritten and are checked against the manifest hash when read. Output `worker/.runs/desk-short-interest.json` feeds `company.shortInterest` and `scripts/build-desk-snapshot.mts`.
- **Share of shares sold short** (since 2026-11-26): shares short over the company's share count known at the settlement date, from the desk statements files (fundamentals standard): the newest quarter filed on or before that date and at most 200 days old, its period-end shares outstanding, else its weighted average. All share classes, so not the float; none above 100%, none for the seven companies whose common stock trades under two symbols (Brown-Forman, Berkshire, Fox, Alphabet, Lennar, McCormick, News Corp; FINRA counts one class). 486 of 501 companies on 2026-11-26, median 3.0%. Shown on the company page's Ownership card (with the count and its date on hover) and in the Ownership page's short-interest table.

### 22f. News feeds (added 2026-11-25, owner's go: "lets get everything we can, decide later based on value")

- **IDs:** `news-feeds-fast` · **Cron:** 2-59/5 * * * * · **Requirements:** network, driveD; `news-feeds-company` · **Cron:** 10 */3 * * * · **Requirements:** network, mysql, driveD
- **Command:** `npx tsx worker/news-feeds.mts --set fast` / `--set company --batch 70` (`--dry-run` lists the requests; `--init` created the archive once)
- **Fast set:** SEC current 8-Ks (through `secGet`), GlobeNewswire, PR Newswire, Seeking Alpha market currents, MarketWatch, Benzinga, CNBC, Nasdaq earnings. **Company set:** Google News, Nasdaq, Seeking Alpha and Yahoo Finance per registry ticker (70 a run, all 502 a day), plus the Fed, BLS and BEA feeds.
- **Archive** `D:/research/alpha-engine/news`: `raw/<feed>/<UTC date>/` every answer gzipped as received; `items/<UTC date>.jsonl` one row per new item with `firstSeenAt` (when the news was available to us; use it, not `publishedAt`, for point-in-time work), tags (GlobeNewswire tickers and ISINs, SEC filer CIK and 8-K items, the company a per-company feed was asked for) and `storyId`; `mentions/` when a company feed returns an item already stored; `state/` (seen items 45 days, stories 7 days, company rotation, gaps).
- **Duplicates** (owner: "everybody copies everyone"): an item joins an earlier story when it has the same canonical address, the same normalized title, or the same words apart from filler words (`sameStory`, at least 5 words, 80% shared). Strict on purpose: a missed copy costs a row, a false merge would hide news. SimHash was tried and rejected: on short titles it put two companies' identical headlines closer than true copies.
- **Gaps:** a fast feed whose whole answer is new after an earlier fetch, and a company feed whose oldest item is newer than our previous ask for that company, are counted in `state/feeds.json` (`gaps`, `gapTickers`). Google News is paced at one request in 8 seconds (it answered 429 faster) and left alone for the rest of a run after a 429; Yahoo one in 3 seconds.
- **English only** (owner, 2026-11-25: "just english, drop other news, no other languages"): `worker/lib/news-language.ts` decides per item: GlobeNewswire's language code in the address, else the `eld` detector (pinned 2.1.0, its large table) on the title and summary without tickers, numbers, symbols and the outlet name; foreign only with at least four real words, a lead over English of 0.09 or more, and a common word of that language (or a non-Latin script). A foreign item stays in the raw answer, is counted as `notEnglish` per feed in `state/feeds.json` and is not stored. The 105 items of 2026-11-25 it marks foreign were all checked by hand (none English); those stored before the rule are skipped by `news-extract` and `build-desk-news`, the items file itself is not rewritten.
- **Investing.com** (fast set since 2026-11-26): eight feeds (stock market, company news, analyst ratings, earnings, insider trading, press releases, economy, economic indicators), 10 items each. Their times have no zone and are UTC (checked against GlobeNewswire and the SEC 8-K of the same news); the parser reads a zoneless time as UTC only for a feed marked so, and as unknown for any other feed (before, it took the machine's Pacific time, hence the hours-off times).
- **Not yet:** Business Wire (its site answers 403 and no list of its feed codes could be read; its industry feeds work but none covers all news), Accesswire (403), Reddit (its public feeds answer 429 or a block page; its API needs an account of the owner's), the FNSPID history (resuming 2026-11-26 after 02:00 local, owner's wish), GDELT (probe of 2026-11-26 in `news/gdelt-probe`, see the handoff).

### 22g. News reading by the local model (added 2026-11-25, owner's go: "run gemma as scheduled job")

- **IDs:** `news-extract` · **Cron:** 4-59/10 * * * * · **Requirements:** gpu, driveD; `news-company-index` · **Cron:** 50 5 * * 0 · **Requirements:** network, mysql, driveD
- **Command:** `npx tsx worker/news-extract.mts --minutes 3` (`--days N` reaches back further, default 2; `--limit N`; `--dry-run` counts what is left); `npx tsx worker/news-company-index.mts` (`--no-fetch` uses the latest stored SEC list).
- **Model:** gemma4:12b in Ollama (models stay on C:; `num_ctx` 32768, temperature 0, thinking off, seed 7, the answer schema as the format). Chosen by the bake-off of 2026-11-25 on 300 hand-labelled items (`D:/research/alpha-engine/news/bakeoff`): subject 93.3%, event 79.3%, direction 79.7%, novelty 81.7%, all four 51.3%, about 0.9 s an item. The prompt is pinned by a test (`PROMPT_VERSION` b0f0bc360b718996); a change needs a new bake-off.
- **What it reads:** items of the last two UTC days, one per story (copies are skipped), newest first, for three minutes a run (about 200 items; about 30,000 a day). The budget keeps the scheduler's single lane free for live prices.
- **Output** `D:/research/alpha-engine/news/extract/<first-seen UTC date>.jsonl`, one row per item read: the label (subject and other companies as named, event type of 16, direction, novelty new/followup/noise, a fact of at most 20 words), the subject and each other company resolved to CIK and tickers by code (`worker/lib/news-companies.ts`, ties refused), model digest, prompt version, index build time, our extraction time, seconds and tokens. For point-in-time research the item's availability stays its `firstSeenAt`.
- **Failure rules:** each answer is appended at once, so an interruption loses at most one item; an item without a valid answer is asked once more and then left, its rows kept as the record; three failed calls in a row fail the run (Ollama down); more than 20% unusable answers in a run fail it. The scheduler's preflight fails a GPU job when Ollama does not answer on port 11434.
- **Company index:** the SEC's company list with tickers (kept as received in `news/lookup/<date>-company_tickers.json`), the K26 Russell 1000 identities with former names, and the registry; written atomically, and a missing source or fewer than 5,000 companies leaves the previous index in place.
- **Desk files:** `desk-news` (no cron, `dependsOn: news-extract`, requirement driveD) runs `npx tsx scripts/build-desk-news.mts` after every reading run, in about a second: `worker/.runs/desk-news/days/<first-seen UTC date>.json` (stories: copies joined, companies tied with the reason — the model's subject or other company, the SEC filer, the wire's ticker tag, or the company feed that returned it — and the model's reading; today and yesterday rebuilt each run) and `company/<cik>.json` for every registry company (the last 30 days). The desk serves them through `desk.news` (News page, `/desk/news`) and `desk.companyNews` (the company page's News card); the model's readings reach only the owner and NDA reviewers, the server strips them for members.
- **Followed first:** items tied to a followed company before reading (SEC filer, wire ticker tag, the company a feed was asked for, also through `mentions/`) are read before all others; the list is `news/lookup/followed.json`, written by `news-briefs`. `news-feeds-company` also asks every followed company on each pass, plus the 70 others in rotation (about 16 minutes a pass with 51 followed).

### 22h. News briefs for followed companies (added 2026-11-25, owner's go on the brief plan)

- **ID:** `news-briefs` · **Cron:** none, `dependsOn: desk-news` (so every ten minutes) · **Requirements:** gpu, driveD
- **Command:** `npx tsx worker/news-briefs.mts --minutes 4` (`--company TICKER`; `--now ISO` to replay a time; `--dry-run` prints the prompts; `--out DIR` writes a trial without touching the desk copy or the followed list; `--redo-morning` writes the day's morning brief again after a rule change, appended).
- **Who:** the active watchlists of the owner and of reviewers who accepted the NDA (`user_universe` in alpha_engine, read only; when the database cannot be read the last `followed.json` is used). 51 companies on 2026-11-25. Members' follows get no brief: they never see one.
- **When (New York time):** a morning brief each weekday from 08:45 of the news since the previous weekday's 16:00 close (Monday's covers the weekend; holidays are written like other days). It waits for the reader until 09:15 while followed stories are unread, then is written anyway with the unread count. Until 20:00 each run adds timed updates when new picked stories have come in (checked every ten minutes, written only when there is news); later news waits for the next morning.
- **Picked:** SEC filings always; else stories about the company (the model's subject, the SEC filer, or the wire's ticker tag when the model names no other subject) that the reader calls new, or follow-ups of a material kind (results, outlook, analysts, deals, legal, management). Counted, not shown: stories published more than 6 hours before the window (first seen late), about other companies, noise, commentary, other follow-ups, unread. At most 30 a model call (filings, then new, then follow-ups, newest first).
- **Writing and checks:** gemma4:12b (temperature 0, seed 7) gets the picked stories as S1… (time, outlet, kind, tone, headline, the feed summary) and the company's open stories of the last 72 hours as T1…; it answers a top line and up to 4 points (morning) or up to 3 updates, each citing its items and the thread it continues. Code checks every number and capitalised word of each part against the cited stories' own text (singular/plural, possessives, spelled-out EU/UK/US and small numbers allowed; ordinary words are those the day's summaries write in lower case). A part that fails shows the first source's headline, marked, with the reason; an invalid answer shows the headlines. The price line is written by code from the desk snapshot. The prompts are hashed into `promptVersion`.
- **Output:** `D:/research/alpha-engine/news/briefs/<New York date>/<cik>.jsonl`, every version appended complete (`morning`, `update`, or `check` when new stories added nothing), with inputs, counts, model digest, Ollama version and prompt version; `worker/.runs/desk-news/briefs/<cik>.json` the latest, served by `desk.companyBrief` (the company page's News card) and `desk.briefs` (the Today page's card, “Briefs | Filings”) to the owner and NDA reviewers only, for 72 hours after the latest version.
- **Picking rules p3 (stored as `pickVersion`):** also left out as commentary: question headlines, numbered lists and comparison pieces ("…may be the better…", "better buy", "X vs. Y"; p3, after a Fool comparison became "Chevron pays a bigger dividend today"), and results stories while the company is between reports (last report over 10 days ago, next over 14 days ahead, from the desk snapshot; a real early report still comes as an SEC filing); fund holdings, fund flows and insider trades (`insider_ownership`) are counted as holdings, since the company page shows them from the 13F and insider standards. The first versions of 2026-11-25 (p1, no `pickVersion`) were redone with `--redo-morning` and stay in the files.
- **Article text** (since 2026-11-26, `worker/lib/news-article.ts`): each run first fetches, for at most 75 seconds (and never into the model's last three minutes), the pages of the stories a brief would pick now (each followed company's picks of the last 30 hours), newest first, one request per outlet every 1.5 s, and appends one record per try to `news/articles/<UTC date>.jsonl` (status, reason, text up to 20,000 characters, SHA-256). A text is used only when it has at least 600 characters, shares half of the headline's words and is not a short subscriber page; stored texts are judged again by the current rules. The model then reads the article's first 1,500 characters instead of the feed summary (marked "Article:"), and the checks read exactly that. Not asked: Google News links (a redirect page; 46% of followed stories in the measurement) and nasdaq.com (403); Seeking Alpha opinion pieces are paywalled teasers. Retried only after a network or server error, twice in all. Measured on 192 stories: 17% readable as first fetched, about 29% with Yahoo's large headers allowed; in the first runs 51 of 122 stories given to the model had article text. `counts.texts` in each brief.
- **Known limits (trials of 2026-11-25; 20 of 51 companies with news, 1 part failed the check in the p2 run):** the text is headlines and feed summaries where no article could be read (Google News gives only the headline); the model can misattribute (a Seeking Alpha contributor's “rating upgrade” written as analysts') or join two true items wrongly (Costco's special dividend and a $30 membership offer) — the check catches neither.

### 22e. Alpha Vantage analysts' EPS estimates (added 2026-11-25, owner's go)

- **ID:** `alpha-vantage-earnings` · **Cron:** 40 6 * * * · **Requirements:** network, mysql, driveD
- **Command:** `npx tsx worker/alpha-vantage-earnings.mts` (`--limit N` at most 25, `--dry-run` lists today's tickers without a request; `--init` created the empty archive once)
- **Source:** Alpha Vantage `EARNINGS` with the owner's free key `ALPHAVANTAGE_API_KEY` in `.env` (never printed or logged; errors never carry the URL). Per reported quarter: consensus EPS (`estimatedEPS`), reported EPS, surprise, report date and time of day; one request returns the whole history (IBM back to 1996). EPS only: no revenue estimates and no history of revisions.
- **Limits:** 25 requests a day on the free key ([alphavantage.co/premium](https://www.alphavantage.co/premium/), [support](https://www.alphavantage.co/support/)); the collector waits 15 seconds between requests. The first pass over the 502 registry tickers takes 21 days (25 fetched by hand on 2026-11-25); after it, the oldest copies are asked again 25 a day.
- **Operational note:** archive `D:/research/alpha-engine/estimates/alphavantage/earnings` (`raw/<TICKER>/<date>.json` as received, never rewritten; `manifest.json` with hashes and one line per run). A rate-limit notice stops the run without marking anything; a premium-only notice is an error; a ticker empty under both class separators (BRK.B / BRK-B) is asked again after 30 days; a CIK that no longer matches the stored one stops the run. Research input only; every use is checked first against our own reported EPS and release calendar.

### 23. FRED and ALFRED vintage refresh

- **ID:** `macro-fred-weekly`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 30 5 * * *
- **Dependencies:** none
- **Purpose:** Refresh all registered FRED series with raw yearly chunks, vintage availability and resumable manifests.
- **Input:** FRED/ALFRED API, existing D:-only macro archive and the configured server-side API key.
- **Output:** Raw hashes, normalized first-to-current vintage rows and manifest-fred.json from 2000 onward.
- **Destination:** Normalized vintage rows automatically pushed through macroPoints after exit-ok; raw FRED chunks stay local.
- **Requirements:** network, driveD
- **Operational note:** Daily since 2026-11-24 (it ran on Sundays only, so yields, VIX and credit spreads were up to a week old); the job keeps its old id. Its dependent `desk-macro` (`npx tsx scripts/build-desk-macro.mts`) then writes the Today page's macro card, `worker/.runs/desk-macro.json`. The full-vintage refresh preserves sourceHash and realtimeStart/End. Conflicting vintages are rejected with reasons rather than overwritten. Request spacing remains capped at 100 requests per minute.

```powershell
npx tsx worker/macro-fred-fetch.mts --group all
```

### 24. OFAC daily event refresh

- **ID:** `macro-events-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 40 5 * * *
- **Dependencies:** none
- **Purpose:** Merge the latest official OFAC Recent Actions page into forward-only event history.
- **Input:** OFAC Recent Actions HTML and the existing normalized event archive.
- **Output:** manifest-events.json and idempotent ofac-events.json with publication-day availability.
- **Destination:** Local macro archive only; no production write.
- **Requirements:** network, driveD
- **Operational note:** Uses the current HTML endpoint, not the retired RSS feed. Zero new events is valid; an empty parsed page fails closed.

```powershell
npx tsx worker/macro-events-fetch.mts --pages 1
```

### 25. Macro manifest and availability QA

- **ID:** `macro-manifest-qa`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 55 5 * * *
- **Dependencies:** none
- **Purpose:** Audit raw hashes, required series, normalized row counts, duplicates, availability inversions and the 2000+ research window every day.
- **Input:** Current FRED and OFAC manifests and normalized artifacts on D:.
- **Output:** worker/.runs/macro-manifest-qa.json with pass, warn or fail evidence.
- **Destination:** Local fail-closed QA gate only.
- **Requirements:** driveD
- **Operational note:** Independent of the weekly FRED parent so daily OFAC changes are audited daily and a failed collector cannot suppress QA.

```powershell
npx tsx worker/macro-manifest-qa.mts
```

### 26. Company macro exposure evidence

- **ID:** `company-exposure-evidence`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `research-series` (it was `research-factors` until that job was retired on 2026-11-24; the builder reads the canonical series, not the factor points)
- **Purpose:** Materialize debt, interest, fuel, oil and geography exposure only from aligned canonical SEC evidence.
- **Input:** Local canonical series and the 50-name research universe.
- **Output:** company-exposures.json and .md with availability, period alignment, missing and stale flags.
- **Destination:** Local static evidence only; no production write.
- **Requirements:** mysql, review
- **Operational note:** Runs after current research factors so scenario inputs cannot silently use an older fundamental snapshot.

```powershell
npx tsx scripts/build-company-exposure.mts --universe research-universe-50.json
```

### 27. Pilot SEC exposure evidence refresh

- **ID:** `pilot-exposure-evidence`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 5 6 * * *
- **Dependencies:** none
- **Purpose:** Refresh DAL, RCL, CVX, COP and PFE exposure evidence from fresh SEC companyfacts without sector inference.
- **Input:** SEC companyfacts and exact exposure concepts for the five pilot companies.
- **Output:** pilot-exposure-evidence.json and .md with concept, period, source hash and availability lineage.
- **Destination:** Local static evidence only; no production write.
- **Requirements:** network, driveD, review
- **Operational note:** Missing geography and hedge evidence stays missing. Fresh SEC facts are collected locally only.

```powershell
npx tsx scripts/build-pilot-exposure-evidence.mts
```

### 28. Availability-anchored macro scenarios

- **ID:** `macro-scenarios`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `macro-manifest-qa`, `company-exposure-evidence`, `pilot-exposure-evidence`; additionally, a complete local exposure-history summary and the Macro Transmission Atlas artifact are required.
- **Purpose:** Recompute rate, oil, USD and credit scenarios after QA and current SEC exposure evidence.
- **Input:** Normalized FRED baselines, pilot evidence, company exposures, latest inline-XBRL exposure evidence and atlas records.
- **Output:** macro-scenarios.json and .md with formulas, filing excerpts, measured atlas responses, provenance and computability status.
- **Destination:** Local Scenario Lab only; no production write.
- **Requirements:** driveD, review
- **Operational note:** Rate shocks use scheduled latest-10-K maturities plus directly tagged floating debt minus cash when available; the legacy full-repricing bound is retained only as a fallback. Upper bounds and gross exposure are not profit forecasts. Missing or stale evidence remains historical-only or not computable. The cache-only `npx tsx scripts/build-exposure-history.mts` command is a manual prerequisite, not a new collector or scheduler entry.

```powershell
npx tsx scripts/build-exposure-history.mts
npx tsx scripts/build-macro-transmission-atlas.mts
npx tsx scripts/build-macro-scenarios.mts
```

### 29. Historical macro shock calibration

- **ID:** `shock-calibration`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `macro-manifest-qa`
- **Purpose:** Calibrate historical shock percentiles and moving-block confidence intervals after manifest QA.
- **Input:** Normalized FRED history with availability and vintages.
- **Output:** shock-calibration.json and .md with p50/p75/p90/p95/p99 and CI95.
- **Destination:** Local Scenario Lab only; no production write.
- **Requirements:** driveD, review
- **Operational note:** Uses latest eligible vintages as of the report cutoff for calibration, explicitly separate from the event study's first-release policy.

```powershell
npx tsx scripts/build-shock-calibration.mts
```

### 30. OFAC first-release macro event study

- **ID:** `macro-event-study`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `macro-manifest-qa`
- **Purpose:** Measure first-release macro responses to eligible OFAC events with chronological discovery and out-of-sample evidence.
- **Input:** Normalized OFAC events and DGS10, WTI, broad USD and high-yield OAS first-release observations.
- **Output:** macro-event-study.json and .md with 1/5/21/63-observation changes and moving-block CI95.
- **Destination:** Local research artifact only; no production write or probability promotion.
- **Requirements:** driveD, review
- **Operational note:** Baseline must be known at event eligibility and outcomes start on the next observation day. No directional forecast is inferred.

```powershell
npx tsx scripts/build-macro-event-study.mts
```

### 31. Macro Transmission Atlas

- **ID:** `macro-transmission-atlas`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `macro-event-study`, `research-series` (in place of the retired `research-factors`); additionally, the local complete exposure-history summary is required and its hash is verified.
- **Purpose:** Estimate company-level macro transmission with point-in-time SEC exposure, market-model returns and frozen discovery-only OOS evaluation.
- **Input:** First-release macro event observations, canonical series, daily company and SPY prices, and filing-anchored inline-XBRL exposure history.
- **Output:** macro-transmission-atlas.json and .md with sector FE interactions, event-bootstrap CI95 and OOS metrics.
- **Destination:** Local research artifact only; no production write or probability promotion.
- **Requirements:** mysql, driveD, review
- **Operational note:** Exposure must be available and non-stale at event eligibility. Inline fuel/oil flows use operating income from the same filing and period. Debt burden is a proxy, not a floating-rate share. OOS coefficients are never refit. The history builder is a manual cache-only prerequisite, not another collector.

```powershell
npx tsx scripts/build-exposure-history.mts
npx tsx scripts/build-macro-transmission-atlas.mts
```

### 32. Production UI rebuild

- **ID:** `ui-production-build`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `schwab-daily-bars`, `schwab-feature-lab`. A child runs only after all of its parents have run since its last run. Until 2026-11-24 the first parent was `analytics-snapshot` (itself after `schwab-daily-bars`); that job and `expectations-report` were retired with the classic view, and no generated TypeScript is compiled into the client any more. The build still copies `public/` into `dist/public`, which the production server reads the report files from. The live prices need no build: the desk re-reads `desk-snapshot.json` whenever it changes.
- **Purpose:** Compile newly generated static snapshots and the server into dist for normal production-mode operation.
- **Input:** Current source and freshly generated report artifacts.
- **Output:** dist/public and dist/boot.js.
- **Destination:** Local production server files only; no cloud deployment.
- **Requirements:** review
- **Operational note:** Required for application code or generated TypeScript changes, not for a Schwab-only JSON refresh. Not required for npm run dev; restart production only when server behavior changes.

```powershell
npm run build
```

### 33. Local morning brief

- **ID:** `daily-digest`
- **Mode:** paused; **enabled by default:** no (paused on 2026-11-24: the owner paused the morning brief and the local model is stopped, so the job failed every morning; its only reader, the classic dashboard, is gone)
- **Cron:** 15 7 * * *
- **Dependencies:** none
- **Purpose:** Summarize the last 36 hours of actual local signals into a short owner brief.
- **Input:** Local signals, local Ollama and the currently configured model.
- **Output:** One morning digest with model and window metadata.
- **Destination:** Local probation when INGEST_URL is set; no automatic reviewed production promotion is added by the scheduler.
- **Requirements:** server, gpu, mysql
- **Operational note:** SEC facts and crowd comments stay separate. An empty signal window exits successfully without generating filler.

```powershell
npx tsx scripts/daily-digest.mts --hours 36
```

### 34. Daily operations health report

- **ID:** `daily-operations-report`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 20 7 * * *
- **Dependencies:** none
- **Purpose:** Record scheduler health, same-day Schwab evidence, job failures and pending automation in one owner-only static report.
- **Input:** Persistent scheduler state, current registry configuration and credential-free Schwab report summaries.
- **Output:** daily-operations.json and .md in public/reports and an existing dist/public/reports bundle.
- **Destination:** daily-operations.json and .md automatically pushed through reportFile after exit-ok and served from the fresher of DB/static.
- **Requirements:** offline computation only
- **Operational note:** Runs independently after the morning jobs so failed parents cannot suppress the health report. A critical report is evidence, not a scheduler process failure; its push failure still marks the job error.

```powershell
npx tsx scripts/build-daily-operations-report.mts
```

### 35. Data health and quarantine

- **ID:** `data-health`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `research-series`, `schwab-daily-bars`, `edgar-exhibits-daily`, `schwab-feature-lab`
- **Purpose:** Check price, filing, extraction and option inputs and record point-in-time quarantine evidence without rewriting data.
- **Input:** Local prices, facts, series_points, K06 calendar, extraction results and Dolt option features.
- **Output:** public/reports/data-health.json and .md plus research/engine/quarantine.json with per-check evidence, and an existing dist/public/reports bundle.
- **Destination:** Local read-only QA artifacts; no production write, schema change or retroactive data removal.
- **Requirements:** mysql, driveD, review
- **Operational note:** All option snapshots receive spot/IV checks; parity strikes are checked on monthly first trading dates and the latest date through the Dolt clone.

```powershell
npx tsx scripts/build-data-health.mts
```

### 36. Weekly coverage and drift report

- **ID:** `weekly-coverage-report`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 45 7 * * 1
- **Dependencies:** `daily-operations-report`
- **Purpose:** Compare the latest two inventory snapshots per table with row deltas, content hashes and latest dates.
- **Input:** The current reviewed inventory and the previous local inventory snapshot.
- **Output:** weekly-coverage.json and .md with per-table counts, deltas and hash drift.
- **Destination:** weekly-coverage.json and .md automatically pushed through reportFile after exit-ok and exposed in Workers → Weekly coverage.
- **Requirements:** offline computation only
- **Operational note:** Baseline-missing is explicit, never a zero-coverage claim. Decreases and hash drift remain visible. The report is operational evidence, not a model evaluation.

```powershell
npx tsx scripts/build-weekly-coverage.mts
```

### 37. Alpha Bridge captain executor

- **ID:** `alpha-bridge-agent`
- **Mode:** paused; **enabled by default:** no
- **Cron:** */2 * * * *
- **Dependencies:** none
- **Purpose:** Execute at most one pending captain command and record its acknowledged terminal evidence.
- **Input:** Pending bounded commands in docs/ALPHA_COMMANDS.jsonl and the existing owner authorization in AGENTS.md.
- **Output:** Acknowledged commands with completed, failed or blocked status and bounded evidence.
- **Destination:** Local command protocol only; no production transport.
- **Requirements:** review
- **Operational note:** Paused by default. Enable only after static deny rules are configured for production apply, migrations, credentials, force operations and GDELT. One pending command per run, no automatic resume of interrupted acknowledged commands.

```powershell
npx tsx worker/alpha-bridge-agent.mts
```

### 38. 13F holdings and full-book refresh

- **ID:** `13f-refresh`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 5 * * 1,4
- **Dependencies:** none
- **Purpose:** Check recent 13F-HR filings and amendments without repeating the full historical build.
- **Input:** worker/funds-13f.json, SEC XML, cached CUSIP mappings and OpenFIGI only for unknown securities.
- **Output:** fund_quarters, fund_holdings and deterministic share/full-book-weight events for the latest four quarters.
- **Destination:** Local MySQL; production transfer is a separate reviewed manual job.
- **Requirements:** network, mysql, driveD
- **Operational note:** Monday and Thursday checks are sufficient for a quarterly disclosure source with a long filing lag. No LLM is used.

```powershell
npx tsx scripts/13f-refresh.mts --quarters 4
```

### 46. Schwab token keepalive

- **ID:** `schwab-refresh-manual`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 2 */2 * *
- **Dependencies:** none
- **Purpose:** Rotate the access and refresh tokens every two days so the seven-day refresh-token window does not expire during normal unattended operation.
- **Input:** Local refresh token and Schwab client credentials available in the scheduler process environment.
- **Output:** Updated local token file and an AAPL HTTP smoke result; no token values in the UI.
- **Destination:** Local credential store only.
- **Requirements:** network
- **Operational note:** Browser authorization is needed only after revocation, credential/app changes or an outage long enough to lose the refresh window. The daily collector also refreshes an expired access token when credentials are available.

```powershell
npx tsx worker/schwab-refresh.mts
```

### 47. Read-only research reconciliation

- **ID:** `research-reconciliation`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Reconcile facts, series, factors, prices and per-CIK lineage without changing data.
- **Input:** Current local DB and research-universe-53.json compatibility baseline.
- **Output:** Coverage and lineage issues; strict failure remains a deliberate manual gate.
- **Destination:** Console/log only.
- **Requirements:** mysql, review
- **Operational note:** Use --strict manually only after the known registry decision is resolved.

```powershell
npx tsx scripts/research-reconciliation.mts
```

### 48. Fundamental integrity and continuity audit

- **ID:** `fundamental-integrity-audit`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Fail closed on duplicates, unit conflicts, missing periods, availability inversions, continuity gaps and factor-before-fact without modifying the database.
- **Input:** Local facts, series_points, factor_points, company registry and research-universe-50.json.
- **Output:** public/reports/fundamental-integrity.json and .md with CIK, concept, period and accession evidence plus explicit omitted-issue counts.
- **Destination:** Read-only QA report; no repairs, deletions or silent interpolation.
- **Requirements:** mysql, review
- **Operational note:** Run with --strict to block the next research stage on any error. Warnings retain unit changes, irregular durations, revision outliers and concept coverage gaps for review.

```powershell
npx tsx scripts/fundamental-integrity-audit.mts
```

### 49. EDGAR coverage and continuity gap analysis

- **ID:** `edgar-gap-analysis`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `fundamental-integrity-audit`
- **Purpose:** Group integrity findings by era, concept and unique missing quarter rather than treating all history as equally repairable.
- **Input:** public/reports/fundamental-integrity.json with periodEnd >= 2000-01-01.
- **Output:** edgar-coverage-gaps.json and .md with era/type/CIK summaries, deduplicated missing quarters and remediation guidance.
- **Destination:** Read-only EDGAR remediation manifest.
- **Requirements:** review
- **Operational note:** Pre-2000 findings are excluded. Recent gaps trigger EDGAR refresh; historical gaps are not blindly backfilled with current-provider data.

```powershell
npx tsx scripts/edgar-gap-analysis.mts
```

### 50. Schwab fundamental gap mapping

- **ID:** `schwab-fundamental-gap-map`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `edgar-gap-analysis`, `schwab-context-hourly`
- **Purpose:** Map EDGAR concept gaps to direct, derived and unsupported Schwab fundamental candidates without fabricating XBRL replacements.
- **Input:** edgar-coverage-gaps.json, schwab-context.json and the 50-name ticker registry.
- **Output:** schwab-fundamental-gap-map.json and .md with per-concept fields, formulas and vintage-equivalence warnings.
- **Destination:** Read-only candidate map for a later reviewed repair plan.
- **Requirements:** review
- **Operational note:** Direct fields are current metadata, not vintage replacements. Derived formulas are approximate; unsupported concepts stay missing.

```powershell
npx tsx scripts/schwab-fundamental-gap-map.mts
```

### 51. Per-company EDGAR remediation and Schwab fallback

- **ID:** `remediate-company`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `schwab-context-hourly`
- **Purpose:** Run a bounded EDGAR refresh, uncapped per-company integrity audit and only then a defensible Schwab fallback candidate map.
- **Input:** One --ticker, EDGAR cache, local facts/series/factors and Schwab instrument profile.
- **Output:** public/reports/remediation/<ticker>.json with stages, errors, recent gaps, availability inversions, candidates and next action.
- **Destination:** Local reviewed remediation plan; no automatic value insertion or production sync.
- **Requirements:** network, server, mysql, driveD, review
- **Operational note:** Default dry-run. Use --apply for EDGAR network refresh and --strict to fail on remaining errors. One ticker per run; no hidden retries.

```powershell
npx tsx scripts/remediate-company.mts
```

### 54. DoltHub historical option export

- **ID:** `dolthub-export`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Resume the free historical chain export without confusing Dolt with MySQL or SEC fundamentals.
- **Input:** Local Dolt CLI and DoltHub option database.
- **Output:** One CSV per ticker/year with hashes and resumable error manifests on D:.
- **Destination:** D:-only historical research archive.
- **Requirements:** network, driveD
- **Operational note:** Long manual backfill; not a daily job because the historical source does not require nightly recollection.

```powershell
npx tsx worker/dolthub-export.mts
```

### 55. DoltHub export validation

- **ID:** `dolthub-validate`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `dolthub-export`
- **Purpose:** Validate every exported batch, schema, date range, hash and duplicate contract key.
- **Input:** DoltHub CSV batches and manifest.
- **Output:** Fail-closed validation report.
- **Destination:** Local QA artifact.
- **Requirements:** driveD, review
- **Operational note:** Run after export completion or resume; a partial export remains visible as partial.

```powershell
npx tsx worker/dolthub-export-validate.mts
```

### 56. Historical option feature materialization

- **ID:** `dolthub-features`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `dolthub-validate`
- **Purpose:** Materialize schema-v2 per-date features using actual DTE and point-in-time spot lookups.
- **Input:** Validated historical CSV and price history.
- **Output:** JSONL option feature snapshots with resume-by-schema manifest.
- **Destination:** Local historical feature archive.
- **Requirements:** driveD
- **Operational note:** Old schemas fail instead of silently producing unusable expected-move data.

```powershell
npx tsx worker/dolthub-features.mts
```

### 57. Preregistered option hypothesis research

- **ID:** `dolthub-research`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `dolthub-features`
- **Purpose:** Run frozen ATM IV, term slope, skew and VRP tests with independent universes and FDR.
- **Input:** Historical features, frozen protocol and price labels.
- **Output:** Dated evidence, robustness and multiple-testing results.
- **Destination:** Local research artifacts only.
- **Requirements:** driveD, review
- **Operational note:** The sealed holdout is not a tuning set.

```powershell
npx tsx worker/dolthub-research.mts
```

### 58. Expected-move calibration

- **ID:** `expected-move-calibration`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `dolthub-features`
- **Purpose:** Compare ATM-IV expected move with RV20 using actual DTE and dollar-denominated realized moves.
- **Input:** Schema-v2 option features and forward prices.
- **Output:** Coverage, MAE, RMSE and actual/expected calibration ratios.
- **Destination:** Local research artifact.
- **Requirements:** driveD, review
- **Operational note:** Supports volatility sizing, not directional accuracy claims.

```powershell
npx tsx worker/dolthub-expected-move.mts
```

### 59. Volatility-target historical replay

- **ID:** `volatility-target-replay`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `dolthub-features`
- **Purpose:** Replay the frozen risk-scalar policy with next-close entry, costs, independent universes and robustness checks.
- **Input:** Historical options, prices and vol-target-protocol.json.
- **Output:** Drawdown, volatility, Sharpe and paired net-return evidence.
- **Destination:** Local research artifact.
- **Requirements:** driveD, review
- **Operational note:** Risk reduction is not automatically return alpha.

```powershell
npx tsx worker/dolthub-vol-target.mts
```

### 60. Stooq price archive import

- **ID:** `price-archive-import`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Refresh daily adjusted prices from an explicitly chosen local archive when automated free delivery is unavailable.
- **Input:** Operator-supplied Stooq-compatible ZIP on D:.
- **Output:** Upserted daily bars with missing-ticker reporting.
- **Destination:** Local MySQL; no browser storage credential required.
- **Requirements:** mysql, driveD, review
- **Operational note:** Not UI-runnable because the operator must supply and review a real file path. The factor materialization that used to follow it was retired on 2026-11-24.

```powershell
npx tsx scripts/import-research-prices-file.mts --file D:\path\to\prices.zip
```

### 61. Signals production dry-run

- **ID:** `signals-dry-review`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Preview exactly which new local EDGAR signal rows would leave the machine.
- **Input:** Local signals and per-source watermark.
- **Output:** Counts and coverage only; no network delivery.
- **Destination:** Review console only.
- **Requirements:** mysql, review
- **Operational note:** This is the only signals-push action exposed as UI-runnable.

```powershell
npx tsx scripts/push-local-signals.mts --source edgar --dry
```

### 62. Facts production dry-run

- **ID:** `facts-dry-review`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Preview complete per-CIK facts snapshots before any production transfer.
- **Input:** Local facts and the 50-name universe.
- **Output:** Per-company row counts and missing coverage; no production write.
- **Destination:** Review console only.
- **Requirements:** mysql, review
- **Operational note:** A dry-run is never marked as a successful production synchronization.

```powershell
npx tsx scripts/push-local-facts.mts --universe research-universe-50.json --dry
```

### 63. Reviewed signals production push

- **ID:** `signals-production-push`
- **Mode:** blocked; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `signals-dry-review`
- **Purpose:** Deliver reviewed local EDGAR rows without refetching or rescoring.
- **Input:** A reviewed dry-run, current local rows and the existing watermark.
- **Output:** New production signal rows with server receipt timestamps and dedupe protection.
- **Destination:** Production only after explicit terminal review.
- **Requirements:** network, mysql, review
- **Operational note:** Deliberately not UI-runnable and never scheduled. Production receives reviewed data only.

```powershell
npx tsx scripts/push-local-signals.mts --source edgar
```

### 64. Reviewed facts production push

- **ID:** `facts-production-push`
- **Mode:** blocked; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `facts-dry-review`
- **Purpose:** Replace reviewed per-CIK production snapshots transactionally.
- **Input:** A reviewed dry-run and complete local snapshots.
- **Output:** Production facts replaced per company in 500-row chunks.
- **Destination:** Production only after explicit terminal review.
- **Requirements:** network, mysql, review
- **Operational note:** Deliberately not UI-runnable and never scheduled; missing local coverage fails the apply run.

```powershell
npx tsx scripts/push-local-facts.mts --universe research-universe-50.json
```

### 66. Independent-universe and macro-regime validation

- **ID:** `macro-regime-validation`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Challenge AssetGrowth with odd/even CIK universes, sectors and macro regimes instead of relying on one full-sample IC.
- **Input:** research-universe-50.json, sector-neutral factor data, macro_points and SPY.
- **Output:** Independent universe, sector, final-holdout and macro-regime strategy evidence.
- **Destination:** Console/log research evidence only.
- **Requirements:** mysql, review
- **Operational note:** No model or protocol parameters are tuned by this runner.

```powershell
npx tsx scripts/macro-validation.mts
```

### 67. Sector-neutral portfolio evaluation

- **ID:** `sector-portfolio-evaluation`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Measure economic long/short performance of sector-neutral asset-growth quintiles at 63 and 126 sessions.
- **Input:** research-universe-50.json and sector-neutral factor dataset.
- **Output:** Directional strategy metrics and moving-block confidence intervals.
- **Destination:** Console/log research evidence only.
- **Requirements:** mysql, review
- **Operational note:** Statistical IC and economic portfolio outcomes are separate gates.

```powershell
npx tsx scripts/sector-portfolio-eval.mts
```

### 68. Sector volatility-target holdout evaluation

- **ID:** `sector-vol-target-evaluation`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Compare the frozen volatility scalar with untreated sector-neutral spreads across development, validation and final holdout.
- **Input:** research-universe-50.json and sector-neutral asset-growth data.
- **Output:** Baseline and volatility-target metrics with chronological holdout and confidence intervals.
- **Destination:** Console/log research evidence only.
- **Requirements:** mysql, review
- **Operational note:** A name-level scalar is not a guarantee of portfolio volatility or return alpha.

```powershell
npx tsx scripts/sector-vol-target-eval.mts
```

### 69. Frozen research protocol validation

- **ID:** `research-protocol-check`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Verify the option hypothesis battery and its freeze hash before using research output.
- **Input:** research/option-hypotheses-protocol.json and its SHA256 file.
- **Output:** Schema, uniqueness, window, source-grade and freeze-hash validation.
- **Destination:** Console/log only.
- **Requirements:** review
- **Operational note:** CRLF/LF differences must be resolved as byte-level facts, never by silently changing protocol parameters.

```powershell
npx tsx scripts/validate-research-protocol.mts
```

### 70. 13F top-300 universe rebuild

- **ID:** `13f-top300-universe`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Rebuild the expanded manager universe by recent full-book reported AUM when explicitly needed.
- **Input:** Recent SEC 13F-HR filers, original and amendment information tables, and the curated manager tiers.
- **Output:** worker/funds-13f-top300.json; institutional-only managers do not create position events.
- **Destination:** Local tracked universe candidate for review; not a daily job.
- **Requirements:** network, driveD, review
- **Operational note:** Long manual universe maintenance. Review the diff before committing or using it in 13f-refresh.

```powershell
npx tsx scripts/build-13f-top300.mts
```

### 71. Research coverage expansion

- **ID:** `coverage-expansion`
- **Mode:** blocked; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Expand research breadth without contaminating results with survivorship or orphan entities.
- **Input:** A reviewed universe plan, departed/delisted coverage and daily price freshness.
- **Output:** A future reviewed expansion pipeline; the legacy bootstrap helper is not a nightly command.
- **Destination:** Blocked pending universe design.
- **Requirements:** mysql, review
- **Operational note:** scripts/expand-coverage.mts remains a legacy curated bootstrap helper, not an acceptable substitute for the 300+ research universe gate.

```powershell
Not scheduled — design a 300+ point-in-time universe with departed/delisted names first
```

### 72. signals.note migration gate

- **ID:** `signals-note-migration`
- **Mode:** blocked; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `mysql-backup-restore`
- **Purpose:** Apply the prepared VARCHAR(2000) signals.note change only after recovery is proven.
- **Input:** Successful MySQL backup/restore, prepared DDL and code compatibility review.
- **Output:** Local migration first; a later separate reviewed production migration.
- **Destination:** Blocked by mysql-backup-restore.
- **Requirements:** mysql, driveD, review
- **Operational note:** Never db:push --force and never drop tables.

```powershell
Manual reviewed DDL only after backup and restore evidence
```

### 73. Schwab OAuth browser authorization

- **ID:** `schwab-oauth-callback`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Run the one-shot local HTTPS callback only when a new authorization code is required.
- **Input:** Current-session Schwab client credentials, the local development certificate and an interactive browser.
- **Output:** Local token file and AAPL smoke quote; no credentials in logs or browser UI.
- **Destination:** Interactive terminal/browser flow, not scheduler-runnable.
- **Requirements:** network, review
- **Operational note:** The self-signed certificate is local development only; never disable certificate validation globally.

```powershell
npx tsx worker/schwab-callback.mts
```

### 74. Optional ORATS option lane

- **ID:** `options-orats-optional`
- **Mode:** blocked; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Keep the optional provider visible without silently enabling a paid or credentialed data path.
- **Input:** Separately configured ORATS access and an explicit research need.
- **Output:** Provider-specific snapshots only if manually activated later.
- **Destination:** Blocked; no scheduled collection.
- **Requirements:** network, driveD, review
- **Operational note:** Free Schwab, Cboe and DoltHub lanes remain independent; providers are never silently mixed.

```powershell
Not active — optional worker/options-orats.mts lane requires separately reviewed credentials
```

### 75. Legacy cloud ad-hoc job queue

- **ID:** `cloud-adhoc-jobs`
- **Mode:** blocked; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Keep legacy cloud bootstrap, harvest and other queue actions distinct from the home scheduler.
- **Input:** A separate owner decision and the existing cloud job queue.
- **Output:** Cloud-side work only; no new default direct-to-production collection is authorized by this registry.
- **Destination:** Blocked from home cron.
- **Requirements:** review
- **Operational note:** The cloud control plane cannot spawn home workers, and the home scheduler does not create legacy cloud jobs.

```powershell
No home cron — legacy /jobs actions require a separate deliberate review
```

### 76. MySQL backup and restore gate

- **ID:** `mysql-backup-restore`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Protect the local DB before the signals.note migration or any storage move; the same SELECT-only tooling protects reviewed Expectations staging apply through direct or worker HTTP transport.
- **Input:** Local gate: DATABASE_URL plus SCRATCH_DATABASE_URL. Current production: PROD_INGEST_URL, WORKER_KEY and SCRATCH_DATABASE_URL. Optional direct production mode: PROD_DATABASE_URL.
- **Output:** External-root table JSON dumps, per-table hashes, row counts and passing restore-drill evidence.
- **Destination:** Manual only; backups outside Git with the last ten retained and pruning only through --prune.
- **Requirements:** mysql, driveD, review
- **Operational note:** Two modes: direct uses the DATABASE_URL command above and closes signals.note only after its own full scratch drill. Via-api is the current production channel: npx tsx scripts/prod-backup.mts --via-api --restore-target SCRATCH_DATABASE_URL, then apply-expectations-reviewed.mts --via-api --backup-id <id>. The server uses worker-key auth, gzip, a 64 MB decompressed guard and no DDL. Direct PROD_DATABASE_URL remains optional. Missing reviewed tables are a separate blocker; db/ddl/031_expectations_reviewed.sql is prepared but never auto-applied.

```powershell
npx tsx scripts/prod-backup.mts --full --source-env DATABASE_URL --restore-target SCRATCH_DATABASE_URL
```

### 77. Selective AAPL/SPY streaming

- **ID:** `schwab-selective-stream`
- **Mode:** blocked; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Add selective quote/trade streaming with heartbeat, lag and stale detection.
- **Input:** User Preference authorization, AAPL/SPY only and the official streamer contract.
- **Output:** Local JSONL stream captures and explicit connection state.
- **Destination:** Future local streaming lane only.
- **Requirements:** network, driveD, review
- **Operational note:** No full-universe streaming and no production sync. The current User Preference 401 must be resolved first.

```powershell
Not implemented — M5 only after REST/UI review
```

### 78. GDELT collector and backfill

- **ID:** `gdelt-frozen`
- **Mode:** frozen; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Keep the moratorium visible in the operational registry so nobody accidentally restarts it.
- **Input:** None while frozen.
- **Output:** No requests and no new rows.
- **Destination:** None.
- **Requirements:** review
- **Operational note:** The legacy Windows task, if still present, must remain disabled. The scheduler offers no Run control for this entry.

```powershell
Frozen — no automated or manual GDELT requests
```

## 6. Daily review checklist

1. Open `/workers` → **Daily report**. Require an online scheduler, same-day Schwab capture for every expected ticker and zero failed checks. The report is operational evidence, separate from the LLM morning digest.
2. Rebuild the report on demand with `npx tsx scripts/build-daily-operations-report.mts`. It writes credential-free JSON and Markdown locally and updates an existing dist bundle without an application rebuild.
3. Open Activity for failed jobs; inspect the log rather than blindly rerunning the whole universe. Use the Schwab Feature Lab chain when raw chains, normalized data and features must be refreshed together.
4. Check `/market-data` coverage, manifest errors and duplicate OSI counts after the Schwab chain.
5. Check Analytics and Expectations freshness after report builders and the production UI rebuild.
6. Check Macro Ops artifact lineage: weekly FRED coverage, daily OFAC and QA, then scenarios, shock calibration, first-release event study and Macro Transmission Atlas. Do not require daily FRED collection merely to make the weekly schedule appear healthy.
7. Run dry-review jobs before any production transfer. Apply commands remain in the terminal and are never cron jobs.
8. Do not start both dev and production web servers. Do not start a second scheduler or re-enable legacy overlapping tasks.
