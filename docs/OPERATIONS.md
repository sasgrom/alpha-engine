# Alpha Engine Operations Runbook

Generated from `contracts/operations.ts`. The scheduler, UI and this document share the same job registry.

## 1. Normal home run stack

Use exactly **one** web server on port 3000. The scheduler is a separate process. MySQL and Ollama are independent services.

### Local production server

Normal daily UI and local ingest API.

- **When:** Use for ordinary operation after npm run build. Do not run together with the dev server.
- **Input:** dist/public, dist/boot.js and the home .env.
- **Output:** One local application at http://127.0.0.1:3000.

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

### Cloud control plane

Receive reviewed data and present the cloud UI.

- **When:** Never scheduled and never triggered by a collector. Cloud cannot spawn home jobs.
- **Input:** Reviewed facts, signals or other explicitly approved artifacts.
- **Output:** Production records with server receipt timestamps and dedupe protection.

```powershell
Manual terminal apply after review only
```

## 2. Install the single cron engine

Run from `C:\dev\alpha-engine` after `git pull` and `npm install --no-audit --no-fund`:

```powershell
powershell -ExecutionPolicy Bypass -File worker\operations-scheduler-install.ps1 -DisableLegacyTasks
schtasks /Run /TN AlphaEngine-Operations-Scheduler
```

The installer creates one `ONLOGON` task. `-DisableLegacyTasks` disables old Stocktwits, GDELT and Digest tasks when present and skips tasks that do not exist, so reruns are idempotent. GDELT remains frozen. To inspect or stop the scheduler:

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
| Canonical research series | scheduled | after facts-fetch-daily | Local MySQL. |
| Research factor materialization | scheduled | after research-series | Local MySQL. |
| Schwab REST daily snapshot | scheduled | 0 4 * * * | Local Schwab archive only; no orders, accounts or production sync. |
| Schwab normalized UI snapshot | scheduled | after schwab-fetch-daily | Reviewed local static snapshot only. |
| Analytics and weekly evidence snapshot | scheduled | after research-factors | Local static UI artifacts; no production write. |
| Expectations static report | scheduled | 0 6 * * * | Local static UI artifacts; partial results remain explicitly unreviewed. |
| Production UI rebuild | scheduled | after analytics-snapshot + schwab-snapshot + expectations-report | Local production server files only; no cloud deployment. |
| Local morning brief | scheduled | 15 7 * * * | Local probation when INGEST_URL is set; no automatic reviewed production promotion is added by the scheduler. |
| 13F holdings and full-book refresh | scheduled | 0 5 * * 1,4 | Local MySQL; production transfer is a separate reviewed manual job. |
| EDGAR local tone scoring | paused | after edgar-fetch-daily | Local MySQL/outbox only; production copy remains reviewed and manual. |
| Quarterly cohort pack builder | paused | after edgar-exhibits-daily | Local cache only. |
| Cohort LLM extraction | paused | after expectations-cohorts | Local research files only. |
| Independent extraction benchmark | paused | after expectations-extract | Local benchmark artifact only. |
| Legacy Cboe option snapshot | paused | 30 4 * * * | Local option cache; never silently merged with Schwab or DoltHub. |
| Offline DTE option features | paused | after options-cboe-fetch | Local option-features cache. |
| Offline option provider QA | paused | after options-features | Local QA artifacts only. |
| Schwab token refresh smoke | manual | manual | Local credential store only. |
| Read-only research reconciliation | manual | manual | Console/log only. |
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
| MySQL backup and restore gate | blocked | manual | Not implemented as a runnable job yet. |
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
- **Input:** SEC exhibit-bearing filings for the current 51-name expectations universe.
- **Output:** Hash-linked EX-99 cache with completeness metadata.
- **Destination:** Local expectations cache only.
- **Requirements:** network, driveD
- **Operational note:** Independent from the legacy tone exhibit selection; never reduces documents to the largest exhibit.

```powershell
npx tsx worker/edgar-exhibits.mts --universe research-universe-51.json
```

### 4. Companyfacts local snapshot

- **ID:** `facts-fetch-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 3 * * *
- **Dependencies:** none
- **Purpose:** Refresh SEC XBRL companyfacts into local MySQL with first-filed availability intact.
- **Input:** SEC companyfacts JSON and research-universe-51.json.
- **Output:** One complete, validated facts snapshot per CIK; raw JSON remains cached on D:.
- **Destination:** Local MySQL through the local factsSnapshot ingest route; no production write.
- **Requirements:** network, server, mysql, driveD
- **Operational note:** Requires exactly one reachable local web server on port 3000 and INGEST_URL pointing to it.

```powershell
npx tsx worker/facts-fetch.mts --universe research-universe-51.json
```

### 5. Canonical research series

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
npx tsx scripts/build-research-series.mts --universe research-universe-51.json
```

### 6. Research factor materialization

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
npx tsx scripts/materialize-research-factors.mts --universe research-universe-51.json
```

### 7. Schwab REST daily snapshot

- **ID:** `schwab-fetch-daily`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 4 * * *
- **Dependencies:** none
- **Purpose:** Capture chains, quotes, daily price history and instruments with hashes and availability timestamps.
- **Input:** Schwab Market Data Production; local token file; research-universe-51.json.
- **Output:** D:-only raw snapshots and a resumable manifest; User Preference status is recorded separately for streaming setup.
- **Destination:** Local Schwab archive only; no orders, accounts or production sync.
- **Requirements:** network, driveD
- **Operational note:** Same-day complete tickers resume without redownloading. A User Preference 401 does not invalidate completed REST data.

```powershell
npx tsx worker/schwab-fetch.mts --universe research-universe-51.json
```

### 8. Schwab normalized UI snapshot

- **ID:** `schwab-snapshot`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `schwab-fetch-daily`
- **Purpose:** Normalize the latest valid chain per ticker and expose credential-free static data to /market-data.
- **Input:** Latest Schwab manifest entries and raw chains.
- **Output:** public/reports/schwab-market-data.json with OSI IDs, DTE and QA, fetched on demand by /market-data.
- **Destination:** Reviewed local static snapshot only.
- **Requirements:** review
- **Operational note:** Hash mismatches, truncated chains and provider failures remain visible instead of falling back to stale success.

```powershell
npx tsx worker/build-schwab-market-data.mts
```

### 9. Analytics and weekly evidence snapshot

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

### 10. Expectations static report

- **ID:** `expectations-report`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** 0 6 * * *
- **Dependencies:** none
- **Purpose:** Publish the current local extraction and factual fallback notes to the owner-only UI without raw LLM responses.
- **Input:** Current cohort extraction results, benchmark result when present, and research-universe-51.json.
- **Output:** Credential-free expectations JSON and TypeScript with evidence, coverage and data-quality notes.
- **Destination:** Local static UI artifacts; partial results remain explicitly unreviewed.
- **Requirements:** review
- **Operational note:** Safe even while extraction is paused: it reports the actual partial state instead of fabricating completion.

```powershell
npx tsx worker/build-expectations-report.mts --cohorts --scope full-history
```

### 11. Production UI rebuild

- **ID:** `ui-production-build`
- **Mode:** scheduled; **enabled by default:** yes
- **Cron:** none
- **Dependencies:** `analytics-snapshot`, `schwab-snapshot`, `expectations-report`
- **Purpose:** Compile newly generated static snapshots and the server into dist for normal production-mode operation.
- **Input:** Current source and freshly generated report artifacts.
- **Output:** dist/public and dist/boot.js.
- **Destination:** Local production server files only; no cloud deployment.
- **Requirements:** review
- **Operational note:** Not required for npm run dev. The running production server serves the rebuilt static assets; restart is required only when server behavior changes.

```powershell
npm run build
```

### 12. Local morning brief

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

### 13. 13F holdings and full-book refresh

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

### 14. EDGAR local tone scoring

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

### 15. Quarterly cohort pack builder

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
npx tsx worker/edgar-cohorts.mts --universe research-universe-51.json
```

### 16. Cohort LLM extraction

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
npx tsx worker/edgar-cohort-extract.mts --universe research-universe-51.json
```

### 17. Independent extraction benchmark

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

### 18. Legacy Cboe option snapshot

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
npx tsx worker/options-fetch.mts --source cboe --universe research-universe-51.json
```

### 19. Offline DTE option features

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

### 20. Offline option provider QA

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

### 21. Schwab token refresh smoke

- **ID:** `schwab-refresh-manual`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Rotate the access token without a browser and verify AAPL quotes.
- **Input:** Local refresh token and current-session Schwab client credentials.
- **Output:** Updated local token file and an HTTP smoke result; no token values in the UI.
- **Destination:** Local credential store only.
- **Requirements:** network
- **Operational note:** The daily collector also refreshes an expired token automatically when credentials are available.

```powershell
npx tsx worker/schwab-refresh.mts
```

### 22. Read-only research reconciliation

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

### 23. Availability-anchored tone event study

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

### 24. Tone IC and turnover evaluation

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

### 25. DoltHub historical option export

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

### 26. DoltHub export validation

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

### 27. Historical option feature materialization

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

### 28. Preregistered option hypothesis research

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

### 29. Expected-move calibration

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

### 30. Volatility-target historical replay

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

### 31. Stooq price archive import

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

### 32. Signals production dry-run

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

### 33. Facts production dry-run

- **ID:** `facts-dry-review`
- **Mode:** manual; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Preview complete per-CIK facts snapshots before any production transfer.
- **Input:** Local facts and the 51-name universe.
- **Output:** Per-company row counts and missing coverage; no production write.
- **Destination:** Review console only.
- **Requirements:** mysql, review
- **Operational note:** A dry-run is never marked as a successful production synchronization.

```powershell
npx tsx scripts/push-local-facts.mts --universe research-universe-51.json --dry
```

### 34. Reviewed signals production push

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

### 35. Reviewed facts production push

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
npx tsx scripts/push-local-facts.mts --universe research-universe-51.json
```

### 36. EDGAR tone readiness audit

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

### 37. Independent-universe and macro-regime validation

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

### 38. Sector-neutral portfolio evaluation

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

### 39. Sector volatility-target holdout evaluation

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

### 40. Frozen research protocol validation

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

### 41. 13F top-300 universe rebuild

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

### 42. Research coverage expansion

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

### 43. signals.note migration gate

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

### 44. Schwab OAuth browser authorization

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

### 45. Optional ORATS option lane

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

### 46. Legacy cloud ad-hoc job queue

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

### 47. MySQL backup and restore gate

- **ID:** `mysql-backup-restore`
- **Mode:** blocked; **enabled by default:** no
- **Cron:** none
- **Dependencies:** none
- **Purpose:** Protect the local DB before the signals.note migration or any storage move.
- **Input:** A tested mysqldump backup on D: and a successful restore drill.
- **Output:** Verified recovery evidence before schema changes.
- **Destination:** Not implemented as a runnable job yet.
- **Requirements:** mysql, driveD, review
- **Operational note:** No forced DDL, no table drops and no storage migration before this gate passes.

```powershell
Not automated until backup and restore verification is complete
```

### 48. Selective AAPL/SPY streaming

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

### 49. GDELT collector and backfill

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

1. Open `/workers`: scheduler heartbeat is online, no unexpected current/queued job, and next run is plausible.
2. Open Activity for failed jobs; inspect the log rather than blindly rerunning the whole universe.
3. Check `/market-data` coverage, manifest errors and duplicate OSI counts after the Schwab chain.
4. Check Analytics and Expectations freshness after report builders and the production UI rebuild.
5. Run dry-review jobs before any production transfer. Apply commands remain in the terminal and are never cron jobs.
6. Do not start both dev and production web servers. Do not start a second scheduler or re-enable legacy overlapping tasks.
