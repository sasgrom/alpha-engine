# K14 — Standard fundamentals: finish step 1 with company-specific tags

Task for Kimi Code. On 2026-11-12 the owner said: "lets finalize whats open in step 1, do you want to hand it to kimi? make sure he can handle it".

This is the mapping work. The machinery is built and tested:
- `overrides.json` and how the build reads it;
- the zero rule;
- `compare.py`.

The process, the rules and the gates are in `docs/engine/STANDARD_FUNDAMENTALS.md`. Read it first.

## LLM use

None.

## Where it stands

- **Builds:**
  - `D:\research\alpha-engine\fundamentals\standard\v2\` is the evaluated build.
  - `...\standard\v3-mech\` is the baseline for this task: v2 plus the zero rule, with no overrides. QA and checks have been run on it.
- **Code:** lab `C:\dev\alpha-engine-lab\src\fundamentals\` (commit `935307e`). The file you edit is `overrides.json`, which is empty now.
- **Your K13 candidates:** `D:\research\alpha-engine\fundamentals\standard\v1\gaps\gaps.json`.
- **SEC data sets, per company and quarter:** `D:\research\alpha-engine\fundamentals\fsds\extract\<quarter>\<cik>.json`. Each holds `filings[]` with:
  - `num`: `[tag, version, ddate, qtrs, uom, segments, value]`. Version `us-gaap/…` is a standard tag; a version equal to the accession number is the company's own tag. `ddate` is rounded to the month end. `qtrs` is 0 for an instant, else the number of quarters.
  - `pre`: `[report, line, stmt, inpth, tag, version, plabel, negating]`, the statement line each tag sits on and its printed label.
  - `custom`: the company's own tags' labels.
- **Newest filings' XBRL:** `D:\research\alpha-engine\fundamentals\edgar-filings\<cik>\<accession>\rows.json`. Own tags appear as `custom:Name`.

## The work

**Scope:** from the baseline's `checks.json`, `qa.json` and your K13 `gaps.json`.

1. **Series that stop while the company keeps filing** (`continuity.stops`):

   | Field | Companies |
   |---|---|
   | grossProfit / costRev | 51 |
   | capex | 38 |
   | debt | 35 |
   | opinc | 22 |
   | sharesBasic | 20 |
   | shareswa | 8 |
   | epsDil | 3 |
   | netinc | 2 |
   | revenue | 1 |
   | ncfo | 1 |

2. **Companies under 90% coverage since 2010** for capex, intexp, depamor, debt and opinc (K13 lists), where the company files the item on its own tag or on a standard tag missing from the field's list.
3. **Revenue that is not a printed income-statement line** (`revenueLine.companiesWithDifferences`, 44 companies). Typical cases are casinos before 2018 and companies whose `Revenues` tag has another scope. Decide per company: an override with `"use": "first"`, or a documented exception.
4. **The four negative fourth-quarter revenues** in `qa.json`: WMB 2011, JCI 2012, AES 2017, AOS 2010. Find the cause and fix it with an override, or document it.

**Method: follow the statement line across filings.**
- For a series that stops, find the line in the company's last filings that still carry it (PRE: the statement, line order and `plabel`). Find the same line, by label and position, in the later filings, and read its tag there.
  - It may be another standard tag: add it as a fallback override.
  - It may be the company's own tag: add `custom:Name`.
  - It may be a total that is now tagged only by part: use an identity of tagged lines, written with signed parts.
- For an item that never had a standard tag, take the line by its label and the statement it is on, and check its value against the statement.

**Worked example 1: General Dynamics (CIK 40533) cost of revenue, which stops in 2019.**
- In the 2019 10-Qs, IS line 10 "Cost of sales" is `CostOfGoodsAndServicesSold` with a value (Q2 2019: 7,869m).
- From 2020 the same line has no consolidated value. In 2020q3, `num` has only segment rows `ProductOrService=Service` 3,246m and `ProductOrService=Product` 4,603m.
- The line "Operating costs and expenses, total" (`CostsAndExpenses`, 8,423m) minus "General and administrative" (`GeneralAndAdministrativeExpense`, 574m) gives 7,849m, which equals 3,246 + 4,603.
- Entry:

  ```json
  "40533": { "costRev": { "tags": ["CostsAndExpenses-GeneralAndAdministrativeExpense"], "use": "fallback", "from": "2020-01-01",
    "evidence": "10-Q for 2020-06-28 (0000040533-20-000057, filed 2020-07-29): IS 'Cost of sales' tagged only by product/service (3,246m + 4,603m); 'Operating costs and expenses, total' 8,423m − 'G&A' 574m = 7,849m", "by": "kimi", "reviewed": false } }
  ```

  Gross profit then follows by its identity.

**Worked example 2: NextEra (CIK 753308) capex, which no standard tag carries.**
- The CF statement prints "Capital expenditures of FPL" (`custom:CapitalExpendituresOfFPL`) and "Independent power and other investments of NEER" (`custom:IndependentPowerInvestments`).
- `-custom:CapitalExpendituresOfFPL-custom:IndependentPowerInvestments` gives 23 quarters from 2021.
- Before 2021 the same lines carry other own-tag names. Find them by their labels in the earlier filings and list every name, so the series reaches back to 2009.
- Decide with evidence whether "Nuclear fuel purchases" (standard `PaymentsForProceedsFromNuclearFuel`) and "Other capital expenditures" belong to capex. Compare NextEra's own total capital expenditures in its filings.

**Each entry in `C:\dev\alpha-engine-lab\src\fundamentals\overrides.json`:**
- `tags`;
- `use`: "fallback" unless the standard tag's scope is wrong for the company, then "first";
- `from` / `until` when the mapping holds only for a period;
- `evidence`: the filing (accession and period), the statement line or lines and their printed values, and that the tags give those values;
- `by`: "kimi";
- `reviewed`: false.

The build rejects an entry without evidence.

## Stages

**Stage A, the pilot. Stop after it and send me a message.**
1. Write five entries:
   - General Dynamics costRev (example 1);
   - NextEra capex back to 2009 (example 2);
   - one capex, one debt and one opinc case of your choice from the lists.
2. Build into `D:\research\alpha-engine\fundamentals\standard\v3-pilot\`:
   `STANDARD_DIR=…\v3-pilot\ npx tsx C:/dev/alpha-engine-lab/src/fundamentals/build.mts <the five CIKs>`
3. Run `python -I …/compare.py …\v3-mech …\v3-pilot`.
4. Report the entries, the compare output and each new series' first and last values.

I review before stage B.

**Stage B, everything.**
1. Write the remaining entries.
2. Build all companies into `…\standard\v3\`.
3. Run `qa.mts`, `checks.py`, and `compare.py …\v3-mech …\v3`.
4. Run the review workbook into `…\v3\Standard fundamentals v3 - review.xls`:
   `python C:/dev/alpha-engine-lab/tools/fundamentals/review-workbook.py <out> …\v3 …\v2`, with `XLWT_PATH` set to a folder where you pip-installed xlwt and xlrd. That folder must be outside both repositories.

## Rules

- **Edit only** `C:\dev\alpha-engine-lab\src\fundamentals\overrides.json`.
  - Your mining scripts may go in `C:\dev\alpha-engine-lab\src\fundamentals\k14\`.
  - Do not change `build.mts`, `fields.mts`, `checks.py`, `compare.py`, `qa.mts`, `fsds-*`, `edgar-filings-*` or the review workbook script. If something is missing, ask through the mailbox.
- **Lab commits:** commit there (local repository, no remote) with clear messages.
- **Outputs:** write only to `…\standard\v3-pilot\` and `…\standard\v3\`. Never write to v1, v2 or v3-mech.
- **Read only:**
  - the SEC data-set files and extracts, and the newest filings' files;
  - the `facts` table: SELECT per company (`WHERE cik = ?`) only.
- **Never:** production writes, schema changes, scheduler entries, web restarts, network requests, LLM calls or GDELT requests.
- **Point in time:** an override reads only what the filings reported, with their own filing dates. Never fill a value from a later filing into an earlier version.
- **Real gaps** are listed, not mapped. Examples: banks' and insurers' cost of revenue, gross profit and operating income.

## Acceptance gates (stage B)

1. **compare.py, v3-mech → v3:**
   - 0 broken filing matches and 0 removed values.
   - Every changed value (only `use: first` entries can change one) is listed in the delivery report with its reason.
2. **checks.py on v3:**
   - Each field's filing-match share is at least the baseline's.
   - Freshness stays at 0.
   - The revenue "largest printed line" share is at least 96.10%.
   - Every remaining "stops early" item is listed with its reason. Target: each field's count at least halved.
3. **qa.mts on v3:** no check worse than the baseline. The baseline's off counts: grossProfit 536, cashChange 630, signs 259, revenueJumps 61, assetJumps 48, negativeQ4Revenue 4.
4. **Overrides:** every entry has evidence. The report has a table: company, field, tags, use, period, evidence filing, and the quarters it added or changed.
5. **Documentation:** fill section 9 of `docs/engine/STANDARD_FUNDAMENTALS.md` with:
   - the method;
   - the counts;
   - the patterns found (tag renames, totals tagged only by part, own tags, scope differences);
   - the traps you hit.

## Delivery

- A delivery report in this file.
- A handoff note.
- A mailbox message to Claude at each stage.
- Main repository commits: this file, `docs/engine/STANDARD_FUNDAMENTALS.md` section 9 and the handoff. Commit nothing else there.
