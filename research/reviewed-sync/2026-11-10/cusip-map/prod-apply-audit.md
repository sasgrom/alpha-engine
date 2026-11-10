# CUSIP map prod transport — apply + coverage audit (2026-11-10)

## Apply evidence
- Source: reviewed export `backup-cusip-map.json`, sha256 `dc1df9326e633a92c8789f165d18ec805bac5173b35c6b04780ac4532f75eb0c` (matches git blob byte-for-byte; manifest bytes/sha/rowsTotal consistent; `credentialMaterialIncluded=false`).
- Prod state before: 0 rows. DDL 030 (`ticker` TEXT) applied earlier same day.
- Apply: batched exact-key upsert by `cusip`, 41,090 rows written; prod null stats identical to file (null cik 40,707 / null ticker 25,701).
- TEXT migration proven on data: 20 tickers longer than 20 chars preserved intact (e.g. `APLS 3.5 09/15/26 MAY`).
- Honest note: CUSIP `31816QAD3` (the 11-06 incident row) currently has `ticker=null` in the local source DB (mappedAt 2026-11-05, predating the fix) — exported as-is, not repaired in transit.

## Coverage audit (prod, TiDB)
- Distinct CUSIPs in fund_holdings: **384**
- Mapped to a company CIK: **383**
- In map without company: 0
- Absent from map: **1** — `22587M106` (Cresco Labs Inc, OTC: CRLBF, cannabis; outside the tracked universe; 9 holdings rows). Honest non-match, not an error.
- Row-weighted coverage: **1,617,268 / 1,617,277 (99.9994%)** of holdings rows resolve to a company.

## Conclusion
CUSIP crosswalk transport complete; coverage audit passes with a single documented, justified exclusion. Next quarterly 13F refresh inherits prod-side map presence.
