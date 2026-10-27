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

# Repair 8-K/8-K/A EX-99 from existing manifests only (no submissions crawl)
npx tsx worker/edgar-fetch.mts --universe edgar-universe.json --exhibits-only

# Score with two bounded lanes (default); use 1 only for memory diagnosis
npx tsx worker/edgar-tone.mts --universe edgar-universe.json --concurrency 2
```

Two lanes keep at most two Ollama requests in flight and remove CPU/disk gaps
between requests. There are no LLM retries: one transport error ends that
filing; two consecutive errors atomically checkpoint the manifest/outbox and
abort the run. `LLM request failed` is retryable next run, not a terminal
content skip. `thin`, `boilerplate-only` and parse-cap outcomes are separate.
Per-filing timings and outcomes land in `worker/.runs/edgar-tone-audit.jsonl`;
invalid model replies remain in `llm-failures.jsonl`. The final process summary
includes total prompt/generated tokens, duration-weighted prefill/decode tok/s,
and effective decode tok/s over the full process wall time (pauses included).

Manifest/outbox checkpoints are atomic and are written every 20 completed
filings and at company end, including all-skip companies. `keep_alive=30m`
prevents model unloads between companies. `--include-skipped` and `--rescore`
are deliberate repair modes, never defaults for an incremental full run.

## Price backfill for research-universe-53

The original Stage 1.7 method is reused: download Stooq's bulk daily archive
`d_us_txt.zip` from `https://stooq.com/db/h/`, upload it through Admin → Prices
Import (whole ZIP or pre-split parts, with resume), then run the research import
with the returned batch UUID:

```powershell
npx tsx scripts/import-research-prices.mts --batch <batch-uuid>
```

Unlike the original five-ticker import, this entrypoint uses
`research-universe-53.json` rather than active user memberships. It includes SPY,
imports RIVN/ENLT and maps `xom.us.txt` to both current XOM and XOM_PRE. All bars
remain split/dividend-adjusted Metastock daily data under `source='stooq'`.
Existing bars are upserted, never duplicated. The final report names any ticker
missing from the archive instead of inventing coverage. After a complete import,
rematerialize factors to add `high52` and `momentum122` across the panel.

## Research universe: 50 current S&P names + 3 evidence-only CIKs

`research-universe-50.json` contains 50 current S&P tickers: the original 35,
12 existing index names and AIG, COP, LIN. `research-universe-53.json` adds
`XOM_PRE` (predecessor evidence) plus off-index legacy RIVN and ENLT. Keeping
these files separate prevents off-index names from contaminating S&P metrics.

For the three new names only:

```powershell
npx tsx worker/facts-fetch.mts --universe facts-universe-expansion-3.json
```

Then verify the complete local 53-CIK set and push after review/publication:

```powershell
npx tsx scripts/push-local-facts.mts --universe research-universe-53.json --dry
npx tsx scripts/push-local-facts.mts --universe research-universe-53.json
```

Use `research-universe-50.json` for current-S&P factor/evaluation panels and
`research-universe-53.json` for complete-data ingestion only.

After facts are synced, build the derived layers on the server (no local run):

```powershell
# Atomic per-CIK canonical series; resumes only missing companies
npx tsx scripts/build-research-series.mts --universe research-universe-53.json --skip-built

# One grouped facts query + atomic factor replacement per company
npx tsx scripts/materialize-research-factors.mts --universe research-universe-53.json
```

Verified baseline: 1,348,866 facts, 1,093,785 series_points and 10,734
factor_points across all 53 CIKs, with no stale factor history. Current XOM has
only two points because it is a new holding; use XOM_PRE for predecessor history.
ENLT currently has one point because its underlying series is sparse. Price-based
factors still require the separate full-price-history backfill.

## Companyfacts fundamentals: local-first snapshots

Restart the local dev server after pulling so it registers the `factsSnapshot`
route. For the full target-35 refresh use
`facts-universe-35-plus-predecessor.json`: 35 current tickers plus Exxon's
historical CIK 34088. Current XOM (2115436, ExxonMobil Holdings Corp) and the
predecessor remain separate; no silent entity merge.

```powershell
# If only XOM needs repair after the initial 34-company run:
npx tsx worker/facts-fetch.mts --universe facts-universe-xom.json

# SEC companyfacts → D: cache → LOCAL MySQL for the full 36-CIK set:
npx tsx worker/facts-fetch.mts --universe facts-universe-35-plus-predecessor.json

# Review exactly what the local DB will send (no network to prod)
npx tsx scripts/push-local-facts.mts --universe facts-universe-35-plus-predecessor.json --dry

# After the prod route is published and local coverage is reviewed:
npx tsx scripts/push-local-facts.mts --universe facts-universe-35-plus-predecessor.json
```

Each CIK travels as one complete snapshot. The server validates every row and
replaces only that company in one transaction, with inserts chunked at 500.
A failed snapshot rolls back its delete and all inserts; other companies are
untouched. Reruns are idempotent by full replacement. SEC's zero-padded string
`cik` is normalized to a number before validation. Use `--cached` on
`facts-fetch` to replay an existing D: payload without another SEC request.

## Strata 125B A/B: identical 100-document EDGAR benchmark

Use the current Terminal release rather than the old source-only `START-HERE.bat`.
Check the plan before downloading tens of GB; the selected pack must fit actual
RAM, VRAM, disk and backend support:

```powershell
irm https://github.com/Niko1221/Strata/releases/latest/download/install.ps1 | iex
# Open a NEW terminal, then inspect without changing the model:
strata launch --family qwen --model IQ2_XS --context 32k --plan --output json
# Only after the plan fits:
strata launch --family qwen --model IQ2_XS --context 32k --yes --no-tui
strata launch --status
```

The benchmark reuses prepared windows from the EDGAR cache. It never writes
signals, manifests or outboxes, and never promotes Strata to production. Both
engines run sequentially at concurrency 1 with identical prompts, temperature 0,
256 output tokens and reasoning disabled. Warmups are excluded.

```powershell
npx tsx worker/edgar-tone-ab.mts --only AIG --limit 100 --engines ollama,strata --run-id aig-100-strata-v1
```

`STRATA_URL` defaults to `http://127.0.0.1:8080`; set `STRATA_MODEL` when more
than one model is served and `STRATA_API_KEY` only if configured. Repeating the
same command resumes completed engine/window keys. Use a new `--run-id` for a
fresh independent repetition.

Reports in `worker/.runs/edgar-tone-ab-<run-id>.*` include prompt input/cache/
fresh-read/generated tokens, prefill/decode/effective tok/s, wall time, parse
and error rates, score MAE/RMSE/Pearson/direction agreement, and the 20 largest
score/why divergences with SEC links. Agreement is not absolute correctness;
manual source review remains the quality gate.

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
