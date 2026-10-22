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
schtasks /Create /TN "AlphaEngine-GDELT" /SC HOURLY /TR "cmd /c cd /d C:\dev\alpha-engine && npx tsx worker\gdelt.mts >> worker\gdelt.log 2>&1"
schtasks /Create /TN "AlphaEngine-Stocktwits" /SC HOURLY /MO 1 /ST 00:30 /TR "cmd /c cd /d C:\dev\alpha-engine && npx tsx worker\stocktwits.mts >> worker\stocktwits.log 2>&1"
```

## Data honesty

- `eventTs` = content time (GDELT hour bucket / newest message time);
  `ingestedAt` = server receipt time. Never the other way around.
- GDELT tone ≈ [-10..10], normalized to [-1..1] by ÷10 (documented
  approximation, see `lib/gdelt.ts`).
- Stocktwits label score = (bullish − bearish) / labeled messages of the
  30-message stream window; `null` when nothing labeled.
