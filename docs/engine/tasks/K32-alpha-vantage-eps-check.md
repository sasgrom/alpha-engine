# K32 — Alpha Vantage EPS against our own figures

Task for Kimi Code. **Owner's go of 2026-11-26** ("load him more"). Written by Claude the same day. Code only, rerunnable
as the collector adds 25 companies a day.

## Why

The owner's rule: "all data must be verified, bad and good". Alpha Vantage's EARNINGS answers (consensus
`estimatedEPS`, `reportedEPS`, `reportedDate`, `reportTime`, back to 1996) are collected daily by
`worker/alpha-vantage-earnings.mts` into `D:/research/alpha-engine/estimates/alphavantage/earnings/` (raw per ticker
and date plus a manifest). Before the consensus is used for surprise tests, its reported figure and dates must agree
with what we know from the companies' own releases.

## Check (new script `scripts/check-alpha-vantage-eps.mts` and a pure module with tests, Kimi's own paths)

For every stored ticker and quarter:
1. **Reported EPS against ours:** the adjusted EPS of the a8 reader (`D:/research/alpha-engine/engine/adjusted-eps/a8`,
   built by `scripts/build-adjusted-eps.mts`; read its files, do not rerun it) and the GAAP diluted EPS of the
   fundamentals standard (`D:/research/alpha-engine/fundamentals/standard/v3.1` or the desk statements files). Match
   quarters by **period end date**, never by fiscal labels (SEC companyfacts' fy/fp run a year off in
   places; the lab's `fiscal_calendar.Calendar` keys on period ends). Agreement within 1 cent or 1%, separately for adjusted and GAAP; a split
   between them is expected (Alpha Vantage reports adjusted figures for most companies).
2. **Dates:** `reportedDate` against our release calendar (`D:/research/alpha-engine/engine/events/filings-*.jsonl`, the
   8-K earnings release's acceptance time): same New York date, and `reportTime` (pre/post market) against the
   acceptance hour.
3. **Splits:** Alpha Vantage's history is probably restated for later splits; compare on both bases with the standard
   prices' split list and say which one it uses, per company.

Output `D:/research/alpha-engine/estimates/alphavantage/checks/<stamp>.json` plus a short markdown: agreement shares
overall and per company, every disagreement with both values and the source lines, and quarters only one side has.

## Rules

AGENTS.md in full; no Alpha Vantage request (read the stored files only); no database write. Tests with small fixtures
(a split, a fiscal year not ending in December, a pre-market and a post-market release). Gates for code: `npm run check`,
the new tests, `npm test -- --run`, `npm run build`, `git diff --check`; announce the full run to Claude. Deliver a report
at the end of this file, a handoff section and a mailbox message.
