# Per-company EDGAR remediation and Schwab fallback

`remediate-company.mts` runs one bounded chain for one company. It never repairs values implicitly and never treats Schwab as an XBRL replacement.

## Default dry-run

```powershell
npx tsx scripts/remediate-company.mts --ticker AAPL
```

Stages:

1. uncapped fundamental integrity audit;
2. EDGAR era/concept/quarter gap analysis;
3. fresh-companyfacts diagnosis of the exact recent integrity errors;
4. Schwab direct/derived/unsupported candidate mapping.

## Apply EDGAR refresh, then fall back to Schwab

```powershell
npx tsx scripts/remediate-company.mts --ticker AAPL --apply
```

Additional first stages:

1. `edgar-fetch` for primary filings;
2. `edgar-exhibits` for complete EX-99 preservation;
3. `facts-fetch` for current companyfacts into local MySQL.

The fallback then runs the same audit, diagnosis and mapping again, so remaining EDGAR gaps are distinguished from valuation-only Schwab candidates. The diagnosis is scoped to continuity findings with `periodEnd >= 2020-01-01`; it checks exact concepts and Current/Noncurrent twins without merging them automatically.

Annual-only 10-K concepts are warnings (`cadence_expected_gap`), not quarterly continuity errors. They remain visible in gap reports but are excluded from quarterly trend imputation. Schwab direct and derived fields are allowed as snapshot-anchored provider features with `capturedAt` and `sourceHash`; they are not relabeled as historical EDGAR facts.

## Causal imputation candidates

```powershell
npx tsx scripts/build-causal-imputation.mts --ticker AAPL
```

This read-only builder evaluates only non-annual isolated gaps with four consecutive actual quarters and an actual following quarter. Causal OLS4 uses only the four prior values. A separate retrospective smoother may average that forecast with the following actual, but it is marked `usesFutureObservation=true` and inherits the following fact's `sourceFiled` availability. Neither method overwrites reported or canonical series; output is a review candidate under `public/reports/remediation/<ticker>-imputation-candidates.json`.

## Strict gate

```powershell
npx tsx scripts/remediate-company.mts --ticker AAPL --strict
```

`--strict` exits with code 1 when errors remain after all stages. Use it before promoting new factor research.

Output: `public/reports/remediation/<ticker>.json` with `stages`, error counts, recovery/alias/unavailable quarter counts, Schwab candidate counts and `nextAction`. Detailed evidence and the source companyfacts SHA256 are in `public/reports/remediation/<ticker>-recent-gap-diagnosis.json` and `.md`.

Possible next actions:

- `fix_availability_before_factor` — repair availability semantics before new factors;
- `edgar_refresh_recent` — legacy fallback when no fresh diagnosis was supplied;
- `review_fact_ingestion` — exact facts exist in fresh companyfacts but remain absent locally;
- `review_taxonomy_aliases` — only a Current/Noncurrent twin covers a missing quarter; compare taxonomy and values before any merge;
- `review_source_sparse_gaps` — neither exact facts nor twins exist, so another download cannot restore the quarters; review reporting cadence and taxonomy instead;
- `review_schwab_candidates` — inspect direct/derived valuation candidates;
- `edgar_only_no_replacement` — Schwab cannot supply the missing concept honestly.
