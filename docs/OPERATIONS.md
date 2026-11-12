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

Push only QA-passed operational outputs after successful scheduled jobs.

- **When:** Automatically after exit-ok for Schwab prices/context, FRED vintages and daily operations. One retry with backoff; failure marks the job error. Manual triggers do not auto-push; use this explicit backfill command instead.
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

Both installers create hidden `ONLOGON` processes: the production UI and the single cron engine. `npm run dev` remains a manual development-only mode. `-DisableLegacyTasks` disables old Stocktwits, GDELT and Digest tasks when present and skips tasks that do not exist, so reruns are idempotent. GDELT remains frozen. Because the hidden launchers detach, Task Scheduler may show Ready rather than Running; verify the server with curl and the scheduler with its heartbeat/log. To inspect or stop the scheduler:

```powershell
schtasks /Query /TN AlphaEngine-Operations-Scheduler /V /FO LIST
schtasks /End /TN AlphaEngine-Operations-Scheduler
```

For an interactive diagnostic run instead of the Windows task:

```powershell
npx tsx worker/operations-scheduler.mts
```

The scheduler reads cron configuration and UI commands every 15 seconds. It runs one job at a time. Dependency children start only after successful parents. A failed parent blocks its children. A missed cron slot is caught up once after a scheduler outage; a brand-new job starts at its next future slot. Cron uses the home machine's local timezone.

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
| Research factor materialization | scheduled | after research-series | Local MySQL. |
| Precomputed dashboard and institutional data | scheduled | after facts-fetch-daily + sp500-facts-daily + edgar-fetch-daily | Local precomputed page-data artifacts only; no production write or push lane. |
| Precomputed 13F page data | scheduled | after 13f-refresh | Local precomputed page-data artifacts only; no production write or push lane. |
| Precomputed probability after research factors | scheduled | after research-factors | Local precomputed page-data artifacts only; no production write or model promotion. |
| Precomputed probability after daily prices | scheduled | after schwab-daily-bars | Local precomputed page-data artifacts only; no production write or model promotion. |
| Precomputed probability after macro vintages | scheduled | after macro-fred-weekly | Local precomputed page-data artifacts only; no production write or model promotion. |
| Precomputed probability after EDGAR tone | scheduled | after edgar-tone-nightly | Local precomputed page-data artifacts only; no production write or model promotion. |
| Schwab REST daily snapshot | scheduled | 0 4 * * * | Raw chains remain local; successful scheduled runs automatically push QA-passed daily OHLCV and daily-prices-schwab.json through /api/worker/ingest. |
| Schwab normalized UI snapshot | scheduled | after schwab-fetch-daily | Normalized snapshot automatically pushed as schwab-market-data.json after exit-ok; raw chains and the local gzip stay local. |
| Schwab Feature Lab materialization | scheduled | after schwab-snapshot | Local Feature Lab UI only; no production factor promotion. |
| Schwab market context pack | scheduled | 10 * * * * | schwab-context.json automatically pushed through reportFile after successful scheduled runs; no accounts, orders or full-universe streaming. |
| Schwab REST daily snapshot · S&P 500 and funds | scheduled | 30 4 * * * | Local only: no operational push, no normalized UI snapshot and no production write. |
| Schwab daily bars into local prices | scheduled | after schwab-fetch-sp500 | Local MySQL only; the operational pricesDaily push is unchanged. |
| Desk market snapshot | scheduled | after schwab-daily-bars | Local static UI artifact read by desk.snapshot; no production write and no push lane. |
| Analytics and weekly evidence snapshot | scheduled | after research-factors | Local static UI artifacts; no production write. |
| Expectations static report | scheduled | 0 6 * * * | Local static UI artifacts; partial results remain explicitly unreviewed. |
| FRED and ALFRED weekly vintage refresh | scheduled | 30 5 * * 0 | Normalized vintage rows automatically pushed through macroPoints after exit-ok; raw FRED chunks stay local. |
| OFAC daily event refresh | scheduled | 40 5 * * * | Local macro archive only; no production write. |
| Macro manifest and availability QA | scheduled | 55 5 * * * | Local fail-closed QA gate only. |
| Company macro exposure evidence | scheduled | after research-factors | Local static evidence only; no production write. |
| Pilot SEC exposure evidence refresh | scheduled | 5 6 * * * | Local static evidence only; no production write. |
| Availability-anchored macro scenarios | scheduled | after macro-manifest-qa + company-exposure-evidence + pilot-exposure-evidence | Local Scenario Lab only; no production write. |
| Historical macro shock calibration | scheduled | after macro-manifest-qa | Local Scenario Lab only; no production write. |
| OFAC first-release macro event study | scheduled | after macro-manifest-qa | Local research artifact only; no production write or probability promotion. |
| Macro Transmission Atlas | scheduled | after macro-event-study + research-factors | Local research artifact only; no production write or probability promotion. |
| Production UI rebuild | scheduled | after analytics-snapshot + schwab-feature-lab + expectations-report | Local production server files only; no cloud deployment. |
| Local morning brief | scheduled | 15 7 * * * | Local probation when INGEST_URL is set; no automatic reviewed production promotion is added by the scheduler. |
| Daily operations health report | scheduled | 20 7 * * * | daily-operations.json and .md automatically pushed through reportFile after exit-ok and served from the fresher of DB/static. |
| Data health and quarantine | scheduled | after research-series + schwab-daily-bars + edgar-exhibits-daily + schwab-feature-lab | Local read-only QA artifacts; no production write, schema change or retroactive data removal. |
| Weekly coverage and drift report | scheduled | 45 7 * * 1 | weekly-coverage.json and .md automatically pushed through reportFile after exit-ok and exposed in Workers → Weekly coverage. |
| Alpha Bridge captain executor | paused | */2 * * * * | Local command protocol only; no production transport. |
| 13F holdings and full-book refresh | scheduled | 0 5 * * 1,4 | Local MySQL; production transfer is a separate reviewed manual job. |
| EDGAR local tone scoring | paused | after edgar-fetch-daily | Local MySQL/outbox only; production copy remains reviewed and manual. |
| Quarterly cohort pack builder | paused | after edgar-exhibits-daily | Local cache only. |
| Cohort LLM extraction | paused | after expectations-cohorts | Local research files only. |
| Independent extraction benchmark | paused | after expectations-extract | Local benchmark artifact only. |
| Legacy Cboe option snapshot | paused | 30 4 * * * | Local option cache; never silently merged with Schwab or DoltHub. |
| Offline DTE option features | paused | after options-cboe-fetch | Local option-features cache. |
| Offline option provider QA | paused | after options-features | Local QA artifacts only. |
| Schwab token keepalive | scheduled | 0 2 */2 * * | Local credential store only. |
| Read-only research reconciliation | manual | manual | Console/log only. |
| Fundamental integrity and continuity audit | manual | manual | Read-only QA report; no repairs, deletions or silent interpolation. |
| EDGAR coverage and continuity gap analysis | manual | after fundamental-integrity-audit | Read-only EDGAR remediation manifest. |
| Schwab fundamental gap mapping | manual | after edgar-gap-analysis + schwab-context-hourly | Read-only candidate map for a later reviewed repair plan. |
| Per-company EDGAR remediation and Schwab fallback | manual | after schwab-context-hourly | Local reviewed remediation plan; no automatic value insertion or production sync. |
| Availability-anchored tone event study | manual | manual | Local research artifact. |
| Tone IC and turnover evaluation | manual | manual | Local research artifact. |
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
| EDGAR tone readiness audit | manual | manual | Console/log only; no Ollama, ingest or manifest writes. |
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

### 7. Research factor materialization

- **ID:** `research-factors`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `research-series`
- **Purpose:** Materialize point-in-time factor points from the new canonical series and available prices.
- **Input:** Local series_points and existing research price history.
- **Output:** Idempotent factor_points per company.
- **Destination:** Local MySQL.
- **Requirements:** mysql
- **Operational note:** Does not claim new predictive evidence; evaluation remains a separate research job.

```powershell
npx tsx scripts/materialize-research-factors.mts --universe research-universe-50.json
```

### 8. Precomputed dashboard and institutional data

- **ID:** `page-data-dashboard`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `facts-fetch-daily`, `sp500-facts-daily`, `edgar-fetch-daily`
- **Purpose:** Precompute global dashboard counts and institutional ownership after SEC fact and filing inputs change.
- **Input:** Local companies, filings, facts and 13F holdings for the research universe.
- **Output:** dashboard-stats.json and per-company institutional artifacts with generation time, input evidence and code version.
- **Destination:** Local precomputed page-data artifacts only; no production write or push lane.
- **Requirements:** mysql, review
- **Operational note:** Live user membership and job counters remain on request. Stale artifacts remain visible with an as-of time and stale mark; missing artifacts use the original computation.

```powershell
npx tsx scripts/build-precomputed-page-data.mts --group stats
```

### 9. Precomputed 13F page data

- **ID:** `page-data-13f`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `13f-refresh`
- **Purpose:** Precompute institutional ownership, guarded sector flows and 13F-dependent probability results after holdings change.
- **Input:** Local fund_holdings, fund_quarters and current guarded quarter pair.
- **Output:** Per-company institutional/probability artifacts and sector-flows.json with input lineage.
- **Destination:** Local precomputed page-data artifacts only; no production write or push lane.
- **Requirements:** mysql, review
- **Operational note:** The original guarded aggregation runs unchanged. Missing artifacts fall back to on-request computation.

```powershell
npx tsx scripts/build-precomputed-page-data.mts --group institutional
```

### 10. Precomputed probability after research factors

- **ID:** `page-data-fundamentals`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `research-factors`
- **Purpose:** Recompute per-company probability artifacts after point-in-time factor materialization changes.
- **Input:** Local factor_points and the existing availability-anchored probability inputs.
- **Output:** One probability artifact per research-universe company with generation time, input evidence and code version.
- **Destination:** Local precomputed page-data artifacts only; no production write or model promotion.
- **Requirements:** mysql, review
- **Operational note:** Point-in-time evaluation is unchanged; this is serving precomputation, not a new model or factor.

```powershell
npx tsx scripts/build-precomputed-page-data.mts --group probability
```

### 11. Precomputed probability after daily prices

- **ID:** `page-data-prices`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `schwab-daily-bars`
- **Purpose:** Recompute probability artifacts after the local daily price history changes.
- **Input:** Local company and SPY daily bars with existing source and availability rules.
- **Output:** Per-company probability artifacts with input lineage.
- **Destination:** Local precomputed page-data artifacts only; no production write or model promotion.
- **Requirements:** mysql, review
- **Operational note:** Prices keep their existing source selection and availability discipline.

```powershell
npx tsx scripts/build-precomputed-page-data.mts --group probability
```

### 12. Precomputed probability after macro vintages

- **ID:** `page-data-macro`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `macro-fred-weekly`
- **Purpose:** Recompute probability artifacts after eligible macro vintages change.
- **Input:** Local VIX, high-yield spread and yield-curve vintages.
- **Output:** Per-company probability artifacts with macro input evidence.
- **Destination:** Local precomputed page-data artifacts only; no production write or model promotion.
- **Requirements:** mysql, review
- **Operational note:** The existing macro prior and availability windows are unchanged.

```powershell
npx tsx scripts/build-precomputed-page-data.mts --group probability
```

### 13. Precomputed probability after EDGAR tone

- **ID:** `page-data-tone`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `edgar-tone-nightly`
- **Purpose:** Refresh probability artifacts if the paused EDGAR tone lane is enabled and produces new inputs.
- **Input:** Local EDGAR tone signal rows and existing probability inputs.
- **Output:** Per-company probability artifacts with input lineage.
- **Destination:** Local precomputed page-data artifacts only; no production write or model promotion.
- **Requirements:** mysql, review
- **Operational note:** No model call occurs in this builder. The parent tone lane remains paused until separately enabled.

```powershell
npx tsx scripts/build-precomputed-page-data.mts --group probability
```

### 14. Schwab REST daily snapshot

- **ID:** `schwab-fetch-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 4 * * *
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
- **Cron:** 30 4 * * *
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
- **Dependencies:** `schwab-fetch-sp500`
- **Purpose:** Store every completed official daily candle of both Schwab archives in local prices, so a day one run misses is filled by the next.
- **Input:** pricehistory files of the schwab and schwab-sp500 archives (about one month each).
- **Output:** Local prices rows (source schwab after each series' last Stooq bar, schwab-hist on dates the Stooq history covers) and worker/.runs/local-generated/schwab-daily-bars.json with inserts, conflicts and holes against SPY's sessions.
- **Destination:** Local MySQL only; the operational pricesDaily push is unchanged.
- **Requirements:** mysql, driveD
- **Operational note:** The app lets Schwab win on its dates, so raw Schwab bars never enter dates of the dividend-adjusted Stooq history (they are kept as schwab-hist). A stored close is never changed: a different close is a conflict and marks the job error; other field differences are listed.

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
- **Operational note:** Stops without writing when a Schwab archive root is missing, so the previous snapshot stays in place. Option-derived fields reach only the owner and NDA reviewers. Reports registry rows that disagree with the GICS snapshot.

```powershell
npx tsx scripts/build-desk-snapshot.mts
```

### 21. Analytics and weekly evidence snapshot

- **ID:** `analytics-snapshot`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `research-factors`
- **Purpose:** Refresh Analytics metrics and weekly evidence from the current DB and option manifests.
- **Input:** Local fundamentals, factors, tone, prices, 13F and option feature manifests.
- **Output:** Generated analytics JSON/TypeScript and the English project-strength review.
- **Destination:** Local static UI artifacts; no production write.
- **Requirements:** mysql, review
- **Operational note:** Preserves prior weekly snapshots and does not invent missing history.

```powershell
npx tsx scripts/build-analytics-snapshot.mts
```

### 22. Expectations static report

- **ID:** `expectations-report`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 6 * * *
- **Dependencies:** none
- **Purpose:** Publish the current local extraction and factual fallback notes to the owner-only UI without raw LLM responses.
- **Input:** Current cohort extraction results, benchmark result when present, and research-universe-50.json.
- **Output:** Credential-free expectations JSON and TypeScript with evidence, coverage and data-quality notes.
- **Destination:** Local static UI artifacts; partial results remain explicitly unreviewed.
- **Requirements:** review
- **Operational note:** Safe even while extraction is paused: it reports the actual partial state instead of fabricating completion.

```powershell
npx tsx worker/build-expectations-report.mts --cohorts --scope full-history
```

### 23. FRED and ALFRED weekly vintage refresh

- **ID:** `macro-fred-weekly`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 30 5 * * 0
- **Dependencies:** none
- **Purpose:** Refresh all registered FRED series with raw yearly chunks, vintage availability and resumable manifests.
- **Input:** FRED/ALFRED API, existing D:-only macro archive and the configured server-side API key.
- **Output:** Raw hashes, normalized first-to-current vintage rows and manifest-fred.json from 2000 onward.
- **Destination:** Normalized vintage rows automatically pushed through macroPoints after exit-ok; raw FRED chunks stay local.
- **Requirements:** network, driveD
- **Operational note:** Weekly full-vintage refresh preserves sourceHash and realtimeStart/End. Conflicting vintages are rejected with reasons rather than overwritten. Request spacing remains capped at 100 requests per minute.

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
- **Dependencies:** `research-factors`
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
- **Dependencies:** `macro-manifest-qa`, `company-exposure-evidence`, `pilot-exposure-evidence`
- **Purpose:** Recompute rate, oil, USD and credit scenarios after QA and current SEC exposure evidence.
- **Input:** Normalized FRED baselines, pilot evidence and company exposures.
- **Output:** macro-scenarios.json and .md with formulas, provenance and computability status.
- **Destination:** Local Scenario Lab only; no production write.
- **Requirements:** driveD, review
- **Operational note:** Upper bounds and gross exposure are not profit forecasts. Missing or stale evidence remains historical-only or not computable.

```powershell
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
- **Dependencies:** `macro-event-study`, `research-factors`
- **Purpose:** Estimate company-level macro transmission with point-in-time SEC exposure, market-model returns and frozen discovery-only OOS evaluation.
- **Input:** First-release macro event observations, canonical series, daily company and SPY prices.
- **Output:** macro-transmission-atlas.json and .md with sector FE interactions, event-bootstrap CI95 and OOS metrics.
- **Destination:** Local research artifact only; no production write or probability promotion.
- **Requirements:** mysql, driveD, review
- **Operational note:** Exposure must be available and non-stale at event eligibility. Debt burden is a proxy, not a floating-rate share. OOS coefficients are never refit.

```powershell
npx tsx scripts/build-macro-transmission-atlas.mts
```

### 32. Production UI rebuild

- **ID:** `ui-production-build`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `analytics-snapshot`, `schwab-feature-lab`, `expectations-report`
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
- **Mode:** scheduled; **enabled by default:** yes
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

### 39. EDGAR local tone scoring

- **ID:** `edgar-tone-nightly`
- **Mode:** paused; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `edgar-fetch-daily`
- **Purpose:** Score newly cached filings with local Ollama after the expectations lane is explicitly declared stable.
- **Input:** Cached filings, qwen3.5:9b, 32K context and existing score manifests.
- **Output:** Local tone rows, atomic checkpoints, skip taxonomy and token/rate telemetry.
- **Destination:** Local MySQL/outbox only; production copy remains reviewed and manual.
- **Requirements:** server, gpu, mysql
- **Operational note:** Paused by default. Enabling it shares the single scheduler lane, so it cannot overlap the expectations GPU run.

```powershell
npx tsx worker/edgar-tone.mts --universe edgar-universe.json --concurrency 2
```

### 40. Quarterly cohort pack builder

- **ID:** `expectations-cohorts`
- **Mode:** paused; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `edgar-exhibits-daily`
- **Purpose:** Build deterministic, period-aligned bounded containers from complete guidance and actual blocks.
- **Input:** Complete EX-99 cache and filing period metadata.
- **Output:** cohort-pack-v2.json with source hashes and explicit unpacked failures.
- **Destination:** Local cache only.
- **Requirements:** driveD
- **Operational note:** Paused with the active LLM lane so the operator does not accidentally start a second full-history run.

```powershell
npx tsx worker/edgar-cohorts.mts --universe research-universe-50.json
```

### 41. Cohort LLM extraction

- **ID:** `expectations-extract`
- **Mode:** paused; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `expectations-cohorts`
- **Purpose:** Extract guidance, comparable actuals and factual fallback notes with atomic source-level resume.
- **Input:** Bounded cohort packs and local Ollama; prompt/schema remain fixed by the research protocol.
- **Output:** cohort-v2.json, structured statements, fallback notes and explicit failures.
- **Destination:** Local research files only.
- **Requirements:** gpu, driveD
- **Operational note:** Paused by default. Never runs concurrently with tone because the scheduler has one execution lane.

```powershell
npx tsx worker/edgar-cohort-extract.mts --universe research-universe-50.json
```

### 42. Independent extraction benchmark

- **ID:** `expectations-benchmark`
- **Mode:** paused; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `expectations-extract`
- **Purpose:** Compare extraction with the independent gold benchmark before any reviewed status is allowed.
- **Input:** Official gold statements and current cohort extraction results.
- **Output:** Recall and exact-field issue report without treating extra review items as automatic errors.
- **Destination:** Local benchmark artifact only.
- **Requirements:** review
- **Operational note:** A report cannot become reviewed merely because extraction completed.

```powershell
npx tsx worker/expectations-benchmark.mts --cohorts
```

### 43. Legacy Cboe option snapshot

- **ID:** `options-cboe-fetch`
- **Mode:** paused; **enabled by default:** no
- **Cron:** 30 4 * * *
- **Dependencies:** none
- **Purpose:** Maintain the independent delayed-Cboe provider lane for cross-provider checks when explicitly enabled.
- **Input:** Cboe delayed public chains for the current research universe.
- **Output:** Immutable raw and normalized provider-specific snapshots.
- **Destination:** Local option cache; never silently merged with Schwab or DoltHub.
- **Requirements:** network, driveD
- **Operational note:** Paused to avoid maintaining duplicate current-provider lanes without a research need.

```powershell
npx tsx worker/options-fetch.mts --source cboe --universe research-universe-50.json
```

### 44. Offline DTE option features

- **ID:** `options-features`
- **Mode:** paused; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `options-cboe-fetch`
- **Purpose:** Compute ATM IV, term slope, skew, put/call and liquidity features from the latest Cboe chain per ticker.
- **Input:** Normalized Cboe snapshots.
- **Output:** DTE-bucket feature sets and manifest with actual DTE and honest nulls.
- **Destination:** Local option-features cache.
- **Requirements:** offline computation only
- **Operational note:** Dependency-triggered only when the legacy Cboe lane is enabled.

```powershell
npx tsx worker/option-features.mts
```

### 45. Offline option provider QA

- **ID:** `options-qa`
- **Mode:** paused; **enabled by default:** no
- **Cron:** none
- **Dependencies:** `options-features`
- **Purpose:** Audit provider coverage, duplicates, quote quality, IV/Greeks, timestamps and manifest completeness.
- **Input:** All normalized option snapshots and provider manifest.
- **Output:** options-qa.json and options-qa.md.
- **Destination:** Local QA artifacts only.
- **Requirements:** review
- **Operational note:** Data quality is not evidence of predictive value.

```powershell
npx tsx worker/options-qa.mts
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

### 52. Availability-anchored tone event study

- **ID:** `tone-event-study`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Estimate abnormal returns and CAR after filings with conservative post-close availability.
- **Input:** Local tone events, prices and SPY.
- **Output:** Event-study JSON used by the Analytics CAR chart.
- **Destination:** Local research artifact.
- **Requirements:** mysql, review
- **Operational note:** Measurement windows are not automatically tradable signals.

```powershell
npx tsx scripts/tone-event-study.mts
```

### 53. Tone IC and turnover evaluation

- **ID:** `tone-ic`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Validate slow tone against 63/126-session excess returns with block-bootstrap uncertainty.
- **Input:** Local tone, prices and the production v1 model provenance.
- **Output:** IC, quantile spread, autocorrelation, turnover and confidence intervals.
- **Destination:** Local research artifact.
- **Requirements:** mysql, review
- **Operational note:** A research evaluation, not a scheduled production factor rebuild.

```powershell
npx tsx scripts/tone-ic.mts
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
- **Operational note:** Not UI-runnable because the operator must supply and review a real file path. Run research-factors afterward.

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

### 65. EDGAR tone readiness audit

- **ID:** `edgar-tone-readiness-audit`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Inspect exact deterministic skips, pending work and prompt sizes before any long GPU run.
- **Input:** Cached filings, manifests and the production tone preparation path.
- **Output:** Read-only skip taxonomy, planned calls, windows and prompt-character totals.
- **Destination:** Console/log only; no Ollama, ingest or manifest writes.
- **Requirements:** driveD, review
- **Operational note:** Use --manifest-only for the instant manifest report or the full CPU scan before enabling tone.

```powershell
npx tsx worker/edgar-tone-audit.mts --universe edgar-universe.json
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
