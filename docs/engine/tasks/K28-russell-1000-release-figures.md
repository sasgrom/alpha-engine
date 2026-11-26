# K28 — Release figures for the new Russell 1000 companies

Task for Kimi Code. **Owner's go of 2026-11-25** ("go with task pipeline for kimi"). Written by Claude the same day.
Runs after K27 part B (release calendar and exhibits) is delivered; it does not need parts C to F. Kimi's credits end
2026-11-30 16:00: the build is resumable per release, so leave the resume command in this file if it is cut.

## Goal

K12's press-release statements and quarter figures (revenue, operating income, net income, EPS and the rest K12 reads)
for the new companies, built with the **accepted K12.1 parser** (`worker/lib/flash-html.ts`, codeHash `7f76b2c…`, main
`876594b`). The engine needs them for the first numbers of each quarter, before the 10-Q.

## Run

`scripts/build-flash-statements.mts` with K27's addendum, as in `K12-release-figures-other-companies.md`:
- inputs: `--filings D:/research/alpha-engine/engine/events/filings-r1000.jsonl`,
  `--quarters …/quarters-r1000.jsonl`, `--universe …/universe-r1000.json`;
- output: a new folder `D:/research/alpha-engine/engine/flash-r1000` with
  `--summary research/engine/flash-statements-r1000.summary.json` and
  `--extract D:/research/alpha-engine/engine/flash-r1000/flash-quarter-r1000.jsonl`.

Run the first 20 companies as a pilot, then all of them.

## Parser changes

Prefer none. If the new companies show a layout the parser misreads, a fix is allowed only with:
- a fixture test for that layout;
- a rebuild of the default 50 into a new folder, compared with `flash-k121b-50` using Claude's diff tool
  (`D:/research/alpha-engine/engine/checks/flash50-diff/flash_diff.py`), with no lost value and no period regression;
- the same comparison for the 452 (`flash-k121b-rest`), or a clear statement that it was not run.

Existing builds (`flash-rest`, `flash-k121*`) are never rewritten.

## Gates (report the numbers whether they pass or not)

1. Grade at least 98%; period match at least 98% by the code rule, and the strict share beside it.
2. Point in time: 0 real violations (same-day facts explained by release acceptance after 17:30, as in K12).
3. `npx tsx scripts/check-flash-golden.mts`: 113 of 113, unchanged.
4. Extract against companyfacts (from K27 part A), Q4 included: revenue, operating income, net income and EPS
   agreement shares.
5. A quarantine proposal in the format of `checks/k12-review/quarantine-k121.json`: the companies whose figures should
   not be used, each with its evidence (swapped columns, unscaled units, misdated periods). Claude reviews it.

## Rules

AGENTS.md in full; no model call; no database write; own paths only; write to Claude's mailbox before any full test
run, build or restart. If the parser changes: `npm run check`, the flash tests, `npm test -- --run`, `npm run build`,
`git diff --check`, then commit and push.

## Delivery

A delivery report at the end of this file, a handoff section, and a mailbox message to Claude. Claude reviews the
build as it did K12 (diff tool, PIT, extract) and accepts it with or without conditions.

## Pilot diagnostic evidence — 2026-11-26

The pilot remains failed and is not accepted. Cached release inspection, with no parser change, isolated the three named
quarantine cases:

- **TAP:** all 12 extract-revenue mismatches select gross `Sales`; each release also has a current-period `Net sales` row
  that matches companyfacts. For `0001157523-13-002417`, 1,184.8m sales less 356.3m excise taxes is the correct 828.5m
  net sales. All 12 have the same gross-versus-net explanation and a matching net-sales candidate.
- **UNM:** in `0000005513-13-000009` the wrong selected table is `(in millions of pounds, except exchange rate)` (table 47)
  with supplemental rows including `Commissions`; the correct alternative is `Unum Group Consolidated Statements of Income`
  (tables 17–18). In `0000005513-17-000069`, the selected consolidated-titled table 8 actually grades supplemental
  `Large Case Market` and `Group Long-term Disability` rows against unrelated concepts; the intended primary statement must
  be selected and its consolidated revenue/income rows used instead. These are table/row-selection defects, not legitimate
  alternative GAAP concepts.
- **CBSH:** `CONSOLIDATED STATEMENTS OF INCOME` is the correct table, but later column duration detection is wrong. In
  `0000022356-22-000040`, `Capital market fees` 3.327m is labelled six months and 7.452m three months, while companyfacts
  has the reverse. In `0000022356-22-000003`, the 3.841m quarterly `Capital market fees` is labelled 12 months and the
  15.943m annual amount is labelled three months. The final report will include raw headers and wrong/correct row evidence.

Full all-company and industry-group results are pending B; no full K28 result is claimed here.
