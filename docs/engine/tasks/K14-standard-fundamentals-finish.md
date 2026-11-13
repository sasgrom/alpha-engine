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
  - `...\standard\v3-mech\` was the baseline for Stage A: v2 plus the zero rule, with no overrides.
  - `...\standard\v3-base\` is the baseline for Stage B (rebuilt 2026-11-13 with lab `cd2f158`, checks `35ec948`): v3-mech plus the restated-basis rule and quarter numbers for 10-Qs labelled "FY" (BXP and 9 others), with no overrides. QA and checks have been run on it; the first restated-basis baseline is kept as `v3-base-8f6afc0`.
  - Freshness counts original 10-Q/10-K filings. An amendment of a quarter we hold (TECH's 10-Q/A of 2026-11-12) is listed under `freshness.amendedSince` for information.
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
4. **The four negative fourth-quarter revenues** in `qa.json`: WMB 2011, JCI 2012, AES 2017, AOS 2010. **Moved to Claude after Stage A; do not map.**
   - They are a build rule, not a tag mapping.
   - A filing that restates its prior-year comparatives (a business moved to discontinued operations) is on a new basis. The build subtracted the earlier filing's year-to-date figure, which is on the old basis.
   - Examples: WMB Q4 2011, first version −17m; BAX Q3 2024 capex, first version −22m.
   - Claude adds the rule to `build.mts` and publishes a new baseline for the Stage B comparison.

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
- `magnitude`: true only when every part of the expression is an outflow in every filing of the range and filings store the sign either way. Each fact then counts by its absolute value before any year-to-date difference, and the expression's signs apply after;
- `evidence`: the filing (accession and period), the statement line or lines and their printed values, and that the tags give those values;
- `by`: "kimi";
- `reviewed`: false.

The build rejects an entry without evidence.

**Several periods for one field** (added after the NextEra pilot, lab commit after `0e2aba7`): a field's value may be a list of entries instead of one entry. Each entry has its own `from`/`until` and tags, and the ranges must not overlap. Each quarter uses the entry for its own quarter end. Where the build pairs year-to-date figures across a rename, each figure is read with the entry of its own quarter. End one entry at the last quarter of the old names and start the next at the first quarter of the new ones. The new entry does not need to repeat the old names.

End an entry inside a fiscal year only at a rename, where both sides carry the same lines. An entry may also leave a line out on purpose for some quarters. Example: NextEra's Q1 2019 without the line that holds the Gulf Power purchase. Then the quarters after it in that year must come from `y:` (one expression, differenced), never from `x:`. An `x:` there would set a year-to-date figure with the line against one without it. Check the sources in the build output.

```json
"753308": { "capex": [
  { "until": "2010-09-30", "tags": ["-custom:CapitalExpendituresOfFpl-custom:IndependentPowerInvestments-…", "-custom:CapitalExpendituresOfFPL-…"], "magnitude": true, "use": "first", "evidence": "…", "by": "kimi", "reviewed": false },
  { "from": "2010-10-01", "until": "2018-12-31", "tags": ["-custom:CapitalExpendituresOfPublicUtility-…"], "magnitude": true, "use": "first", "evidence": "…", "by": "kimi", "reviewed": false }
] }
```

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
3. Run `qa.mts`, `checks.py`, and `compare.py …\v3-base …\v3`.
4. Run the review workbook into `…\v3\Standard fundamentals v3 - review.xls`:
   `python C:/dev/alpha-engine-lab/tools/fundamentals/review-workbook.py <out> …\v3 …\v2`, with `XLWT_PATH` set to a folder where you pip-installed xlwt and xlrd. That folder must be outside both repositories.

## Rules

- **Edit only** `C:\dev\alpha-engine-lab\src\fundamentals\overrides.json`.
  - Your mining scripts may go in `C:\dev\alpha-engine-lab\src\fundamentals\k14\`.
  - Do not change `build.mts`, `fields.mts`, `checks.py`, `compare.py`, `qa.mts`, `fsds-*`, `edgar-filings-*` or the review workbook script. If something is missing, ask through the mailbox.
- **Lab commits:** commit there (local repository, no remote) with clear messages.
- **Outputs:** write only to `…\standard\v3-pilot\` and `…\standard\v3\`. Never write to v1, v2, v3-mech or v3-base.
- **Read only:**
  - the SEC data-set files and extracts, and the newest filings' files;
  - the `facts` table: SELECT per company (`WHERE cik = ?`) only.
- **Never:** production writes, schema changes, scheduler entries, web restarts, network requests, LLM calls or GDELT requests.
- **Point in time:** an override reads only what the filings reported, with their own filing dates. Never fill a value from a later filing into an earlier version.
- **Real gaps** are listed, not mapped. Examples: banks' and insurers' cost of revenue, gross profit and operating income.

## Acceptance gates (stage B)

1. **compare.py, v3-base → v3:**
   - 0 broken filing matches and 0 removed values.
   - Every changed value (only `use: first` entries can change one) is listed in the delivery report with its reason.
2. **checks.py on v3:**
   - Each field's filing-match share is at least the baseline's.
   - Freshness stays at 0.
   - The revenue "largest printed line" share is at least 96.10%.
   - Every remaining "stops early" item is listed with its reason. Target: each field's count at least halved.
3. **qa.mts on v3:** no check worse than the baseline. The baseline's (v3-base) off counts: grossProfit 516, cashChange 622, signs 244, revenueJumps 59, assetJumps 48, negativeQ4Revenue 1 (A. O. Smith Q4 2010, which the rule cannot see; leave it).
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


# Delivery report — K14 Stage B

## Scope and mechanism

- 94 companies have company-specific mappings in 110 entries. Every entry has statement evidence, by: kimi, reviewed: false.
- The entries added 2093 company-quarter values. They changed 180 existing direct values and added 6 original filing vintages without replacing the later version. Dependent identities changed 82 further values.
- Full normalized mapping table, all changed values and dependent identity changes: `D:/research/alpha-engine/fundamentals/standard/v3/mapping-report.md` and `D:/research/alpha-engine/fundamentals/standard/v3/mapping-report.json`.
- Full build: 502 company IDs, 500 with quarterly series, 30,754 company-quarters since 2010. Build log: 65 filings supplemented from the SEC financial statement data sets.

## Acceptance evidence

- compare.py, v3-base to v3: **0 removed values and 0 broken filing matches**. Direct changes: revenue 169, intexp 1, depamor 5, debt 1, capex 4; the six original-vintage additions are GE intexp 1, Microsoft depamor 4 and CrowdStrike depamor 1. The other changed values are dependent identities, listed in the report.
- QA: grossProfit 511 (baseline 516), cashChange 622 (622), signs 244 (244), revenueJumps 58 (baseline 59), assetJumps 48 (48), negativeQ4Revenue 1 (1, the documented A. O. Smith case).
- checks.py: freshness 0; revenue largest printed line 96.58% (gate: at least 96.10%); the same five revenue tie-out differences as the baseline, all other field differences unchanged. TECH's amendment is information, not a missed filing.
- Review workbook: `D:/research/alpha-engine/fundamentals/standard/v3/Standard fundamentals v3 - review.xls`, 662,016 bytes; opened successfully with xlrd (9 sheets).

## Continuity

- grossProfit/costRev: 51 -> 21/20; opinc 22 -> 9; capex 38 -> 17; revenue 1 -> 0; netinc 2 -> 0; ncfo 1 -> 0.
- debt 35 -> 20, sharesBasic 20 -> 20, shareswa 8 -> 7, epsDil 3 -> 2. The halving target was not met for those four series. Every remaining item and its reason is listed in `D:/research/alpha-engine/fundamentals/standard/v3/remaining-stops.md`.

## Override table

| Company | Field | Tags | Use | Period | Evidence filing | Added quarters | Changed quarters |
|---|---|---|---|---|---|---:|---:|
| AEP (4904) | depamor | UtilitiesOperatingExpenseDepreciationAndAmortization | fallback | 2011-06-30 to latest | 0000004904-26-000059 | 61 (2011-06-30 to 2026-09-30) | 0 |
| BALL (9389) | opinc | IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments-InterestIncomeOperating+InterestExpenseDebt<br>RevenueFromContractWithCustomerIncludingAssessedTax-CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization-DepreciationAndAmortization-SellingGeneralAndAdministrativeExpense-RestructuringAndOtherActivities | fallback | 2024-06-30 to latest | 0001104659-26-090226 | 10 (2024-06-30 to 2026-09-30) | 0 |
| BAX (10456) | capex | -PaymentsToAcquireOtherProductiveAssets | fallback | 2024-03-31 to latest | 0001628280-24-019786 | 11 (2024-03-31 to 2026-09-30) | 0 |
| WRB (11544) | capex | -custom:PaymentstoAcquirePropertyPlantandEquipmentNet | fallback | 2020-03-31 to 2025-12-31 | 0000011544-20-000030 | 24 (2020-03-31 to 2025-12-31) | 0 |
| FRT (34903) | debt | SecuredDebt+NotesPayable+UnsecuredDebt | fallback | 2026-03-31 to latest | 0000034903-26-000042 | 3 (2026-03-31 to 2026-09-30) | 0 |
| FRT (34903) | capex | -custom:CapitalExpendituresDevelopmentRedevelopment-custom:CapitalExpendituresOther<br>-custom:CapitalExpendituresDevelopmentRedevelopment-PaymentsForCapitalImprovements | first | 2019-03-31 to latest | 0000034903-19-000021 | 27 (2020-03-31 to 2026-09-30) | 4 |
| GD (40533) | costRev | CostsAndExpenses-GeneralAndAdministrativeExpense | fallback | 2020-01-01 to latest | 0000040533-20-000057 | 27 (2020-03-29 to 2026-10-04) | 0 |
| GE (40545) | intexp | custom:InterestAndOtherFinancialCharges | fallback | 2009-06-30 to latest | 0000040545-26-000049 | 66 (2009-06-30 to 2026-06-30) | 1 |
| GE (40545) | costRev | CostsAndExpenses-SellingGeneralAndAdministrativeExpense-RestructuringAndRelatedCostIncurredCost-ResearchAndDevelopmentExpense-custom:InterestAndOtherFinancialCharges-custom:InvestmentContractsInsuranceLossesInsuranceAnnuityBenefitsAndOther-custom:BenefitCostIncomeNonoperating | fallback | 2025-03-31 to latest | 0000040545-26-000049 | 6 (2025-03-31 to 2026-06-30) | 0 |
| GPC (40987) | opinc | GrossProfit-OperatingExpenses | fallback | 2016-06-30 to latest | 0000040987-26-000033 | 42 (2016-06-30 to 2026-09-30) | 0 |
| HAL (45012) | costRev | CostsAndExpenses-RestructuringSettlementAndImpairmentProvisions-GeneralAndAdministrativeExpense<br>CostsAndExpenses-GeneralAndAdministrativeExpense | fallback | 2018-09-30 to 2023-03-31 | 0000045012-23-000027 | 19 (2018-09-30 to 2023-03-31) | 0 |
| HAL (45012) | costRev | CostsAndExpenses-RestructuringSettlementAndImpairmentProvisions-GeneralAndAdministrativeExpense-custom:SAPS4UpgradeExpense<br>CostsAndExpenses-custom:SAPS4UpgradeExpense-GeneralAndAdministrativeExpense | fallback | 2023-04-01 to latest | 0000045012-23-000046 | 13 (2023-06-30 to 2026-06-30) | 0 |
| IP (51434) | opinc | IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments-InterestIncomeExpenseNet-NetPeriodicDefinedBenefitsExpenseReversalOfExpenseExcludingServiceCostComponent | fallback | 2024-12-31 to latest | 0000051434-26-000123 | 8 (2024-12-31 to 2026-09-30) | 0 |
| NTRS (73124) | debt | OtherBorrowings+SeniorNotes+custom:SubordinatedDebtAndLongTermFederalHomeLoanBankAdvances | fallback | 2013-03-31 to latest | 0000073124-26-000047 | 9 (2022-12-31 to 2026-06-30) | 0 |
| PCAR (75362) | intexp | custom:InterestAndOtherBorrowingExpense | fallback | 2024-12-31 to latest | 0001193125-26-323642 | 7 (2024-12-31 to 2026-06-30) | 0 |
| SLB (87347) | costRev | RevenueFromContractWithCustomerExcludingAssessedTax+custom:InterestIncomeAndOther-ResearchAndDevelopmentExpense-GeneralAndAdministrativeExpense-RestructuringCharges-BusinessCombinationIntegrationRelatedCosts-InterestExpense-IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest<br>RevenueFromContractWithCustomerExcludingAssessedTax+custom:InterestIncomeAndOther-ResearchAndDevelopmentExpense-GeneralAndAdministrativeExpense-BusinessCombinationIntegrationRelatedCosts-InterestExpense-IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest | fallback | 2024-06-30 to latest | 0001193125-26-322595 | 9 (2024-06-30 to 2026-06-30) | 0 |
| SHW (89800) | opinc | IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest+InterestExpenseNonoperating-InvestmentIncomeNet+OtherNonoperatingIncomeExpense | fallback | 2024-06-30 to latest | 0000089800-26-000049 | 8 (2024-12-31 to 2026-09-30) | 0 |
| SO (92122) | costRev | CostsAndExpenses-UtilitiesOperatingExpenseMaintenanceAndOperations-custom:DepreciationAndAmortizationExcludingNuclearFuel-TaxesExcludingIncomeAndExciseTaxes | fallback | 2021-09-30 to latest | 0000092122-26-000054 | 21 (2021-09-30 to 2026-09-30) | 0 |
| STT (93751) | debt | OtherShortTermBorrowings+LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities | fallback | 2016-12-31 to latest | 0000093751-26-000397 | 40 (2016-12-31 to 2026-09-30) | 0 |
| TMO (97745) | costRev | CostsAndExpenses-SellingGeneralAndAdministrativeExpense-ResearchAndDevelopmentExpense-custom:RestructuringAndOtherCostsIncomeNet<br>CostsAndExpenses-SellingGeneralAndAdministrativeExpense-ResearchAndDevelopmentExpense-RestructuringSettlementAndImpairmentProvisions | fallback | 2020-03-31 to latest | 0000097745-26-000144 | 25 (2020-06-27 to 2026-06-27) | 0 |
| RTX (101829) | revenue | Revenues | first | 2010-09-30 to 2010-09-30 | 0001193125-10-235003 | 0 | 1 |
| RTX (101829) | costRev | CostsAndExpenses-ResearchAndDevelopmentExpense-SellingGeneralAndAdministrativeExpense | fallback | 2021-03-31 to latest | 0000101829-26-000027 | 23 (2021-03-31 to 2026-09-30) | 0 |
| TJX (109198) | opinc | RevenueFromContractWithCustomerIncludingAssessedTax-CostOfGoodsAndServicesSold-SellingGeneralAndAdministrativeExpense | fallback | 2019-05-04 to latest | 0001628280-19-007432 | 30 (2019-05-04 to 2026-08-01) | 0 |
| JNJ (200406) | opinc | GrossProfit-SellingGeneralAndAdministrativeExpense-ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost-ResearchAndDevelopmentInProcess1-RestructuringCharges<br>GrossProfit-SellingGeneralAndAdministrativeExpense-ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost-RestructuringCharges | fallback | 2015-06-28 to latest | 0000200406-26-000153 | 46 (2015-06-28 to 2026-09-27) | 0 |
| TXT (217346) | costRev | OtherCostAndExpenseOperating-ResearchAndDevelopmentExpense-SellingGeneralAndAdministrativeExpense-InterestIncomeExpenseNet-SpecialCharges-NetPeriodicDefinedBenefitsExpenseReversalOfExpenseExcludingServiceCostComponent<br>OtherCostAndExpenseOperating-ResearchAndDevelopmentExpense-SellingGeneralAndAdministrativeExpense-InterestIncomeExpenseNet-NetPeriodicDefinedBenefitsExpenseReversalOfExpenseExcludingServiceCostComponent | fallback | 2022-01-01 to latest | 0000217346-26-000036 | 11 (2024-03-30 to 2026-10-03) | 0 |
| DE (315189) | costRev | CostsAndExpenses-ResearchAndDevelopmentExpense-SellingGeneralAndAdministrativeExpense-InterestExpense-OtherCostAndExpenseOperating<br>CostsAndExpenses-ResearchAndDevelopmentExpense-SellingGeneralAndAdministrativeExpense-InterestExpense | fallback | 2021-01-31 to latest | 0001104659-26-102213 | 23 (2021-01-31 to 2026-08-02) | 0 |
| KLAC (319201) | opinc | RevenueFromContractWithCustomerExcludingAssessedTax-CostOfRevenue-ResearchAndDevelopmentExpense-SellingGeneralAndAdministrativeExpense-AssetImpairmentCharges | fallback | 2015-06-30 to latest | 0000319201-26-000027 | 13 (2019-09-30 to 2026-06-30) | 0 |
| D (715957) | capex | -custom:PaymentsToAcquirePropertyPlantAndEquipmentIncludingNuclearFuel | fallback | 2026-06-30 to latest | 0001193125-26-327487 | 2 (2026-06-30 to 2026-09-30) | 0 |
| ATO (731802) | costRev | custom:CostOfRevenueNet | fallback | 2025-06-30 to latest | 0000731802-26-000102 | 5 (2025-06-30 to 2026-06-30) | 0 |
| VZ (732712) | costRev | CostsAndExpenses-SellingGeneralAndAdministrativeExpense-DepreciationAndAmortization | fallback | 2018-06-30 to latest | 0000732712-26-000046 | 34 (2018-06-30 to 2026-09-30) | 0 |
| VZ (732712) | capex | -PaymentsToAcquireOtherProductiveAssets | fallback | 2019-12-31 to latest | 0000732712-20-000027 | 28 (2019-12-31 to 2026-09-30) | 0 |
| T (732717) | costRev | CostsAndExpenses-OtherCostOfOperatingRevenue-SellingGeneralAndAdministrativeExpense-GoodwillImpairmentLossAndAssetsDisposedOfByMethodOtherThanSaleInPeriodOfDispositionLossOnDisposition-DepreciationDepletionAndAmortization<br>CostsAndExpenses-OtherCostOfOperatingRevenue-SellingGeneralAndAdministrativeExpense-DepreciationDepletionAndAmortization | fallback | 2023-12-31 to latest | 0000732717-26-000297 | 12 (2023-12-31 to 2026-09-30) | 0 |
| VTR (740260) | capex | -PaymentsToAcquireOtherProductiveAssets | fallback | 2024-06-30 to latest | 0000740260-26-000024 | 10 (2024-06-30 to 2026-09-30) | 0 |
| EXPD (746515) | costRev | DirectOperatingCosts | fallback | 2013-06-30 to latest | 0001193125-26-334457 | 33 (2018-09-30 to 2026-09-30) | 0 |
| NEE (753308) | capex | -custom:CapitalExpendituresOfFPL-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:ProceedsPaymentsFromOtherCapitalExpenditures<br>-custom:CapitalExpendituresOfFPL-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:OtherCapitalExpenditures<br>-custom:CapitalExpendituresOfFPLSegment-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:OtherCapitalExpenditures<br>-custom:CapitalExpendituresOfPublicUtility-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:OtherCapitalExpenditures<br>-custom:CapitalExpendituresOfFpl-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:OtherCapitalExpenditures | fallback + magnitude | start to 2019-03-31 | 0000753308-11-000025 | 43 (2008-09-30 to 2019-03-31) | 0 |
| NEE (753308) | capex | -custom:CapitalExpendituresOfPublicUtility-custom:PaymentsToAcquireBusinessesGrossAndRelatedCapitalExpenditures-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:OtherCapitalExpenditures | fallback + magnitude | 2019-04-01 to 2020-12-31 | 0000753308-19-000165 | 7 (2019-06-30 to 2020-12-31) | 0 |
| NEE (753308) | capex | -custom:CapitalExpendituresOfFPLSegment-custom:CapitalExpendituresOfGulfPowerSegment-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:OtherCapitalExpenditures | fallback + magnitude | 2021-01-01 to 2021-12-31 | 0000753308-22-000014 | 4 (2021-03-31 to 2021-12-31) | 0 |
| NEE (753308) | capex | -custom:CapitalExpendituresOfFPL-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:ProceedsPaymentsFromOtherCapitalExpenditures<br>-custom:CapitalExpendituresOfFPL-custom:IndependentPowerInvestments-PaymentsForProceedsFromNuclearFuel-custom:OtherCapitalExpenditures | fallback + magnitude | 2022-01-01 to latest | 0000753308-26-000031 | 19 (2022-03-31 to 2026-09-30) | 0 |
| DOC (765880) | costRev | OperatingCostsAndExpenses | fallback | 2017-03-31 to latest | 0001628280-26-053373 | 4 (2025-12-31 to 2026-09-30) | 0 |
| MSFT (789019) | depamor | custom:DepreciationAmortizationAndOther<br>custom:DepreciationAmortizationAndOtherNoncashItems | fallback | 2009-09-30 to latest | 0001193125-26-323660 | 60 (2009-09-30 to 2024-06-30) | 4 |
| MGM (789570) | revenue | custom:GrossRevenue | first | start to 2012-12-31 | 0000950123-10-074532 | 0 | 14 |
| MGM (789570) | revenue | SalesRevenueGoodsGross | first | 2013-01-01 to 2014-12-31 | 0001193125-13-431308 | 0 | 7 |
| MGM (789570) | revenue | custom:GrossRevenue | first | 2015-01-01 to 2017-12-31 | 0001564590-17-023064 | 0 | 12 |
| OXY (797468) | costRev | ResultsOfOperationsExpenseFromOilAndGasProducingActivities+custom:TransportationAndGatheringExpense | fallback | 2025-12-31 to latest | 0001628280-26-053388 | 3 (2025-12-31 to 2026-06-30) | 0 |
| FISV (798354) | depamor | OtherDepreciationAndAmortization+custom:AmortizationOfAcquisitionRelatedIntangibleAssets<br>OtherDepreciationAndAmortization+custom:AmortizationofAcquisitionRelatedIntangibleAssets<br>OtherDepreciationAndAmortization+custom:AmortizationOfAcquiredIntangibleAssets1<br>OtherDepreciationAndAmortization+AmortizationOfAcquiredIntangibleAssets<br>custom:DepreciationAndOtherAmortization+custom:AmortizationOfAcquiredIntangibleAssets | fallback | 2009-06-30 to latest | 0000798354-26-000031 | 69 (2009-06-30 to 2026-06-30) | 0 |
| FISV (798354) | costRev | CostsAndExpenses-SellingGeneralAndAdministrativeExpense | fallback | 2019-06-30 to latest | 0000798354-25-000047 | 30 (2019-06-30 to 2026-09-30) | 0 |
| CDNS (813672) | costRev | CostsAndExpenses-SellingAndMarketingExpense-ResearchAndDevelopmentExpense-GeneralAndAdministrativeExpense-AmortizationOfIntangibleAssets | fallback | 2013-03-30 to latest | 0000813672-23-000041 | 21 (2020-03-28 to 2026-09-30) | 0 |
| CCL (815097) | costRev | OperatingCostsAndExpenses | fallback | 2025-11-30 to latest | 0000815097-26-000107 | 4 (2025-11-30 to 2026-08-31) | 0 |
| PHM (822416) | debt | custom:FinancialServicesDebt+NotesPayable | fallback | 2026-03-31 to latest | 0000822416-26-000036 | 2 (2026-03-31 to 2026-06-30) | 0 |
| SBUX (829224) | costRev | ProductionAndDistributionCosts | fallback | 2020-06-28 to latest | 0000829224-26-000130 | 26 (2020-06-28 to 2026-09-27) | 0 |
| JCI (833444) | opinc | GrossProfit-SellingGeneralAndAdministrativeExpense-RestructuringCostsAndAssetImpairmentCharges | fallback | 2016-09-30 to latest | 0000833444-26-000087 | 20 (2021-12-31 to 2026-09-30) | 0 |
| CSCO (858877) | depamor | custom:DepreciationAmortizationAndOther<br>custom:DepreciationAmortizationAndOtherNoncashItems | fallback | 2010-10-31 to latest | 0000858877-26-000132 | 60 (2011-01-29 to 2026-07-25) | 0 |
| REGN (872589) | costRev | CostsAndExpenses-ResearchAndDevelopmentExpense-AcquiredInProcessResearchAndDevelopment-SellingGeneralAndAdministrativeExpense<br>CostsAndExpenses-ResearchAndDevelopmentExpense-SellingGeneralAndAdministrativeExpense | fallback | 2018-06-30 to latest | 0000872589-26-000025 | 34 (2018-06-30 to 2026-09-30) | 0 |
| KIM (879101) | debt | NotesPayable+SecuredDebt | fallback | 2026-03-31 to latest | 0001193125-26-331817 | 3 (2026-03-31 to 2026-09-30) | 0 |
| KIM (879101) | capex | -custom:PaymentsForImprovementsToOperatingRealEstate | fallback | 2026-03-31 to latest | 0001193125-26-331817 | 3 (2026-03-31 to 2026-09-30) | 0 |
| INCY (879169) | capex | -PaymentsToAcquireOtherProductiveAssets | fallback | 2023-03-31 to latest | 0000879169-23-000016 | 15 (2023-03-31 to 2026-09-30) | 0 |
| ROP (882835) | capex | -PaymentsToAcquireOtherProductiveAssets | fallback | 2019-12-31 to latest | 0000882835-20-000006 | 28 (2019-12-31 to 2026-09-30) | 0 |
| INTU (896878) | costRev | CostsAndExpenses-CostOfGoodsAndServicesSoldAmortization-SellingAndMarketingExpense-ResearchAndDevelopmentExpense-GeneralAndAdministrativeExpense-AmortizationOfIntangibleAssets-RestructuringCharges | fallback | 2020-10-31 to latest | 0000896878-26-000037 | 12 (2023-10-31 to 2026-07-31) | 0 |
| CPRT (900075) | costRev | DirectOperatingCosts+CostDirectMaterial | fallback | 2020-10-31 to latest | 0001193125-26-405731 | 24 (2020-10-31 to 2026-07-31) | 0 |
| VMRK (906107) | costRev | CostOfPropertyRepairsAndMaintenance+RealEstateTaxesAndInsurance+custom:CostOfPropertyManagement | fallback | 2011-06-30 to latest | 0001193125-26-326170 | 36 (2017-09-30 to 2026-06-30) | 0 |
| VMRK (906107) | capex | -custom:PaymentsForCapitalExpendituresToRealEstate | fallback | 2020-12-31 to latest | 0001193125-26-326170 | 23 (2020-12-31 to 2026-06-30) | 0 |
| CPT (906345) | revenue | OperatingLeaseLeaseIncome | first | 2019-03-31 to latest | 0000906345-19-000033 | 0 | 31 |
| REG (910606) | epsDil | IncomeLossFromContinuingOperationsPerDilutedShare | fallback | 2021-03-31 to latest | 0001193125-26-203537 | 18 (2021-03-31 to 2026-09-30) | 0 |
| MAA (912595) | opinc | IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments+InterestExpense-GainLossOnSaleOfPropertyPlantEquipment-OtherNonoperatingIncomeExpense<br>Revenues-PropertyOperatingExpenses-OtherCostAndExpenseOperating-GeneralAndAdministrativeExpense | fallback | 2013-12-31 to latest | 0001193125-26-326153 | 29 (2019-09-30 to 2026-09-30) | 0 |
| ESS (920522) | capex | -custom:RedevelopmentExpenditures | fallback | 2015-03-31 to latest | 0000920522-15-000020 | 47 (2015-03-31 to 2026-09-30) | 0 |
| LEN (920760) | costRev | CostsAndExpenses-GeneralAndAdministrativeExpense-custom:ContributionExpense<br>CostsAndExpenses-GeneralAndAdministrativeExpense | fallback | 2021-02-28 to latest | 0001628280-26-046019 | 21 (2021-02-28 to 2026-08-31) | 0 |
| WAT (1000697) | costRev | CostsAndExpenses-SellingGeneralAndAdministrativeExpense-ResearchAndDevelopmentExpense-AmortizationOfAcquisitionCosts-RestructuringCharges<br>CostsAndExpenses-SellingGeneralAndAdministrativeExpense-ResearchAndDevelopmentExpense-AmortizationOfAcquisitionCosts | fallback | 2026-03-31 to latest | 0001193125-26-344691 | 3 (2026-04-04 to 2026-10-03) | 0 |
| VRSN (1014473) | debt | SeniorLongTermNotes+SeniorNotesCurrent<br>SeniorLongTermNotes<br>SeniorNotes | fallback | 2014-03-31 to latest | 0001014473-26-000028 | 48 (2014-12-31 to 2026-09-30) | 0 |
| RL (1037038) | revenue | custom:RevenuesNet | first | 2010-07-03 to 2011-07-02 | 0000950123-10-075672 | 0 | 5 |
| CHRW (1043277) | costRev | CostsAndExpenses-LaborAndRelatedExpense-OtherSellingGeneralAndAdministrativeExpense | fallback | 2018-06-30 to latest | 0001043277-26-000031 | 34 (2018-06-30 to 2026-09-30) | 0 |
| PLD (1045609) | capex | -custom:PaymentForPropertyImprovements | fallback | 2019-09-30 to latest | 0001564590-19-037228 | 29 (2019-09-30 to 2026-09-30) | 0 |
| ED (1047862) | capex | -PaymentsForConstructionInProcess-custom:PaymentsNonUtilityConstructionExpenditures<br>-PaymentsForConstructionInProcess | fallback | 2020-03-31 to latest | 0001047862-25-000011 | 27 (2020-03-31 to 2026-09-30) | 0 |
| FDX (1048911) | costRev | custom:PurchasedTransportationCosts | fallback | 2019-11-30 to latest | 0001048911-26-000105 | 27 (2019-11-30 to 2026-05-31) | 0 |
| AMT (1053507) | costRev | DirectCostsOfLeasedAndRentedPropertyOrEquipment | fallback | 2020-06-30 to latest | 0001053507-26-000133 | 26 (2020-06-30 to 2026-09-30) | 0 |
| URI (1067701) | capex | -custom:PaymentsToAcquirePropertySubjectToOrAvailableForOperatingLease-custom:PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets | fallback | 2025-03-31 to latest | 0001067701-26-000026 | 6 (2025-03-31 to 2026-06-30) | 0 |
| HST (1070750) | debt | DebtAndCapitalLeaseObligations | fallback | 2026-03-31 to latest | 0001070750-26-000126 | 3 (2026-03-31 to 2026-09-30) | 0 |
| BKNG (1075531) | netinc | NetIncomeLossAvailableToCommonStockholdersBasic | fallback | 2016-03-31 to latest | 0001075531-26-000037 | 43 (2016-03-31 to 2026-09-30) | 0 |
| DVN (1090012) | costRev | custom:TotalExpenses-ExplorationExpense-DepreciationDepletionAndAmortization-ImpairmentOfLongLivedAssetsHeldForUse-GainLossOnDispositionOfAssets1-GeneralAndAdministrativeExpense-InterestIncomeExpenseNonoperatingNet-RestructuringCosts-custom:OperatingAndNonoperatingOtherIncomeExpense | fallback | 2020-06-30 to latest | 0001193125-26-334340 | 5 (2025-03-31 to 2026-06-30) | 0 |
| DXCM (1093557) | debt | ConvertibleLongTermNotesPayable | fallback | 2015-12-31 to latest | 0001093557-26-000143 | 39 (2016-12-31 to 2026-09-30) | 0 |
| EG (1095073) | debt | SeniorNotes+SubordinatedDebt+AdvancesFromFederalHomeLoanBanks | fallback | 2011-09-30 to latest | 0001095073-26-000032 | 26 (2019-09-30 to 2026-09-30) | 0 |
| CRL (1100682) | costRev | RevenueFromContractWithCustomerExcludingAssessedTax-OperatingIncomeLoss-SellingGeneralAndAdministrativeExpense-AmortizationOfIntangibleAssets | fallback | 2024-12-28 to latest | 0001100682-26-000118 | 8 (2024-12-28 to 2026-09-26) | 0 |
| ILMN (1110803) | debt | LongTermDebtCurrent+OtherLongTermDebtNoncurrent+ConvertibleDebtNoncurrent<br>NotesPayableCurrent+ConvertibleDebtCurrent+LongTermNotesPayable+ConvertibleDebtNoncurrent<br>NotesPayableCurrent+ConvertibleDebtCurrent+OtherLongTermDebtNoncurrent+ConvertibleDebtNoncurrent<br>NotesPayableCurrent+ConvertibleDebtCurrent+LongTermNotesPayable<br>NotesPayableCurrent+LongTermNotesPayable<br>LongTermNotesPayable | first | 2022-04-03 to latest | 0001110803-22-000021 | 18 (2022-07-03 to 2026-09-27) | 1 |
| NI (1111711) | revenue | RegulatedOperatingRevenue | first | 2018-01-01 to 2024-09-30 | 0001111711-18-000049 | 0 | 27 |
| NOC (1133421) | costRev | OperatingExpenses-GeneralAndAdministrativeExpense | fallback | 2018-09-30 to latest | 0001133421-26-000034 | 27 (2020-03-31 to 2026-09-30) | 0 |
| CME (1156375) | debt | UnsecuredLongTermDebt | fallback | 2026-03-31 to latest | 0001156375-26-000047 | 3 (2026-03-31 to 2026-09-30) | 0 |
| COP (1163165) | opinc | IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest+InterestAndDebtExpense+ForeignCurrencyTransactionGainLossBeforeTax+OtherNonoperatingIncomeExpense-IncomeLossFromEquityMethodInvestments-GainLossOnSaleOfPropertyPlantEquipment-OtherOperatingIncomeExpenseNet | fallback | 2017-12-31 to latest | 0001163165-26-000032 | 22 (2020-06-30 to 2026-09-30) | 0 |
| WYNN (1174922) | revenue | custom:HotelAndCasinoRevenueGross | first | start to 2011-12-31 | 0001193125-10-181746 | 0 | 10 |
| WYNN (1174922) | revenue | custom:GrossRevenue | first | 2012-01-01 to 2017-12-31 | 0001193125-12-225309 | 0 | 24 |
| AIZ (1267238) | debt | UnsecuredDebt | fallback | 2020-06-30 to latest | 0001267238-26-000041 | 26 (2020-06-30 to 2026-09-30) | 0 |
| EXR (1289490) | debt | OtherNotesPayable+UnsecuredDebt+SeniorNotes+LineOfCredit | fallback | 2025-03-31 to latest | 0001289490-26-000053 | 7 (2025-03-31 to 2026-09-30) | 0 |
| DLR (1297996) | debt | UnsecuredDebt+SeniorNotes+SecuredDebt | fallback | 2012-06-30 to latest | 0001104659-26-089296 | 19 (2019-12-31 to 2026-09-30) | 0 |
| LVS (1300514) | revenue | custom:GrossRevenue | first | start to 2017-12-31 | 0000950123-10-074550 | 0 | 35 |
| PANW (1327567) | debt | ConvertibleDebtNoncurrent | fallback | 2023-10-31 to latest | 0001327567-26-000023 | 3 (2025-07-31 to 2026-07-31) | 0 |
| VEEV (1393052) | capex | -PaymentsForSoftware | fallback | 2022-01-31 to latest | 0001393052-22-000017 | 19 (2022-01-31 to 2026-07-31) | 0 |
| PSA (1393311) | capex | -custom:CapitalExpendituresToMaintainRealEstateFacilities-custom:CapitalExpendituresForPropertyEnhancements-custom:CapitalExpendituresForEnergyEfficiencies<br>-custom:CapitalExpendituresToMaintainRealEstateFacilities | fallback | 2020-06-30 to latest | 0001562762-20-000278 | 25 (2020-06-30 to 2026-06-30) | 0 |
| KKR (1404912) | capex | -PaymentsToAcquireFurnitureAndFixtures | fallback | 2020-03-31 to latest | 0001404912-20-000011 | 27 (2020-03-31 to 2026-09-30) | 0 |
| TWLO (1447669) | capex | -PaymentsToAcquireOtherProductiveAssets | fallback | 2022-12-31 to latest | 0001447669-23-000049 | 16 (2022-12-31 to 2026-09-30) | 0 |
| CRWD (1535527) | depamor | custom:DepreciationAndAmortizationExcludingIntangibleAssetsAndDeferredContractAcquisitionCosts+AmortizationOfIntangibleAssets+custom:AmortizationOfDeferredContractAcquisitionCosts | fallback | 2019-04-30 to latest | 0001535527-26-000031 | 28 (2019-04-30 to 2026-04-30) | 1 |
| ETN (1551182) | opinc | RevenueFromContractWithCustomerExcludingAssessedTax-CostOfRevenue-SellingGeneralAndAdministrativeExpense-ResearchAndDevelopmentExpense | fallback | 2014-03-31 to latest | 0001551182-26-000030 | 37 (2017-09-30 to 2026-09-30) | 0 |
| ZTS (1555280) | opinc | Revenues-CostOfGoodsAndServicesSold-SellingGeneralAndAdministrativeExpense-ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost-custom:AmortizationOfIntangibleAssetsNotAssociatedWithSingleFunction-custom:RestructuringChargesAndAcquisitionAndDivestitureRelatedCosts | fallback | 2020-03-31 to latest | 0001555280-26-000040 | 13 (2023-06-30 to 2026-06-30) | 0 |
| VICI (1705696) | revenue | SalesRevenueNet | first | 2018-03-31 to 2018-06-30 | 0001705696-18-000025 | 0 | 2 |
| VICI (1705696) | revenue | RevenueFromContractWithCustomerExcludingAssessedTax | first | 2018-09-30 to 2018-09-30 | 0001705696-18-000086 | 0 | 1 |
| VICI (1705696) | opinc | IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest+InterestExpenseNonoperating-InvestmentIncomeInterest-OtherNonoperatingGainsLosses<br>Revenues-OperatingCostsAndExpensesNetOfAdjustments | fallback | 2021-03-31 to latest | 0001705696-26-000090 | 14 (2023-06-30 to 2026-09-30) | 0 |
| CI (1739940) | capex | -custom:PaymentsForProceedsFromPropertyPlantAndEquipment | fallback | 2020-03-31 to latest | 0001739940-20-000012 | 26 (2020-03-31 to 2026-06-30) | 0 |
| AMCR (1748790) | shareswa | WeightedAverageNumberOfSharesIssuedBasic | fallback | 2026-06-30 to latest | 0001748790-26-000031 | 2 (2026-06-30 to 2026-09-30) | 0 |
| DOW (1751788) | capex | -PaymentsToAcquireMachineryAndEquipment | fallback | 2026-06-30 to latest | 0001751788-26-000147 | 2 (2026-06-30 to 2026-09-30) | 0 |
| HOOD (1783879) | capex | -PaymentsToAcquireOtherProductiveAssets | fallback | 2023-12-31 to latest | 0001783879-24-000054 | 12 (2023-12-31 to 2026-09-30) | 0 |
| VTRS (1792044) | netinc | NetIncomeLossAvailableToCommonStockholdersBasic | fallback | 2020-12-31 to latest | 0001792044-26-000041 | 18 (2021-03-31 to 2026-09-30) | 0 |
| MRVL (1835632) | depamor | OtherDepreciationAndAmortization+AmortizationOfIntangibleAssets<br>DepreciationAndAmortization+custom:AmortizationAndImpairmentOfIntangibleAssets | fallback | 2023-01-31 to latest | 0001835632-26-000025 | 14 (2023-04-29 to 2026-08-01) | 0 |
| APA (1841666) | revenue | custom:RevenuesAndOther-GainLossOnDerivativeInstrumentsNetPretax-GainLossOnSaleOfBusiness-custom:OtherSalesRevenueLossesNet | fallback | 2021-09-30 to latest | 0001841666-26-000053 | 20 (2021-09-30 to 2026-06-30) | 0 |
