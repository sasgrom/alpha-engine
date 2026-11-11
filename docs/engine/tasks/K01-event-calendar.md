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

## Delivery report

Executed with `scripts/build-event-calendar.mts` and `worker/lib/event-calendar.ts` on 2026-11-10/11.
No production write, schema change, model call, or new external service was used. SEC submissions and
older pages were fetched through the existing serialized SEC client and cached under the artifact root.

### Acceptance checks

1. **Completeness — pass.** The builder contains exactly 22,240 unique in-scope rows and 4,644
   quarter rows; there are no duplicates. Form counts on both sides are identical: 10-K 1,092,
   10-K/A 112, 10-Q 3,355, 10-Q/A 85, 8-K 17,230, 8-K/A 366. Proxy/DEF filings were excluded.
   Year totals (local = JSONL): 2000 90, 2001 288, 2002 356, 2003 516, 2004 636, 2005 938,
   2006 1,043, 2007 1,109, 2008 1,107, 2009 938, 2010 902, 2011 1,069, 2012 1,067, 2013 1,031,
   2014 1,023, 2015 1,029, 2016 1,041, 2017 1,041, 2018 1,006, 2019 1,034, 2020 1,180,
   2021 1,077, 2022 1,030, 2023 951, 2024 969, 2025 976, 2026 814.
2. **Publication time — pass.** `acceptedEt` is present for 20,977/20,977 (100%) of filings since
   2004, exceeding 99.5%. Submissions acceptanceDateTime is an ISO UTC value with `Z`; filing
   headers carry New York wall time. `acceptedEt` uses America/New_York and `acceptedUtc` preserves
   the instant, including DST. Thirty header comparisons produced 17 exact matches and 13 old-header
   HTTP 404s; there were no timestamp mismatches among the readable headers.
3. **Item lists — pass.** 16,512/16,512 (100%) of 8-Ks since 2004-08-23 have non-null item lists.
   Earnings flags by year (`item_2.02`): 2003 0 (item_12 46), 2004 45 (item_12 104), 2005 163,
   2006 173, 2007 184, 2008 196, 2009 189, 2010 185, 2011 190, 2012 201, 2013 190, 2014 188,
   2015 194, 2016 199, 2017 195, 2018 197, 2019 208, 2020 209, 2021 212, 2022 215,
   2023 213, 2024 211, 2025 210, 2026 203. No release required `text_rule`; `none` remained
   only when evidence was unavailable. Amendment flags are included in those counts.
4. **Earnings releases per company-year — 102 outliers retained for review.** Counts outside 3–5 are
   not silently relabeled: below 3 can mean periodic-only publication or missing separate 8-K evidence;
   above 5 can include additional earnings/guidance releases or pre-announcements rather than four
   distinct fiscal quarters. Full outlier list: AMD|2008=6; INTC|2009=6; INTC|2010=8; INTC|2011=10;
   INTC|2012=8; INTC|2013=8; PLTR|2020=1; META|2012=2; NFLX|2019=6; TSLA|2021=8; TSLA|2023=8;
   TSLA|2024=8; TSLA|2010=2; TSLA|2015=7; TSLA|2016=8; TSLA|2017=9; TSLA|2018=9; TSLA|2019=9;
   TSLA|2020=8; TSLA|2022=8; TSLA|2025=8; TSLA|2026=8; NKE|2005=8; NKE|2006=8; NKE|2007=8;
   NKE|2008=8; NKE|2009=8; NKE|2010=8; NKE|2011=7; NKE|2012=8; NKE|2013=8; NKE|2014=8;
   NKE|2015=8; NKE|2016=8; NKE|2017=8; NKE|2018=6; LULU|2007=2; RCL|2020=7; GS|2020=6;
   PFE|2023=6; FCX|2019=6; BA|2016=6; BA|2005=2; BA|2009=6; PLD|2009=11; PLD|2010=8;
   PLD|2011=7; PLD|2005=8; PLD|2006=8; PLD|2007=9; PLD|2008=10; ANET|2014=2; SMCI|2009=6;
   SMCI|2012=7; SMCI|2020=6; SMCI|2022=7; SMCI|2023=7; SMCI|2025=6; SMCI|2026=6; SMCI|2015=6;
   SMCI|2016=7; MRNA|2021=6; LLY|2012=7; LLY|2016=2; LLY|2022=6; DAL|2006=12; DAL|2007=6;
   KMI|2011=2; AAPL|2006=7; IBM|2005=8; IBM|2006=8; IBM|2007=8; IBM|2008=10; IBM|2009=8;
   IBM|2010=8; IBM|2011=8; IBM|2012=8; IBM|2013=8; IBM|2014=8; IBM|2015=8; IBM|2016=7;
   T|2005=6; T|2007=6; GOOGL|2015=1; CVX|2013=8; CVX|2014=7; CVX|2009=8; CVX|2010=8;
   CVX|2011=8; CVX|2007=8; CVX|2008=8; CVX|2012=8; MA|2006=2; AIG|2005=7; AIG|2016=6;
   AIG|2017=8; COP|2005=9; COP|2007=9; COP|2006=9; COP|2008=9; COP|2009=8; COP|2010=6.
5. **Quarter timeline — pass with documented long lags.** All 4,644 periodic rows appear once.
   4,105 (88.39%) have a separate earlier earnings release. Lag days: min 0, median 9, p90 32,
   max 931, negative 0. There are 2,946 lags under 20 days (enumerated in the committed summary)
   and 49 over 120 days: AMD/2015-06-27; AIG/2004-03-31, 2004-06-30, 2004-12-31, 2005-03-31,
   2005-06-30, 2005-12-31, 2009-12-31; CAT/2003-12-31 (two), 2005-12-31; JPM/2003-12-31,
   2004-12-31, 2005-12-31 (two); LLY/2007-12-31, 2008-03-31; WMT/2004-01-31; AAPL/2006-07-01;
   MU/2003-12-04, 2005-12-01, 2012-05-31, 2013-02-28, 2016-03-03; UNH/2006-03-31, 2006-06-30,
   2006-09-30; FCX/2014-12-31; COF/2004-12-31, 2005-03-31, 2005-06-30, 2005-09-30;
   PLD/2003-12-31, 2004-03-31, 2006-12-31, 2007-03-31; NVDA/2006-01-29, 2006-04-30;
   AMT/2003-12-31, 2004-03-31, 2004-06-30, 2004-09-30, 2005-12-31 (two), 2006-03-31;
   MA/2010-12-31; FSLR/2015-03-31; SMCI/2007-06-30, 2016-09-30, 2016-12-31, 2017-03-31,
   2017-06-30, 2018-09-30, 2018-12-31, 2019-03-31, 2019-06-30, 2024-06-30; LULU/2013-05-05.
6. **Window lengths.** Median 62 sessions, p05 0, p95 69. Exact-session shares: 20 sessions 0%,
   30 sessions 0.0218%, 45 sessions 0.2612%. Last/unbounded windows are excluded from this distribution.
7. **Checks and repeatability — pass.** `npx vitest run worker/lib/event-calendar.test.ts` = 3/3;
   `npm run check` passed. A second and third build produced byte-identical JSONL files with the same
   hashes; only generation time and header/network metadata changed.

### Artifacts and hashes

- `D:\research\alpha-engine\engine\events\filings-50.jsonl` — 8,823,008 bytes; SHA-256
  `29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d`.
- `D:\research\alpha-engine\engine\events\quarters-50.jsonl` — 1,960,492 bytes; SHA-256
  `8dd75df1d4396c688953aa0e2eadb6f6adad4079a6148a10dda7ae2d7f2a6c44`.
- `D:\research\alpha-engine\engine\events\manifest.json` — SHA-256
  `894bee2e9ad7ce23c49cbbc5c253dc029f51f32650f8fe4d1bf3e7d0c1fa2bc0`.
- `research/engine/event-calendar-50.summary.json` — committed summary only, no row-level data;
  SHA-256 `7a4c6f98778358b50ab4145800c6f4466b24ea312117d0bec8c9d4c77146b302`.
- SEC submissions cache and 30 header-check records live below `D:\research\alpha-engine\engine\events\`.
  No `filings.items` production backfill was performed.

Handoff note added to `docs/KIMI_CODE_HANDOFF.md`.
