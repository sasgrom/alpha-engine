# K09 — Data-health checks with quarantine (Stage 3, step A)

Task for Kimi Code, after K07 and K08. Design agreed by the owner on 2026-11-11 (manual §2.1): purification
starts with correctness; inputs that fail a check are set aside before the engine or the app uses them.

## LLM use

None.

## Goal

One local builder, run by the scheduler after the daily data jobs, that checks every source the engine reads
and writes two files:

- `public/reports/data-health.json` and `.md`: per check, what was examined, what failed, since when, with the
  evidence (dates, values, file or accession).
- `research/engine/quarantine.json`: the machine-readable list of inputs set aside, one entry per item
  (`source`, `key` such as cik and date or accession, `check`, `severity`, `since`, `evidence`). The engine
  (Claude's lab) and later the app read it; this task does not change how they use it.

Operations shows the summary line and links to the report.

## Checks (each with a regression test built from a real case found on 2026-11-11)

Prices (`prices`, sources `stooq`, `schwab`, `schwab-hist`):

1. **Two sources, one story.** Per series and date, Stooq close / Schwab close changes only in steps that a
   dividend explains (ratio never above one beyond rounding, rising towards the present, no step above 15%);
   anything else is a finding. Test: KO steps pass; a planted 2:1 step fails.
2. **Splits from the quotes.** The option-implied price (DoltHub features schema 3, `spotSource = put-call
   parity`, unadjusted) against Schwab's split-adjusted close gives the cumulative split factor per date; a change
   by a clean ratio marks a split date (write the split table found); any other change is a finding. Test: AAPL
   4:1 on 2020-08-31 and NVDA 10:1 on 2024-06-10 found.
3. **Bars:** non-positive values, high below low, unchanged OHLC with zero volume over 3+ sessions, one-day moves
   beyond ±50% with no split or corporate action found (review, not removal). Test: the 22 high-below-low bars of
   the 2026-10-26 Stooq dump.
4. **Gaps:** sessions of SPY's combined Stooq + Schwab calendar since 2006-11-10 that a series lacks inside its own
   span, excluding `schwab-hist` (23 series today, CHTR 25 missing sessions over its span, the first five in
   December 2009).

Filed figures (`facts`, `series_points`):

5. **Non-additive concepts** (average share counts, per-share values) never carry a derived quarter. Test: AAPL
   2026-09-26 −30 M diluted shares (until K08 corrects the builder, this check must find it).
6. **Units and signs:** a value 1,000 times off the company's own neighbouring values, negative revenue, share
   counts or assets.
7. **Restatements:** latest vintage against first filed beyond 10% for income-statement totals (report only).

Filings and calendar:

8. **Out-of-order and duplicate periodic filings** from the K06/K01 anomaly lists (`outOfOrderNextPublications`,
   `duplicateOriginalPeriods`): TMUS 2006 and TXN 2010-06-30 appear in the report.

Model output:

9. **Unverifiable statements:** guidance statements whose quote is not in the source document are counted per
   release (the second pass already rejects them; the report shows the share per company).

Options:

10. **Snapshot health:** quote-derived spot present, implied volatility within 0.03–4, at-the-money strike within
    5% of the spot.

## Rules

- Checks read only; nothing is deleted or rewritten. The quarantine is a list, not an edit.
- Point in time: a finding is dated by when it became knowable; the quarantine never hides data retroactively
  from a backtest without recording the date it was found.
- No production write, no schema change, port 3000 only, D: guards for raw files.

## Acceptance checks

1. Each check has its real-case regression test (above) and a clean-case test.
2. A full run over the local data finishes in under 15 minutes and lists, for 2026-11-11 data, at least: the
   AAPL derived quarter (until K08), the 23 gap series, TMUS and TXN, the PG 1987 bar and BNY 1989–1995 steps
   (now in the accepted history: shown as reviewed, severity info).
3. Scheduler job registered with `dependsOn` on the daily data jobs; Operations shows the summary line.
4. `npm run check`, `npm test -- --run`, `npm run build`, `git diff --check`.

## Delivery

Delivery report in this file (checks, counts per check, the split table found, run time), the usual handoff
note, and a mailbox message to Claude.
