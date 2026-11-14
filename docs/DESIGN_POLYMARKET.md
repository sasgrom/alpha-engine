# DESIGN: Prediction-Market Probability Feed (Polymarket research namespace)

Status: **reviewed and first-tested on 2026-11-13** (owner's go: "lets review improve execute and test"). Section 11
holds the review, the improved plan and the results. The daily collector is task K22
(`docs/engine/tasks/K22-prediction-market-collector.md`).
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


## 2a. Multi-venue design (added after venue survey, 2026-11)

The module is **venue-agnostic by construction**. A `VenueAdapter` interface
(`fetchMarkets`, `fetchSnapshot`, `fetchResolution`, `normalize`) produces one
canonical snapshot format (§4); downstream features, gates and QA never touch
venue-specific shapes.

Venue registry (priority order):

| Venue | Status | Why |
|---|---|---|
| **Polymarket** (US gateway + intl gamma/CLOB) | venue #1 | Widest macro catalogue, rich metadata, keyless reads, price history incl. resolved markets |
| **Kalshi** | venue #2 | CFTC-regulated, USD-settled, keyless public REST (`https://external-api.kalshi.com/trade-api/v2`: markets, order books, trades, historical candlesticks via `/historical/*` tiers). Token-bucket limits (~200 read tokens/s Basic, ~10 tokens/call). Caveats: ~90% of markets are sports — macro liquidity thinner than headline volume; prices are decimal **strings** (`yes_bid_dollars`), parse as decimals; the NO side of the book is implicit (yes ask = 1 − no bid) |
| PredictIt | rejected (for now) | Read-only keyless JSON API, but political-only focus (our default-OFF namespace), non-commercial data license, structurally thin markets ($850 position caps) |
| Novig / ProphetX / OG Predictive | rejected | Sports-native; no macro priors for Scenario Lab |
| Limitless (Base) | deferred | No simple public read API (off-chain metadata + Base RPC + CLOB glue); fast crypto/price markets. Revisit only if crypto-sentiment becomes a goal |

**Why two venues are worth more than 2x one:**

1. **Cross-venue divergence is itself a signal.** The same macro event priced on
   Kalshi (KYC'd, USD, CFTC crowd — closer to institutional) and Polymarket
   (crypto-native, global) gives |P_kalshi − P_polymarket| as an inter-crowd
   consensus/divergence measure. No single venue provides this.
2. **Twice the resolved labels.** Calibration history (Brier/log loss per topic)
   accumulates per venue, letting us measure which crowd is better calibrated on
   which topics, and weight them accordingly.

Cross-venue matching is **manual and curated**: the watchlist entry links one
canonical topic to per-venue market IDs (`venues: { polymarket: "...", kalshi:
"..." }`). No fuzzy auto-matching of contract texts — resolution rules differ
subtly between venues and a wrong pair silently poisons calibration.

Kalshi implementation notes for the executor: read-only integration needs NO key
and NO account (verify against live docs at implementation time — base URLs have
migrated before: `api.elections.kalshi.com` vs `external-api.kalshi.com`);
WebSocket requires a key and is out of scope; mind the live/historical cutoff
(`GET /historical/cutoff`) when a settled market disappears from live endpoints.

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

## 11. Review, improved plan and first tests (Claude, 2026-11-13)

**Review.**
- Sound and kept:
  - read-only and keyless;
  - political markets off by default;
  - availability by fetch time;
  - the liquidity gate;
  - calibration on resolved markets;
  - curated cross-venue matching.
- Changed:
  1. **Test on history first.** Both venues serve the full price history of settled markets:
     - Kalshi `/historical/markets/{ticker}/candlesticks` (daily candles; the live series endpoint answers 404 for them);
     - Polymarket CLOB `prices-history`.
     A daily collector is not needed before the first test.
  2. **Markets chosen by rule:** whole series (every Fed, CPI, payrolls market), not hand-picked ones, so the selection
     carries no hindsight.
  3. **Company markets added.** Kalshi lists KPI markets for about 150 companies (Amazon, Apple, Costco, Chipotle,
     Boeing …) and 130 earnings-call wording series. They are closest to the engine's question, but started mid-2026
     with 1–6 settled events each. They need forward collection and a later test.
  4. **Research storage** on `D:\research\alpha-engine\predmarkets\`, code in the lab (`src/predmarkets/`). The
     production-style collector is K22.
- Verified live on 2026-11-13: `gamma-api.polymarket.com`, `clob.polymarket.com`, `api.elections.kalshi.com` and
  `external-api.kalshi.com` all answer without a key.

**First tests** (lab `9238b97`, `docs/findings-predmarkets-2026-11-13.md` in the lab):
- **Data:** Kalshi Fed (660 markets, 2021–), CPI (554, 2021–), core CPI, CPI year on year and payrolls (422, 2023–).
  Polymarket covers 15 Fed meetings from March 2025.
- **Calibration** (Brier skill against a base-rate forecast, 1 / 7 / 30 days before):
  - Fed 0.99 / 0.97 / 0.94;
  - CPI 0.74 / 0.69 / 0.55;
  - core CPI 0.73 / 0.68 / 0.61;
  - CPI year on year 0.82 / 0.81 / 0.64;
  - payrolls 0.32 / 0.27 / 0.27, biased low in 2023–2026.
- **Two venues on 12 shared FOMC meetings:** Brier 0.014 (Polymarket) against 0.015 (Kalshi) the day before; the mean
  gap is 0.6 points. The cross-venue gap carries no information for Fed decisions.
- **Day-0 reaction:**
  - a hot CPI surprise (per sd of the market's own distribution) moves SPY −0.47% (t −1.5, 51 releases), and real
    estate −0.52% against SPY (t −2.3);
  - Fed decisions were fully priced;
  - payrolls showed nothing.
- **Drift after the release day:** none robust. SPY |t| ≤ 1.0 at 1, 5 and 20 sessions; isolated sector values of
  |t| 2.4–3.3 are what about 220 tests give by chance.

**Conclusion.**
- Macro prediction markets give no after-release signal for the engine.
- They are well-calibrated expectations for context and scenario priors.
- The forward collection of company KPI markets is the part worth building, for a test once releases accumulate.
