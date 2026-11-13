# K13 — Standard fundamentals: which tags would fill the gaps

Task for Kimi Code. The owner approved handing routine work to Kimi on 2026-11-12 ("kimi is sitting idle, you can
offload routine work to him"). Read-only analysis: it changes neither the dataset nor its field definitions.

## LLM use

None.

## Where it stands

On 2026-11-12 the owner ordered the fundamentals to be rebuilt. Step 1 merges every company's SEC XBRL tags into one
quarterly series per standard field, named on the old database's convention. Claude built it, and the owner is now
evaluating it. Step 2 (normalization) waits for his instructions.

- Fields and their tags, in order of preference: `C:\dev\alpha-engine-lab\src\fundamentals\fields.mts`. Read only; do
  not edit the lab repository.
- Data: `D:\research\alpha-engine\fundamentals\standard\v1\`:
  - `company\<cik>.json`: `quarters[]` with `end`, `fy`, `fq`, `filed`, `form`; `sources[]`; and
    `fields[code] = [[quarterIndex, [[filed, value, sourceIndex], ...]], ...]`, all versions in filing order;
  - `index.json`: fields and companies;
  - `qa.json`: coverage per field and per company from 2010.
- A field is missing for a company-quarter when none of its tags (or identities) gives it. Some gaps are real (a
  bank has no cost of revenue). Others come from tags the company uses that are not yet in the field's list.

## What to build

For each field below, and for each company whose coverage of that field from 2010 is under 90%:

1. **The missing quarters:** the quarter ends from 2010 with no value for the field.
2. **The candidate tags:**
   - Source: the local `facts` table, read only. Use SELECT statements per company (`WHERE cik = ?`) on the
     existing `(cik, concept, endDate)` index. Never group over the whole table, because sort files land on the
     small C: drive.
   - What counts: the us-gaap tags the company files for those quarters. For flows, a duration ending at the
     quarter end (three months or year to date). For balances, an instant at the quarter end. Allow ±5 days.
   - Filter: names that match the field's pattern, excluding tags already in the field's list.
3. **The ranking:** rank the candidates by the number of companies and quarters each would fill.
4. **A scope check for the top 5 candidates of each field, on 3 sample companies:**
   - Give the candidate's value next to the field's own value in the nearest quarter where both exist.
   - Give the ratio between them. A ratio near 1 means the same scope; far from 1 means a part or a different
     measure.
   - Where the field has no value nearby, use the related check in the list.
5. **Coverage by sector:** report each field's coverage by sector, using the `sector` in
   `D:\research\alpha-engine\engine\events\universe-rest.json` and the 50-company file, so real gaps show
   (Financials for cost of revenue) and are not mistaken for missing tags.

| Field | Name pattern for candidate tags | Related check when the field has no value nearby |
| --- | --- | --- |
| costRev | `^Cost(s)?Of\|BenefitsLossesAndExpenses\|PolicyholderBenefits` | revenue − grossProfit |
| opinc | `OperatingIncome\|IncomeLossFromOperations` | ebt (should be close) |
| intexp | `Interest.*Expense\|InterestAndDebtExpense` | — |
| ebt | `BeforeIncomeTaxes` | netinc + taxExp |
| depamor | `Depreciation\|Amortization` | — |
| capex | `^PaymentsToAcquire\|^PaymentsFor(Capital\|Construction)\|CapitalExpenditure` | ncfi |
| sbcomp | `ShareBased\|StockBased\|StockCompensation` | — |
| payDiv | `Dividend` | — |
| buybacks | `Repurchase\|TreasuryStockAcquired` | — |
| debtCurrent | `Debt\|Borrowings\|Notes\|CommercialPaper` | liabilitiesCurrent (must be smaller) |
| debtNonCurrent | `Debt\|Borrowings\|Notes` | totalLiabilities (must be smaller) |
| acctRec | `Receivable` | assetsCurrent (must be smaller) |
| acctPay | `Payable` | liabilitiesCurrent (must be smaller) |
| inventory | `Inventor` | assetsCurrent (must be smaller) |
| ppeq | `PropertyPlant\|RealEstateInvestment` | totalAssets (must be smaller) |
| deferredRev | `DeferredRevenue\|ContractWithCustomerLiability` | — |
| cashAndEq | `^Cash` | totalAssets (must be smaller) |
| sharesBasic | `SharesOutstanding\|SharesIssued` | shareswa (should be close) |
| ncfx | `EffectOfExchangeRate` | — |

## Output

- `D:\research\alpha-engine\fundamentals\standard\v1\gaps\gaps.json`, per field:
  - companies under 90%, by sector;
  - missing quarters;
  - candidate tags with the companies and quarters each would fill;
  - the scope checks with values and ratios.
- `D:\research\alpha-engine\fundamentals\standard\v1\gaps\gaps.md`: per field, coverage by sector, the top 5
  candidates with their evidence, and a one-line judgement. Possible judgements: same scope, add to the list;
  a part, do not add; a different measure; real gap.
- The script in the main repository: `scripts/research/standard-fundamentals-gaps.mts`. Run it from the repository
  root with `npx tsx`.

## Rules

- Read only:
  - database: SELECT only, per company;
  - files: the dataset on D:;
  - code: the lab repository.
- No production write, schema change, scheduler entry, web restart, LLM or GDELT request.
- Keep outputs on D:. Commit only the script and this file's delivery report.
- English for code, comments and reports.

## Acceptance checks

1. `gaps.json` and `gaps.md` exist and cover all 19 fields.
2. Each field gives the companies under 90% by sector, and the top candidate tags with company and quarter counts.
3. Three worked examples per field, with the values, the ratio and the judgement.
4. The script runs in under 15 minutes and issues only SELECT statements, per company.
5. Gates for the committed script: `npm run check`, `git diff --check`.

## Delivery

A delivery report in this file, a handoff note, and a mailbox message to Claude.

## Delivery report — 2026-11-13

K13 is complete as a read-only analysis. No field definition, dataset value, production record or scheduler configuration was changed.

### Artifacts and evidence

- `D:\research\alpha-engine\fundamentals\standard\v1\gaps\gaps.json`: all 19 fields, with sector coverage, companies under 90%, every missing quarter, ranked candidates and scope checks. Size: **22,328,852 bytes**.
- `D:\research\alpha-engine\fundamentals\standard\v1\gaps\gaps.md`: the same coverage and top-five candidates with worked examples and one-line judgements. Size: **88,670 bytes**.
- `D:\research\alpha-engine\fundamentals\standard\v1\gaps\checkpoint.json`: resumable, input-hash-checked company checkpoints. A failed run cannot silently replace the completed report with an empty or partial one.
- Final run: **217,036 ms (about 3.6 minutes)**, **499 indexed per-company SELECT statements**, **12,525,994 fact rows read**, **502 company IDs**, **499 with quarterly series**. ExxonMobil's predecessor CIK 34088 is queried separately; XOM_PRE, ENLT and VYLR have no quarterly series and are marked rather than treated as empty evidence.

Each field reports its under-90% companies by sector and missing quarters, then up to five candidates by company and company-quarter count. Top candidates receive up to three worked comparisons, with candidate and comparison values, period, ratio, constraint, suggested sign and judgement. When a related identity or comparison is unavailable, the ratio is explicitly not computable rather than invented.

### Scope and sector checks

- Ratios use the latest filed value for the nearest same-duration quarter or a complete YTD sum, with period offsets recorded. Flow periods last 60–400 days and allow ±5 days at the end; balances are instants. Reported zeroes count as values.
- Semantic exclusions are explicit in the JSON: net interest is not gross interest expense, non-operating income is not operating income, securities are not corporate debt, preferred shares are not common shares, non-current deferred revenue is not current deferred revenue, and financial-investment purchases are not PPE capex. These do not rely on a coincidental ratio near one.
- Both universe files contain only `cik`, `ticker`, and `name`; neither supplies a `sector` property. The report therefore uses the read-only `companies.sector` fallback for **493 mapped CIKs** and labels unmapped companies **Unknown**. This fallback is stated in both artifacts rather than silently substituting a different universe or inferring sectors.
- Every sector coverage is at most 100%. A separate validation found the original cohort mismatch: numerator used all quarters while the denominator started in 2010. `presentQuarters` now receives the same filtered quarter list as the denominator, with a regression test. Current cost-of-revenue coverage ranges from **15.7% in Financials** to **100.0% in Consumer Staples**, with no ratio above 1.

### Verification and commit scope

- `npx vitest run scripts/research/standard-fundamentals-gaps.test.ts --reporter=dot`: **7 tests passed** (period bounds, latest finite/zero versions, YTD aggregation, related identities, smaller-than checks, semantic exclusions and cohort coverage).
- `npm run check`: passed. `git diff --check`: passed.
- Independent artifact validation: all 19 fields, at most five candidates per field, sector coverage no greater than 1, and at least three worked examples or explicit real-gap examples for every under-90% field.
- Only the miner, its regression test and this delivery report are committed. Generated D: artifacts, `.vscode/` and the unrelated generated exposure/analytics files are not included. The shared handoff for this task is delivered through the mailbox, keeping the requested script-and-report commit scope.
- No production write, schema change, scheduler entry, web restart, LLM or GDELT request. No normalization (step 2) or engine-input change was started.
