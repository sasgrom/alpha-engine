# Macro and political-event data collectors

Local-only collectors for availability-anchored macro research. They write raw evidence, normalized vintage rows and manifests. They do not write MySQL, do not call production and do not publish data.

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

`output_type=3` is used for observations so new and revised values are retained as separate vintage rows. `realtime_start` and `realtime_end` are preserved. Missing values (`.`) remain null.

## 5. Output layout

```text
D:\research\alpha-engine\macro\
  manifest-fred.json
  manifest-events.json
  raw\
    fred\<SERIES>\metadata.json
    fred\<SERIES>\observations.json
    fred\<SERIES>\vintagedates.json
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
- A series error does not get converted into a successful empty series.
- No source is retried silently forever and no raw response is overwritten with a model-generated substitute.
- ISM Manufacturing/Services PMI is deliberately not included yet. It needs a dedicated official ISM adapter and release-time evidence; no proxy series is passed off as PMI.
- Exact BLS/BEA/FOMC release timestamps are a separate next milestone, not an assumption made from FRED dates.
