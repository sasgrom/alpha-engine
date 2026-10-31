# Schwab Market Data & Streaming — Technical Specification

## 1. Goal

Build a separate, reviewed market-data lane for Alpha Engine using Schwab Market Data Production. It must complement, not replace, EDGAR fundamentals, guidance extraction, DoltHub option history and the current cohort extraction run.

The lane collects current option chains, price history, quotes and selective streaming data with availability timestamps. It produces research features and an owner-only Market Data UI. Production receives only reviewed normalized outputs.

## 2. Non-goals

- No orders, order previews, account balances, positions or account activity.
- No credentials, token files, raw token responses or raw LLM output in the browser or cloud control plane.
- No direct-to-production collection.
- No invented multi-year option-chain history.
- No forced streaming of the entire universe at once.
- No change to `OLLAMA_NUM_CTX` or the current cohort extraction protocol.
- No raw-document mirroring to production.

## 3. Existing baseline

Working today:

- Schwab OAuth callback and refresh scripts.
- `quotes` and full `chains` return HTTP 200.
- AAPL chain returns thousands of contracts with `isDelayed: false` and `isChainTruncated: false`.
- `pricehistory` works with `periodType=month` and `frequencyType=daily`.
- The official Streamer contract uses `requests`, `response`, `notify` and `data` message types, numeric field IDs and delayed/timestamp metadata.

## 4. Architecture

### 4.1 Authentication

- `worker/schwab-callback.mts` handles browser authorization once.
- `worker/schwab-refresh.mts` refreshes access tokens without a browser.
- Client ID and Client Secret are read only from the current PowerShell session.
- Token JSON stays at `D:\research\alpha-engine\schwab\token.json`, never in Git or browser code.
- Any streaming connection starts with `GET User Preference` and a separate ADMIN LOGIN using the access token.

### 4.2 REST collector

New worker: `worker/schwab-fetch.mts`.

Initial requests:

1. `GET /marketdata/v1/chains?symbol=<ticker>&contractType=ALL&includeQuotes=TRUE`
2. `GET /marketdata/v1/quotes?symbols=<ticker>`
3. `GET /marketdata/v1/pricehistory?symbol=<ticker>&periodType=month&frequencyType=daily&frequency=1`
4. `GET /marketdata/v1/instruments?symbol=<ticker>&projection=fundamental`
5. `GET /trader/v1/userPreference` before streaming.

Rules:

- Bounded concurrency and a serialized provider-specific rate limiter; never hide 429 responses.
- Raw responses remain on D: with per-file SHA256 and manifests.
- Resume by ticker, endpoint, trade date and content hash; no duplicate downloads.
- No hardcoded 4K/16K document cap and no truncation of option chains or filing tables.
- A failed ticker does not abort the universe. Two consecutive transport failures checkpoint and stop the run.
- User Preference is required only for streaming setup. Its failure is recorded in `user-preference-status.json` and does not invalidate completed REST snapshots or trigger a full-universe rerun.
- Token keepalive runs every two days from the central Operations scheduler. Scheduled-task credentials must be present in the process environment; browser authorization is only a recovery path after revocation or an extended outage.
- A full-chain `TooBigBody` response has one bounded fallback of at most 60 monthly windows. Raw chunks and merged hashes are preserved; any failed window keeps the ticker partial.
- The snapshot builder updates both source `public/reports` and an existing `dist/public/reports`, so Schwab-only data refreshes do not require an application rebuild.

### 4.3 Streaming client

New worker: `worker/schwab-stream.mts`.

Protocol:

1. Load connection parameters via `GET User Preference`.
2. Open WebSocket.
3. Send ADMIN LOGIN with the access token.
4. Subscribe selectively, initially to AAPL and SPY only:
   - `LEVELONE_OPTIONS` for option quotes;
   - `LEVELONE_EQUITIES` for underlying quotes;
   - `CHART_EQUITY` for one-minute OHLCV bars.
5. Process `response`, `notify` and `data` independently.
6. Map numeric field IDs to canonical names; do not infer unknown fields.
7. Record delayed state, quote/trade timestamps, sequence number and `SchwabClientCorrelId`.
8. Close with ADMIN LOGOUT when stopped. Reconnect at most twice, then expose an explicit failed state. No hidden infinite retry loop.

Streaming is a separate process from the nightly cohort LLM run. It is never a prerequisite for the current run.

## 5. Raw and normalized data

### 5.1 Raw storage

```text
D:\research\alpha-engine\schwab\chains\YYYY-MM-DD\<ticker>.json
D:\research\alpha-engine\schwab\quotes\YYYY-MM-DD\<ticker>.json
D:\research\alpha-engine\schwab\pricehistory\<ticker>.json
D:\research\alpha-engine\schwab\stream\YYYY-MM-DD\<session-id>.jsonl
D:\research\alpha-engine\schwab\manifest.json
D:\research\alpha-engine\schwab\token.json
```

The manifest contains ticker, endpoint, capturedAt, latest source timestamp, file hash, row count, error class and resume status.

### 5.2 Common provenance fields

- `provider = "schwab"`;
- `capturedAtUtc`;
- `quoteTimeMillis`, `tradeTimeMillis` when supplied;
- `delayed` / `isDelayed`;
- `symbol`, `underlying`, native option symbol and normalized OSI ID;
- `sourceUrl` (without credentials);
- `sourceHash`;
- `schemaVersion`.

No row is treated as current merely because it was downloaded recently.

### 5.3 Option contract fields

Preserve native Schwab fields and a separate OSI crosswalk:

- strike, expiration, DTE, call/put, multiplier, exercise type, settlement type;
- bid, ask, last, mark, spread, volume, open interest;
- implied volatility, delta, gamma, theta, vega, rho;
- underlying price, interest rate, volatility metadata, dividend yield;
- native symbol and OSI contract ID.

## 6. Feature materialization

Use existing option-feature builders where compatible:

- DTE buckets: `0DTE`, `1-7D`, `8-30D`, `31-90D`, `91-365D`, `365+D`;
- ATM IV and actual-DTE expected move;
- term slope, 25-delta skew, put/call volume and OI ratios;
- turnover, ATM spread, volume/OI ratios;
- forward RV20 and availability-anchored event labels.

New Schwab snapshots are an additional provider, not silently merged with DoltHub or Cboe records. Provider comparisons require identical underlying, trade date and contract ID.

## 7. UI specification

New owner-only route: `/market-data`.

### 7.1 Overview

Tiles:

- provider and last successful capture;
- token expiry only (never the token itself);
- latest chain date and contract count;
- coverage by ticker and expiration;
- stream status, message rate, lag and last error;
- QA status: stale, missing, duplicates, invalid rows and manifest errors.

No decorative metrics. Every tile links to a working detail view.

### 7.2 Options view

Filters:

- ticker;
- expiration and DTE bucket;
- call / put / all;
- ATM-only toggle;
- search by native or OSI contract symbol.

Columns:

- contract, expiry, DTE, strike, bid, ask, spread, last, volume, OI, IV, delta, gamma, theta, vega.

The table uses horizontal scrolling only inside the table on mobile, never full-page overflow.

### 7.3 Streaming view

- connection state: disconnected / connecting / live / degraded / failed;
- symbols and subscriptions;
- last quote/trade timestamp and lag;
- messages per second, last heartbeat, reconnect count;
- delayed flag and source timestamp;
- start/stop stream controls for the owner, not orders.

No fake live state: when no messages arrive, the UI shows `stale` rather than `live`.

### 7.4 Provenance / QA view

- raw file hash and manifest row;
- provider response status and error class;
- duplicate contract keys;
- zero-bid, zero-ask, crossed/locked quotes and invalid IV/Greeks;
- token refresh history without secrets;
- download of the reviewed manifest, not the token file.

## 8. Availability and production policy

- Raw files and token responses remain local.
- Only reviewed normalized rows can be published.
- Existing ≤500-row insert batches are preserved.
- No direct-to-production collector, no forced DDL and no table drops.
- Every record carries availability timestamps and delayed status. Forward labels start strictly after the availability cutoff.

## 9. Milestones

### M1 — Smoke

- Refresh token works without a browser.
- `quotes`, `chains`, `pricehistory`, `instruments` and User Preference return 200.
- One ADMIN LOGIN and one AAPL subscription succeed.
- No credentials in logs or browser.

### M2 — Normalization and QA

- Full AAPL chain normalized with native symbol + OSI mapping.
- Manifest and hash validation pass.
- No duplicate contract keys or silent truncation.
- UI shows actual coverage and errors, not a fake success banner.

### M3 — Read-only UI

- Overview, Options and Provenance views work with real data.
- Loading, empty, stale and error states implemented.
- Desktop and mobile checks: no console errors, no 404s, no page overflow.

### M4 — Universe collection

- Extend to all 51 tickers with resume and provider-specific throttling.
- Daily snapshot and price-history materialization.
- No direct production sync until review.

### M5 — Selective streaming

- AAPL and SPY streams only.
- Delay/lag/heartbeat metrics and stale detection.
- Event-window availability analysis; no claim of instant tradability based solely on EOD data.

## 10. Acceptance criteria

- Token refresh succeeds after restart without browser.
- No secret appears in Git, UI, logs, error messages or production.
- Chain row counts match source; no arbitrary cap or silent truncation.
- `isDelayed`, source timestamps and content hashes are present.
- Duplicate contract keys are zero or explicitly logged and explained.
- Crash/resume produces no duplicate source files or normalized rows.
- No hidden retries; failure states are visible in UI.
- Every visible control works; empty states are explicit.
- Full test suite and production build pass.

## 11. Immediate next step

Implement only M1 and M2: `worker/schwab-fetch.mts`, normalization, manifest QA and the read-only Overview/Options/Provenance views. Do not start full-universe streaming or production sync until those pass review.
