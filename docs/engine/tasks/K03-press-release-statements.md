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

## Delivery report

Implemented by `scripts/build-flash-statements.mts` and the pure stages under `worker/lib/flash-*`; builder
source commit **`84fbe95`**. The builder used the corrected K01 timeline, all cached EX-99 exhibits and
read-only local MySQL facts. No LLM, production write, schema change or new service was used.

### Acceptance checks

1. **Coverage — pass.** Processed **3,609** earnings releases and **7,542** distinct exhibits; removed
   **14** duplicate exhibits. **218** releases had no EX-99 exhibit and there were **0 operational errors**.
   Found an income statement in **2,962/3,609 (82.0726%)**, a balance sheet in **2,728/3,609 (75.5888%)**
   and a cash-flow statement in **1,981/3,609 (54.8906%)**. No company is without all statements or without
   an income statement. Companies without a balance sheet: **JNJ, LLY**. Companies without a cash-flow
   statement: **AIG, COF, GS, JNJ, LLY, NKE, PFE, PLD**. Full year/company tables appear below and in the
   committed summary.
2. **Golden documents — pass.** `npx tsx scripts/check-flash-golden.mts` passed **113/113** assertions:
   AAPL 21/21, NVDA 19/19, BA 18/18, DASH 18/18, WMT 20/20 and JPM 17/17. The six golden releases also
   produced **475/475** matching gradable comparisons and **38** explicitly not-gradable comparisons.
3. **Period check — pass overall.** **2,899/2,924 = 99.1450%**, above 98%. Another **38** releases with
   an income statement had no paired K01 expected period and are reported separately as `periodUnpaired`.
   The **25** remaining mismatches comprise **21** without a detected current period and **4** outside the
   seven-day tolerance; none was removed from the denominator. They are NVDA 1, INTC 3, NFLX 1, NKE 1,
   PLD 4, MSFT 1, LLY 1, IBM 3, JNJ 1, WMT 3, COST 3 and AIG 3. Accession-level evidence is in
   `periods.mismatches` in the summary.
4. **Naming rate — measured, no threshold.** Named **101,771/200,557 statement rows = 50.7442%**.
   Income: **28,650/67,468 = 42.4646%**; balance: **47,888/73,798 = 64.8906%**; cash flow:
   **25,233/59,291 = 42.5579%**. Output contains **283,557** values and **135,355** residual records
   (including headings), ready for K04. Statement/year and statement/company rates appear below.
5. **Grade — pass overall.** **106,574/108,252 = 98.4499%** of gradable current-period values match;
   **1,678** mismatch and **18,214** are explicitly not gradable. Not-gradable reasons: fourth-quarter
   three-month **8,525**, incomplete concept coverage **2,482**, missing printed value **1,591**, mixed sign
   convention **493**, no such fact **4,946**, release not paired **177**. The 30 most frequent mismatch
   patterns and one example each appear below; complete numeric comparisons remain in `grades.jsonl`.
6. **Point-in-time — pass.** The automated audit covered **283,557** printed values and **139,539** unique
   answer-key evidence tuples. It found **0** values not derived from the printed cell and **0** answer-key
   facts with `filed >= release date`. Answer-key matches deliberately omit the fact value; extraction uses
   only concept, period, unit, filing lineage and sign evidence. The audit is in
   `worker/lib/flash-golden.ts`, with point-in-time regressions in `worker/lib/flash-facts.test.ts` and
   `worker/lib/flash-pipeline.test.ts`.
7. **Repeatability, checks and isolation.** Per-release checkpoints bind schema, context, input hashes and
   code hash; error results are not successful checkpoints. The first D: write attempt stopped with
   `UNKNOWN`; it was not treated as an empty cache, and the next run resumed the atomic checkpoints. An
   intermediate parser candidate failed the universe period gate and was rejected before the source commit.
   The final candidate passed **25/25 targeted tests**, **187 full-suite files / 1,034 tests**, **39/39**
   scripts tests, `npm run check`, production build and `git diff --check`.

### Coverage, period, naming and grade by year

| Year | Releases | Income | Balance | Cash flow | Period matched | Rows named | Grade matches |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2009 | 189 | 147 (77.7778%) | 130 (68.7831%) | 73 (38.6243%) | 133/134 (99.2537%) | 544/9,144 (5.9493%) | 543/548 (99.0876%) |
| 2010 | 185 | 152 (82.1622%) | 134 (72.4324%) | 80 (43.2432%) | 141/147 (95.9184%) | 2,720/9,105 (29.8737%) | 2,906/2,959 (98.2089%) |
| 2011 | 190 | 157 (82.6316%) | 141 (74.2105%) | 87 (45.7895%) | 150/152 (98.6842%) | 4,076/9,432 (43.2146%) | 4,455/4,537 (98.1926%) |
| 2012 | 201 | 153 (76.1194%) | 139 (69.1542%) | 90 (44.7761%) | 148/151 (98.0132%) | 4,880/9,661 (50.5124%) | 5,096/5,217 (97.6807%) |
| 2013 | 190 | 153 (80.5263%) | 139 (73.1579%) | 96 (50.5263%) | 148/153 (96.7320%) | 5,308/9,890 (53.6704%) | 5,864/5,940 (98.7205%) |
| 2014 | 188 | 151 (80.3191%) | 136 (72.3404%) | 91 (48.4043%) | 148/148 (100.0000%) | 5,420/9,828 (55.1486%) | 5,657/5,747 (98.4340%) |
| 2015 | 194 | 158 (81.4433%) | 141 (72.6804%) | 94 (48.4536%) | 154/155 (99.3548%) | 6,032/10,595 (56.9325%) | 6,532/6,628 (98.5516%) |
| 2016 | 199 | 162 (81.4070%) | 146 (73.3668%) | 102 (51.2563%) | 160/161 (99.3789%) | 6,225/11,097 (56.0962%) | 6,519/6,607 (98.6681%) |
| 2017 | 195 | 162 (83.0769%) | 147 (75.3846%) | 104 (53.3333%) | 161/162 (99.3827%) | 6,084/10,963 (55.4958%) | 6,254/6,415 (97.4903%) |
| 2018 | 197 | 159 (80.7107%) | 149 (75.6345%) | 99 (50.2538%) | 158/158 (100.0000%) | 5,651/10,626 (53.1809%) | 5,767/5,903 (97.6961%) |
| 2019 | 208 | 168 (80.7692%) | 152 (73.0769%) | 114 (54.8077%) | 166/167 (99.4012%) | 6,067/11,320 (53.5954%) | 6,183/6,317 (97.8787%) |
| 2020 | 209 | 173 (82.7751%) | 160 (76.5550%) | 125 (59.8086%) | 173/173 (100.0000%) | 6,610/12,094 (54.6552%) | 6,671/6,795 (98.1751%) |
| 2021 | 212 | 184 (86.7925%) | 171 (80.6604%) | 135 (63.6792%) | 183/183 (100.0000%) | 6,881/13,044 (52.7522%) | 7,124/7,191 (99.0683%) |
| 2022 | 215 | 184 (85.5814%) | 173 (80.4651%) | 134 (62.3256%) | 182/184 (98.9130%) | 7,080/13,027 (54.3487%) | 7,458/7,530 (99.0438%) |
| 2023 | 213 | 185 (86.8545%) | 177 (83.0986%) | 142 (66.6667%) | 182/184 (98.9130%) | 7,365/13,296 (55.3926%) | 7,565/7,662 (98.7340%) |
| 2024 | 211 | 178 (84.3602%) | 169 (80.0948%) | 145 (68.7204%) | 178/178 (100.0000%) | 6,899/12,918 (53.4061%) | 7,266/7,368 (98.6156%) |
| 2025 | 210 | 174 (82.8571%) | 167 (79.5238%) | 139 (66.1905%) | 174/174 (100.0000%) | 7,179/12,604 (56.9581%) | 7,668/7,758 (98.8399%) |
| 2026 | 203 | 162 (79.8030%) | 157 (77.3399%) | 131 (64.5320%) | 160/160 (100.0000%) | 6,750/11,913 (56.6608%) | 7,046/7,130 (98.8219%) |

### Coverage, period, naming and grade by company

| Company | Releases | Income | Balance | Cash flow | Period matched | Rows named | Grade matches |
|---|---:|---:|---:|---:|---:|---:|---:|
| AAPL | 73 | 72 (98.6301%) | 72 (98.6301%) | 72 (98.6301%) | 71/71 (100.0000%) | 3,946/5,978 (66.0087%) | 3,779/3,781 (99.9471%) |
| AIG | 82 | 50 (60.9756%) | 24 (29.2683%) | 0 (0.0000%) | 31/34 (91.1765%) | 5/302 (1.6556%) | 4/5 (80.0000%) |
| AMD | 76 | 72 (94.7368%) | 72 (94.7368%) | 66 (86.8421%) | 71/71 (100.0000%) | 115/5,027 (2.2876%) | 159/169 (94.0828%) |
| AMT | 73 | 73 (100.0000%) | 73 (100.0000%) | 72 (98.6301%) | 73/73 (100.0000%) | 5,174/7,007 (73.8404%) | 5,348/5,383 (99.3498%) |
| AMZN | 72 | 72 (100.0000%) | 72 (100.0000%) | 72 (100.0000%) | 72/72 (100.0000%) | 4,298/6,018 (71.4191%) | 6,782/6,810 (99.5888%) |
| ANET | 52 | 50 (96.1538%) | 50 (96.1538%) | 46 (88.4615%) | 50/50 (100.0000%) | 3,105/3,988 (77.8586%) | 3,292/3,326 (98.9778%) |
| AVGO | 34 | 34 (100.0000%) | 34 (100.0000%) | 34 (100.0000%) | 34/34 (100.0000%) | 1,239/3,124 (39.6607%) | 1,054/1,057 (99.7162%) |
| BA | 79 | 58 (73.4177%) | 59 (74.6835%) | 59 (74.6835%) | 58/58 (100.0000%) | 3,674/5,884 (62.4405%) | 3,870/3,891 (99.4603%) |
| CAT | 75 | 72 (96.0000%) | 72 (96.0000%) | 72 (96.0000%) | 72/72 (100.0000%) | 1,122/7,152 (15.6879%) | 1,621/1,647 (98.4214%) |
| COF | 73 | 72 (98.6301%) | 72 (98.6301%) | 0 (0.0000%) | 72/72 (100.0000%) | 2,085/4,194 (49.7139%) | 1,894/2,194 (86.3263%) |
| COP | 80 | 72 (90.0000%) | 34 (42.5000%) | 72 (90.0000%) | 72/72 (100.0000%) | 4/6,062 (0.0660%) | 6/10 (60.0000%) |
| COST | 72 | 70 (97.2222%) | 68 (94.4444%) | 13 (18.0556%) | 67/70 (95.7143%) | 1,852/3,431 (53.9784%) | 1,660/1,670 (99.4012%) |
| CSCO | 71 | 71 (100.0000%) | 71 (100.0000%) | 71 (100.0000%) | 71/71 (100.0000%) | 2,589/6,394 (40.4911%) | 2,737/2,769 (98.8443%) |
| CVX | 99 | 73 (73.7374%) | 73 (73.7374%) | 32 (32.3232%) | 73/73 (100.0000%) | 36/2,903 (1.2401%) | 56/56 (100.0000%) |
| DAL | 74 | 74 (100.0000%) | 73 (98.6486%) | 64 (86.4865%) | 74/74 (100.0000%) | 1,763/5,254 (33.5554%) | 1,649/1,781 (92.5884%) |
| DASH | 24 | 24 (100.0000%) | 24 (100.0000%) | 24 (100.0000%) | 24/24 (100.0000%) | 1,037/2,086 (49.7124%) | 1,109/1,124 (98.6655%) |
| FCX | 78 | 73 (93.5897%) | 73 (93.5897%) | 73 (93.5897%) | 72/72 (100.0000%) | 2,082/7,031 (29.6117%) | 1,870/1,969 (94.9721%) |
| FSLR | 75 | 73 (97.3333%) | 73 (97.3333%) | 16 (21.3333%) | 70/70 (100.0000%) | 3,634/4,722 (76.9589%) | 3,976/3,997 (99.4746%) |
| GOOGL | 46 | 45 (97.8261%) | 45 (97.8261%) | 45 (97.8261%) | 45/45 (100.0000%) | 2,280/3,621 (62.9660%) | 2,277/2,284 (99.6935%) |
| GS | 74 | 71 (95.9459%) | 71 (95.9459%) | 0 (0.0000%) | 71/71 (100.0000%) | 1,660/3,235 (51.3138%) | 1,471/1,581 (93.0424%) |
| HD | 71 | 69 (97.1831%) | 69 (97.1831%) | 4 (5.6338%) | 69/69 (100.0000%) | 1,689/2,922 (57.8029%) | 1,811/1,826 (99.1785%) |
| IBM | 106 | 22 (20.7547%) | 42 (39.6226%) | 42 (39.6226%) | 18/21 (85.7143%) | 1,907/2,959 (64.4474%) | 935/942 (99.2569%) |
| INTC | 93 | 76 (81.7204%) | 83 (89.2473%) | 42 (45.1613%) | 72/75 (96.0000%) | 3,487/5,011 (69.5869%) | 3,344/3,398 (98.4108%) |
| JNJ | 75 | 75 (100.0000%) | 0 (0.0000%) | 0 (0.0000%) | 73/74 (98.6486%) | 18/1,370 (1.3139%) | 13/13 (100.0000%) |
| JPM | 73 | 72 (98.6301%) | 72 (98.6301%) | 1 (1.3699%) | 72/72 (100.0000%) | 3,008/4,652 (64.6604%) | 3,482/3,518 (98.9767%) |
| KMI | 63 | 60 (95.2381%) | 61 (96.8254%) | 11 (17.4603%) | 59/59 (100.0000%) | 1,195/3,475 (34.3885%) | 1,126/1,240 (90.8065%) |
| LIN | 32 | 22 (68.7500%) | 22 (68.7500%) | 22 (68.7500%) | 21/21 (100.0000%) | 20/1,926 (1.0384%) | 18/18 (100.0000%) |
| LLY | 83 | 65 (78.3133%) | 0 (0.0000%) | 0 (0.0000%) | 64/65 (98.4615%) | 42/1,294 (3.2457%) | 59/62 (95.1613%) |
| LMT | 73 | 72 (98.6301%) | 72 (98.6301%) | 72 (98.6301%) | 72/72 (100.0000%) | 2,719/5,395 (50.3985%) | 2,607/2,621 (99.4659%) |
| LULU | 71 | 71 (100.0000%) | 71 (100.0000%) | 69 (97.1831%) | 71/71 (100.0000%) | 1,784/3,358 (53.1269%) | 1,680/1,702 (98.7074%) |
| MA | 73 | 72 (98.6301%) | 72 (98.6301%) | 72 (98.6301%) | 72/72 (100.0000%) | 2,698/6,905 (39.0731%) | 2,687/2,701 (99.4817%) |
| META | 58 | 58 (100.0000%) | 58 (100.0000%) | 58 (100.0000%) | 58/58 (100.0000%) | 2,525/4,723 (53.4618%) | 2,882/2,895 (99.5509%) |
| MRNA | 40 | 29 (72.5000%) | 16 (40.0000%) | 29 (72.5000%) | 29/29 (100.0000%) | 901/1,457 (61.8394%) | 961/969 (99.1744%) |
| MSFT | 72 | 72 (100.0000%) | 72 (100.0000%) | 9 (12.5000%) | 69/70 (98.5714%) | 3,715/4,739 (78.3921%) | 4,342/4,355 (99.7015%) |
| MU | 73 | 46 (63.0137%) | 49 (67.1233%) | 48 (65.7534%) | 46/46 (100.0000%) | 1,938/2,728 (71.0411%) | 1,931/1,944 (99.3313%) |
| NEE | 73 | 1 (1.3699%) | 1 (1.3699%) | 1 (1.3699%) | 1/1 (100.0000%) | 0/85 (0.0000%) | — |
| NFLX | 75 | 73 (97.3333%) | 72 (96.0000%) | 72 (96.0000%) | 72/73 (98.6301%) | 4,124/5,619 (73.3938%) | 5,223/5,252 (99.4478%) |
| NKE | 109 | 72 (66.0550%) | 71 (65.1376%) | 0 (0.0000%) | 71/72 (98.6111%) | 1,682/3,046 (55.2200%) | 1,971/1,986 (99.2447%) |
| NVDA | 74 | 70 (94.5946%) | 69 (93.2432%) | 27 (36.4865%) | 69/70 (98.5714%) | 2,526/3,358 (75.2233%) | 2,873/2,890 (99.4118%) |
| PFE | 76 | 71 (93.4211%) | 6 (7.8947%) | 0 (0.0000%) | 71/71 (100.0000%) | 8/1,658 (0.4825%) | 8/8 (100.0000%) |
| PG | 72 | 48 (66.6667%) | 48 (66.6667%) | 48 (66.6667%) | 48/48 (100.0000%) | 2,351/3,713 (63.3181%) | 2,219/2,232 (99.4176%) |
| PLD | 86 | 29 (33.7209%) | 38 (44.1860%) | 0 (0.0000%) | 24/28 (85.7143%) | 0/1,201 (0.0000%) | — |
| PLTR | 26 | 25 (96.1538%) | 25 (96.1538%) | 25 (96.1538%) | 25/25 (100.0000%) | 1,382/1,911 (72.3182%) | 1,525/1,537 (99.2193%) |
| RCL | 75 | 53 (70.6667%) | 67 (89.3333%) | 67 (89.3333%) | 53/53 (100.0000%) | 3,408/5,648 (60.3399%) | 3,022/3,042 (99.3425%) |
| SMCI | 96 | 61 (63.5417%) | 61 (63.5417%) | 56 (58.3333%) | 60/60 (100.0000%) | 2,719/3,838 (70.8442%) | 2,824/2,958 (95.4699%) |
| T | 76 | 74 (97.3684%) | 73 (96.0526%) | 70 (92.1053%) | 68/68 (100.0000%) | 3,691/6,711 (54.9993%) | 3,392/3,450 (98.3188%) |
| TSLA | 117 | 36 (30.7692%) | 36 (30.7692%) | 36 (30.7692%) | 36/36 (100.0000%) | 1,419/2,564 (55.3432%) | 1,467/1,525 (96.1967%) |
| UNH | 73 | 68 (93.1507%) | 68 (93.1507%) | 68 (93.1507%) | 68/68 (100.0000%) | 2,541/3,803 (66.8157%) | 2,893/2,950 (98.0678%) |
| V | 72 | 58 (80.5556%) | 58 (80.5556%) | 58 (80.5556%) | 58/58 (100.0000%) | 2,122/5,219 (40.6591%) | 1,874/1,888 (99.2585%) |
| WMT | 71 | 71 (100.0000%) | 71 (100.0000%) | 71 (100.0000%) | 67/70 (95.7143%) | 4,452/5,856 (76.0246%) | 4,791/4,826 (99.2748%) |


### Answer-key naming by statement and year

| Year | Income | Balance | Cash flow |
|---|---:|---:|---:|
| 2009 | 78/3,563 (2.1892%) | 434/3,366 (12.8936%) | 32/2,215 (1.4447%) |
| 2010 | 637/3,551 (17.9386%) | 1,697/3,338 (50.8388%) | 386/2,216 (17.4188%) |
| 2011 | 1,266/3,590 (35.2646%) | 1,951/3,498 (55.7747%) | 859/2,344 (36.6468%) |
| 2012 | 1,510/3,571 (42.2851%) | 2,234/3,457 (64.6225%) | 1,136/2,633 (43.1447%) |
| 2013 | 1,626/3,506 (46.3776%) | 2,427/3,497 (69.4023%) | 1,255/2,887 (43.4707%) |
| 2014 | 1,706/3,434 (49.6797%) | 2,392/3,602 (66.4076%) | 1,322/2,792 (47.3496%) |
| 2015 | 1,868/3,731 (50.0670%) | 2,622/3,822 (68.6028%) | 1,542/3,042 (50.6903%) |
| 2016 | 1,841/3,828 (48.0930%) | 2,672/4,030 (66.3027%) | 1,712/3,239 (52.8558%) |
| 2017 | 1,699/3,706 (45.8446%) | 2,838/3,952 (71.8117%) | 1,547/3,305 (46.8079%) |
| 2018 | 1,712/3,652 (46.8784%) | 2,753/4,013 (68.6020%) | 1,186/2,961 (40.0540%) |
| 2019 | 1,803/3,790 (47.5726%) | 2,804/4,289 (65.3765%) | 1,460/3,241 (45.0478%) |
| 2020 | 1,764/3,914 (45.0690%) | 3,097/4,541 (68.2008%) | 1,749/3,639 (48.0627%) |
| 2021 | 1,833/4,106 (44.6420%) | 3,225/4,887 (65.9914%) | 1,823/4,051 (45.0012%) |
| 2022 | 1,910/4,029 (47.4063%) | 3,366/4,909 (68.5679%) | 1,804/4,089 (44.1184%) |
| 2023 | 1,975/4,017 (49.1660%) | 3,450/4,970 (69.4165%) | 1,940/4,309 (45.0220%) |
| 2024 | 1,839/3,959 (46.4511%) | 3,307/4,682 (70.6322%) | 1,753/4,277 (40.9867%) |
| 2025 | 1,846/3,889 (47.4672%) | 3,418/4,605 (74.2237%) | 1,915/4,110 (46.5937%) |
| 2026 | 1,737/3,632 (47.8249%) | 3,201/4,340 (73.7558%) | 1,812/3,941 (45.9782%) |

### Answer-key naming by statement and company

| Company | Income | Balance | Cash flow |
|---|---:|---:|---:|
| AAPL | 795/1,737 (45.7686%) | 1,786/1,939 (92.1093%) | 1,365/2,302 (59.2963%) |
| AIG | 5/291 (1.7182%) | 0/11 (0.0000%) | — |
| AMD | 115/1,525 (7.5410%) | 0/2,063 (0.0000%) | 0/1,439 (0.0000%) |
| AMT | 1,397/2,007 (69.6064%) | 2,042/2,555 (79.9217%) | 1,735/2,445 (70.9611%) |
| AMZN | 1,150/1,779 (64.6431%) | 1,438/1,734 (82.9296%) | 1,710/2,505 (68.2635%) |
| ANET | 812/1,096 (74.0876%) | 1,274/1,438 (88.5953%) | 1,019/1,454 (70.0825%) |
| AVGO | 252/1,052 (23.9544%) | 724/857 (84.4807%) | 263/1,215 (21.6461%) |
| BA | 780/1,369 (56.9759%) | 1,727/2,108 (81.9260%) | 1,167/2,407 (48.4836%) |
| CAT | 1,121/1,789 (62.6607%) | 1/2,694 (0.0371%) | 0/2,669 (0.0000%) |
| COF | 1,005/2,511 (40.0239%) | 1,080/1,683 (64.1711%) | — |
| COP | 4/2,395 (0.1670%) | 0/1,038 (0.0000%) | 0/2,629 (0.0000%) |
| COST | 160/1,264 (12.6582%) | 1,631/1,846 (88.3532%) | 61/321 (19.0031%) |
| CSCO | 1,142/1,813 (62.9895%) | 12/1,756 (0.6834%) | 1,435/2,825 (50.7965%) |
| CVX | 36/1,520 (2.3684%) | 0/516 (0.0000%) | 0/867 (0.0000%) |
| DAL | 210/2,361 (8.8945%) | 1,361/1,676 (81.2053%) | 192/1,217 (15.7765%) |
| DASH | 266/431 (61.7169%) | 478/675 (70.8148%) | 293/980 (29.8980%) |
| FCX | 136/1,583 (8.5913%) | 1,830/2,492 (73.4350%) | 116/2,956 (3.9242%) |
| FSLR | 1,155/1,479 (78.0933%) | 2,080/2,706 (76.8662%) | 399/537 (74.3017%) |
| GOOGL | 361/665 (54.2857%) | 1,294/1,540 (84.0260%) | 625/1,416 (44.1384%) |
| GS | 1,336/2,234 (59.8030%) | 324/1,001 (32.3676%) | — |
| HD | 462/1,473 (31.3646%) | 1,227/1,449 (84.6791%) | — |
| IBM | 114/549 (20.7650%) | 1,457/1,635 (89.1131%) | 336/775 (43.3548%) |
| INTC | 806/1,397 (57.6951%) | 2,009/2,336 (86.0017%) | 672/1,278 (52.5822%) |
| JNJ | 18/1,370 (1.3139%) | — | — |
| JPM | 1,319/2,297 (57.4227%) | 1,689/2,355 (71.7197%) | — |
| KMI | 461/1,642 (28.0755%) | 734/1,833 (40.0436%) | — |
| LIN | 20/618 (3.2362%) | 0/672 (0.0000%) | 0/636 (0.0000%) |
| LLY | 42/1,294 (3.2457%) | — | — |
| LMT | 654/1,323 (49.4331%) | 1,432/2,057 (69.6159%) | 633/2,015 (31.4144%) |
| LULU | 455/1,263 (36.0253%) | 1,064/1,437 (74.0431%) | 265/658 (40.2736%) |
| MA | 244/1,345 (18.1413%) | 1,280/2,714 (47.1629%) | 1,174/2,846 (41.2509%) |
| META | 802/1,329 (60.3461%) | 714/1,344 (53.1250%) | 1,009/2,050 (49.2195%) |
| MRNA | 287/455 (63.0769%) | 382/441 (86.6213%) | 232/561 (41.3547%) |
| MSFT | 1,509/2,117 (71.2801%) | 1,985/2,343 (84.7204%) | 221/279 (79.2115%) |
| MU | 480/697 (68.8666%) | 988/1,103 (89.5739%) | 470/928 (50.6466%) |
| NEE | 0/36 (0.0000%) | 0/25 (0.0000%) | 0/24 (0.0000%) |
| NFLX | 1,052/1,277 (82.3806%) | 1,339/1,757 (76.2094%) | 1,733/2,585 (67.0406%) |
| NKE | 644/1,303 (49.4244%) | 1,038/1,743 (59.5525%) | — |
| NVDA | 881/1,201 (73.3555%) | 1,130/1,367 (82.6628%) | 515/790 (65.1899%) |
| PFE | 8/1,614 (0.4957%) | 0/44 (0.0000%) | — |
| PG | 376/1,241 (30.2981%) | 980/1,033 (94.8693%) | 995/1,439 (69.1452%) |
| PLD | 0/667 (0.0000%) | 0/534 (0.0000%) | — |
| PLTR | 373/476 (78.3613%) | 612/703 (87.0555%) | 397/732 (54.2350%) |
| RCL | 744/1,508 (49.3369%) | 1,085/1,854 (58.5221%) | 1,579/2,286 (69.0726%) |
| SMCI | 762/1,217 (62.6130%) | 1,283/1,713 (74.8978%) | 674/908 (74.2291%) |
| T | 587/1,679 (34.9613%) | 2,140/2,485 (86.1167%) | 964/2,547 (37.8484%) |
| TSLA | 605/949 (63.7513%) | 577/1,149 (50.2176%) | 237/466 (50.8584%) |
| UNH | 1,052/1,301 (80.8609%) | 731/1,095 (66.7580%) | 758/1,407 (53.8735%) |
| V | 537/1,318 (40.7436%) | 901/1,972 (45.6897%) | 684/1,929 (35.4588%) |
| WMT | 1,118/1,611 (69.3979%) | 2,029/2,277 (89.1085%) | 1,305/1,968 (66.3110%) |

### Thirty most frequent grade-mismatch patterns

Each example identifies the release and row; `grades.jsonl` retains the printed value, every paired-filing
comparison and the reason. `value_mismatch` is not reinterpreted as a passing alternative concept.

| Pattern | Count | Example |
|---|---:|---|
| balance / value_mismatch / Assets,LiabilitiesAndStockholdersEquity | 107 | NVDA 0001045810-11-000039 — Total assets |
| income / value_mismatch / NetIncomeLoss | 67 | INTC 0000050863-14-000029 — NET INCOME |
| balance / value_mismatch / StockholdersEquity | 40 | NVDA 0001045810-13-000029 — Stockholders' equity |
| balance / value_mismatch / Liabilities | 34 | NFLX 0001193125-12-023436 — Total liabilities |
| balance / value_mismatch / OtherLiabilitiesNoncurrent | 34 | NVDA 0001045810-11-000039 — Other long-term liabilities |
| balance / value_mismatch / LiabilitiesCurrent | 33 | INTC 0000050863-14-000029 — TOTAL CURRENT LIABILITIES |
| income / value_mismatch / IncomeTaxExpenseBenefit | 32 | NFLX 0001193125-12-023436 — Provision for income taxes |
| income / value_mismatch / EarningsPerShareDiluted | 30 | AMD 0000002488-25-000163 — Earnings from continuing operations - diluted |
| balance / value_mismatch / AssetsCurrent | 23 | INTC 0000050863-14-000065 — TOTAL CURRENT ASSETS |
| balance / value_mismatch / OtherAssetsNoncurrent | 23 | INTC 0000050863-14-000065 — Other long-term assets |
| income / value_mismatch / EarningsPerShareBasic | 23 | AMD 0000002488-25-000163 — Earnings from continuing operations - basic |
| income / value_mismatch / WeightedAverageNumberOfDilutedSharesOutstanding | 23 | NKE 0000320187-12-000164 — Diluted |
| income / value_mismatch / IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest | 22 | INTC 0000050863-14-000029 — INCOME BEFORE TAXES |
| income / value_mismatch / WeightedAverageNumberOfSharesOutstandingBasic | 20 | AMZN 0001193125-13-409933 — Diluted |
| cashflow / value_mismatch / NetIncomeLoss | 19 | NFLX 0001193125-12-023436 — Net income |
| income / value_mismatch / OperatingIncomeLoss | 19 | INTC 0000050863-14-000029 — OPERATING INCOME |
| balance / value_mismatch / StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest | 18 | UNH 0000731766-17-000004 — Equity |
| balance / value_mismatch / RetainedEarningsAccumulatedDeficit | 17 | INTC 0000050863-14-000029 — Retained earnings |
| income / value_mismatch / NetIncomeLossAvailableToCommonStockholdersBasic | 15 | GS 0000886982-26-000294 — Net earnings to common |
| balance / value_mismatch / DeferredTaxLiabilitiesNoncurrent | 14 | INTC 0000050863-14-000065 — Long-term deferred tax liabilities |
| income / value_mismatch / NoninterestExpense | 14 | GS 0000886982-26-000294 — Total operating expenses |
| balance / value_mismatch / PropertyPlantAndEquipmentNet | 13 | NVDA 0001045810-11-000006 — Property and equipment, net |
| income / value_mismatch / InterestIncomeExpenseNet | 13 | GS 0000886982-26-000294 — Net interest income |
| income / value_mismatch / IncomeLossFromContinuingOperationsPerDilutedShare | 12 | COF 0000927628-16-000126 — Net income from continuing operations |
| income / value_mismatch / OtherNoninterestExpense | 12 | GS 0000886982-26-000294 — Other expenses |
| balance / value_mismatch / AccumulatedOtherComprehensiveIncomeLossNetOfTax | 11 | FCX 0000831259-10-000004 — Accumulated other comprehensive loss |
| income / value_mismatch / NoninterestIncome | 11 | GS 0000886982-26-000294 — Total non-interest revenues |
| income / value_mismatch / OccupancyNet | 11 | GS 0000886982-26-000294 — Occupancy |
| balance / value_mismatch / LiabilitiesNoncurrent | 10 | DAL 0000027904-26-000008 — Total noncurrent liabilities |
| balance / value_mismatch / OtherAssetsCurrent | 10 | INTC 0000050863-14-000065 — Other current assets |

### Artifacts, repeatability evidence and limits

Final generation time: **2026-11-11T10:01:06.788Z**. Builder commit
`84fbe958af8eb1cfa2b9ded1667d62b89ec0266d`; code hash
`dd49b64d157d25529af745fca4f78c8b5e858e4171886e5dcca817f79ddee64d`.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `D:\research\alpha-engine\engine\flash\statements.jsonl` | 20,479,744 | `b6f8e83a9cf752078d6ec1a76eed1898d3ed6435a82e1726c784a055900176cd` |
| `D:\research\alpha-engine\engine\flash\values.jsonl` | 358,156,079 | `9630456dc8dc34f0c42d0ec3e07e0b6f74dd858242a1c1f488efe02380a6ccea` |
| `D:\research\alpha-engine\engine\flash\grades.jsonl` | 64,092,966 | `c8e58b4f8208e2482a16fe2093b25050341ad30e6b02945f179f4842d37f7f4d` |
| `D:\research\alpha-engine\engine\flash\residual.jsonl` | 95,279,132 | `117332243a6b1137ffe92b338c3762d8f2b53dbfa6bed82d7ec268d6de75d731` |
| `D:\research\alpha-engine\engine\flash\manifest.json` | 1,441 | `e72a09e3614aedb3333cefd0905e05c20b6759dc1789be7c0a8a64b81397c487` |
| `research/engine/flash-statements-50.summary.json` | 80,358 | `ad7b56058064b1944e6523dd47c0294f25248b1e363bad1b2b9b682c3d267869` |

Two consecutive post-commit runs each reported **3,609 cache hits / 0 releases processed again / 0 errors**.
All four JSONL byte counts and hashes above are identical across those runs. The manifest's generation time and
hash changed (`b1e5380be6bdc9bc680dd374940fd7383c455525ef0ed4858bbee0c5b734c6dd` on the first run to
`e72a09e3614aedb3333cefd0905e05c20b6759dc1789be7c0a8a64b81397c487` on the second), which is the allowed
generation-time exception. Per-release checkpoints are under `D:\research\alpha-engine\engine\flash\releases\`.
The committed summary contains the same overall/year/company tables, period exceptions, mismatch patterns and
PIT evidence in machine-readable form.

Known limits are unchanged from the task scope: only cached HTML EX-99 exhibits are read; page images, hidden
text layers and 8-K-body tables are K05/other work; plain-text releases, non-GAAP, guidance, segments and
change tables are excluded. Unnamed rows remain residual work for K04, not guessed concepts. Fourth-quarter
three-month figures and unpaired releases are not gradable. Coverage and grading are extraction-quality
measurements, not predictive or alpha evidence.
