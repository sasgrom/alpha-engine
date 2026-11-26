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


## Delivery — Kimi, 2026-11-26

- Added `worker/lib/alpha-vantage-eps-check.ts`, four fixtures and `scripts/check-alpha-vantage-eps.mts`. The latest
  hash-verified stored answer per ticker is compared by exact period end with a8 adjusted EPS and the earliest stored
  standard-fundamentals GAAP diluted EPS. No fiscal labels or fuzzy period matching are used.
- Agreement is one cent or one percent, reported separately on the original and later-split-restated bases. Split
  evidence comes from standard prices' positive `splitRatio` events after the release acceptance/filing date. Per-company
  basis inference uses split-affected adjusted rows first and states mixed/indistinguishable where it cannot decide.
  Dates use New York; pre-market is before 09:30 and post-market at/after 16:00. Every disagreement carries both values
  and source evidence; every one-sided period is listed.
- Full stored run: `D:/research/alpha-engine/estimates/alphavantage/checks/20261126T050350Z.json` and `.md`.
  **25/25 tickers, zero input errors.** Adjusted: 787 comparable, 86.79% original, **90.85% restated/best**. GAAP:
  1,453 comparable, 21.34% original, **22.30% restated/best**. Same New York date 73.37%; report-time agreement 93.32%
  on 2,006 gradable quarters. Disagreements 1,201; one-sided AV/ours 1,247/271. AAPL's nine exact GAAP comparisons all
  agree on the restated basis. The low GAAP share is consistent with AV predominantly reporting adjusted figures and is
  not hidden by blending the two series.
- Gates: new fixtures **4/4**, TypeScript, full suite **298 files / 1,776 tests**, build and `git diff --check` pass.
  No Alpha Vantage request, database write or production action.


## Follow-up: near periods and date conventions — 2026-11-26

- Added one-to-one nearest-first matches within ten calendar days per series, with exact counts retained separately;
  no fiscal labels. Added one-sided reasons (before/after the other history or a true interior gap), the AV-minus-release
  date-offset distribution by pre/market/post acceptance band, next-session post-close convention detection using the
  standard sessions, and 20 disagreement examples carrying both sources.
- Corrected an exact one-sided counter caught by the first follow-up run; the final report restores the original exact
  totals instead of the erroneous zero. Current output is
  `D:/research/alpha-engine/estimates/alphavantage/checks/20261126T055345Z.json` and `.md`.
- Adjusted: **980 = 787 exact + 193 near**, 90.51% best overall and 90.85% exact-only. GAAP:
  **1,708 = 1,453 exact + 255 near**, 23.89% best overall and 22.30% exact-only. One-sided exact AV/ours is
  **1,247/271**; near-matched is **983/7** (926 AV before our history, four after, 55 true gaps; five ours before AV,
  two after). Next-session post-close convention explains 17 date non-matches; 711/728 (97.66%) remain unexplained.
  Full offset bands and examples are in the JSON.
- Follow-up gates: fixtures 4/4, TypeScript, full **299 files / 1,779 tests**, build and `git diff --check` pass.
  Still no AV request or database write.
