# Macro and political-event data collectors

Local-only collectors for availability-anchored macro research. They write raw evidence, normalized vintage rows and manifests. They do not write MySQL, do not call production and do not publish data.

**Research window: 2000-01-01 onward.** Observation periods and real-time vintages before 2000 are outside the Alpha Engine scope and are not downloaded. `--from` rejects earlier dates.

## 1. Prepare

```powershell
cd C:\dev\alpha-engine
git pull
npm install --no-audit --no-fund
```

FRED requires a 32-character lowercase API key. Register it in the FRED account, then set it only in the current PowerShell session:

```powershell
$env:FRED_API_KEY = "YOUR_KEY_HERE"
```

Do not send the key to chat, commit it or print it in logs. The collectors redact it from request errors.

The default Windows output root is:

```text
D:\research\alpha-engine\macro
```

The collector enforces D:-only output on Windows, resolves the real path and requires at least 2 GiB free. Run one macro collector at a time so two processes cannot race the same manifest.

## 2. Download in order

### Rates

```powershell
npx tsx worker/macro-fred-fetch.mts --group rates
```

Includes 2Y/10Y/30Y Treasury, 10Y−2Y curve, SOFR, effective fed funds and 30Y mortgage rate. `DFF` is the daily effective rate channel; `FEDFUNDS` is the distinct monthly `effective_federal_funds_monthly` channel. They are not interchangeable.

### Oil

```powershell
npx tsx worker/macro-fred-fetch.mts --group oil
```

Includes WTI and Brent spot series sourced by FRED from EIA. No separate EIA key is required for these two FRED series.

### US dollar

```powershell
npx tsx worker/macro-fred-fetch.mts --group usd
```

Uses the Fed nominal broad U.S. dollar index (`DTWEXBGS`), not an unlicensed DXY substitute.

### Credit spreads

```powershell
npx tsx worker/macro-fred-fetch.mts --group credit
```

Includes ICE BofA investment-grade and high-yield OAS. FRED currently notes that, starting in April 2026, these series include only three years of observations. The warning is preserved in the series registry and manifest. Longer history requires an authorized source; it is not silently backfilled.

### Volatility

```powershell
npx tsx worker/macro-fred-fetch.mts --group volatility
```

Includes the CBOE VIX close (`VIXCLS`) as a separate `volatility` / `vix_close` channel. It is not silently included in rates. The registry now expects **22 series** for a complete manifest, QA and Daily Operations coverage. The four Event Study series (`DGS10`, `DCOILWTICO`, `DTWEXBGS`, `BAMLH0A0HYM2`) and Shock Calibration inputs are unchanged.

### Inflation

```powershell
npx tsx worker/macro-fred-fetch.mts --group inflation
```

Includes headline/core CPI and headline/core PCE.

### Labor

```powershell
npx tsx worker/macro-fred-fetch.mts --group labor
```

Includes nonfarm payrolls and unemployment rate.

### Growth

```powershell
npx tsx worker/macro-fred-fetch.mts --group growth
```

Includes real and nominal GDP.

### Everything except political events

```powershell
npx tsx worker/macro-fred-fetch.mts --group all
```

## 3. Political events

OFAC retired its old RSS feed. The collector uses the current official Recent Actions HTML instead:

```powershell
npx tsx worker/macro-events-fetch.mts --pages 1
```

To request more history explicitly:

```powershell
npx tsx worker/macro-events-fetch.mts --pages 5
```

This is incremental forward accumulation, not a claim of complete OFAC archive coverage. Each event keeps its official URL, title, publication day and raw-page hash. `effectiveAt` remains null until separately verified. No intraday timestamp is invented.

## 4. Refresh, force and single-series smoke tests

A completed series resumes from raw cache on the same UTC day. A later day fetches fresh data.

```powershell
# Force one fresh series download
npx tsx worker/macro-fred-fetch.mts --series DGS10 --force

# Limit the observation window without changing vintage semantics
npx tsx worker/macro-fred-fetch.mts --group inflation --from 2000-01-01

# Smoke-test the full command surface
npx tsx worker/macro-fred-fetch.mts --series DGS10 --from 2020-01-01 --force
```

The collector first requests each series' earliest ALFRED vintage and builds one-calendar-year real-time chunks from the later of that vintage and 2000-01-01. The final current-year chunk uses the officially supported open boundary `realtime_end=9999-12-31`, so a local/server clock mismatch cannot reject the download. It never sends an unsupported pre-inception period or pre-2000 research period. `output_type=1` returns observations by real-time period, including the actual `realtime_start` and `realtime_end` for each value's availability lifetime. Identical vintages spanning adjacent chunks are deduplicated; conflicting values fail closed. Request spacing is capped at 100 requests/minute, below FRED's documented 120/minute limit. Raw chunks and merged responses are both preserved, and missing values (`.`) remain null. If a series has no ALFRED vintages, the manifest explicitly records `availabilityMode: "current_fred_only"` instead of pretending historical availability exists.

## 5. Output layout

```text
D:\research\alpha-engine\macro\
  manifest-fred.json
  manifest-events.json
  raw\
    fred\<SERIES>\metadata.json
    fred\<SERIES>\observations.json
    fred\<SERIES>\vintagedates.json
    fred\<SERIES>\chunks\observations-YYYY-01-01_YYYY-12-31.json
    fred\<SERIES>\chunks\vintagedates-YYYY-01-01_YYYY-12-31.json
    ofac\recent-actions-page-0.html
  normalized\
    fred\<SERIES>.json
    ofac-events.json
```

Every FRED normalized row contains:

- `observationPeriod`, `value`, `unit`, `frequency`;
- `vintageId`, `supersededAt`;
- `releasedAt: null` because FRED's vintage date is not proof of the original agency's exact release timestamp;
- `availableAt`, `availablePrecision: "day"`, `availabilityBasis: "fred_realtime_start"`;
- conservative `researchEligibleAt` at the end of the FRED availability day;
- `ingestedAt`, public `sourceUrl` and raw `sourceHash`.

Do not use these day-precision rows to claim intraday release-event alpha. Exact BLS/BEA/FOMC release timestamps require separate release-calendar evidence.

## 6. Validation and limitations

- `manifest-fred.json` records rows, observation/vintage bounds, raw hashes and per-series errors.
- `manifest-events.json` records page hashes and accumulated event counts.
- A real-time chunk with no vintage dates is recorded as an empty chunk and does not invalidate other years. Empty ranges are listed in the series manifest entry.
- A series error does not get converted into a successful empty series.
- No source is retried silently forever and no raw response is overwritten with a model-generated substitute.
- ISM Manufacturing/Services PMI is deliberately not included yet. It needs a dedicated official ISM adapter and release-time evidence; no proxy series is passed off as PMI.
- Exact BLS/BEA/FOMC release timestamps are a separate next milestone, not an assumption made from FRED dates.

## 7. Manifest QA

```powershell
npx tsx worker/macro-manifest-qa.mts --root D:\research\alpha-engine\macro
```

Use `--allow-partial` when only some groups were intentionally downloaded. `--fred-only` and `--events-only` isolate one collector's checks. QA validates manifest presence, per-series errors, raw SHA256 hashes, row counts, duplicate vintages/events, availability inversions and the 2000+ research window. Output is `worker/.runs/macro-manifest-qa.json`.

## 8. Company exposure evidence

```powershell
npx tsx scripts/build-company-exposure.mts --universe research-universe-50.json
```

For one company or a historical as-of check:

```powershell
npx tsx scripts/build-company-exposure.mts --only DAL --as-of 2026-01-31T00:00:00Z
```

Outputs are `public/reports/company-exposures.json` and `.md`. The report computes only directly supported values: debt/operating income, operating income/interest expense, cash/debt, fuel cost/operating income, oil revenue/cost and foreign revenue share when domicile and total revenue are directly comparable **for the same periodEnd**. It does not infer sector directions, floating-rate debt share, maturity schedules or hedge ratios. Each metric carries source concepts, period, availability and stale-evidence flags.

After F-05, every derived metric receives `MAX(sourceFiled)` across all required inputs: four TTM points, current+noncurrent debt, both ratio sides and domestic+total revenue. A null required date fails closed; it cannot displace a known eligible vintage or become `quality=available`. PIT selection requires `sourceFiled <= asOf` and `periodEnd <= asOf`, so later revisions do not affect earlier anchors. Ratios require identical `periodEnd` and units, finite values and a positive denominator; incompatible evidence is missing with a diagnostic rather than a numeric ratio.

Non-consecutive TTM remains partial for display with its explicit note. Scenario debt requires `quality=available` plus valid as-of availability, and Atlas additionally requires known availability at or before event eligibility. Partial/missing evidence produces no research row. Existing Company Exposure, Scenario and Atlas reports require a separate reviewed rebuild; lower available coverage after this correction is a valid fail-closed outcome.

## 9. Pilot source-linked evidence pack

```powershell
npx tsx scripts/exposure-evidence-probe.mts
npx tsx scripts/build-pilot-exposure-evidence.mts
```

The probe inspects fresh SEC companyfacts for DAL, RCL, CVX, COP and PFE. The builder preserves exact fixed-rate shares, weighted/effective rates, interest-rate hedge shares, maturity concepts, fuel/oil metrics and foreign derivative notionals with accession links and raw-payload hashes. No LLM is used. Staleness is based on the economic period, not on the accession year. If comparable domicile and total revenue do not share `periodEnd`, foreign revenue share remains missing.

## 10. Macro Scenario Engine

Build the cache-only exposure history, the atlas and then the scenarios, in that order:

```powershell
npx tsx scripts/build-exposure-history.mts
npx tsx scripts/build-macro-transmission-atlas.mts
npx tsx scripts/build-macro-scenarios.mts --macro-root D:\research\alpha-engine\macro
```

The history builder reads only the cached SEC primary 10-K/10-Q documents on D:. It preserves each filing's accession, source hash and exact inline-XBRL facts, including dimensional revenue, maturity tables and `ixt:fixed-zero` values. Every measure uses `availableAt = filingDate`; no value is revised backwards into an earlier filing. D: realpath checks are mandatory, per-company checkpoints are resumable and a partial run never replaces the last complete history. `research/engine/exposure-history.jsonl` is used up to 20 MiB; larger histories stay on D: with a committed summary. The repository JSONL is marked `-text` in `.gitattributes` so checkout cannot change its hash.

Optional shocks and historical as-of:

```powershell
npx tsx scripts/build-macro-scenarios.mts --rate-shock 0.01 --oil-shock 0.20 --usd-shock 0.05 --credit-shock 0.01 --as-of 2026-01-31T00:00:00Z
```

The engine reads normalized FRED baselines, pilot SEC evidence, company exposure rows, the latest exposure evidence and atlas records. Every baseline uses `availableAt` and `researchEligibleAt`; SEC evidence must also have `availableAt/sourceFiled <= asOf`. Future evidence is excluded rather than backdated. `exposure-latest.json` and `macro-transmission-atlas.json` are local-only report files (`automatic: false`), not a production transport.

- **Rates:** when latest-10-K evidence exists, `(next12 + yearTwo + directlyTaggedFloatingDebt − cashAndShortTermInvestments) × rateShock`, in USD/year and, when positive operating income is reported, as a ratio of it. Floating/maturity overlap is disclosed, not silently netted. Cash earns the same shock. When the standard next-12-month total is absent, an explicit current-debt aggregate may be used and is labeled as a proxy. Missing required inputs fall back to the older explicit debt-based upper bound, whose immediate-full-repricing assumption remains visible. Financial-sector companies are `not_applicable` with `rate_exposure_works_through_interest_margin`.
- **Oil:** dimensional oil/gas revenue, directly tagged fuel cost and purchased oil/gas are multiplied by the oil shock. Explicit product, energy and oil/gas segment members are required; intersegment eliminations and unrelated minerals, pipelines and services do not become oil exposure. These are **gross exposure** values before hedges, basis, pass-through and tax, not profit forecasts. Stale legacy metrics are omitted when replaced by current inline evidence.
- **USD:** `−foreignRevenueShare × usdShockPct` is only a translation elasticity. Geographic facts must match the period and a consolidated total, with reconciliation across concept aliases only when the table supports it. It is not earnings impact and does not infer derivative direction. No valid share means `not_computable`.
- **Credit:** the next-12-month maturity is multiplied by the spread shock as an explicit full-refinancing upper bound. Secured/unsecured type totals may be summed only after excluding instrument rows and other dimensions. Current-debt aggregates are labeled when they replace a missing standard maturity total. A new-issuance estimate remains unevaluated without its terms. A reported fixed-zero maturity is zero, not missing evidence.

The output is `public/reports/macro-scenarios.json` and `.md`. Use `--out /tmp/macro-scenarios.json` for an isolated smoke run. Scenario shocks are user-defined assumptions, not FRED forecasts.

## 11. Scenario Lab UI and review invariants

Open owner-only **`/scenario-lab`**. It loads the scenario, pilot/company exposure, latest-exposure and atlas reports at runtime, recomputes every shock in the browser and exports the current JSON. Calibration is optional. No scenario state is inferred from missing reports.

- `complete` means every company computes; `partial` means only a subset computes. `not_applicable` is not counted as a fabricated current computation.
- `upper_bound` is used when hedge share is unknown; `gross_exposure` is not net income.
- FRED baseline carries full source URL, hash, vintage and research availability.
- Fuel and oil evidence preserves `periodStart`, so YTD periods cannot be mistaken for standalone quarters.
- TTM built from non-consecutive quarters is `partial`, never silently `available`.
- Targeted company rebuilds preserve the original `universeSha256`.

The evidence inspector shows exact formula, concepts, period, availability, filing accession, source hash and inline fact excerpts. Measured market response is the atlas median of abnormal return divided by the observed macro shock, with an empirical event/horizon p05/p95 interval. That interval is **not** a confidence interval or forecast, and atlas coverage is explicitly unavailable when the company/channel is absent. Empty states include the build commands rather than fabricated data. A fixture, when used for tests, is explicitly marked `dataMode: "fixture"` and is never presented as a live FRED baseline.

## 12. Shock calibration

```powershell
npx tsx scripts/build-shock-calibration.mts --macro-root D:\research\alpha-engine\macro
```

Calibration reads normalized FRED history and computes absolute daily changes for rates/credit and log returns for oil/USD. It selects the latest vintage available at each observation period, never uses availability after the report `asOf` and requires at least 30 changes per horizon. FRED `Percent` values are divided by 100 so rate and credit presets use the decimal shocks required by Scenario Engine; unsupported rate units fail closed. Scenario Engine converts decimal shocks back to source units for the displayed scenario baseline.

Outputs `public/reports/shock-calibration.json` and `.md` with p50/p75/p90/p95/p99 for 1, 5, 21 and 63 observations. Confidence intervals use 200 moving-block bootstrap replicates with a maximum block length of 20.

Scenario Lab uses calibrated presets when present:

- `Mild p50`;
- `Severe p90`;
- `Extreme p99`.

Without calibration it falls back to illustrative presets. Percentiles are not directional forecasts. The evidence inspector includes p50/p90 confidence intervals when available.

## 13. Macro Ops scheduling and health evidence

The operations registry automates the existing local macro pipeline without adding production collection:

| Job | Trigger | Purpose |
|---|---|---|
| `macro-fred-weekly` | Sunday 05:30 | Refresh all FRED/ALFRED vintages and raw yearly chunks |
| `macro-events-daily` | Daily 05:40 | Merge the latest OFAC Recent Actions page |
| `macro-manifest-qa` | Daily 05:55 | Audit hashes, rows, required coverage and availability |
| `company-exposure-evidence` | After `research-factors` | Rebuild aligned company exposure evidence |
| `pilot-exposure-evidence` | Daily 06:05 | Refresh five pilots from SEC companyfacts |
| `exposure-history` (manual cache-only prerequisite) | After new cached SEC filings | Rebuild immutable filing-anchored exposure history; no collection or scheduler entry |
| `macro-scenarios` | After QA + both evidence reports + complete history and atlas | Recompute Scenario Lab baselines and impacts |
| `shock-calibration` | After QA | Recompute historical shock distributions and CIs |
| `macro-event-study` | After QA | Recompute the first-release OFAC event study |
| `macro-transmission-atlas` | After event study + research factors + complete history | Estimate company-level shock × exposure transmission with frozen OOS |

`macro-manifest-qa` deliberately has no parent dependency. A weekly FRED refresh must not block daily OFAC QA through the scheduler's 48-hour dependency freshness window. Derived builders still require successful current QA and evidence parents. The history command only reads cached SEC documents; it does not register another collector or scheduler job. Existing scheduled jobs consume the last complete history rather than silently treating a missing or partial history as empty.

Daily Operations reads artifact evidence in addition to scheduler status:

- FRED must cover every registered series and be no more than eight days old;
- OFAC must be no more than 36 hours old and contain parsed events;
- QA must not fail or predate current inputs;
- scenarios, calibration and event study must not predate QA;
- `partial` or `insufficient_events` remains visible as a research coverage warning, not a false healthy completion.

Manual chain:

```powershell
npx tsx worker/macro-fred-fetch.mts --group all
npx tsx worker/macro-events-fetch.mts --pages 1
npx tsx worker/macro-manifest-qa.mts
npx tsx scripts/build-company-exposure.mts --universe research-universe-50.json
npx tsx scripts/build-pilot-exposure-evidence.mts
npx tsx scripts/build-exposure-history.mts
npx tsx scripts/build-shock-calibration.mts --macro-root D:\research\alpha-engine\macro
npx tsx scripts/build-macro-event-study.mts --macro-root D:\research\alpha-engine\macro
npx tsx scripts/build-macro-transmission-atlas.mts
npx tsx scripts/build-macro-scenarios.mts --macro-root D:\research\alpha-engine\macro
npx tsx scripts/build-daily-operations-report.mts --macro-root D:\research\alpha-engine\macro
```

## 14. First-release OFAC macro event study

```powershell
npx tsx scripts/build-macro-event-study.mts --macro-root D:\research\alpha-engine\macro
```

The event study measures signed changes in `DGS10`, `DCOILWTICO`, `DTWEXBGS` and `BAMLH0A0HYM2` over 1, 5, 21 and 63 observations after eligible OFAC publications. Rates and credit use decimal absolute differences; oil and USD use log returns.

Availability policy is stricter than calibration:

1. Only one **first-release** observation is retained per economic period. Later revisions are never substituted.
2. Events must satisfy `publishedAt`, `researchEligibleAt` and `ingestedAt <= asOf`.
3. The baseline must have been available by the event's `researchEligibleAt`.
4. Outcomes start on the first observation **after** the publication day, never on an ambiguous same-day window.
5. Outcomes and source rows must be available by the report `asOf`; events ingested after that cutoff are excluded.

Events are split chronologically into the earliest 70% `discovery` and latest 30% `out_of_sample`. A summary is emitted only with at least five observations in the relevant split. Mean, median and a 500-replicate moving-block bootstrap CI95 are reported for each series, horizon and split; blocks contain at most three events.

Outputs are `public/reports/macro-event-study.json` and `.md`, including per-event baseline and outcome vintage IDs. `ready`, `partial` and `insufficient_events` describe coverage only. These measurements are not directional forecasts, trading signals or a promoted probability model.

## 15. Macro Transmission Atlas

```powershell
npx tsx scripts/build-macro-transmission-atlas.mts
```

Atlas joins the first-release macro event observations to canonical SEC exposure and market-model abnormal returns. Use `--universe research-universe-50.json` for the evaluated S&P panel or `--only TICKER` for a bounded diagnostic run. The CLI reads `public/reports/macro-event-study.json`, local `series_points`, daily prices and the complete exposure history; it does not fetch production data. The history must have `status: complete`, `published: true` and the SHA256 recorded in `research/engine/exposure-history.summary.json`.

### Exposure panel

Exposure is rebuilt at every event's `researchEligibleAt`, using only `quality=available`, non-stale evidence. Inline-XBRL measures are selected from filings available at that timestamp, never from a later filing. Fuel and oil flows are divided by operating income from the **same filing and same period**; an incompatible or missing denominator does not create a ratio.

- `debt_burden`: debt / operating income. This is a balance-sheet rate-sensitivity proxy, **not** a floating-rate share or a maturity-specific repricing schedule;
- `fuel_cost`: fuel cost / operating income;
- `oil_revenue`: oil and gas revenue / operating income;
- `oil_cost`: purchased oil and gas cost / operating income;
- `foreign_revenue`: directly comparable foreign revenue share, including dimensional geographic evidence.

Partial, stale, negative or missing ratios are excluded and counted. No sector means, zero imputation or current-exposure backfill is allowed. Oil ratios use additive optional fields, so older exposure reports without them simply produce missing evidence.

### Price and company models

Company price response uses the existing post-close market-model OLS with 120 estimation returns, a minimum of 60, and SPY as the benchmark. The company model is fitted independently for every series, exposure kind and horizon:

```text
abnormalReturn = intercept + β1 shock + β2 exposure + β3 shock × exposure + sector fixed effects + ε
```

`β3` is the conditional transmission coefficient. It is not automatically a causal effect.

Discovery contains the earliest 70% of events. The model and sector levels are fitted only on discovery. The later 30% is evaluated with those frozen coefficients; OOS is never refit. OOS reports MAE, RMSE and R² against the discovery mean, which may be negative.

A fit requires at least 30 rows, 10 events, 5 companies and a full-rank design. `pilot` means 5–19 companies or 10–29 events; `full_sample` requires at least 20 companies and 30 events. `insufficient_coverage` is returned instead of a fabricated coefficient. Interaction CI95 uses 500 event-cluster bootstrap replicates with a maximum block length of three.

Outputs are `public/reports/macro-transmission-atlas.json` and `.md`. Daily Operations checks Atlas lineage and research coverage but does not treat `estimated` as alpha validation or authorize production promotion.

## 16. Incremental S&P 500 companyfacts collection

The independent `sp500-facts-daily` job collects SEC companyfacts for the current documented S&P snapshot, not for a historical point-in-time index membership. The collection snapshot is `edgar-universe.json` plus `GICS_SNAPSHOT_AS_OF=2026-10-11`, sourced from the documented Wikipedia `List of S&P 500 companies` constituents table. It has 502 rows and 499 unique CIKs; FOX/FOXA, GOOG/GOOGL and NWS/NWSA are deduplicated by CIK, never downloaded twice for share classes. The sorted-unique-CIK universe SHA256 is `9db32591ad570e51e4e9902417a5152414c2d27a5d73e2b9f7365b4d75809c9b`. No live scrape is performed during collection; snapshot changes require a separate documented source/asOf diff.

- The scheduler command is `npx tsx worker/facts-fetch.mts --universe edgar-universe.json`, cron `30 23 * * *` home local time. The job has no research-series/research-factors dependencies and its failures do not block the independent research-50 chain.
- Recent submissions are checked for 10-K, 10-Q, 20-F, 40-F, 10-KT and 10-QT forms plus their amendments. Form 4, 13D/G and other irrelevant forms never trigger a companyfacts refresh.
- Refresh occurs for a new relevant accession, missing/corrupt raw, missing/failed previous ingest, previous failure or due full reconciliation. Unchanged valid raw with successful previous ingest and the same filing signature is skipped.
- The full reconciliation baseline is seven days with a deterministic 0–6-day CIK stagger, so the whole index is not downloaded every week in one run.
- A new payload is validated and ingested before the previous raw is replaced. Failed download/ingest therefore preserves previous good raw, raw SHA256 and successful capture/ingest timestamps. One company's failure does not cancel other completed snapshots.
- Each CIK has an atomic credential-free manifest at `worker/cache/companyfacts/manifest/<cik>.json` with checked/success timestamps, latest relevant accession/filingDate/form/signature, last full reconciliation, raw SHA256, status, bounded error and universe hash. Completed CIKs resume from that manifest after interruption; missing/failed CIKs retry on the next daily run.
- `--cached` remains the offline recovery path for an existing valid raw payload and never bypasses local ingest validation. `INGEST_URL` must be loopback-only; production ingest is rejected before collection.

Daily Operations reads these manifests for unique-CIK coverage, refreshed/unchanged/failed/missing counts and latest check time. Research universe 51, factor/IC evaluation, Atlas and factor/model/regime universes are not expanded by this collection job.

## 17. Normalized FRED/ALFRED → legacy macro_points

`scripts/backfill-macro-vintages.mts` restores the eight curated probability/dashboard series from `normalized/fred/<SERIES>.json` into local `macro_points`. It does not collect data, alter schemas or run a production action. The default mode is a dry-run. A local apply requires `--apply` and `--backup-manifest <path>` for a complete pre-write table backup; its SHA256 and current database fingerprint must match before any write.

```powershell
npx tsx scripts/backfill-macro-vintages.mts --out worker/.runs/macro-vintage-dry-run
npx tsx scripts/backfill-macro-vintages.mts --apply --backup-manifest worker/.runs/<reviewed-backup>/backup-manifest.json --out worker/.runs/<reviewed-apply>
```

The exact availability mapping is `observationPeriod → date`, `value → value`, `availableAt → realtimeStart`, `supersededAt → realtimeEnd`, and the actual new ingest timestamp → `fetchedAt`. Null values remain null. Null `supersededAt` is open-ended. Missing `availableAt` is skipped with a diagnostic; `fetchedAt`, `researchEligibleAt` and `ingestedAt` never substitute for official availability.

Deduplication is limited to identical `(seriesId, observationPeriod, realtimeStart)` rows. An identical key with a different value or `realtimeEnd` is a conflict error, never a silent upsert. A conflict-bearing series is wholly preserved; an independent valid series may still be ingested, producing an explicit `partial` result and nonzero exit code. `ingestMacroPoints` inserts in batches of at most 500. There are no DELETE/DROP/TRUNCATE operations, and live idempotency is checked read-only rather than by repeating an apply.

`FEDFUNDS` (monthly effective federal funds rate) is not interchangeable with regular collector series `DFF` (daily rate). It has a deliberate `rates` / `effective_federal_funds_monthly` registry entry, but a missing normalized archive remains a blocker until a real targeted collection and clean QA complete. A failed fetch is not retried in the same reviewed block and no substitute series is used.

`--series` accepts a comma-separated curated subset, so one reviewed apply can cover multiple series without sequential applies. Empty, duplicate or unknown IDs fail before reading source files or writing data.

`scripts/remediate-macro-window-conflicts.mts` provides the separate exact-ID repair path for the five reviewed legacy one-day closures. It validates each ID's series, observationPeriod, realtimeStart, value and official `supersededAt=null`. Default is dry-run with an exact diff and plan fingerprint. Apply requires the matching saved plan and a fresh complete backup with SHA256 and current-table fingerprint. One transaction locks all five IDs and changes only `realtimeEnd` to NULL; any mismatch or failed row rolls back the whole transaction. Raw MySQL UTC timestamp strings are normalized for comparison with Date instances, not rewritten. Post-check requires exactly five changed rows and all other rows unchanged.

Every collector or apply requires a separate fail-closed scheduler/preflight guard. A failed guard means no command continuation and no state mutation; after natural scheduler idle, the entire guard must pass again. Never chain an apply after a failed check with a shell semicolon.

Earlier partial follow-up evidence is preserved in `docs/MACRO_VINTAGE_FOLLOWUP_2026-11-04.md`. The subsequent reviewed run in `docs/MACRO_VINTAGE_FEDFUNDS_COMPLETION_2026-11-04.md` collected 4,510 official monthly FEDFUNDS rows, passed QA for 22 series and applied one six-series backfill with 275,481 inserted rows and zero conflicts. All eight curated series now have current eligible vintages. The final table has 408,862 rows, with all preexisting evidence preserved and independently verified source mappings. Historical source limits remain explicit; only 84/485 evaluated anchors have complete three-series evidence, so this is not an alpha or production-promotion claim.
