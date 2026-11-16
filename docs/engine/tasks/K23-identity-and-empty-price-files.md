# K23 — Six companies without identity, five empty price files

Task for Kimi Code. **Approved by the owner on 2026-11-16** ("prepare instructions for kimi to complete what u think is
necessary and send it to him"). Written by Claude the same day. Run it after K20 is delivered and before K12.

## Why

Two defects found during Claude's research on 2026-11-16. Both silently drop companies from research.

**1. Six companies carry placeholder identities.** In the standard fundamentals v3.1 company documents
(`D:\research\alpha-engine\fundamentals\standard\v3.1\company\<cik>.json`) these six have ticker `CIK<cik>`, name
`CIK <cik>` and no sector or industry. Their numbers and their standard prices are fine; only the identity is missing.

| CIK | Company (check against the registry's own source) | Ticker |
| --- | --- | --- |
| 27419 | Target Corp | TGT |
| 46080 | Hasbro, Inc. | HAS |
| 76334 | Parker-Hannifin Corp | PH |
| 766704 | Welltower Inc. | WELL |
| 1113169 | T. Rowe Price Group, Inc. | TROW |
| 1116132 | Tapestry, Inc. | TPR |

What breaks downstream:
- None of the six is in K06's universe (`D:\research\alpha-engine\engine\events\universe-rest.json`, 446 companies), and
  none is in the research 50. So they have no release calendar, no cached releases, and K12 would skip them.
- No sector, so no sector fund in the engine tests. Stooq intraday files are keyed by ticker, so the hourly and
  5-minute tests skipped them.
- Matching by name or ticker fails (Claude had to patch them by hand when building S&P 500 membership).

**2. Five standard daily price files are empty** (header only) in `D:\research\alpha-engine\prices\std\daily\`, build
`p1.20261114`:

| CIK | Ticker | First price | Rows the gates compared |
| --- | --- | --- | --- |
| 1874178 | RIVN | 2021-11-10 | 1,243 |
| 2058873 | Q (Qnity Electronics) | 2025-11-03 | 256 |
| 2082247 | FDXF (FedEx Freight) | 2026-06-01 | 113 |
| 2089271 | HONA (Honeywell Aerospace) | 2026-06-29 | 94 |
| 2128626 | VYLR (Vylor) | 2026-10-01 | 28 |

`companies.json` of the price build lists each with first and last price dates and gate counts above zero, so rows
existed at gate time and were lost when the file was written. They have no Tiingo history in common: RIVN's notes show
`afterTiingo.noOverlap = true`; check the other four. The likely place is the weekly refresh (K18) or the build's file
writer, for Schwab-only series.

## Rules

- **Do not overwrite data** (owner's rule). Final numeric tables stay byte-identical (`std_fundamentals` v3.1,
  `std_prices` rows of other companies, K06 files). Identity fixes go into the registry the builds read, plus a
  versioned, documented identity correction. If a final artifact must carry the corrected identity, write a new version
  next to it and keep the old one.
- Take each company's ticker, name, sector, industry and SIC from the same source the other 494 companies use. The
  table above is only a cross-check; a disagreement is reported, not silently resolved.
- Use only existing collectors at their usual pace. Downloads are limited to the six companies' SEC filings and release
  exhibits for part B. No production write, no schema change, no model call.
- The AGENTS.md section 3.1 D: protocol applies: checkpoints, no C: fallback, resume after a remount check.

## What to do

**A. Identity.** Correct the six in the registry. Regenerate whatever identity outputs the standard builds publish
(company lists for fundamentals and prices), as new versions. Then search the other research inputs for `CIK<digits>`
placeholder tickers and list any further cases.

**B. Release calendar and documents for the six.** Run K06's collector for the six companies only: filings,
earnings-release flags, quarter pairing and cached release exhibits from 2009-01-01, with K06's point-in-time checks.
Write them as an addendum (for example `filings-six.jsonl`, `quarters-six.jsonl`, `universe-six.json`, with the
exhibits in K06's cache layout), or as new versions of the rest files with the old ones kept. Never edit K06's files in
place.

**C. Empty price files.** Find why the five files were written empty and fix the writer, with a regression test on a
Schwab-only fixture. Regenerate the five files (they are empty, so nothing is overwritten) and check them against
`alpha_research.std_prices`. If the database rows are missing too, load them in batches of at most 500. Add a gate: a
company with a first and last price date must never get a header-only daily file.

## Acceptance checks

1. The six show correct ticker, name, sector, industry and SIC in the registry and in the regenerated identity outputs.
   Before/after hashes and row counts prove that no numeric value of any table or file changed.
2. Addendum for the six: filings and releases per company and year, the share of quarters paired, and K06's
   point-in-time audit with 0 violations. K06's original files are byte-identical.
3. The five price files have rows that match the gate counts and the database: first and last date, row count and a
   hash of the closes. The new gate fails on a header-only file in a test.
4. The list of any other placeholder identities found in research inputs.
5. `npm run check`, the targeted tests, `npm test -- --run`, `npm run build`, `git diff --check`.

## Delivery

A delivery report in this file, a handoff note, and a mailbox message to Claude. Claude then updates the lab's n1
company list from the corrected registry, and K12 runs over K06 plus the six (452 companies).
