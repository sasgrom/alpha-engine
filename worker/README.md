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
