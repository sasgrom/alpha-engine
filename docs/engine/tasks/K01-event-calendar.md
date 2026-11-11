# K01 — Event calendar for the research-50

Prep task for Kimi Code. Context: [`../DESIGN.md`](../DESIGN.md) sections 1.3 and 2.

## Goal

Give the prediction engine an exact timeline of when each company's results became public. Every
window opens at an earnings release and closes just before the next one, so the engine needs, for
each of the 50 companies in `worker/research-universe-50.json` since 2000-01-01:

1. every 8-K, 10-Q and 10-K (and their /A amendments) with its **publication time**, not only its
   date;
2. a reliable flag for which 8-Ks are **earnings releases**;
3. one row per fiscal quarter that pairs the earnings release with the 10-Q/10-K for the same
   quarter.

Today `filings.items` is filled only from the "recent" block of the SEC submissions API
(`api/services/edgar.ts:161`), so the earnings flag is mostly missing before 2019 and absent before
2013, and no acceptance time is stored anywhere.

## LLM use

None. Every step is ordinary code: SEC metadata requests, string matching on cached documents and
date arithmetic. The `text_rule` flag is a plain text search, not a model judgment. Do not send
filings to any model, cloud or local. Do not read cached filings into the agent session, except a
handful of small samples needed as unit-test fixtures; the script does the bulk work.

## Inputs

- Local MySQL `filings` (51 CIKs; 10-Q 3,380, 10-K 1,097, 8-K 17,320) and `documents`.
- Cached documents under `worker/cache/edgar/<cik>/` (`<accession>.htm`, `<accession>.ex*.htm`).
- SEC submissions API including the older pages listed in `filings.files`
  (`acceptanceDateTime`, `items`, `form`, `filingDate`, `reportDate`, `primaryDocument`).
  Existing access rules apply: declared User-Agent, at most 8 requests per second, bounded retries.
- Trading calendar: distinct dates of SPY in `prices` (source `stooq`).

## Deliverables

Research artifacts, written outside Git under `D:\research\alpha-engine\engine\events\`:

1. `filings-50.jsonl` — one row per filing:
   `cik, ticker, accessionNo, form, filingDate, reportDate, acceptedEt, acceptedUtc,
   acceptedSource, items, itemsSource, isEarningsRelease, earningsFlagBasis, primaryDoc,
   cachedFiles[{name, bytes}]`.
   - `acceptedEt` is the SEC acceptance time as New York wall-clock time (`YYYY-MM-DDTHH:MM:SS`);
     `acceptedUtc` is the same instant in UTC.
   - `isEarningsRelease` is `true`, `false` or `null` (unknown). `earningsFlagBasis` is one of
     `item_2.02` (from 2004-08-23), `item_12` (2003-03-28 to 2004-08-22), `text_rule`, `none`.
     `text_rule` means the item list was unavailable and the cached primary document states
     "Results of Operations and Financial Condition".
2. `quarters-50.jsonl` — one row per company and fiscal quarter:
   `cik, ticker, fiscalPeriodEnd, periodicForm, periodicAccession, periodicAcceptedEt,
   earningsAccession, earningsAcceptedEt, firstPublicationEt, pairingBasis,
   otherEarningsAccessions[], nextFirstPublicationEt, windowSessions`.
   - Pairing rule: the earnings release of a quarter is the **earliest** earnings 8-K accepted
     after `fiscalPeriodEnd` and not later than the periodic filing. If there is none, the periodic
     filing is the first publication (`pairingBasis: "periodic_only"`).
   - `windowSessions` = number of sessions strictly after `firstPublicationEt`'s date and strictly
     before `nextFirstPublicationEt`'s date.
3. `manifest.json` — generation time, row counts, SHA-256 of both files, code commit.
4. Committed summary `research/engine/event-calendar-50.summary.json` with the coverage tables
   from the acceptance checks below (no row-level data).
5. Source code with tests (builder under `scripts/` or `worker/`, pure logic under `worker/lib/`).

Optional, local database only: backfill `filings.items` through the existing code path so the local
`events` table matches. Nothing in this task writes to production.

## Acceptance checks

Report each as a number in the delivery report.

1. **Completeness:** every 10-Q, 10-K and 8-K row in local `filings` for the 50 companies since
   2000-01-01 appears exactly once in `filings-50.jsonl`. Show counts by form and year, both sides.
2. **Publication time:** `acceptedEt` is present for at least 99.5% of filings since 2004. Verify
   the time zone of the SEC field: compare 30 randomly chosen filings against the
   `<ACCEPTANCE-DATETIME>` line of the filing header and state the finding explicitly (the
   submissions API value may be New York time carrying a `Z` suffix). Include daylight-saving
   cases in the unit tests.
3. **Item lists:** non-null for at least 99% of 8-Ks since 2004-08-23. Table by year: 8-Ks, with
   items, earnings releases by basis.
4. **Earnings releases per company-year (2005+):** table; list every company-year with fewer than
   3 or more than 5 and say why.
5. **Quarter timeline:** every 10-Q/10-K since 2005 has exactly one row. Report the share with a
   separate earlier release, the distribution of days from release to periodic filing (expected
   median about 2 days, 90th percentile about 20), zero negative lags, and every window shorter
   than 20 or longer than 120 calendar days.
6. **Window lengths:** median and 5th/95th percentile of `windowSessions`, and the share of windows
   that hold 20, 30 and 45 sessions.
7. `npm run check` and the targeted tests pass. The builder is resumable and repeatable: a second
   run produces byte-identical files apart from the generation time.

## Out of scope

- Classifying exhibits or extracting numbers from press releases (a later task).
- Companies outside the 50.
- Any production write, schema change or new external service.

## Delivery

Append a "Delivery report" section to this file with the numbers for checks 1–7, artifact paths
and hashes, and anything that did not meet a threshold. Add the usual note to
`docs/KIMI_CODE_HANDOFF.md`.
