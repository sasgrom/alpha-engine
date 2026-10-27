# Home Workers (Variant C, 4k/D45)

Collectors that must run from a residential IP (datacenter-blocked upstreams:
GDELT, Stocktwits; Reddit/YouTube-CC planned). They run on the home machine,
never touch the database, and POST normalized signal rows to the cloud:

```
POST https://alphadelta-2.kimi.pro/api/worker/ingest
Authorization: Bearer <WORKER_KEY>   # in .env, never committed
```

The server validates every row (zod), stamps `ingestedAt` itself (D43
no-lookahead), and INSERT-IGNOREs redeliveries — reruns are safe.

## Files

| File | Purpose |
|------|---------|
| `universe.json` | Committed snapshot of active companies (cik, ticker, gdeltQuery). Regenerate in the cloud: `npx tsx scripts/export-worker-universe.mts`, commit, push. |
| `lib/http.ts` | fetch JSON with timeout + backoff; 4xx is fatal, 5xx/timeout retried. |
| `lib/ingest.ts` | Batch poster (chunks ≤ 500 rows). |
| `lib/gdelt.ts` | GDELT normalizers (pure, tested). |
| `lib/stocktwits.ts` | Stocktwits normalizers (pure, tested). |
| `gdelt.mts` | GDELT collector: hourly bucket tone + buzz per company. |
| `stocktwits.mts` | Stocktwits collector: buzz + sentiment label per ticker. |

## Run (from repo root, Node ≥ 20)

```powershell
npx tsx worker/gdelt.mts
npx tsx worker/stocktwits.mts
```

## Schedule (Windows Task Scheduler, hourly, staggered)

```powershell
schtasks /Create /TN "AlphaEngine-GDELT" /SC HOURLY /TR "cmd /c cd /d C:\dev\alpha-engine && if not exist worker\.runs mkdir worker\.runs && npx tsx worker\gdelt.mts >> worker\.runs\gdelt-scheduled.log 2>&1"
schtasks /Create /TN "AlphaEngine-Stocktwits" /SC HOURLY /MO 1 /ST 00:30 /TR "cmd /c cd /d C:\dev\alpha-engine && if not exist worker\.runs mkdir worker\.runs && npx tsx worker\stocktwits.mts >> worker\.runs\stocktwits-scheduled.log 2>&1"
```

## Data honesty

- `eventTs` = content time (GDELT hour bucket / newest message time);
  `ingestedAt` = server receipt time. Never the other way around.
- GDELT tone ≈ [-10..10], normalized to [-1..1] by ÷10 (documented
  approximation, see `lib/gdelt.ts`).
- Stocktwits label score = (bullish − bearish) / labeled messages of the
  30-message stream window; `null` when nothing labeled.

## Historical backfill (one-off, on-demand)

```powershell
npx tsx worker/gdelt-backfill.mts --from 2024-01-01 --to 2026-10-21
```

Per company per UTC day, ONE ToneChart call yields both tone and exact
article count. Rows are `src:"backfill"` with day-bucket payloadKeys —
resumable by rerunning the same range. A year × 5 companies ≈ 3 h at the
GDELT fair-use pace (6 s/call). Defaults: from = 2 years ago, to = yesterday.

## Plan B: manual GDELT exports (when the IP is throttled)

Download per company per ≤3-month window (browser, human pace):
- buzz:  `.../doc?query=%22Microsoft%22&mode=ArtList&maxrecords=250&format=csv&startdatetime=20241001000000&enddatetime=20241231235959`
- tone:  same with `mode=TimelineTone`

Then: `npx tsx worker/import-gdelt-csv.mts --file <path> --ticker MSFT`
Auto-detects ArtList (per-day buzz) vs Timeline (per-day tone); gdeltcsv:*
payloadKeys make reimports free. Note: ArtList tops out at 250 articles per
window — for heavy tickers use monthly windows for honest volume.

## EDGAR tone: audited full-universe run

Keep `OLLAMA_NUM_CTX=32768`; the scorer does not lower context or the 16K-char
window guard. Before a long run, use the read-only audit (no Ollama, ingest or
manifest writes):

```powershell
# Instant manifest/skip report
npx tsx worker/edgar-tone-audit.mts --universe edgar-universe.json --manifest-only

# Full CPU scan: exact deterministic skips, planned windows and prompt chars
npx tsx worker/edgar-tone-audit.mts --universe edgar-universe.json

# Score with two bounded lanes (default); use 1 only for memory diagnosis
npx tsx worker/edgar-tone.mts --universe edgar-universe.json --concurrency 2
```

Two lanes keep at most two Ollama requests in flight and remove CPU/disk gaps
between requests. There are no LLM retries: one transport error ends that
filing; two consecutive errors atomically checkpoint the manifest/outbox and
abort the run. `LLM request failed` is retryable next run, not a terminal
content skip. `thin`, `boilerplate-only` and parse-cap outcomes are separate.
Per-filing timings and outcomes land in `worker/.runs/edgar-tone-audit.jsonl`;
invalid model replies remain in `llm-failures.jsonl`.

Manifest/outbox checkpoints are atomic and are written every 20 completed
filings and at company end, including all-skip companies. `keep_alive=30m`
prevents model unloads between companies. `--include-skipped` and `--rescore`
are deliberate repair modes, never defaults for an incremental full run.

## Options data: snapshots, cache and normalization

Collectors keep raw provider payloads in `worker/cache/options/` and normalized chains in `worker/cache/options-normalized/`. The manifest at `worker/cache/options/manifest.json` records provider, ticker, tradeDate, snapshotId, availability and quality metrics. Every run uses a new timestamped snapshotId by default, so history is never overwritten; rerun a crashed batch with the same `--snapshot-id` to skip completed files.

```powershell
# All 35 underlyings from edgar-universe-35.json, current Cboe chain
npx tsx worker/options-fetch.mts --source cboe

# EODHD demo time series (AAPL only, with coverage warning if pagination stops)
npx tsx worker/options-fetch.mts --source eodhd

# Alpha Vantage historical IBM sample (demo endpoint)
npx tsx worker/options-fetch.mts --source alphavantage --date 2017-11-15

# ORATS near-EOD full-market sample (2024-01-03)
npx tsx worker/options-orats.mts

# ORATS five one-minute AAPL samples (2022-08-08)
npx tsx worker/options-orats-intraday.mts
```

Useful flags: `--only NVDA`, `--force` (refetch only the current snapshot ID), `--snapshot-id <id>` (resume a crashed batch), and `OPTIONS_RPS=2` (default request pacing). Do not raise concurrency before checking provider terms. Raw cache must stay on the large home drive; production receives derived features only.

Data quality contract: OSI contract IDs, per-side bid/ask/sizes, volume, OI, IV and Greeks are normalized separately from last/midpoint/theoretical prices. Quality metrics distinguish rows, unique contracts, duplicate rows, invalid rows, zero-bid and crossed quotes. EODHD is grouped per `tradeDate`, never mixed into one chain. ORATS put delta is call delta minus one.
