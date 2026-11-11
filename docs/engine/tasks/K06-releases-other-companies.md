# K06 — Release calendar and release documents for the other S&P 500 companies

Prep task for Kimi Code. Context: [`../DESIGN.md`](../DESIGN.md) sections 1.3 and 2, and
[`K01-event-calendar.md`](K01-event-calendar.md), whose procedure this task repeats on more companies.

**Status: approved by the owner by name on 2026-11-11** ("go ahead with work, put kimi to work!",
in answer to the line naming this file). It runs after K03 is delivered: one task at a time.

## Goal

The engine's one confirmed effect (the reaction to an earnings release) needs only prices and the
exact time of each release. Prices for about 500 companies are already loaded (K02). This task
gives the engine the same timeline K01 produced for the research-50, for every other company that
has both filed figures and a price series, and puts each earnings release on disk so that the
guidance pass can read it.

Two uses, in this order of importance:

1. run engine version 1 unchanged on companies it has never seen (about ten times the decisions);
2. feed the releases to the local model's guidance pass after the research-50 are done.

## LLM use

None. Ordinary code only: SEC metadata requests, downloads, string matching, date arithmetic. Do
not send any document to a model, cloud or local. Do not read documents into the agent session,
except a handful of small samples needed as unit-test fixtures.

## Companies

Every CIK that has rows in local `facts` and a `prices` series with `source = 'stooq'`, and is not
in `worker/research-universe-50.json`. Expected: about 450. Write the list once to
`D:\research\alpha-engine\engine\events\universe-rest.json` (`cik`, `ticker`, `name`) and report
its size and any company that has figures but no price series (or the reverse). CIK is the company identity
key; `ticker` comes from `prices.ticker` for `source='stooq'`, not from the registry's preferred-share or
secondary symbol. The summary retains every registry-to-traded-symbol correction and rejects ambiguous
multiple-ticker mappings for one CIK.

## Steps

1. **Filing metadata.** For each company, every 8-K, 10-Q and 10-K (and /A) since 2005-01-01 from
   the SEC submissions API including its older pages: accession, form, filing date, report date,
   acceptance time, items, primary document. Same access rules as K01: declared User-Agent, at most
   8 requests per second, bounded retries, resumable per company.
2. **Calendar.** Build `filings-rest.jsonl` and `quarters-rest.jsonl` with exactly the fields and
   rules of the delivered `filings-50.jsonl` and `quarters-50.jsonl`, including the four timeline
   corrections made after the first K01 delivery. Parameterize `scripts/build-event-calendar.mts`
   by universe file and output suffix; the research-50 outputs must stay byte-identical.
3. **Release documents.** For every filing that the calendar marks as an earnings release, download
   its exhibits into `worker/cache/edgar/<cik>/` with the existing fetcher and naming
   (`<accession>.ex-<name>.htm`, `manifest.json`). Earnings releases only: no 10-Q, 10-K or other
   8-K bodies in this task.

## Order of work, so that partial results are usable

Process companies in descending order of their number of `facts` rows (largest histories first),
and finish steps 1 to 3 for one company before starting the next. After every company, rewrite
`quarters-rest.jsonl` atomically and append the company to `progress-rest.json`. A reader may use
the files at any moment; companies not yet listed there are simply absent.

Pilot before the long run: the first 20 companies. Report for them the number of quarters, the
share of quarters with an earnings release paired, the K01 acceptance checks, the bytes downloaded
and the seconds taken, and the projected totals for all companies. Continue to the full list only
if every K01 check passes on the pilot and the projected download fits on D: with at least 100 GB
left free; otherwise stop and report.

## Deliverables

Under `D:\research\alpha-engine\engine\events\` (outside Git): `universe-rest.json`,
`filings-rest.jsonl`, `quarters-rest.jsonl`, `progress-rest.json`, `manifest-rest.json` (counts,
hashes, code commit, start and end time). In Git: the parameterized builder with its tests, and a
summary `research/engine/event-calendar-rest.summary.json` (counts per company, check results).

## Acceptance checks

1. Every K01 acceptance check, per company, with the K01 thresholds.
2. Research-50 outputs unchanged (same SHA-256 as before this task).
3. For 30 randomly chosen quarters (seeded), the acceptance time of the earnings release equals
   the time on the filing's SEC index page.
4. Every earnings release in `quarters-rest.jsonl` either has at least one exhibit file on disk or
   is listed with a reason in the summary.
5. The usual gates: `npm run check`, `npm test -- --run`, `npm run build`, `git diff --check`.

## Out of scope and stop conditions

- Everything this task collects goes to D: (documents through the `worker\cache` junction, the
  calendar files under `D:\research\alpha-engine\engine\events\`). C: is the small system disk
  (owner's reminder of 2026-11-11): nothing new there except source code and the small summary file.
- No database writes: the existing fetcher keeps its filing list in per-company `manifest.json`
  files, and the calendar is built from those and from the SEC metadata. No schema change; nothing
  to production; no scheduler or registry change.
- No model calls. No GDELT. Raw documents stay on D: behind the existing junction.
- Stop and report instead of improvising if the SEC throttles for more than 15 minutes, if a
  company's submissions pages are inconsistent with K01's assumptions, or if disk space falls
  under the limit above.

## Delivery report — 20-company pilot complete; full run stopped for owner decision

**Traded-symbol correction (2026-11-11):** current artifacts use `prices.ticker` for `source="stooq"`.
The correction section at the end supersedes registry/preferred-share labels and artifact hashes in the
original report below; the underlying pilot acceptance counts are unchanged.

Implemented in `scripts/build-release-calendar-rest.mts`, with shared calendar rules in
`worker/lib/event-calendar.ts` and REST helpers in `worker/lib/event-calendar-rest.ts`.
`scripts/build-event-calendar.mts` now accepts `--universe`, `--suffix`, `--from` and `--check`; defaults
remain research-50. Builder source commit: **`2b8cbda881612e75475153a410878b693629cb6c`**.
No model call, database write, production action, schema change, scheduler change or new service occurred.
Only SEC metadata and earnings-release exhibits were downloaded; no primary 10-Q/10-K or other 8-K bodies
were fetched. Existing per-company manifest fields were preserved.

### Acceptance checks

1. **Every K01 check on every pilot company — pass (20/20).** The universe has **446** eligible CIKs;
   `factsWithoutStooq=[]` and `pricesWithoutFacts=[]`. The pilot is the first 20 in descending fact-count
   order. It contains **11,534 filings**, **1,750 original-period quarters**, and **2,116 earnings releases**.
   All **11,534/11,534** filings have acceptance timestamps and all **9,717/9,717** 8-Ks have item lists.
   Originals since 2005: **1,750/1,750** represented exactly once; duplicate company-periods **0**;
   non-increasing next publications **0**; negative lags **0**; earliest-release selection **true**.
   Separate earlier releases: **1,663/1,750 = 95.0286%**. Lag days: min **0**, median **18**, p90 **38**,
   max **176**. Multiple-release quarters since 2009-06: **144**, with **1,909** retained earnings-filing
   links; the earliest remains the chosen release.
2. **Research-50 unchanged — pass.** `npx tsx scripts/build-event-calendar.mts --check` rebuilt both outputs
   in memory and reported `byte_identical` without overwriting them. `filings-50.jsonl` is **8,823,008 bytes**,
   SHA-256 `29bf87c5ba943b691215825ad611e3945ef6b2de33c2ac8f19b0808faf26716d`;
   `quarters-50.jsonl` is **2,264,505 bytes**, SHA-256
   `35e11fc013b935c0457771759248a401895c7e8aa64fcdea42cbfcba8ff2a21f`.
3. **Seeded SEC index check — pass.** **30/30** sampled earnings quarters had `earningsAcceptedEt` exactly
   equal to the SEC index-page acceptance time; **0 failures**. Evidence and code-hash lineage are under
   `D:\research\alpha-engine\engine\events\index-checks-rest\`.
4. **Exhibit coverage — pass with 26 explicit exceptions.** **2,090** releases have at least one exhibit
   on disk. The other **26** are individually listed in `exhibitExceptions` with CIK, ticker, accession,
   `status="no_exhibit"` and the reason `No substantive earnings exhibit in the filing index`. There are
   **0 releases without an outcome and 0 unexplained missing exhibits**. All cached exhibit files are checked
   by byte count and SHA-256 before reuse. The 26 accessions are:
   - MET-PF: `0001193125-14-180174`, `0001193125-17-234225`, `0001193125-18-043518`.
   - BNY-PK: `0001193125-16-430028`.
   - WFC-PZ: `0000072971-16-000967`, `0000072971-18-000307`, `0001193125-09-027231`.
   - FITB-PM: `0001193125-13-320588`, `0001193125-15-183207`.
   - MS-PQ: `0000905148-05-002330`, `0000950103-15-001485`.
   - PRS: `0001193125-10-028108`.
   - HBANZ: `0001299933-06-006587`, `0001299933-07-004082`.
   - KEY-PL: `0000950152-08-003064`.
   - AES: `0000874761-14-000038`, `0000874761-16-000091`, `0000874761-18-000002`, `0001104659-07-020466`.
   - STT-PG: `0001104659-09-002906`.
   - ELV: `0001193125-14-009489`, `0001193125-15-008817`, `0001193125-16-427226`, `0001193125-17-006246`.
   - PNC: `0000713676-17-000017`, `0000713676-19-000020`.
5. **Gates and repeatability — pass.** Targeted calendar tests **14/14**, full suite **189 files / 1,042 tests**,
   scripts suite **8 files / 39 tests**, forced TypeScript build, production build and `git diff --check` pass.
   Consecutive cached runs each report **20 cache hits / 0 companies reprocessed**. An independently saved
   hash baseline and a later cached run produced byte-identical universe/filing/quarter artifacts. Only
   generation-time fields changed. Checkpoints bind the code hash, SEC submissions and SPY calendar; index
   evidence also binds the parser code hash.

### Per-company counts and checks

`Earlier release` is the K01 separate-earlier-release pairing. Seconds are cumulative company processing
time across the smoke, pilot and reporting resume; resumed checkpoint time is not added again.

| Company | Filings | Quarters | Earlier release | Releases | Bytes downloaded | Seconds | Checks |
|---|---:|---:|---:|---:|---:|---:|---|
| C-PR | 896 | 88 | 86/88 (97.73%) | 108 | 887,632,632 | 124.001 | pass |
| MET-PF | 682 | 88 | 88/88 (100.00%) | 148 | 440,767,689 | 88.187 | pass |
| BNY-PK | 455 | 78 | 78/78 (100.00%) | 114 | 242,167,352 | 62.449 | pass |
| WFC-PZ | 1,492 | 88 | 88/88 (100.00%) | 95 | 255,490,803 | 59.659 | pass |
| FITB-PM | 769 | 88 | 88/88 (100.00%) | 90 | 211,086,881 | 52.618 | pass |
| MS-PQ | 424 | 88 | 85/88 (96.59%) | 89 | 261,736,042 | 65.308 | pass |
| MER-PK | 520 | 88 | 88/88 (100.00%) | 93 | 446,159,819 | 72.098 | pass |
| PRS | 542 | 88 | 88/88 (100.00%) | 116 | 354,629,857 | 66.199 | pass |
| USB-PS | 510 | 88 | 88/88 (100.00%) | 89 | 79,831,453 | 39.309 | pass |
| RF-PF | 572 | 88 | 88/88 (100.00%) | 91 | 246,512,884 | 57.541 | pass |
| HBANZ | 587 | 88 | 86/88 (97.73%) | 92 | 191,849,815 | 60.617 | pass |
| KEY-PL | 405 | 88 | 87/88 (98.86%) | 90 | 68,708,099 | 48.815 | pass |
| AES | 411 | 88 | 18/88 (20.45%) | 89 | 46,293,145 | 28.163 | pass |
| STT-PG | 478 | 88 | 88/88 (100.00%) | 97 | 225,667,291 | 57.629 | pass |
| MTB-PL | 398 | 88 | 88/88 (100.00%) | 90 | 145,986,087 | 33.643 | pass |
| GE | 437 | 88 | 80/88 (90.91%) | 92 | 70,945,662 | 31.584 | pass |
| TFC-PR | 538 | 88 | 88/88 (100.00%) | 90 | 211,644,977 | 58.729 | pass |
| ELV | 422 | 88 | 87/88 (98.86%) | 96 | 32,977,351 | 31.547 | pass |
| PNC | 614 | 88 | 88/88 (100.00%) | 257 | 234,185,934 | 99.765 | pass |
| NTRSO | 382 | 88 | 88/88 (100.00%) | 90 | 67,584,031 | 31.267 | pass |

### Form and year counts

| Year | 8-K | 8-K/A | 10-Q | 10-Q/A | 10-K | 10-K/A |
|---|---:|---:|---:|---:|---:|---:|
| 2005 | 429 | 13 | 55 | 0 | 19 | 2 |
| 2006 | 418 | 6 | 59 | 6 | 19 | 4 |
| 2007 | 450 | 9 | 59 | 5 | 19 | 3 |
| 2008 | 501 | 8 | 60 | 4 | 20 | 2 |
| 2009 | 540 | 7 | 60 | 6 | 20 | 0 |
| 2010 | 420 | 3 | 60 | 7 | 20 | 3 |
| 2011 | 471 | 10 | 60 | 0 | 20 | 2 |
| 2012 | 514 | 6 | 60 | 3 | 20 | 2 |
| 2013 | 493 | 7 | 60 | 0 | 20 | 1 |
| 2014 | 457 | 5 | 60 | 0 | 20 | 1 |
| 2015 | 498 | 12 | 60 | 2 | 20 | 2 |
| 2016 | 536 | 12 | 60 | 4 | 20 | 1 |
| 2017 | 502 | 7 | 60 | 0 | 20 | 2 |
| 2018 | 466 | 9 | 60 | 0 | 20 | 0 |
| 2019 | 498 | 8 | 60 | 0 | 20 | 0 |
| 2020 | 421 | 8 | 60 | 0 | 20 | 0 |
| 2021 | 353 | 7 | 60 | 1 | 20 | 0 |
| 2022 | 316 | 11 | 60 | 0 | 20 | 0 |
| 2023 | 314 | 5 | 60 | 3 | 20 | 0 |
| 2024 | 321 | 10 | 60 | 0 | 20 | 0 |
| 2025 | 332 | 2 | 60 | 0 | 20 | 1 |
| 2026 | 297 | 5 | 60 | 0 | 20 | 0 |
| **Total** | **9,547** | **170** | **1,313** | **41** | **437** | **26** |

All earnings flags use `item_2.02`: **2,100 8-K** and **16 8-K/A** releases.

### Company-year and window outliers

There are **68 company-year outliers**, all above five Item 2.02 filings and none below three. These years
contain additional results-related publications, not a forced single release per quarter. Multiple-release
quarters remain explicit in `earningsFilings[]`; metadata alone does not prove that each additional filing is
a separate fiscal-quarter result rather than a guidance/update/amendment. Complete outliers:

- C-PR: 2009=8, 2010=6, 2012=6, 2013=7, 2014=9.
- MET-PF: 2018=8, 2005=6, 2006=7, 2007=6, 2008=8, 2010=7, 2011=6, 2019=8, 2020=8, 2021=8, 2022=8, 2012=10, 2013=6, 2014=8, 2015=7, 2016=8, 2017=7.
- BNY-PK: 2008=8, 2009=9, 2010=8, 2011=10, 2012=11, 2013=8, 2015=6.
- WFC-PZ: 2018=7, 2009=7.
- MER-PK: 2013=6.
- PRS: 2025=7, 2026=9, 2007=6, 2008=6, 2011=6, 2012=8, 2014=7, 2015=6.
- HBANZ: 2025=6, 2008=6.
- KEY-PL: 2008=6.
- AES: 2006=6, 2007=6.
- STT-PG: 2009=6, 2010=6.
- ELV: 2014=6, 2015=6.
- PNC: 2017=12, 2018=9, 2019=10, 2020=8, 2021=8, 2022=8, 2024=6, 2007=18, 2005=17, 2006=17, 2008=13, 2009=16, 2010=19, 2011=15, 2012=16, 2013=15, 2014=13, 2015=12, 2016=11.

Window sessions across **1,730** bounded windows: median **62**, p05 **55**, p95 **67**; shares holding at
least 20/30/45 sessions are **99.8844% / 99.8266% / 98.6127%**. From 2009-06 (**1,380** windows): median
**62**, p05 **57**, p95 **67**, with shares **100% / 99.9275% / 99.5652%**.

The one window below 20 calendar days is AES `2005-09-30`: `2006-01-19T06:11:51` →
`2006-01-19T06:13:49` (**0 calendar days**), retained because two results-related publications occurred on
one day. The four above 120 are MS-PQ `2008-11-30` (**126**), AES `2005-06-30` (**176**), AES `2006-03-31`
(**126**) and AES `2007-09-30` (**129**). They are preserved in the summary rather than clipped or hidden.

### Time, bytes and full-run projection

- Initial 20-company run wall time: **996.117 seconds**; cumulative per-company processing after the
  evidence-reporting resume: **1,169.128 seconds**. The final cached comparison took **18.741 seconds**.
- New bytes downloaded: **4,721,857,804**; exhibit bytes on disk: **4,721,857,804**. Code-hash resumes retain
  these totals instead of dropping or double-counting them.
- Remaining 426 companies, projected from the pilot's exhibit bytes on disk: **100,575,571,225 bytes** and
  **24,902.4264 seconds** (about **6.92 hours**). Projected full-universe exhibit total is
  **105,297,429,029 bytes**.
- Projected free space after that remaining work: **624,944,354,023 bytes**, above the required
  **107,374,182,400 bytes (100 GiB)**. `storagePass=true`.
- Manifest start: `2026-11-11T10:40:43.983Z`; final cached run end: `2026-11-11T11:14:20.705Z`.

**The remaining 426 companies were not started.** Passing the pilot and the storage guard does not authorize
the long extraction. A separate explicit owner decision is required before `--limit 446` or any equivalent
full-list invocation.

### Artifacts and hashes

Builder code hash: `be36150bbd666cc3941fe5f4997f79bfdb3da964c6071b6c875d072d054f159b`.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `D:\research\alpha-engine\engine\events\universe-rest.json` | 33,744 | `8c5aec546a72924aaed0cb3f094035a726584bd955878e2c123aff9437e5cbf5` |
| `D:\research\alpha-engine\engine\events\filings-rest.jsonl` | 5,757,634 | `7cb028bbaac76ff60afc67e78f6d3b949152b84770eb25472ccae65fcd690f02` |
| `D:\research\alpha-engine\engine\events\quarters-rest.jsonl` | 910,774 | `2bf4e386eff334c6d81e11c5efad65893fea37e1a9d0e836d9351615167fe9c3` |
| `D:\research\alpha-engine\engine\events\progress-rest.json` | 5,173 | `8c69c6be88a9b70d8ee71697ea2ed78c786ff5809d6413da7c84b6c9e37519cb` |
| `research/engine/event-calendar-rest.summary.json` | 62,986 | `814cb89161608dd4ed0b50105d5137e2e377dedb59662ed2aba042cef456ce5e` |
| `D:\research\alpha-engine\engine\events\manifest-rest.json` | 1,826 | `a9341d323b05236116caec7d1fb2728d4a8af482ec49a64472be4970aeac06ab` |

Atomic per-company checkpoints are in `D:\research\alpha-engine\engine\events\rest-companies\`. The summary
contains every company's full K01 metrics, all exhibit exceptions, index-check rows, universe gaps, form/year
counts and projection. The progress file is rewritten after each company so completed work is usable after
an interruption or D: remount. `productionWrite=false` and `databaseWrite=false` are recorded in both the
summary and manifest.

## Traded-symbol correction — 2026-11-11

Claude's pilot review found that the registry's preferred-share/secondary symbols could not join reliably to
the common-share price series. The database check confirmed **66 CIKs** whose registry and Stooq tickers differ.
Commit **`7b466c9d7471b8a383d59d789823fec6f6ef205a`** changes `universe-rest.json`, `filings-rest.jsonl` and
`quarters-rest.jsonl` to use `prices.ticker` for `source="stooq"`; CIK remains the identity key. A guard rejects
multiple Stooq symbols for one CIK. `universeEvidence.tickerSource="prices.stooq.ticker"` and all 66
registry-to-traded-symbol corrections are retained in the committed summary. Checkpoint input now binds the
traded ticker as well as SEC submissions, SPY dates and the code hash.

Every one of the **11,534 filings** and **1,750 quarters** was checked against the corrected universe mapping.
All 20 company checks and the original acceptance results still pass, including **30/30** index-time matches,
**2,090** releases with exhibits and **26** explicit exceptions. Downloaded/on-disk bytes remain
**4,721,857,804**; valid exhibits were not redownloaded. Research-50 hashes remain unchanged.

### Corrected per-company labels and counts

| Company | Filings | Quarters | Earlier release | Releases | Bytes downloaded | Seconds | Checks |
|---|---:|---:|---:|---:|---:|---:|---|
| C | 896 | 88 | 86/88 (97.73%) | 108 | 887,632,632 | 131.169 | pass |
| MET | 682 | 88 | 88/88 (100.00%) | 148 | 440,767,689 | 91.469 | pass |
| BNY | 455 | 78 | 78/78 (100.00%) | 114 | 242,167,352 | 65.787 | pass |
| WFC | 1,492 | 88 | 88/88 (100.00%) | 95 | 255,490,803 | 66.607 | pass |
| FITB | 769 | 88 | 88/88 (100.00%) | 90 | 211,086,881 | 54.666 | pass |
| MS | 424 | 88 | 85/88 (96.59%) | 89 | 261,736,042 | 72.315 | pass |
| BAC | 520 | 88 | 88/88 (100.00%) | 93 | 446,159,819 | 77.203 | pass |
| PRU | 542 | 88 | 88/88 (100.00%) | 116 | 354,629,857 | 69.588 | pass |
| USB | 510 | 88 | 88/88 (100.00%) | 89 | 79,831,453 | 40.911 | pass |
| RF | 572 | 88 | 88/88 (100.00%) | 91 | 246,512,884 | 59.243 | pass |
| HBAN | 587 | 88 | 86/88 (97.73%) | 92 | 191,849,815 | 62.273 | pass |
| KEY | 405 | 88 | 87/88 (98.86%) | 90 | 68,708,099 | 50.043 | pass |
| AES | 411 | 88 | 18/88 (20.45%) | 89 | 46,293,145 | 29.227 | pass |
| STT | 478 | 88 | 88/88 (100.00%) | 97 | 225,667,291 | 63.366 | pass |
| MTB | 398 | 88 | 88/88 (100.00%) | 90 | 145,986,087 | 34.881 | pass |
| GE | 437 | 88 | 80/88 (90.91%) | 92 | 70,945,662 | 32.794 | pass |
| TFC | 538 | 88 | 88/88 (100.00%) | 90 | 211,644,977 | 60.743 | pass |
| ELV | 422 | 88 | 87/88 (98.86%) | 96 | 32,977,351 | 32.524 | pass |
| PNC | 614 | 88 | 88/88 (100.00%) | 257 | 234,185,934 | 105.268 | pass |
| NTRS | 382 | 88 | 88/88 (100.00%) | 90 | 67,584,031 | 32.541 | pass |

The 68 company-year outliers have the same counts with these traded labels (C, MET, BNY, WFC, BAC, PRU,
HBAN, KEY, AES, STT, ELV and PNC); the complete current list is in `overall.checks.companyYearOutliers` in
the summary. The original outlier and form/year counts are unchanged.

### Corrected artifact and verification evidence

Builder code hash: `05d6a83426b81d2be7f1907375f9f5a538ba15332d2ad72383a8634acb43814e`.
Final cached run: `2026-11-11T11:34:25.034Z`. Cumulative company processing after the correction:
**1,232.618 seconds**; final cached comparison: **17.933 seconds**. Remaining-426 projection:
**100,575,571,225 bytes**, **26,254.7634 seconds**, projected free **624,944,181,991 bytes** versus the
100 GiB minimum. `storagePass=true`.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `D:\research\alpha-engine\engine\events\universe-rest.json` | 33,606 | `f6d828f039078e5ea2c45af30a8092fc271522af523b8b97ef52c06eaece6fff` |
| `D:\research\alpha-engine\engine\events\filings-rest.jsonl` | 5,732,248 | `3b1174cbdf16336dd5bfedbfec26a1e2fb837466e07e9b80c1d9e33489ff4a1c` |
| `D:\research\alpha-engine\engine\events\quarters-rest.jsonl` | 907,196 | `c6febb5aeef9904384159bf10d83766e0c3dec01e232d6d39862510841c705e6` |
| `D:\research\alpha-engine\engine\events\progress-rest.json` | 9,686 | `f7eba3d779222c5dda999508620629ecd7dc5545222e1963b9695461e9e5ebc0` |
| `research/engine/event-calendar-rest.summary.json` | 67,213 | `e5ec5d24a7f570f8c47644a9452f82fbae0c7e7a8fb2e266ef2faa237199934c` |
| `D:\research\alpha-engine\engine\events\manifest-rest.json` | 1,826 | `31e2a19ce8d2f5d0f0211ba95c4d446e7ed9fd5a3dd0e32686b5a7c839f403a4` |

A saved hash baseline and a later cached run are byte-identical for universe/filings/quarters, with **20 cache
hits / 0 reprocessed**. Verification: **15 targeted tests**, **189 files / 1,043 full-suite tests**, **39**
scripts tests, forced TypeScript, production build and `git diff --check` pass. Scheduler-generated changes
to `public/reports/company-exposures.json`, `.md` and `src/data/analytics-snapshot.ts` were left untouched
and excluded from both correction commits.

The remaining **426 companies were not started**. This correction does not change the requirement for an
explicit owner decision before the long extraction.
