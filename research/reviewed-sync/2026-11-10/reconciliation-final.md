# Local↔prod reconciliation — final record (2026-11-10)

Method: canonical per-table inventory both sides (scripts/reconcile-inventory.mts;
type-aware date canonicalization, sorted row keys, bigint-as-string, server/transport
stamp columns excluded). Prod inventories run from the sandbox via direct read access.

## Converged (counts + content hash)
- digests: 3 = 3, hash MATCH.
- macro_points: 408,860 = 408,860 after reviewed deletion of 18 stale
  pre-remediation rows (surgical backup macro-delete-backup.json, sha256 ce417c4b…);
  sourceHash backfilled from the reviewed local package (360,962 rows, sha256
  8d2cc2f0…); content drill vs the package: realtimeEnd/value identical on all
  360,962 archive-anchored rows. Residual: 47,898 rows lack archive hashes on
  BOTH sides — final hash settles at the next reviewed macro sync.

## Converged by construction (transport post-checks), count-equal
- cusip_map: 41,090 = 41,090 (prod apply from reviewed export + one re-resolved row).
  Hash settles at next 13F transport (single-row mappedAt nuance).
- documents: 39,940 = 39,940; hash intentionally differs — prod preserves legacy
  cloud storageKeys under exact-key upsert; local never had them. Documented asymmetry.

## In flight at cutoff
- signals backfill: prod 42,048 / local 84,329 (lane active; rerun if stalled).
- pricesDaily backfill: Δ50 daily bars.

## Reviewed-lane queue (deliberate, not drift)
- events +968 local (derived), companies +1, fund_holdings +379 / fund_quarters +1
  (13F transport in flight), filings −6 (legacy cloud-era rows on prod).

## Intentional asymmetries (never converge)
- facts: local research corpus 12,856,818 vs prod presentation 1,390,442.
- expectations_reviewed_*: staging lives on prod only.
- reports: prod-serving table.
