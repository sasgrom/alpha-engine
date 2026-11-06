# Deferred evaluation: manager-aware 13F aggregation

Date: 2026-11-06
Status: **deferred until the current 24-quarter run is finished and separately reviewed**

This is a future evaluation TODO, not an implementation assignment and not a production-change approval. The current run should finish with its existing behavior. Do not change code, schema, collectors or history because of this document.

## 1. Evidence that prompted this review

Morgan Stanley accession `0000895421-23-000255`, period 2022-12-31:

- [Original SEC information table](https://www.sec.gov/Archives/edgar/data/895421/000089542123000255/DetailTableInfo_2022Q4.xml)
- [Original SEC cover page](https://www.sec.gov/Archives/edgar/data/895421/000089542123000255/primary_doc.xml)
- [SEC filing index](https://www.sec.gov/Archives/edgar/data/895421/000089542123000255/0000895421-23-000255-index.html)
- Local information table: `worker/cache/13f/895421/000089542123000255.xml`
- Local cover page: `worker/cache/13f/895421/000089542123000255.primary.xml`

The cover reports **23 other managers**, **43,935 entries** and **880,468,352,011** in reported value.

The current dollar scaling was checked and is correct for this document:

- The filing supplies actual dollars rather than the usual thousands.
- `parseInfoTable()` initially multiplies the filed value by 1,000 (`worker/lib/thirteenf.ts:63`).
- `autoScale13F()` finds a median implied share price of $30,439.995 and divides the value by 1,000 because it exceeds the existing $5,000 threshold (`worker/lib/thirteenf.ts:78`).
- After correction, the median implied share price is $30.44 and the detail sum is exactly the cover total: **$880,468,352,011**.
- The current merged database quarter has **7,888 positions** and **$60,365,095,357**. That difference is not caused by the ÷1000 correction.

`mergeQuarterFilings()` currently keeps one latest row for each `cusip:secClass` key (`worker/lib/thirteenf.ts:135`). Repeating that operation on the scaled source produces exactly 7,888 keys and $60,365,095,357. The review therefore concerns manager-level aggregation, not a claim that scaling destroyed the difference.

## 2. Problem to evaluate later

A repeated CUSIP may occur under different managers in a combination report. Keeping only the latest row for `cusip:secClass` can discard distinct manager entries. Blindly summing every repeated CUSIP could instead double-count a position repeated across filing components. CUSIP alone is not enough to decide.

The current reported total and an economic exposure aggregate are different questions and must not be conflated. The future review should decide how each is calculated and documented, rather than silently replacing one with the other.

## 3. Deferred implementation proposal

1. **Preserve an entry-level ledger before filtering or deduplication.** Retain accessionNo, raw `otherManager`, CUSIP, secClass, investmentDiscretion, shares, normalized valueUsd, actual filingDate and source hash. Do not assume an `otherManager` token is itself a CIK; resolve it through filing metadata when possible and preserve the raw reference regardless.
2. **Reconcile each accession before aggregation.** After scaling, the full detail-row count and sum must reconcile with the reported cover total. Company filtering must happen only afterward.
3. **Merge amendments at the entry level.** ORIGINAL starts the ledger, RESTATEMENT replaces it, and NEW HOLDINGS appends. Availability remains MAX(actual filingDate) across required components.
4. **Handle repeated manager/security identities deliberately.** Across original and NEW HOLDINGS components, use managerRef + CUSIP + secClass + investmentDiscretion as a candidate identity. Repeated identities must be surfaced for review rather than blindly summed or overwritten.
5. **Build a separate economic aggregate for research.** Aggregate `cusip:secClass` or mapped `heldCik:secClass` with summed shares and valueUsd, while preserving contributing accessions and manager references. Compare the same aggregate across quarters so a security moving between managers does not create a false exit/re-entry.
6. **Keep reported and economic totals distinct.** A cover-total reconciliation is not proof that a particular beneficial-ownership aggregation is correct. Document the chosen meaning of each total rather than calling both the full book without qualification.
7. **Choose storage only after evaluating the evidence.** A minimal change may aggregate into existing `fund_holdings` while retaining local manager-level evidence. A later, separately reviewed `fund_holding_entries` table may be justified if a complete entry-level audit trail is required. No schema decision is approved by this TODO.

## 4. Acceptance tests for the future change

- Same CUSIP under two different managers is retained and aggregated according to the documented policy.
- Repeated original/NEW HOLDINGS entries are not blindly double-counted.
- RESTATEMENT replaces the book; NEW HOLDINGS only augments it.
- Existing Vanguard amendment regressions remain green.
- The Morgan Stanley source reproduces **43,935 reported entries** and **$880,468,352,011** after scaling, with **7,888** retained separately as a distinct CUSIP/class metric.
- Reconciliation occurs before company filtering, and the final report explains any difference between cover and economic totals.

## 5. Review sequence and boundaries

- Finish the current 24-quarter run as-is.
- Review the resulting coverage and representative combination reports before changing code.
- Propose the manager-aware merge and its regression fixtures from the evidence above.
- Back up relevant local tables before any reviewed historical rebuild.
- Compare old and new results; do not silently rewrite production history or trigger production sync/deploy.
- Revisit the earlier discarded-label issue only through a separate `--repair` decision; the TEXT migration does not reconstruct those old values.

No automatic scheduler action, collector run, historical rebuild, production migration or deployment is authorized by this TODO. The cloud Kimi agent can read this document and the linked handoff after the reviewed commit reaches `origin/main`; it should wait for the next explicit owner review before implementing anything.
