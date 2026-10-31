# Fundamental integrity and continuity audit

`scripts/fundamental-integrity-audit.mts` is a **read-only, fail-closed audit** of the local fundamental pipeline. It never deletes, interpolates or repairs values and never contacts SEC or production.

## Commands

```powershell
# Current 51-name universe
npx tsx scripts/fundamental-integrity-audit.mts

# One company
npx tsx scripts/fundamental-integrity-audit.mts --only AAPL

# Fail the process when any error exists
npx tsx scripts/fundamental-integrity-audit.mts --strict

# Change the universe or the explicit issue display cap
npx tsx scripts/fundamental-integrity-audit.mts --universe research-universe-51.json --max-issues 10000
```

Outputs:

- `public/reports/fundamental-integrity.json`
- `public/reports/fundamental-integrity.md`
- the same files under an existing `dist/public/reports`

Every issue contains CIK, concept and, when applicable, period and accession. The summary preserves the complete error/warning count even when the displayed issue list is capped.

## Error gates

- **missing_availability**: filed or accession is absent, so point-in-time use is impossible.
- **missing_unit / missing_period / invalid_period**: empty units, invalid dates, inverted start/end or missing flow duration.
- **duplicate_fact**: exact taxonomy/concept/unit/period/value/form/filed/accn duplicate.
- **frame_conflict**: one accession contains different values for the same concept, unit and period.
- **unit_conflict**: one concept/period has incompatible units.
- **continuity_gap**: expected quarter cells are missing inside the observed grid; the script never interpolates them.
- **availability_inversion**: `filed < periodEnd` or `sourceFiled < periodEnd`.
- **factor_before_fact**: factor availability precedes first fact availability for that period.
- **duplicate_series_point / duplicate_factor_point**: duplicate vintage/factor rows for one concept/period.
- **missing_stage / count_inversion / orphan_cik**: derived rows without parents or invalid facts → series cardinality.

## Review warnings

- unit changes across history;
- non-standard durations;
- large revisions and sign flips;
- missing required concept groups: revenue, net income, operating cash flow, assets, equity, shares, EPS, cash and debt.

Warnings do not fail `--strict` by themselves. They remain visible rather than being converted into silent exclusions.

## Interpretation

- `PASS`: no errors and no warnings.
- `PASS_WITH_WARNINGS`: no errors, but review is required.
- `FAIL`: at least one error; do not promote the affected data into new factor research until its cause is understood and a new audit passes.

A real clean fixture and negative fixtures cover exact duplicates, frame conflicts, unit conflicts, continuity gaps, availability inversions, duplicate series/factors, revision outliers and explicit omission caps.
