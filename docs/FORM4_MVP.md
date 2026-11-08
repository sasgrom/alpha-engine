# Local SEC Form 4 insider-buy MVP

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/form4-mvp.ps1
```

Options:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/form4-mvp.ps1 -Tickers INTC,NVDA -From 2024-01-01 -DryRun -StrictQa
```

`-Force` refetches already cached filings without deleting the cache. `-StrictQa` stops on any QA mismatch. The default universe is `worker/research-universe-50.json`; `XOM_PRE` and other synthetic placeholders return `not_computable` and are never replaced with XOM.

Canonical roots: code lives at `C:\dev\alpha-engine`; Form 4 cache defaults to `D:\alpha-engine\worker\cache\edgar-form4`; QA/benchmark summaries default to `D:\alpha-engine\worker\.runs\form4-qa`. Override only through `ALPHA_CACHE_ROOT` and `ALPHA_RUNS_ROOT`. Doctor checks the parent `worker\cache` reparse point before the child path. A parent junction targeting `ALPHA_CACHE_ROOT` is one physical store, so a blank child LinkType is valid. Split-brain exists only when the parent is a normal directory and D contains files. Never recursively remove a path under `worker\cache`; if a reparse point must be removed, use only `cmd /c rmdir` on the link itself.

Pipeline:

1. `worker/form4-fetch.mts` reads EDGAR submissions, official `index-headers.html` acceptance timestamps and ownership XML with serialized fair access (`SEC_RPS=7`, hard cap 8). Manifests and raw cache are atomic and resumable under `worker/cache/edgar-form4/`; no midnight acceptance fallback is used.
2. `worker/form4-parse.mts` verifies raw SHA256 and writes normalized transaction JSON without raw XML.
3. `worker/form4-features.mts` builds `insider_buy_cluster_v1` from open-market code P purchases only, with visible exclusion counts and amendment supersede.
4. `worker/form4-qa.mts` runs synthetic fixtures plus golden EDGAR checks for INTC and QA-only external issuers. Transcript names are never authoritative; EDGAR XML is.
5. `worker/form4-benchmark.mts --dry-run` computes +1/+5/+20 trading-day excess returns only when reviewed local bars exist after `availableAt`.

Outputs are local only: per-company manifests/transactions/features in the cache, `worker/.runs/form4-qa/summary.json`, and `worker/.runs/form4-qa/benchmark-summary.json`. Cache, raw XML, and `.runs` are not source-delivery artifacts.

Status discipline:

- `computed`: all purchase values required by the core cluster are present.
- `partial`: some purchase values are missing; no zero substitution occurs.
- `not_computable`: no eligible open-market purchase or required market evidence is unavailable.
- `purchaseToMarketCap` remains `not_computable` without point-in-time reviewed market-cap lineage.
- ADV20 and drawdown20d use only reviewed bars at or before `availableAt`.
- Benchmark is dry-run research evidence, not production alpha.

Known MVP limits: derivative/RSU semantics are excluded rather than interpreted; percentOwnedAfter remains null unless XML provides it; historical market cap requires a separately reviewed point-in-time input; limited price history can make all benchmark horizons `not_computable`; amendments without an explicit reference use the latest filing for the same issuer, owner and period; multiple reporting owners without explicit transaction-owner mapping fail closed instead of being guessed.
