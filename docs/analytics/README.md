# Weekly analytics release protocol

## Goal

Keep an English visual report of project strength current every week, without inventing trend history or changing the raw data stores.

## Weekly run

1. Run `npx tsx scripts/build-analytics-snapshot.mts` from the repository root.
2. Review `src/data/analytics-snapshot.ts` for factual changes: new companies, factor coverage, EDGAR tone rows, 13F holdings, options snapshots, errors and latest price date.
3. Review `public/reports/weekly-metrics.json` for the raw metrics payload.
4. Run the full tests and production build.
5. Commit and publish the updated app version.

The generator preserves up to 12 weekly snapshots. The first week is explicitly marked as the baseline; no synthetic trend line is drawn.

## Files

- `src/data/analytics-snapshot.ts` — generated typed snapshot used by `/analytics`.
- `public/reports/weekly-metrics.json` — generated raw metrics for the current week.
- `public/reports/project-strength-review.md` — long-form English project review.
- `scripts/build-analytics-snapshot.mts` — generator. Edit only when the data contract changes.

## Data contract

- `metrics`: registry, facts, factor_points, prices, EDGAR tone, 13F, macro and jobs status.
- `actual`: real component status with evidence and next action.
- `target`: required architecture for genuine alpha, also with evidence and next action.
- `history`: weekly metrics only, no fabricated trend lines or future placeholders.

Raw HTML/XML/JSON archives stay on the large home drive. Production receives metrics and normalized features only.
