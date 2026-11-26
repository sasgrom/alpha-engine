# K34 — Trades of members of Congress (and the executive branch where filed)

Task for Kimi Code. **Owner's go of 2026-11-26:** "I want to collect more info on the famous people, more famous traders,
politicians included, all we can get." Written by Claude the same day. Kimi's credits end 2026-11-30 16:00: build the
collector and run it; the parser for scanned reports may be left for Claude.

## Sources (official, free; raw kept as received)

1. **House:** the Clerk's financial disclosure archive. Yearly index `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/<YEAR>FD.zip`
   (XML: member, state/district, filing type, date, DocID), and each periodic transaction report (filing type P) at
   `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/<YEAR>/<DocID>.pdf`. 2012 to today.
2. **Senate:** the eFD search site `https://efdsearch.senate.gov/search/` (accept its terms page in the session, then its
   report search for periodic transaction reports). Electronic reports are HTML tables; older ones are scanned images
   (stored, listed, not parsed in this task).
3. **Executive branch (stretch):** OGE 278-T periodic transaction reports published by the Office of Government Ethics,
   for the President, Vice President and Cabinet, where available as files.

Polite pace: one request a second per site, a generic client name, no account. Store everything under
`D:/research/alpha-engine/people/congress/` (`house/<year>/`, `senate/`, `oge/`, each with a manifest of address, bytes,
SHA-256 and fetch time). Our first-seen time is kept: it is when the trade was known to us, while the report's filing
date is when it was public (STOCK Act: up to 45 days after the trade).

## Parse (electronic reports only)

One row per transaction: `chamber, member, state, district/party where stated, filer (member, spouse, joint, child),
report id, filed date, transaction date, owner, asset as written, ticker as written, asset type (stock, option, bond,
fund...), type (purchase, sale, partial sale, exchange), amount range (low, high), comment`, plus the parse method
(text PDF, HTML) and the source file hash. House text PDFs: `pdfplumber` (install it in a venv on D:, as the news venv);
a report without extractable text is listed as scanned. Resolve tickers and asset names to CIKs with
`worker/lib/news-companies.ts` (`CompanyIndex.resolve`, the news company index): resolved, ambiguous (candidates kept) or
not a company.

Output `D:/research/alpha-engine/people/congress/trades-<stamp>.jsonl` and a summary: reports per year and chamber,
electronic and scanned, transactions, resolved share, the 20 most active members, and 50 hand-checked rows against the
PDF or HTML (owner's rule: verify data, bad and good).

## Rules

AGENTS.md in full; no database write; no change to the scheduler (a daily job is a later decision); own new paths only
(`worker/congress-*.mts`, `worker/lib/congress-*.ts`, tests with small fixtures of one House PDF text and one Senate
HTML table). Gates for code: `npm run check`, the new tests, `npm test -- --run`, `npm run build`, `git diff --check`;
announce full runs to Claude. Deliver a report at the end of this file, a handoff section and a mailbox message.

## Collection and verification evidence — 2026-11-26

### Senate final archive

Final summary: `D:/research/alpha-engine/people/congress/senate/summary.json` (10:55:18Z). The archive preserves the
union of current and every immutable paginated index because current results changed during pagination:

- **2,437 unique reports:** 1,828 electronic, 604 scanned, zero pending, five failed. Current index 2,123; 314
  outside-current-index reports retained. Recovered identities use the earliest retained raw-index observation.
- Independent audit covered all referenced HTML/PDF/image files: **1,290 scanned images, 382,571,512 bytes, zero missing
  files, zero hash/byte mismatches and zero duplicate report IDs**. Scans remain listed and are not OCR-parsed.
- `senate-todo.jsonl` preserves five exhausted failures, without endless retries: `40f35e56-…` returned an unsupported
  scanned image (8 attempts); Sessions PTRs `489c3783-…`, `dd4abe42-…`, `ef1398cf-…`, `7df7e34b-…` are cached
  `eFD: Find Reports` pages with no transaction table (16 attempts each). They are failures, not collected transaction
  reports. No unknown identity remains.

### House and final parser delivery

House main+post-pass finished with 8,469/8,946 PDFs and 477 permanent 404s (five attempts each). Parser review caught and
fixed dropped `$` preferred tickers, uncoded corporate notes, wrapped page-header amounts, trailing asset terms and
bond/option confusion. V9 migrates only asset classes from hash-identical v8 checkpoints after the final uncoded
coupon/maturity fixture; PDF text did not need another extraction.

Final artifacts:

- `D:/research/alpha-engine/people/congress/trades-20261126T120447Z.jsonl` and `.summary.json`.
- **10,901 parsed reports:** 7,714 electronic, 3,066 scanned, 121 House electronic reports with no transaction rows.
  The five Senate failures above are retained in the collector summary, not hidden in parsed output.
- **74,188 transactions:** 49,482 resolved, 38 ambiguous and 24,668 not a company; resolved share **66.6981%**. The summary
  includes year/chamber coverage and the 20 most active members.
- **50/50 hand-checked rows match all source fields** at 12:10:14Z. The signed manual review is
  `hand-check-20261126T120918Z.reviewed.json`, SHA-256
  `4b39c47e01bae0f27ff3838c7001fa88a8d073bfb6688f37eeda0c9fc124b3cf`; the unsigned generated source set and its SHA-256
  are linked in the final summary. Earlier hand-check files remain unsigned evidence of corrected defects.
- The executive-branch OGE 278-T stretch was not attempted. No scanned-report OCR, scheduler, DB or production change is
  claimed.

## K34.1 historical company resolution — 2026-11-26

Resolution only; the accepted `trades-20261126T120447Z` input is unchanged (SHA-256
`7b444c052f2e96eb8f6ebf0cac4605ef80086886151c7d05761d6258a77dfd11`). Final output is
`D:/research/alpha-engine/people/congress/trades-resolution-20261126T134505Z.jsonl` and `.summary.json` (SHA-256
`73a5b0e407d3118e110902e589be12fe55d94c317e34f764ddae5efacf3dc6de`).

- Stock trades: **60,257**, resolved **47,518 → 50,445**, unresolved **12,739 → 9,812**. Newly resolved:
  **2,927** (2,618 House / 309 Senate): 799 case+company-name, 2,071 company-name and 57 leading-symbol.
- Parsed fields and every existing resolution are unchanged. Name cleaning removes ticker/exchange/source-code and common
  share-class wrappers. Fallback accepts exact/word/ticker matches only. No ticker validity dates are invented.
- Review rejected 74 weak-prefix resolutions (including historical KLX Inc. incorrectly matching later KLX Energy Services)
  and nine non-traded Inland Real Estate Income Trust resolutions. ETFs, funds, notes and private holdings stay unresolved.
- **30/30 newly sampled House/Senate rows have the correct company identity** after owner-aware source excerpts. Signed
  review `resolution-check-20261126T134544Z.reviewed.json`, SHA-256
  `01cc19d543a3a6136c897c944e022b7a16b0ed6d7ddf24311e60f8d7ae107cda`, timestamp 13:47:15Z. Earlier unsigned resolution
  files/reviews document rejected matches and are not final artifacts.
