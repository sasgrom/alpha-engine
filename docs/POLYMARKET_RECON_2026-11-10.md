# Polymarket live recon — 2026-11-10 (owner-fetched, sandbox-analyzed)

Source: three files fetched by the owner from home (sandbox network cannot reach
polymarket hosts — gamma/clob/gateway.us all time out; SEC/GitHub reachable).
Files: search-fed.json, search-recession.json, top-volume.json (gamma-api,
public, no key — confirms the no-auth read path).

## Design assumptions VALIDATED against live responses

- outcomePrices = implied probabilities directly (["0.981","0.019"]).
- Liquidity gate fields all present per market: volumeNum, volume24hr,
  liquidityNum, spread, bestBid/bestAsk.
- resolutionSource carries the OFFICIAL resolution venue (e.g. the Fed FOMC
  calendar URL) — contract resolution rules are machine-checkable text.
- clobTokenIds present for price-history pulls; active/closed/endDate flags
  for lifecycle; umaResolutionStatus for resolution tracking.
- Sports/entertainment dominate raw top-volume — topic curation in the
  watchlist is mandatory, as designed.

## Live macro snapshot (2026-11-10/11, illustrative first read)

- December 2026 FOMC: +25bp HIKE priced 85.5% (vol24h $1.58M, spread 0.01),
  +50bp 10.75%, no change 3.65% — crowd is hawkish into December.
- "No Fed rate cuts in 2026": 98.1% ($9.6M volume, spread 0.002).
- Fed funds end-of-2026 buckets: deep tails thin (e.g. 4.0% at 4.3%,
  $828 vol24h) — gate must be per-market, not per-event.
- US recession by end-2026: active, $2.45M event volume.
- Japan recession 2026: $4.3k volume — dead; would be gated out as thin.

## Watchlist proposal v0 (macro namespace)

fed-decision-<meeting> (per-FOMC rows), fed-cuts-count-2026,
fed-rate-end-2026 buckets (liquid buckets only), us-recession-2026,
us-recession-2027, cpi-yoy-<month> (to be fetched next round),
jobs-report-<month>. Political: separate namespace, OFF by default.

## Next

Collector implementation awaits explicit owner go (DESIGN_POLYMARKET.md).
Kalshi venue-2 recon can reuse the same owner-fetch pattern if its hosts are
also blocked from the sandbox.
