# K03 — Read and grade press-release statements

Prep task for Kimi Code, approved by the owner on 2026-11-10. Context: [`../DESIGN.md`](../DESIGN.md)
sections 1.3 and 3. Depends on the corrected K01 timeline.

## Goal

A company's window opens at its earnings press release, so the engine needs the numbers in that
release on the day it comes out, days to weeks before the 10-Q/10-K. Press releases are not
machine-tagged. This task reads the three primary statements (income statement, balance sheet,
cash flow) out of each release as printed, says what each row is, and grades every number against
the 10-Q/10-K filed later.

Scope: the 50 companies, earnings releases from 2009-01-01, releases whose statements are real
HTML tables (about 86% of them).

## LLM use

None in this task. Reading, naming and grading are ordinary code. Rows that this task cannot name
are listed in a residual report; a later task (K04) will name those with the local model
(qwen3.5:9b on Ollama) using instructions written by Claude. Do not read filings into the agent
session beyond a few small samples for test fixtures.

## How rows get named without a model: the answer key

Every release prints prior-period comparative columns next to the new numbers. Those prior-period
numbers were already filed, machine-tagged, in last year's 10-Q/10-K. So:

- take a row's value in a comparative column;
- look in the company's own SEC facts for the same period, using only facts **filed before the
  release was published**;
- if exactly that value is there, the row is that tagged concept, and the same row's
  current-period column is the new, not-yet-filed number for the same concept.

This is point-in-time safe: it uses nothing a reader could not have looked up on release day.

## Inputs

- K01 artifacts in `D:\research\alpha-engine\engine\events\` (`filings-50.jsonl` with
  `isEarningsRelease`, `acceptedEt`, `cachedFiles`; `quarters-50.jsonl` with the pairing of each
  release to its periodic filing).
- Cached exhibits `worker/cache/edgar/<cik>/<accession>.ex-*.htm`. Each file starts with an SGML
  header naming its type (`<TYPE>EX-99.1`). `<accession>.ex.htm` duplicates one of them; drop
  duplicates by content hash.
- Local MySQL `facts` (cik, concept, unit, startDate, endDate, val, fp, fy, form, filed, accn),
  read-only, always filtered by `cik`.

## Pipeline

Each stage is a pure function with unit tests.

1. **Candidates.** Every 8-K with `isEarningsRelease` and `filingDate >= 2009-01-01`; all its
   EX-99 exhibits. (The largest EX-99 exhibit holds the statements in 99.8% of cases, but scan all:
   banks and a few others put them in a supplement filed as EX-99.2.)
2. **Table reader.** HTML tables to grids, expanding `colspan`/`rowspan`. Keep the text just before
   each table (title, units line) and titles placed in the first rows. Normalize cells: join a
   currency sign, an opening or closing parenthesis and a percent sign with their number; parse
   numbers with sign (parentheses are negative); dashes are "no value"; keep footnote markers
   (superscripts, trailing "(1)", "(a)") out of the label but stored separately.
3. **Statement finder.** Mark each table as income statement, balance sheet, cash flow or other,
   from the title and characteristic rows. Exclude tables whose title or headers say non-GAAP,
   adjusted, reconciliation, segment, outlook, guidance, constant currency, highlights or contents.
   Join a statement that continues in the next table with the same columns. When several tables
   still qualify for one statement (about 19% of releases), keep them all as ranked candidates;
   stage 5 decides.
4. **Columns and units.** For each value column: period length in months (0 for a balance date)
   and period end date, from the header rows and their spans. Units multiplier from the units
   phrase next to the table, with row exceptions for per-share amounts and share counts. The
   current period is the latest period end among the income-statement columns; it must agree with
   K01's `fiscalPeriodEnd` for that release within 7 days, otherwise flag the release.
5. **Row naming by answer key.** For each row and each comparative column, find facts of the same
   company with the same period (end date within 3 days, same length) and `filed` earlier than the
   release date, whose value equals the printed value after the multiplier, within half a unit of
   the last printed digit (per-share amounts: exact to the printed cent). Compare magnitudes and
   record whether the sign is flipped. A match counts only if the printed number has at least three
   significant digits or the same concept also matches in a second column. Record every matching
   concept; when several concepts share the value, keep the set. Among candidate tables for one
   statement, choose the one with the most named rows.
6. **Values.** For every named row, output the current-period values (quarter, year-to-date,
   balance date) and the comparative values as printed, with units applied.
7. **Grading.** Compare each current-period value with the fact of the same concept and period
   from the paired periodic filing (`periodicAccession` in K01). Result per value: `match`,
   `mismatch` (store both numbers) or `not_gradable` with a reason (no such fact, fourth-quarter
   three-month figure, release not paired). For fourth quarters, grade the twelve-month column
   against the 10-K. Grading never changes an extracted value.
8. **Residual report.** Every row of a chosen statement that stayed unnamed: company, date,
   statement, heading path, label, printed values. This is the input for K04.

## Deliverables

Under `D:\research\alpha-engine\engine\flash\`, outside Git:

- `statements.jsonl`: per release and statement — source file, table positions, title, units,
  columns with periods, flags.
- `values.jsonl`: per value — company, release accession, `acceptedEt`, statement, row label,
  heading path, matched concept(s), period, value, sign note, how named (`answer_key`), source
  table and row.
- `grades.jsonl`, `residual.jsonl`, `manifest.json` (counts, hashes, code commit).
- Committed summary `research/engine/flash-statements-50.summary.json` with the tables for the
  acceptance checks.
- Code with tests: pure logic under `worker/lib/`, builder under `scripts/` or `worker/`.

## Acceptance checks

Report each as numbers, overall and by year and company.

1. **Coverage.** Earnings releases processed (expected about 3,600); share with an income
   statement, a balance sheet, a cash flow found. Expected from a survey of the cache: income
   statement in about 85% of releases, balance sheet in about 75%, cash flow in about 57%.
   List companies with none (expected: AIG; PLD, TSLA from 2019 and others that publish page
   images).
2. **Golden documents.** [`K03-golden.json`](K03-golden.json) holds 113 expected values read by
   eye from six releases (AAPL, NVDA, BA, DASH, WMT, JPM), each with the list of traps it contains:
   prior year first, year-to-date first, percent-change columns between amounts, a statement that
   continues in a second table, a highlights table before the statements, a bank supplement with
   five quarters side by side. Values are in absolute units. For every assertion the output must
   contain a row of the named statement with that label and period (footnote markers removed, case
   and apostrophe style ignored; `headingContains` narrows repeated labels such as "Diluted") and
   exactly that value. An automated test runs these assertions; all 113 must pass.
3. **Period check.** Current-period end equals K01's `fiscalPeriodEnd` in at least 98% of releases
   with an income statement.
4. **Naming rate.** Share of statement rows named by the answer key, by statement and year. No
   threshold for this first run; the number sizes K04.
5. **Grade.** Of gradable current-period values, the share that match. Target at least 98%. List
   the 30 most frequent mismatch patterns with one example each.
6. **Point-in-time test.** An automated test proves that every fact used as an answer key has
   `filed` earlier than the release date, and that no value in `values.jsonl` was copied from
   `facts`.
7. Repeatable (second run byte-identical apart from generation time), resumable,
   `npm run check` and targeted tests pass, no production write, no schema change.

## Out of scope

- Releases published as page images with a hidden text layer. They get their own task (K05),
  which reads the pages with the local model's vision and reuses stages 5–8 of this task, so keep
  those stages independent of how the grid was read.
- Plain-text releases and tables in the 8-K body (IBM 2004–2016).
- Guidance, segment tables, non-GAAP tables.
- Any model call; companies beyond the 50; years before 2009.

## Delivery

Append a "Delivery report" section with the numbers for checks 1–7, artifact paths and hashes.
Add the usual note to `docs/KIMI_CODE_HANDOFF.md`.
