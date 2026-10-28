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

Completed baseline (2026-10-27): all 53 CIKs + SPY have daily bars through
2026-10-26 (447,282 rows), with zero missing tickers. `factor_points` was rebuilt
to 15,312 rows; `high52` and `momentum122` now cover all 53 CIKs.

## Factor IC baseline (50 current S&P, excess return over SPY)

Cross-sectional Spearman IC uses 63/126-session excess forward returns and a
2,000-run circular block bootstrap (4-quarter blocks, seed 42), not independent
sample-count claims. Weighted IC [95% block CI]:

| Factor | 63 sessions | 126 sessions | Reading |
|---|---:|---:|---|
| accruals | -0.057 [-0.097,-0.016] | -0.047 [-0.094,-0.001] | expected negative sign, borderline at 126 |
| assetGrowth | +0.132 [+0.074,+0.191] | +0.182 [+0.115,+0.243] | strongest candidate, but regime-dependent |
| buybackYield | -0.076 [-0.145,-0.009] | -0.168 [-0.240,-0.091] | adverse; do not promote |
| grossProfitability | -0.088 [-0.152,-0.025] | +0.058 [-0.020,+0.137] | sign unstable |
| high52 | -0.059 [-0.152,+0.040] | -0.033 [-0.162,+0.105] | no robust signal |
| momentum122 | -0.013 [-0.084,+0.052] | -0.005 [-0.096,+0.079] | no signal |
| sue | -0.001 [-0.041,+0.037] | +0.043 [+0.002,+0.082] | weak 126-day candidate only |

AssetGrowth remains regime-dependent: 63-day weighted IC was -0.180 in 2022 and
-0.083 in 2026 YTD, despite the strong full-sample CI. Next gate: sector-neutral
residuals and nested holdout with costs/capacity, not probability-model promotion.

## Market-cap and enterprise-value factors

Added 9 availability-anchored valuation factors: earningsYield, bookToMarket,
fcfYield, salesYield, ocfYield, evEbitda, evEbit, netDebtToEbitda and peRatio.
Market cap uses period-end close × shares (with diluted-share fallback); EV uses
financial debt minus cash, never total liabilities. Negative yields are preserved;
P/E and EV multiples require positive denominators. Concept queries are capped at
8 concurrent per company, with a short bounded retry for transient DB failures.

Final registry: 16 factors, 21,894 factor_points, 672 company-factor pairs.
New-factor IC: bookToMarket is the only additional candidate at 126 sessions,
+0.080 [+0.012,+0.144] (63d +0.035 [-0.031,+0.107]). OCF yield is only borderline
at 126 sessions, +0.060 [-0.003,+0.121]. Earnings/FCF/sales yields, P/E, EV/EBIT,
EV/EBITDA and netDebt/EBITDA show no robust independent signal so far. This makes
sector-neutral residual evaluation mandatory before using valuation factors.

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

Report continuation fix: running `--engines ollama` after a completed Strata-only
run now retains both engine summaries from JSONL/sessions. Model ID falls back to
the latest result, and wall time falls back to per-request durations if a session
file is missing. Repeating the same continuation command regenerates the report
without re-scoring completed windows.

## Sector-neutral residuals and economic viability

`neutralizeBySector` subtracts both the sector-median factor and the sector-median
forward return (minimum 4 names per sector, global fallback otherwise). AssetGrowth
retains positive IC: 63d +0.038 [+0.001,+0.073], 126d +0.089 [+0.036,+0.142].
Book-to-market loses significance: +0.037/+0.023 with CI through zero, so most of
the earlier value effect was sector-driven. BuybackYield, EV/EBIT and netDebt/EBITDA
remain adverse; OCF yield, SUE, high52 and momentum122 show no robust signal.

Economic quintile test (top/bottom 20%, 15 bps per unit turnover): high-asset-growth
long/short has positive mean returns, 63d +3.58% [+0.82%,+6.60%] and 126d +11.15%
[+5.13%,+17.26%], but max drawdown is 74.9% and 99.2% respectively. Opposite-direction
portfolios lose all capital. This is statistical evidence of a signal, not an
investable strategy: no promotion without volatility/capacity controls and nested
holdout.

## Pre-registered volatility targeting and chronological holdout

`applyVolTarget` uses only the trailing 4 quarterly spread returns, targets 5%
quarterly volatility and clamps leverage to 0.25–1.00 (gross <=100% across both
legs). Leverage changes are included in turnover costs. Evaluation is strictly
chronological: 60% development, 20% validation, 20% final holdout, with no
parameter selection on holdout.

At 126 sessions, development maxDD falls from 74.4% to 25.4%; validation remains
negative for both variants (baseline -84.7%, vol-target -38.3%). On final holdout,
baseline loses 51.2% with 98.9% maxDD, while vol-target gains 200.8% with 31.7%
maxDD and +5.40% mean return [+0.62%,+9.76%]. At 63 sessions, vol-target improves
validation from -40.6% to +25.1%, but final-holdout return falls from +84.5% to
+39.7% while maxDD falls from 60.7% to 24.9%. This proves better risk control, not
a universally profitable strategy. These remain synthetic sector-relative returns;
next gate is independent-universe and macro-regime validation, not production.

## Independent-universe and macro-regime results

Deterministic odd/even CIK universes and leave-one-sector-out checks are mostly
negative or near zero: AssetGrowth is not universal. Final holdout vol-target is
+0.2% in the odd universe and -1.5% in even; only Consumer Discretionary is
positive (+2.5%), while Health Care (-3.1%), Information Technology (-1.3%) and
Financials (-0.5%) are negative. Sector concentration remains a material risk.

Pre-registered macro thresholds show a clear regime split. Vol-target mean return
is positive with CI in risk-on regimes: VIX <20 (+3.45% [+1.96%,+4.85%]), normal
yield curve (+2.90% [+1.51%,+4.27%]), tight HY credit (+4.24% [+1.29%,+7.64%]) and
SPY above 200DMA (+3.35% [+1.90%,+4.75%]). VIX mid/high, inversion and SPY below
200DMA include zero. HY mid has only one observation and is not interpreted.
Volatility targeting reduces drawdown but does not rescue stress periods. Do not
introduce a regime gate based on the same sample: that would be data snooping.
A new independent universe/period is required before any regime-filtered strategy.

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
