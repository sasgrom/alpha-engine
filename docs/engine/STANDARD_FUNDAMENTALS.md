# Standard fundamentals — how the series are built, checked and kept

The owner's order of 2026-11-12:
- **Step 1:** turn every company's raw SEC XBRL facts into one merged quarterly series per standard field, with typical names.
- **Step 2:** normalization, on his instructions.

This document is the process for step 1. With it, the build can be repeated for new quarters and for new companies, and the mistakes made on the way are not made again.

- **Code:** the lab repository `C:\dev\alpha-engine-lab\src\fundamentals\` and `tools\fundamentals\`.
- **Data:** `D:\research\alpha-engine\fundamentals\`.

## 1. What the series are

- **Fields:** 64 per company, named on the old database's (Tiingo's) statement codes, plus `goodwill` and `buybacks` (`fields.mts`). Each field lists the XBRL tags that carry it, in order of preference.
- **Tag expressions:** `A+B-C`, a sum of signed parts; `-Tag` negates; `custom:Name` is the company's own extension tag.
- **Identities:** used when no tag gives a value (for example gross profit = revenue − cost of revenue).
- **Quarters:** the company's own fiscal quarters, from its 10-Q/10-K period ends, plus the year of comparatives before its first XBRL filing. 52/53-week years and 12/16-week quarters align.
- **Values:** as filed, in original units. Flows are three-month figures:
  - the filed three-month figure, or year-to-date differences;
  - Q4 = the full year − nine months;
  - weighted share counts are differenced by days.
  - Nothing is scaled, smoothed or split-adjusted: that is step 2.
- **Point in time:** every version a filing gave is kept, as `[filed date, value, source]`.
  - Each quarter also carries the EDGAR acceptance time of its own 10-Q/10-K (US Eastern), so a test knows whether it came out before or after the close.
  - Source labels:
    - `t:` a three-month figure;
    - `y:` year-to-date differenced;
    - `x:` two tags' year-to-date figures across a tag switch;
    - `dN:` an identity.
- **One history across a change of registrant:** for example ExxonMobil's predecessor CIK 34088 is joined onto 2115436 (`TICKER_PRE` in the universe file).

## 2. Sources, and what each lacks

| Source | What it gives | What it lacks |
|---|---|---|
| SEC companyfacts (the local `facts` table, collector `worker/facts-fetch.mts`, daily) | Standard-tag facts of every filing, with exact period dates | Company extension tags. Many filings: in Nov 2026, 21 companies' recent 10-Qs (combined-registrant utilities and REITs, Citigroup), and new 10-Qs for one to two weeks (32 companies behind EDGAR on 2026-11-12). |
| SEC financial statement data sets (`fsds-fetch.mts`, `fsds-extract.py`; quarterly ZIPs since 2009) | Every number on the face of every 10-K/10-Q, extension tags included. The statement line each number sits on and its label (PRE). Acceptance time to the second (SUB). Co-registrant and axis/member rows. | Notes. The current quarter (a quarter is posted after it ends). Exact period dates (rounded to month ends). |
| The filing's own XBRL (`edgar-filings-fetch.mts`, `edgar-filings-parse.py`) | The newest filings neither source holds yet, with exact dates and extension tags | Only what is fetched: the latest 10-Q/10-K of a company when it is missing elsewhere |

The build merges them in this order:
1. **companyfacts** first; it keeps its exact dates.
2. **SEC data sets,** for filings companyfacts lacks.
3. **The filing's own XBRL,** for filings neither holds.

Where two sources share a filing they give the same numbers. `checks.py` verifies this over every quarter.

## 3. The steps, with commands

Run from `C:\dev\alpha-engine` unless noted. Raw data stays on D:, and every step is resumable.

Sizes on 2026-11-12:

| Folder | Size |
|---|---|
| `fsds\raw` | 5.4 GB |
| `fsds\extract` | 2.5 GB |
| `edgar-filings` | 200 MB |
| one build (`standard\vN`) | about 65 MB |

| # | Step | Command | Time | Output |
|---|---|---|---|---|
| 1 | companyfacts into the local `facts` table | existing scheduler job `facts-fetch-daily` / `sp500-facts-daily` | daily | MySQL `facts` |
| 2 | SEC data sets: download | `npx tsx C:/dev/alpha-engine-lab/src/fundamentals/fsds-fetch.mts` | 23 min the first time, then one file a quarter | `fsds\raw\YYYYqN.zip`, `manifest.json` (SHA-256) |
| 3 | SEC data sets: our companies | `python -I C:/dev/alpha-engine-lab/src/fundamentals/fsds-extract.py [quarter …]` | about 35 s a quarter; two processes on different quarters may run at once | `fsds\extract\<quarter>\<cik>.json` and `_summary.json` |
| 4 | The newest filings missing from both | `npx tsx …/edgar-filings-fetch.mts`, then `python -I …/edgar-filings-parse.py` | a minute | `edgar-filings\<cik>\<accession>\` (instance, header, `meta.json`, `rows.json`) |
| 5 | Build | `npx tsx …/build.mts [cik …]`, output folder `STANDARD_DIR` (default `standard\v2\`) | about 4 min for 502 companies | `company\<cik>.json`, `index.json`, `coverage.json`, `build.log` |
| 6 | QA | `npx tsx …/qa.mts` (same `STANDARD_DIR`) | 1 min | `qa.json`: coverage, identities, signs, jumps |
| 7 | Checks against the filings and EDGAR | `python -I …/checks.py <standard dir>` | 2 min | `checks.json` |
| 8 | Compare with the previous build | `python -I …/compare.py <previous dir> <new dir>` | 2 min | `compare-<previous>.json` |
| 9 | Review workbook | `python …/tools/fundamentals/review-workbook.py <out.xls> <dir> <previous dir>` (`XLWT_PATH` = a folder holding xlwt) | 1 min | `.xls` |

Step details:
- **Step 3 checkpoints:** a quarter is reused only when its summary matches the extractor's code hash, the ZIP's SHA-256 and the company list. Changing the company list, or the script (Git's CRLF conversion counts as a change), re-extracts every quarter, about 45 minutes.
- **Step 4:** fetches the latest EDGAR 10-Q/10-K of a company (from the companyfacts collector's manifest) when its accession is in neither source.
- **Steps 3–8:** read only, apart from their own outputs.
- **Production:** no step writes to MySQL production. Loading into MySQL is section 8.

## 4. The rules inside the build (`build.mts`)

- **Calendar:**
  - A filing's main period is the latest duration end it reports with at least three concepts.
  - Filings within 10 days are one quarter.
  - The quarter number comes from the filing's fiscal period, or else from the spacing to the next fiscal year end.
- **Same-basis year-to-date differences:** the earlier year-to-date figure is taken as known when the later one was filed, and filed within 400 days before it. Without this, a full year restated years later for a spin-off was set against an old nine-month figure, which gave COP, FE and EXC negative fourth quarters.
- **Mislabelled periods:** a quarter equal to its own full year in the same filing, while another quarter of that year is not zero, is set aside. This applies to steady income and cash-flow tags only.
  - 577 figures in 63 companies, for example HSIC 2019 and NiSource Q4 2024–2025.
  - The first version also dropped Apple's legitimate $53M interest expense. The fix was to require a year of 300+ days and another nonzero quarter.
- **Tag order per company:**
  - Tags filed for four quarters or more come first; rarely used tags only fill gaps.
  - Then the year-to-date figures of two tags across a tag switch.
  - Then identities.
- **Revenue:**
  - It takes the largest revenue tag, because some companies use plain `Revenues` for net revenue (C.H. Robinson since 2018).
  - It takes that largest only among the tags the filing prints on its income statement. A bigger "revenue" in the notes (Republic Services' revenue before eliminations, utilities' revenue including pass-through taxes, Hasbro) is not the statement's revenue.
- **Banks:**
  - Revenue = net interest income + non-interest income (`derive`, `compete`).
  - It may replace only a tag listed in `parts` (fee or lease revenue), never a bank's own total line.
  - The first version took interest income + non-interest income (gross) for 13 financial companies.
- **Impossible values:** for fields marked `positive` (total assets and share counts), a zero or negative value is passed over for the next tag. Examples: a share class with 0 shares on the cover page; negative weighted shares from year-to-date differences.
- **Company-specific tags (`overrides.json`):**
  - **Order:** per company and field, tags tried either as a fallback (the default: only where the field's own tags give nothing) or first (a standard tag with another scope for that company), optionally limited to a range of quarter ends.
  - **Evidence:** every entry carries the statement line and the values that tie.
  - **Example:** General Dynamics' cost of sales since 2020 is tagged only by product and service, so it is `CostsAndExpenses-GeneralAndAdministrativeExpense`.
  - **Example:** NextEra's capex is on its own tags, `-custom:CapitalExpendituresOfFPL-custom:IndependentPowerInvestments`.

## 5. Acceptance gates

Every new build is accepted only when all of these hold.

| Gate | Tool | Threshold | v2 (2026-11-12) |
|---|---|---|---|
| Our first-reported values equal each filing's own numbers (same tag, period, duration) | `checks.py` | at least 99.98% for every field; each difference explained | 99.98–100%. The 23 differences are filer mislabels the data sets copy (NiSource, Tractor Supply, Kinder Morgan and others), Mosaic's 2013 fiscal-year change, and J.B. Hunt's rounded duplicate. |
| Latest filing = EDGAR's latest 10-Q/10-K | `checks.py` | 0 companies behind | 0 |
| Revenue is the income statement's largest printed revenue line | `checks.py` | not below the previous build | 96.1%; 2.2% bank identity (no total line); 1.1% not printed (44 companies) |
| No regression against the previous build | `compare.py` | 0 broken filing matches; removals only of impossible values; every change explained | — |
| QA identities, signs, jumps | `qa.mts` | not worse than the previous build | gross profit identity off 4.8%; cash change off 2.2%; signs off 0.2% |
| Coverage per field from 2010 | `qa.mts` | not below the previous build | revenue 98.7%, net income 98.4%, total assets 98.4%, operating cash flow 99.1%, capex 91.1%, debt 83.1% |

## 6. Lessons learned (do not repeat)

- **companyfacts drops filings and lags.**
  - Its downloads for 21 companies lacked months of 10-Qs, most of them combined-registrant filers.
  - New 10-Qs were missing for 1–2 weeks after the collector had re-downloaded.
  - The collector recorded success anyway. Always check freshness against EDGAR's filing list (`checks.py`).
- **The SEC data sets round dates to month ends.**
  - Take the exact period end from the instance file's name (`nvda-20260726_htm.xml`), matching only real dates; other 8-digit numbers occur in names.
  - Otherwise use the nearest end the company is known to use, within 16 days.
  - The data sets write per-share amounts with the unit `USD`, not `USD/shares`.
- **A filing may tag one number twice at different precision** (a summary table in billions next to the statement in units). Keep the most precise; SEC does.
- **Filers mislabel periods** (a full year tagged as a quarter). The data sets copy such mistakes: a difference against them is not automatically ours.
- **Some totals are only tagged by part.** General Dynamics' cost of sales since 2020 exists only by product and service. Use an identity of tagged lines, or an override.
- **Banks have no total-revenue line on the face of the statement**, so a check by label sees a fee line. Their revenue is the identity.
- **The largest tag is not always the statement's figure.** Take the largest among the lines the statement prints.
- **Restatements:** never set a restated year against an old nine-month figure (same-basis rule).
- **Built server:** code bundled into the server (`dist/boot.js`) must not take the repository root from `import.meta.dirname`.
- **WebFetch cannot read SEC's PDF documentation.** Save it and read it with the PDF reader.
- **Windows:** Git's CRLF conversion changes a script's hash. Do not let it touch `fsds-extract.py` without expecting a full re-extraction.

## 7. New quarters, and new companies

**New quarters (incremental):**
- **Daily:**
  - the companyfacts collector (scheduler);
  - for filings EDGAR lists that companyfacts lacks, step 4 (fetch and parse the filing's XBRL).
- **Once a quarter,** when SEC posts the new data-set file (early in the next quarter): step 2 (only the new file is fetched) and step 3 (only the new quarter is extracted).
- **Then:**
  1. Rebuild (step 5; about 4 min for all companies).
  2. Run QA, checks and compare against the stored version (steps 6–8).
  3. Load only the new and changed rows into MySQL (section 8).
- **What a rebuild changes:** new quarters, and new versions of old quarters (restatements, kept as versions). Old versions never change.

**New companies (historical upload):**
1. Add them to the universe file and let the companyfacts collector fetch them.
2. Re-run step 3: the company list changed, so all quarters are re-extracted, about 45 minutes.
3. Run steps 5–8.
4. Review the new companies' gaps (series that stop, own tags) and add `overrides.json` entries with evidence.
5. Load them.

## 8. Keeping the series in MySQL (proposal; a new table needs the owner's review)

The cleaned series become static MySQL data: computed once, then extended with new quarters.

**Tables:**

`std_fundamentals`, one row per company, field, quarter and filed version:

| Column | Type / meaning |
|---|---|
| `cik` | INT |
| `field` | VARCHAR(32) |
| `quarterEnd` | DATE |
| `filed` | DATE |
| `value` | DOUBLE |
| `source` | VARCHAR(160), the source label |
| `buildVersion` | VARCHAR(16) |

Primary key: `(cik, field, quarterEnd, filed)`. Index: `(field, quarterEnd)`.

`std_fundamental_quarters`, one row per company quarter:

| Column | Meaning |
|---|---|
| `cik` | |
| `quarterEnd` | |
| `quarterStart` | |
| `fiscalYear` | |
| `fiscalQuarter` | |
| `filed` | |
| `acceptedAt` | DATETIME, US Eastern |
| `form` | |
| `registrant` | |

Primary key: `(cik, quarterEnd)`.

`std_fundamental_builds`, one row per load:

| Column |
|---|
| `buildVersion` |
| `createdAt` |
| `codeCommit` |
| `inputs` (JSON: data-set manifest hash, companyfacts as-of date, overrides hash) |
| `gates` (JSON: the section 5 numbers) |

**Loading:**
- Inserts only, in batches of at most 500 rows.
- A rebuild inserts only versions not yet stored.
- A stored version is never updated. If a value of a stored (cik, field, quarter, filed) differs, the load stops and reports it.

**Gates before any load:** section 5. Local MySQL first; production only by the owner's reviewed sync.

## 9. Company-specific mappings (K14)

Filled by K14: the method, the counts, and the patterns and traps found while mapping each company's own lines.
