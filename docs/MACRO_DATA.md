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

Includes 2Y/10Y/30Y Treasury, 10Y−2Y curve, SOFR, effective fed funds and 30Y mortgage rate.

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
npx tsx scripts/build-company-exposure.mts --universe research-universe-51.json
```

For one company or a historical as-of check:

```powershell
npx tsx scripts/build-company-exposure.mts --only DAL --as-of 2026-01-31T00:00:00Z
```

Outputs are `public/reports/company-exposures.json` and `.md`. The report computes only directly supported values: debt/operating income, operating income/interest expense, cash/debt, fuel cost/operating income, oil revenue/cost and foreign revenue share when domicile and total revenue are directly comparable **for the same periodEnd**. It does not infer sector directions, floating-rate debt share, maturity schedules or hedge ratios. Each metric carries source concepts, period, availability and stale-evidence flags.

## 9. Pilot source-linked evidence pack

```powershell
npx tsx scripts/exposure-evidence-probe.mts
npx tsx scripts/build-pilot-exposure-evidence.mts
```

The probe inspects fresh SEC companyfacts for DAL, RCL, CVX, COP and PFE. The builder preserves exact fixed-rate shares, weighted/effective rates, interest-rate hedge shares, maturity concepts, fuel/oil metrics and foreign derivative notionals with accession links and raw-payload hashes. No LLM is used. Staleness is based on the economic period, not on the accession year. If comparable domicile and total revenue do not share `periodEnd`, foreign revenue share remains missing.

## 10. Macro Scenario Engine

```powershell
npx tsx scripts/build-macro-scenarios.mts --macro-root D:\research\alpha-engine\macro
```

Optional shocks and historical as-of:

```powershell
npx tsx scripts/build-macro-scenarios.mts --rate-shock 0.01 --oil-shock 0.20 --usd-shock 0.05 --credit-shock 0.01 --as-of 2026-01-31T00:00:00Z
```

The engine reads normalized FRED baselines, pilot SEC evidence and company exposure rows. Every baseline uses `availableAt` and `researchEligibleAt`; SEC evidence must also have `availableAt/sourceFiled <= asOf`. Future evidence is excluded rather than backdated.

- **Rates:** `debt × (1 − fixedInterestShare) × (1 − interestRateHedgeShare) × rateShock`, in USD/year. If hedge share is unknown, the result is an **upper bound**, not a point estimate. The formula assumes immediate full repricing and is not a maturity-specific forecast.
- **Oil:** fuel cost, oil revenue and purchased oil/gas are multiplied by the oil shock. These are **gross exposure** values before hedges, basis, pass-through and tax, not profit forecasts. Stale evidence is `historical_only`.
- **USD:** `−foreignRevenueShare × usdShockPct` is only a translation elasticity. It is not earnings impact and does not infer derivative direction. No valid share means `not_computable`.
- **Credit:** remains `not_computable` until new-issuance spread, maturity and rating terms exist.

The output is `public/reports/macro-scenarios.json` and `.md`. Use `--out /tmp/macro-scenarios.json` for an isolated smoke run. Scenario shocks are user-defined assumptions, not FRED forecasts.

## 11. Scenario Lab UI and review invariants

Open owner-only **`/scenario-lab`**. It loads the three reviewed reports at runtime, recomputes every shock in the browser and exports the current JSON. No scenario state is inferred from missing reports.

- `complete` means every pilot computes; `partial` means only a subset computes.
- `upper_bound` is used when hedge share is unknown; `gross_exposure` is not net income.
- FRED baseline carries full source URL, hash, vintage and research availability.
- Fuel and oil evidence preserves `periodStart`, so YTD periods cannot be mistaken for standalone quarters.
- TTM built from non-consecutive quarters is `partial`, never silently `available`.
- Targeted company rebuilds preserve the original `universeSha256`.

The evidence inspector shows exact formula, concepts, period, availability and reasons for `not_computable`. Empty states include the build commands rather than fabricated data. A fixture, when used for tests, is explicitly marked `dataMode: "fixture"` and is never presented as a live FRED baseline.

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
| `macro-scenarios` | After QA + both evidence reports | Recompute Scenario Lab baselines and impacts |
| `shock-calibration` | After QA | Recompute historical shock distributions and CIs |
| `macro-event-study` | After QA | Recompute the first-release OFAC event study |

`macro-manifest-qa` deliberately has no parent dependency. A weekly FRED refresh must not block daily OFAC QA through the scheduler's 48-hour dependency freshness window. Derived builders still require successful current QA and evidence parents.

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
npx tsx scripts/build-company-exposure.mts --universe research-universe-51.json
npx tsx scripts/build-pilot-exposure-evidence.mts
npx tsx scripts/build-macro-scenarios.mts --macro-root D:\research\alpha-engine\macro
npx tsx scripts/build-shock-calibration.mts --macro-root D:\research\alpha-engine\macro
npx tsx scripts/build-macro-event-study.mts --macro-root D:\research\alpha-engine\macro
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
