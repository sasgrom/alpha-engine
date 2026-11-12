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

## Delivery report — 2026-11-12

Delivered locally with no production write, deployment, schema change, LLM or GDELT request. The new report-file policies for `exposure-latest.json` and `macro-transmission-atlas.json` are `automatic: false`.

### Acceptance evidence

Coverage is `computable / historical_only / not_applicable / not_computable`:

- Rates: **26 / 17 / 0 / 7 → 38 / 2 / 6 / 4**.
- Oil: **1 / 3 / 0 / 46 → 5 / 0 / 0 / 45**. Current evidence covers COP, CVX and KMI oil/gas revenue and DAL/RCL fuel costs; FCX refined copper is correctly excluded.
- USD: **0 / 8 / 0 / 42 → 44 / 1 / 0 / 5**, exceeding the 40/50 target.
- Credit: **36 / 6 / 0 / 8 → 46 / 1 / 0 / 3**.

The 17 original stale rate cases now comprise 12 computable, two historical-only and three not-applicable. The six stale credit cases now comprise five computable and one historical-only. `staleEvidenceAudit` in `research/engine/exposure-history.summary.json` preserves every before/after value, accession, concept and exact recovered fact. PLTR remains historical-only because its latest 10-K has no standard or current-debt maturity figure. NFLX, LLY, AMT and LMT use explicitly labeled current-debt aggregates; AIG uses secured/unsecured type totals without summing instrument-level duplicates. NFLX's more precise `2,474,796 × 10^3 USD` is retained instead of the rounded `2,475 × 10^6 USD`.

The maturity checks cover AAPL, AMD, INTC, AMZN, TSLA, BA, RCL, DAL, MSFT and COP, plus MU's regression. Every entry has its latest-10-K accession, source URL/hash and exact fact excerpt. MU's next-12-month and year-two values are both zero (`ixt:fixed-zero`), not missing. GS, COF, JPM, MA, V and AIG are `not_applicable` for rates with `rate_exposure_works_through_interest_margin`.

The atlas has **7,376 records**. Scenario comparisons are available for 17 rate, 17 credit, 44 USD and three oil companies; all other company/channel pairs say `atlas_company_not_covered`. Responses show median abnormal return per observed macro shock and an empirical event/horizon p05/p95 interval, not a confidence interval or forecast. Atlas `partial` and failed OOS gates remain visible; there is no alpha promotion.

### History and artifacts

- `research/engine/exposure-history.jsonl`: **1,435 evidence-bearing filings, 6,111 measures, 50 companies, 11,225,147 bytes**. The 5,100 parsed documents include 3,665 with no supported measure; they are not treated as errors or given fabricated rows. Another 51 pre-inline-XBRL primary documents are explicitly unavailable, not silently treated as an empty archive.
- Measures: foreign revenue share 876; oil/gas revenue 70; fuel cost 71; next-12-month debt 1,187; year-two debt 422; floating-rate share 15; cash/short-term investments 1,237; operating income 1,128; interest expense 1,105. Per-company document/measure counts are in the summary.
- Every row has `availableAt = filingDate`, accession, source URL/hash, period and exact facts. Full parser verification found 1,435 filings and 6,111 measures with no availability mismatch.
- History SHA256: `98a5d49fd3e92469ca84b3a72cc84479dc28d277f2808a0a837de4a65990c39d`. The D: archive and repository JSONL have the same bytes; `.gitattributes` prevents line-ending changes.
- `research/engine/exposure-latest.json` and `public/reports/exposure-latest.json` provide the latest annual and per-measure evidence for the browser. The local scenario and atlas payloads are `public/reports/macro-scenarios.json` and `public/reports/macro-transmission-atlas.json`.
- Final hashes in the summary: exposure-latest `80a3ab359360bf9105de6bed27782c83ed5656483e03ac9e61c215e8ea51df30`; scenarios `ddc4986b112524fe3143c3e0ff5805c31f78f5d8f432deefce860a6f51f177c3`; atlas `69c7fe5848a98188ae5e44b5e293ecf785fe2fb287544b61ac82c10255d00b13`.

The builder streams rows and checkpoints complete companies on D:. A D: disconnect or modern missing primary document prevents publication; it never initializes a C: replacement archive. The original in-memory failure was fixed without deleting any cache or publishing a partial history.

### Verification and delivery

- `npm run check`: passed.
- `VITEST_MAX_WORKERS=2 npm test -- --run --reporter=dot`: **230 files, 1,291 tests passed**.
- `npm run build`: passed; `git diff --check`: passed.
- Real browser against the rebuilt local server: 50 companies, AAPL maturity/cash evidence and exact shock doubling, USD atlas coverage, AIG split maturity evidence with `USD/year`, current COP oil revenue, and JPM's interest-margin status. All required report URLs returned 200 and no page errors occurred. Screenshots are in `worker/.runs/k10-scenario-{rates,usd,credit}.png` (uncommitted).
- One local production-mode listener was restarted after verifying its process: pid **16900**. No additional collector or scheduler entry was added. Source and evidence are committed separately; unrelated generated exposure/analytics files are not included.
