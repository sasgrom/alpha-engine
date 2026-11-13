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
- **Restated basis (added after K14 Stage A):** a filing that restates broadly stands on a new basis. Examples: a business moved to discontinued operations, or a merger that replaces the history. For share counts, a stock split does the same. Its year-to-date figure is not differenced with an earlier filing's figure on the old basis when that would move the quarter by more than 5% of its value.
  - **Broad:** at least 15% of the filing's prior-year figures that were reported before have moved by more than 2%, sign flips aside.
    - In a sample of 47 companies' filings, 76% move under 5% and 8% move 20% or more.
    - Typical values: BAX's Q3 2024 10-Q 49%, WMB's 2011 10-K 20%.
    - A line moved between two tags is not broad: UNP's Q2 2019 10-Q moved 720m of its 2018 repurchases to a second tag, which is 1%.
    - Share counts skip this test, because a split moves only the share figures. Instead their own change must be one a split explains: 1.2 to 60 times either way.
  - **The tag itself moved:** this is read from a figure the filing shares with earlier filings. That is the span itself when the figure is a comparative reported before, otherwise the same span a year earlier. Look under the same tag, or else under another single tag of the field (the name before a rename).
    - The restatement, scaled to the earlier figure's span, stands for the gap between the bases.
    - Changes within 0.5% count as rounding.
    - A gap of a thousand or a million times is a scaling slip in one of the filings, not a restatement. GRMN's and WRB's 10-Ks gave weighted shares in thousands.
  - **When the pair is refused:** only when the earlier filing is known to stand on the old basis. Its own shared figure, read under the same tag as the later filing's comparison, must equal the one known before it.
    - If the earlier filing restated as well, both stand on the new basis.
    - If it shares no figure, its basis is unknown and the pair is kept.
  - **Plausible figures only:** a year-to-date figure counts only from a filing whose own period ends at the span's end, or one to three years after it. GD's Q3 2011 10-Q tags its nine months' dividends as the full years 2010 and 2011. Taken as an earlier full year, that would have looked like a restatement.
  - **Effect:** the quarter then waits for a pair on one basis, usually next year's comparatives. Until then it has no value.
  - **Examples:**
    - WMB's Q4 2011 revenue, −17m: the 2011 10-K's full year on continuing operations after the WPX spin-off, minus nine months with WPX. It now first appears from the 2012 10-K, at 2,103m.
    - BAX's Q3 2024 capex: Kidney Care moved to discontinued operations in the Q3 10-Q. The first version was −22m; it is now −134m, from the 2025 comparatives.
    - JCI (the former Tyco, CIK 833444), FY2015 Q4 revenue: after the 2016 merger, the 10-K carries Johnson Controls' history. Its FY2015 minus Tyco's nine months gave a quarter of 29,782m. That version is now refused; the quarter keeps Tyco's 2,505m.
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
  - **Periods:** a field may have several entries, one per range of quarter ends (`from`/`until`; the ranges must not overlap). Each quarter uses the entry for its own quarter end. When the build pairs year-to-date figures across a tag change, it reads each figure with its own quarter's entry. So the fourth quarter after a rename pairs the new tag's full year with the old tag's nine months. End an entry inside a fiscal year only at a rename. If an entry leaves a line out on purpose for some quarters, the later quarters of that year must come from `y:` (one expression, differenced), never from such a pairing; check the sources.
  - **Magnitude:** `"magnitude": true` counts each fact by its absolute value before any year-to-date difference; the expression's signs apply after. It is only for lines that are outflows in every filing of the range, such as capex payments, where filings store the sign either way.
  - **Evidence:** every entry carries the statement line and the values that tie.
  - **Example:** General Dynamics' cost of sales since 2020 is tagged only by product and service, so it is `CostsAndExpenses-GeneralAndAdministrativeExpense`.
  - **Example:** NextEra's capex is on its own tags, renamed four times since 2009, so it has one entry per name period, with magnitude:
    - 2009 – Q3 2010: `CapitalExpendituresOfFPL`, then `…OfFpl`.
    - Q4 2010 – 2020: `…OfPublicUtility`.
    - 2021: the FPL and Gulf Power segment tags.
    - 2022 onward: `…OfFPL` again.

## 5. Acceptance gates

Every new build is accepted only when all of these hold.

| Gate | Tool | Threshold | v2 (2026-11-12) | v3-base (2026-11-13) |
|---|---|---|---|---|
| Our first-reported values equal each filing's own numbers (same tag, period, duration) | `checks.py` | at least 99.98% for every field; each difference explained | 99.98–100%. The 23 differences are filer mislabels the data sets copy (NiSource, Tractor Supply, Kinder Morgan and others), Mosaic's 2013 fiscal-year change, and J.B. Hunt's rounded duplicate. | unchanged |
| Latest filing = EDGAR's latest 10-Q/10-K | `checks.py` | 0 companies behind | 0 | 0 |
| Revenue is the income statement's largest printed revenue line | `checks.py` | not below the previous build | 96.1%; 2.2% bank identity (no total line); 1.1% not printed (44 companies) | unchanged |
| No regression against the previous build | `compare.py` | 0 broken filing matches; removals only of impossible or mixed-basis values; every change explained | — | against v3-mech: broken 0; removed 125, all quarters whose only value mixed two bases (17 of them split-affected share counts) |
| QA identities, signs, jumps | `qa.mts` | not worse than the previous build | gross profit identity off 4.8%; cash change off 2.2%; signs off 0.2% | counts off, v3-mech → v3-base: gross profit 536 → 516, cash change 630 → 623, signs 259 → 244, revenue jumps 61 → 58, asset jumps 48 → 48, negative Q4 revenue 4 → 1 |
| Coverage per field from 2010 | `qa.mts` | not below the previous build, except the removals the compare gate explains | revenue 98.7%, net income 98.4%, total assets 98.4%, operating cash flow 99.1%, capex 91.1%, debt 83.1% | at most 0.02 points lower (the 125 removals) |

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
- **A company may store the same tag with either sign in different filings.** NextEra's 2010 10-K stored FPL capex as +2,605m and NEER investments as −2,899m. Its 2011 10-K stored both as positive outflows. No signed expression fits both years; `magnitude` does, and the 2010 quarters then sum to the 10-K's 5,846m. Use it only where every part is an outflow in every filing of the range; a "payments for (proceeds from)" line that can turn into a net inflow needs its own range or no magnitude.
- **Filers mislabel the fiscal period of a 10-Q as "FY"** (BXP's 2026 Q1 and Q2, DIS 2022, TMUS 2020 and 7 others). The build ignores "FY" on a 10-Q and numbers the quarter from the spacing to the fiscal year end.
- **An amendment is not a newer quarter.** TECH's 10-Q/A counted as "behind EDGAR" although companyfacts held it; the freshness gate counts original filings only.
- **A tag with a standard-looking name may be the company's own.** GE's `InterestAndOtherFinancialCharges`, SLB's `InterestIncomeAndOther`, TMO's `RestructuringAndOtherCostsIncomeNet` and OXY's `TransportationAndGatheringExpense` are extension elements. In the data sets their `version` is the filing's accession, not `us-gaap/…`, and companyfacts (us-gaap only) never has them. Write them as `custom:Name`; read the version column before calling a concept "missing from companyfacts".
- **Banks have no total-revenue line on the face of the statement**, so a check by label sees a fee line. Their revenue is the identity.
- **The largest tag is not always the statement's figure.** Take the largest among the lines the statement prints.
- **Restatements:** never set a restated year against an old nine-month figure (same-basis rule).
- **A restatement inside the year mixes bases too.** A spin-off or a business moved to discontinued operations restates the comparatives in the very filing whose year-to-date figure is then set against the previous quarter's figure on the old basis. That gave negative fourth-quarter revenues (WMB 2011, JCI 2012, AES 2017) and a capex of 22m instead of about 130m (BAX Q3 2024). A filing filed within 400 days is not enough: compare a figure both filings share.
  - The check must also look under the field's other tags, because companies rename tags around the same time (BAX's capex).
  - It must not treat "no shared figure" as "same basis": WMB's 2010 filings flipped the sign of capex on both sides of a pair that was right.
  - It must ask whether the filing restated broadly, not only whether one tag moved. UNP moved part of its 2018 repurchases to another tag. A one-tag test refused a correct pair, and a weaker tag then gave 0.
  - It must ignore mislabelled contexts, which look like restatements (GD's nine months tagged as full years).
  - It must ignore scaling slips, which also look like restatements: GRMN's 2018 10-K gave weighted shares in thousands (188,6xx). The test refused the right Q4 values of 2018 and 2019 until a slip of a thousand times was excluded, and share counts were held to split-sized changes.
  - Read the refused pairs before trusting a rule like this: `SHOW_REFUSED=1` prints each refused pair and each implausible figure.
  - What it cannot see is a first XBRL year with nothing earlier to compare: A. O. Smith's Q4 2010 revenue stays at −166m until the 2011 comparatives give 370m.
- **Share counts are not one thing** (found by the market value tie-out against the old database, `docs/engine/STANDARD_PRICES.md` gate 6, 2026-11-13). They are step-2 items:
  - Some filers tag the year-end count of shares *issued* as `CommonStockSharesOutstanding`. Boeing's 10-Ks give about 1.36 times the outstanding count; Tyler Technologies is similar.
  - The filed count covers one class or one listed company where market value needs all of them (Visa, UPS, Comcast, Mastercard, Berkshire; Carnival's two companies).
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

## 8. Keeping the series in MySQL

The cleaned series become static MySQL data: computed once, then extended with new quarters.

- **Where:** the local research database `alpha_research`, through `RESEARCH_DATABASE_URL`. Its user has all rights there and read-only access to `alpha_engine`.
- **Permission:** the owner's, of 2026-11-12, AGENTS.md section 3.2.
- **Lab code:**
  - `src/research-db.mts`: the connection and inserts of at most 500 rows.
  - `src/research-db-check.mts`: who, grants, a write round trip.
  - `src/fundamentals/load-mysql.mts`: the loader.

**Loading a build:**
```
npx tsx C:/dev/alpha-engine-lab/src/fundamentals/load-mysql.mts <build dir> <build version> <provisional|final> [--replace]
```
- **Modes:**
  - `--replace` empties the tables and loads the build. It is allowed only while every stored build is provisional.
  - Otherwise it appends: only versions not stored yet are inserted. A stored version whose value differs stops the load, because a stored value is never updated; restatements arrive as new filed versions.
- **After loading:** every table is counted, and 2,000 random values are read back and compared with the build.
- **Build record:** each load stores the lab commit, the SHA-256 of the data-set manifest and of `overrides.json`, and the acceptance gates' numbers.

**Example, point in time:** each company's revenue for every quarter, as known on 2024-06-30.
```sql
SELECT f.cik, f.quarterEnd, f.value
FROM std_fundamentals f
JOIN (SELECT cik, quarterEnd, MAX(filed) AS filed FROM std_fundamentals
      WHERE field = 'revenue' AND filed <= '2024-06-30' GROUP BY cik, quarterEnd) k
  ON k.cik = f.cik AND k.quarterEnd = f.quarterEnd AND k.filed = f.filed
WHERE f.field = 'revenue';
```

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

`std_fundamental_companies`: ticker, name, predecessor, first and last quarter. `std_fundamental_fields`: statement, kind, unit, meaning, tags, identities.

`std_fundamental_builds`, one row per load:

| Column |
|---|
| `buildVersion` |
| `createdAt` |
| `codeCommit` |
| `inputs` (JSON: data-set manifest hash, companyfacts as-of date, overrides hash) |
| `gates` (JSON: the section 5 numbers) |

**Gates before a final load:** section 5. Production only through a reviewed migration and the owner's reviewed sync.

## 9. Company-specific mappings (K14)

K14 followed the statement line, not the tag name alone. For each stopped series the last good filing supplied the statement, line order and printed label; later filings supplied the replacement tag or a signed identity. Every override records its filing evidence and stays unreviewed. Fallbacks fill only missing values; `first` is used only when the existing tag has the wrong scope. Ranges separate renames and scope changes, and `magnitude` is limited to one-way outflows whose stored sign flips.

The final set has 94 companies and 110 entries, adding 2093 company-quarter values. Direct changes total 180, with 6 original-vintage additions; dependent identities account for 82 more. The full normalized table and every changed value are in `mapping-report.md` / `mapping-report.json`.

Patterns found:
- Standard-tag renames: capex moved to `PaymentsToAcquireOtherProductiveAssets`, `PaymentsToAcquireFurnitureAndFixtures`, `PaymentsForSoftware`, `PaymentsToAcquireMachineryAndEquipment` and company extension tags. Interest, depreciation and weighted-share counts also needed exact alternate names.
- Totals tagged only by part: General Dynamics' cost of sales is `CostsAndExpenses-GeneralAndAdministrativeExpense`; RTX, Verizon, Lennar, Waters and C.H. Robinson use similar operating-cost identities. Some other companies need the pretax/non-operating reconciliation instead.
- Own extension tags with standard-looking names: GE interest and insurance/benefit lines, SLB interest and other income, TMO restructuring, OXY transportation/gathering, PACCAR borrowing expense, NextEra's capex and interest lines, Fiserv's acquisition amortization, and many real-estate debt/capex lines. They must be written `custom:Name`.
- Scope differences: casinos need gross revenue before 2018 (LVS, MGM, WYNN, including `SalesRevenueGoodsGross` and `HotelAndCasinoRevenueGross`); NI uses total regulated operating revenue through 2024 Q3; CPT uses property lease revenue; VICI needs total revenue rather than lease-only revenue; RL and RTX need the consolidated total rather than component sums.
- Debt identities: current and non-current notes, secured/unsecured debt, senior/subordinated notes, FHLB advances and lines of credit are summed only when every component is explicitly a borrowing. Securities-lending balances and accrued interest are excluded.

Traps and guardrails:
- The same custom tag can change sign convention across filings. Magnitude normalizes only true one-way outflows; it is not applied to net proceeds or other income.
- The SEC data sets round dates to month ends and per-share units to USD, while companyfacts supplies exact dates and USD/shares.
- A filing can be present in companyfacts while an extension fact is absent. The data-set `version` column, not the name, distinguishes an extension from a us-gaap fact.
- BXP's 10-Q was labelled `fp=FY`; the committed build now derives the quarter from period spacing, which fixed ncfo without an override. TECH's amendment is listed separately from freshness failures.
- Federal Realty's 2019 capex omitted development/redevelopment; four existing quarters were corrected. Illumina's 2022 Q1 debt omitted non-current term and convertible notes and changed from $499m to $1,740m.
- NextEra's Gulf Power acquisition is present only in Q1 2019. It is excluded there; Q2-Q4 2019 and 2020-2021 include Gulf capex through YTD differencing, with Q2-Q4 2019 forced to `y:`.
- WRB's 2026 net-proceeds line would put a positive value in the capex sign check, so its mapping stops at 2025 Q4. NiSource's revenue override stops at 2024 Q3 because later presentations caused extreme jumps. These bounds preserve QA.
- Financial companies' pretax income is not operating income. Multi-class share counts and dimension-only debt are not consolidated into invented totals. No zero debt, share count, capex or interest is inferred from an absent line.

Counts and gates are in `delivery-report.md`. Remaining continuity gaps and their reasons are in `remaining-stops.md`.
