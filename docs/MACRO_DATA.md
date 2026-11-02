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

Outputs are `public/reports/company-exposures.json` and `.md`. The report computes only directly supported values: debt/operating income, operating income/interest expense, cash/debt, fuel cost/operating income, oil revenue/cost and foreign revenue share when domicile and total revenue are directly comparable. It does not infer sector directions, floating-rate debt share, maturity schedules or hedge ratios. Each metric carries source concepts, period, availability and stale-evidence flags.
