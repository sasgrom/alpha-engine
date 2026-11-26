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
