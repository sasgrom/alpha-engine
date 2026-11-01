# Per-company EDGAR remediation and Schwab fallback

`remediate-company.mts` runs one bounded chain for one company. It never repairs values implicitly and never treats Schwab as an XBRL replacement.

## Default dry-run

```powershell
npx tsx scripts/remediate-company.mts --ticker AAPL
```

Stages:

1. uncapped fundamental integrity audit;
2. EDGAR era/concept/quarter gap analysis;
3. Schwab direct/derived/unsupported candidate mapping.

## Apply EDGAR refresh, then fall back to Schwab

```powershell
npx tsx scripts/remediate-company.mts --ticker AAPL --apply
```

Additional first stages:

1. `edgar-fetch` for primary filings;
2. `edgar-exhibits` for complete EX-99 preservation;
3. `facts-fetch` for current companyfacts into local MySQL.

The fallback then runs the same audit and mapping again, so remaining EDGAR gaps are distinguished from valuation-only Schwab candidates.

## Strict gate

```powershell
npx tsx scripts/remediate-company.mts --ticker AAPL --strict
```

`--strict` exits with code 1 when errors remain after all stages. Use it before promoting new factor research.

Output: `public/reports/remediation/<ticker>.json` with `stages`, `edgarErrors`, `recentErrors`, `availabilityInversions`, `directCandidates`, `derivedCandidates`, `unsupportedConcepts` and `nextAction`.

Possible next actions:

- `fix_availability_before_factor` — repair availability semantics before new factors;
- `edgar_refresh_recent` — refresh only the recent EDGAR gaps;
- `review_schwab_candidates` — inspect direct/derived valuation candidates;
- `edgar_only_no_replacement` — Schwab cannot supply the missing concept honestly.
