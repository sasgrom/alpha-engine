# EDGAR coverage and continuity gap analysis

`edgar-gap-analysis.mts` converts the fundamental integrity report into an era-aware remediation manifest. It is read-only and does not contact SEC, Schwab or production.

```powershell
npx tsx scripts/edgar-gap-analysis.mts
```

Optional arguments:

```powershell
npx tsx scripts/edgar-gap-analysis.mts --since 2000-01-01 --max-gaps 5000 --input public/reports/fundamental-integrity.json
```

Outputs:

- `public/reports/edgar-coverage-gaps.json`
- `public/reports/edgar-coverage-gaps.md`
- the same files under an existing `dist/public/reports`

The report deduplicates missing quarters across fact and series layers, groups findings by era, CIK, type and concept, and distinguishes recent gaps from archive-only gaps. Recent gaps are candidates for EDGAR refresh. Historical gaps are not blindly backfilled with current-provider data.

# Schwab fundamental gap mapping

`schwab-fundamental-gap-map.mts` maps EDGAR concept gaps to actual Schwab instrument fields. It never treats provider metadata as a vintage-equivalent XBRL replacement.

```powershell
npx tsx scripts/schwab-fundamental-gap-map.mts
```

Candidate statuses:

- **direct_candidate**: a provider field exists, but only as current snapshot metadata.
- **derived_candidate**: an approximate valuation formula is possible, with an explicit warning that it is not an exact EDGAR fact.
- **unsupported**: the concept cannot be restored honestly from Schwab and remains an EDGAR gap.

Examples of direct fields: EPS/epsTTM, sharesOutstanding, marketCap, P/E, P/B, P/CF, bookValuePerShare, margins, ROE/ROA/ROI, debt ratios, beta and dividends.

Examples of derived fields:

- `bookValuePerShare × sharesOutstanding` for equity;
- `epsTTM × sharesOutstanding` for net income;
- `marketCap / pcfRatio` for approximate operating cash flow.

Accounts payable, assets, cash, revenue and most detailed XBRL concepts remain unsupported. The mapping is a review plan, not an automatic repair.
