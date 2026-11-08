# DESIGN: Prediction-Market Probability Feed (Polymarket research namespace)

Status: **design + executor brief** — no implementation task has been issued yet (owner decision pending).
Companion chapter: `docs/ALPHA_ENGINE_MANUAL.md` §22 / `docs/ALPHA_ENGINE_MANUAL_EN.md` §22.

## 1. Purpose

Extract crowd-implied probabilities from prediction markets as a research signal:
macro priors for Scenario Lab, ΔP shock triggers for event studies, and — uniquely —
a free source of perfectly labeled outcomes (every contract resolves to 0 or 1) for
calibration work. **This is a data feed, not a betting integration.** Trading, API
keys, order placement and account operations are permanently out of scope.

## 2. Verified source facts (as of 2026-11)

- **Polymarket US** public gateway: `https://gateway.polymarket.us` — markets, events,
  order books, BBO, settlement prices, price history. **No API key.** Public
  endpoints limited to ~20 req/s per IP; query/report endpoints have per-firm limits
  that do not apply to unauthenticated reads.
- **International surface**: `https://gamma-api.polymarket.com` (event/market
  catalogue, metadata, volume fields, resolution status) and
  `https://clob.polymarket.com` (`/book`, `/price`, `/midpoint`, `/prices-history`).
  Public reads need no key, no account, no wallet. Rate limits are IP-based via
  Cloudflare: e.g. `/markets` 300 req/10s, `/prices-history` 1000 req/10s.
- **No paid tier exists for market data.** Paid access only appears in third-party
  resellers (historical L2 depth, archives) — not needed for this design.
- **Hard limit**: order-book depth is forward-only. `/prices-history` gives price
  series (down to 1-minute fidelity, including resolved markets), but historical
  book depth exists nowhere. Snapshot accumulation must start early; missed depth
  is unrecoverable.
- Docs: `docs.polymarket.us` (US), `docs.polymarket.com` (international). Endpoints
  and limits change — re-verify against official docs before implementation, do not
  trust this file over the live docs.

## 3. Scope boundaries (non-negotiable)

- Read-only public endpoints only. No authentication anywhere in this module; if an
  endpoint starts requiring a key, the module stops, it does not acquire one.
- **Political contracts**: separate sub-namespace `prediction_markets.political`,
  default OFF. Standing rule: political events are excluded from the computation
  plan; enabling requires an explicit owner decision recorded in the manual.
- No production writes. Everything lands in the local worker cache under
  `ALPHA_CACHE_ROOT`; production promotion is a separate reviewed handoff.
- Retail Terminal never surfaces the provider name; lineage lives in admin/QA.
- No missing value forced to zero; no stale snapshot presented as current; no
  fixture presented as live.

## 4. Data model (local, file-based first)

Cache root: `ALPHA_CACHE_ROOT/polymarket/` (resolver via `worker/lib/cache-root.ts`,
never hardcode paths; remember the `worker/cache` junction on C: — single physical
store on D:).

```
polymarket/
  watchlist.json            # versioned, owner-curated (see §5)
  markets/<marketId>.json   # latest metadata per tracked market (refreshed)
  snapshots/<marketId>/<yyyy-mm-dd>.jsonl   # append-only quote snapshots
  resolutions/<marketId>.json               # resolution outcome + evidence
  qa/<runId>.json           # QA run reports
```

Snapshot record (one JSONL line):
```json
{
  "marketId": "...", "eventSlug": "...", "question": "...",
  "fetchedAt": "2026-11-08T22:00:00.000Z",
  "midpoint": 0.62, "bestBid": 0.61, "bestAsk": 0.63,
  "volume24h": 152340.5, "liquidity": 88000.0, "openInterest": null,
  "endDate": "2026-12-16T19:00:00Z", "active": true, "closed": false,
  "liquidityFlag": "ok"
}
```

`fetchedAt` is the actual poll timestamp; contract `endDate`/resolution time are
separate fields. Snapshots are append-only — probability history is first-class.

## 5. Watchlist contract

`watchlist.json` is versioned (bump `version` on every change) and curated by the
owner — dozens of contracts, not the catalogue. Entry:

```json
{
  "version": 1,
  "markets": [
    {
      "marketId": "...", "eventSlug": "fed-rate-decision-december-2026",
      "topic": "fed", "namespace": "macro",
      "notes": "FOMC Dec 2026 25bp cut"
    }
  ]
}
```

Topics: `fed`, `cpi`, `pce`, `recession`, `jobs`, `oil`, `chips`, `tariffs`,
`sector-tech`. Namespace `macro` default; `political` entries rejected at load time
unless the political flag is explicitly on.

## 6. Liquidity gate

A thin market's price is noise. Defaults (tunable in watchlist):

- `minVolume24h`: 10,000 USD
- `maxSpread`: 0.05 (bestAsk − bestBid)
- `minLiquidity`: 5,000 USD (order-book liquidity field)

Below threshold → record with `liquidityFlag: "thin"`, excluded from all features
and calibration. Missing liquidity fields → flag `unknown`, treated as thin.
The gate filters features, never deletes data.

## 7. Feature layer (three signal forms)

1. **Level** — current implied probability per topic, exposed as an external prior
   candidate for Scenario Lab. Delivered as read-only feature rows; Scenario Lab
   integration is a separate reviewed step.
2. **Delta (ΔP shock)** — probability change over a window (default 24h and 7d);
   |ΔP| above threshold (default 0.10) emits an event-study trigger record,
   analogous to 8-K event extraction. Output feeds the existing event-study
   harness; it does not create a new one.
3. **Calibration** — for resolved markets: Brier score and log loss of the
   probability trajectory at fixed horizons (T-30d, T-7d, T-1d), aggregated per
   topic. This is the empirical weight of the crowd signal vs. our own models and
   the basis for favorite-longshot correction before any use as a prior.

All features carry `fetchedAt`-based availability: a feature computed at time T may
only use snapshots with `fetchedAt <= T`.

## 8. Collector design (worker)

One script, one PowerShell wrapper, same ergonomics as `form4-mvp.ps1`:

- `worker/polymarket-snapshot.mts`: load watchlist → resolve market IDs (gamma) →
  fetch quotes (BBO/midpoint) → apply liquidity gate → append snapshots →
  detect resolutions (market `closed` + outcome) → write resolution records →
  QA report. Idempotent: re-running the same day appends, never rewrites.
- `scripts/polymarket-mvp.ps1`: fails outside `C:\dev\alpha-engine`, sets
  `ALPHA_CACHE_ROOT`/`ALPHA_RUNS_ROOT` defaults, runs snapshot → features → QA.
- Politeness: single sequential worker, ≥250 ms between requests, exponential
  backoff on 429/5xx, daily cron cadence is sufficient (macro contracts move
  slowly; event days can add a manual run).
- Fail-closed: schema validation failures quarantine the record with reason, never
  crash the run, never fabricate missing fields.

## 9. QA plan

- **Known-resolved markets**: pick 3–5 long-resolved markets (e.g. past FOMC
  decisions), fetch `/prices-history`, verify final price ≈ 0/1 and resolution
  direction matches the known outcome.
- **Point-in-time test**: feature computed at T must be reproducible from snapshots
  alone; test proves no record with `fetchedAt > T` leaks in.
- **Gate test**: synthetic thin/unknown records excluded from features, present in
  storage.
- **Political namespace test**: political entries rejected at watchlist load with
  flag off.
- **No-network test**: parser/feature/QA layers run on cached fixtures without
  network (fixtures clearly labeled, never presented as live).

## 10. Executor brief (LLM working instructions)

Read first: `docs/LLM_CONTEXT.md` (hard invariants, comment convention, cache-root
rules), manual §22, this file. Follow the collaboration protocol.

**Expected outcome** (define done):
1. `worker/polymarket-snapshot.mts` + `scripts/polymarket-mvp.ps1` implementing §8
   against a small starter watchlist (≤10 macro contracts; the exact list will be
   provided by the owner — do not invent political or sports markets).
2. Local cache layout per §4, append-only snapshots, versioned watchlist per §5.
3. Feature extraction per §7 as a dry-run report (JSON + console summary), no
   database writes.
4. QA suite per §9 with vitest tests in `worker/**/*.test.ts`; all green.
5. A short run report: markets tracked, snapshot counts, gate rejections,
   resolutions detected, honest limitations observed.

**Constraints**: research-only, no keys, no trading endpoints, no production, no
provider names in presentation code. Respect hard invariants (no destructive git/fs
operations, no `DROP`/`TRUNCATE`, no credential material in code/logs/commits).
Never recursively delete anything under `worker\cache`; the junction means C: and
D: are one physical store.

**Freedom of design**: choose the simplest structure that satisfies the data model
and QA plan. If the US gateway or gamma endpoints differ from §2 when you implement,
trust the live docs and the observed responses, note the discrepancy in your report,
and continue — do not hardcode assumptions that contradict reality.

**Out of scope for the first task**: Scenario Lab integration, event-study harness
wiring, calibration backtests, UI, production transport. Those are separate
reviewed steps after the collector proves itself locally.
