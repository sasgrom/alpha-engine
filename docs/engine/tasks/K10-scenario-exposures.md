# K10 — Scenario Lab: complete exposures, a realistic rate shock, the market's measured sensitivity, exposure history

Task for Kimi Code, after K07; its order relative to K08 and K09 is the owner's. Owner approved the four
improvements on 2026-11-11.

## LLM use

None.

## Where it stands (2026-11-11, after the `/reports/` whitelist fix `fec4dc5`)

Coverage per shock in `public/reports/macro-scenarios.json` (current / old filings only / not computable):
rates 26/17/7, credit 36/6/8, **oil 1/3/46, dollar 0/8/42**. Oil and dollar are nearly empty because they need
revenue by geography and by product, which companies report with XBRL dimensions; the SEC companyfacts feed the
project loads carries no dimensional facts. The rate shock assumes all debt reprices at once.

## What to build

1. **Segment facts from the filings.** Read revenue by geographic area (`srt:StatementGeographicalAxis` and
   country or region members) and by product or service (`srt:ProductOrServiceAxis`, e.g. crude oil, natural gas,
   refined products) from the XBRL of the 10-K/10-Q filings already cached on D: (inline XBRL or the instance
   document in the filing package). Read only; the cache sits behind the `worker\cache` junction and is never
   deleted from. Output per company and filing: foreign revenue share and oil and gas revenue, each with filing
   date, accession and the exact facts used.
2. **Rate shock that reflects repricing.** Debt maturing within 12 and 24 months
   (`LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths`, `...InYearTwo`) plus floating-rate debt where
   it is tagged, minus the interest earned on cash and short-term investments under the same shock; in USD a year
   and as a share of operating income. Banks and insurers get the status "not applicable: rate exposure works
   through the interest margin" instead of "not computable".
3. **Stale evidence.** For the 17 rate and 6 credit cases that use old filings (AMD's debt from 2016), find why the
   latest filings lack the concept (renamed or split concepts) and extend the concept map; a case stays "old
   filings only" only if the latest 10-K truly lacks the figure. Before/after list.
4. **The market's measured sensitivity beside the filings.** Next to each company's filing-based impact, show its
   measured response to the same macro move from the macro transmission atlas
   (`public/reports/macro-transmission-atlas.json`), with its interval, and mark disagreements (a large exposure
   the market does not respond to, or the reverse).
5. **Exposure history for the engine.** A point-in-time file with every exposure measure per company and filing,
   dated by its filing date (available from), never revised backwards: `research/engine/exposure-history.jsonl`
   (or on D: if larger than 20 MB, with a committed summary). Claude's engine test reads it.

## Acceptance checks

1. Coverage before/after per shock. Targets: dollar for at least 40 of the 50; oil for the producers, airlines and
   cruise lines among the 50.
2. The rate shock for 10 named companies checked against the maturity table of their latest 10-K, with the quote.
3. Banks and insurers show "not applicable" with the reason.
4. The atlas comparison appears for all four shocks.
5. The exposure history file with counts per measure and company; a test that a value is never dated before its
   filing.
6. `npm run check`, `npm test -- --run`, `npm run build`, `git diff --check`; no production write; no schema
   change.

## Delivery

Delivery report in this file, the usual handoff note, and a mailbox message to Claude.
