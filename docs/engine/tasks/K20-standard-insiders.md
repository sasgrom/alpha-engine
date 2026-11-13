# K20 — Standard insider series: Forms 3, 4 and 5 for every company, point in time

**Owner's approval:** 2026-11-13 afternoon ("ok, lets download and clean"; he also asked how to follow individuals).
**Author:** Claude. **Coder:** Kimi. **LLM use:** none. **Order:** after K19.
**Scope:**
- a new lab folder `C:\dev\alpha-engine-lab\src\insiders\`;
- the research database `alpha_research`, with the right to create, fill and replace the tables of section 4 (AGENTS.md
  3.2), in batches of at most 500 rows;
- outputs on D:. Main-repository code is read and imported, never changed.

## 1. Why

Insider trades are the last family in the cleaning order. Today:
- **Coverage:** the app holds about 3,000 rows for 48 companies, from a cache of the 50 since 2019
  (`worker\cache\edgar-form4\<issuer cik>\<accession>.xml`).
- **Known defects** (Claude's audit of 2026-11-10):
  - affiliated co-filers inflate the insider count (one Sequoia filing showed as 10 insiders);
  - amendments replace earlier versions before clusters are formed, so history is rewritten;
  - the benchmark is not point in time.
- **Individuals** cannot be followed today. Every filing names its reporting persons by EDGAR id, one number per person
  for life and the same at every company, so each person's roles, trades and track record can be followed.

## 2. Inputs

- **SEC Insider Transactions Data Sets** (`https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets`):
  - quarterly ZIPs, 2006 Q1 to 2026 Q3 (83 files, 8–16 MB each), extracted by the SEC from the XML part of Forms 3, 4
    and 5;
  - read the SEC's README for the files and fields;
  - download each ZIP once: at most one request a second, the project's EDGAR User-Agent, into
    `D:\research\alpha-engine\insiders\sec-345\`, with a manifest (URL, bytes, SHA256, fetched at).
- **Filings after 2026-09-30:**
  - EDGAR's daily form indexes since 2026-10-01; take Forms 3, 4, 5 and amendments whose issuer is in our registry;
  - fetch their XML at most 5 requests a second, cached under `D:\research\alpha-engine\insiders\edgar\<issuer cik>\`;
  - parse them with `worker/lib/form4-xml.ts` into the same shape as the data sets.
- **Read-only:**
  - the existing cache of the 50, for check 2;
  - `alpha_research.std_prices` (as-traded close, `splitIndex`) and `std_price_companies`;
  - the registry's issuer CIKs.
- **No other network access.**

## 3. Rules

1. **Scope.** All filings whose issuer CIK is in the registry are loaded. The raw ZIPs keep everything; a person's trades
   at other companies can be added later.
2. **Point in time.** `availableFrom` is the session after the filing date.
   - Where an acceptance time is known (the EDGAR fetches), it is the first session whose 09:30 ET open comes after it.
   - A filing moved into the next quarter's data set (filed after 17:30 on the last business day) is the same accession:
     deduplicate by accession.
3. **Amendments never rewrite history.**
   - A 4/A is stored as its own filing, with its own `availableFrom`, and linked to the original it amends.
   - A view as of time t uses, per original, the latest version available by t.
4. **Owner groups** fix the inflated insider counts.
   - Owners who appear together in any one filing for the same issuer form a group (connected components).
   - Distinct insiders are counted by group.
   - The same trade filed separately by group members is one economic trade: same issuer, transaction date, code,
     shares and price. Link the copies with `duplicateOf` to the earliest available copy.
   - The Sequoia case (DoorDash, accession 0001062993-22-007354) is one group.
5. **Transaction codes.**
   - Every row is kept with its code.
   - P (purchase) and S (sale) are marked `discretionary`.
   - Grants (A), exercises (M, X), tax withholding (F), gifts (G), dispositions to the issuer (D), conversions (C) and
     the rest are mechanical.
6. **10b5-1 plans:**
   - from the data sets' `AFF10B5ONE` flag since 2023;
   - before that, from footnotes that mention 10b5-1, flagged with that source.
7. **Prices.**
   - Compare the price of each P and S row with our as-traded close on the transaction date.
   - A ratio outside 0.5–2, or a zero price on P or S, is flagged and never repaired.
8. **Shares.**
   - Shares are stored as filed.
   - `sharesToday` is shares × `splitIndex(today)` ÷ `splitIndex(transaction date)`.
   - Value is shares × price.
9. **Late filing.** A filing more than 2 business days after its transaction is flagged `late`. It stays available only
   from its own filing.

## 4. Tables (alpha_research)

- **`std_insider_filings`**:
  - identity: accession, issuer CIK, form, filing date, acceptance time where known, `availableFrom`;
  - links: the accession it amends;
  - flags: the 10b5-1 flag and its source, the number of owners, the source (bulk or EDGAR).
- **`std_insider_owners`**, per filing and owner: owner CIK, name, director, officer, officer title, 10% owner, other,
  and the owner group.
- **`std_insider_transactions`**, one row per filed line:
  - identity: accession, line, issuer CIK, owner group, security title, derivative or not, transaction date;
  - trade: code, acquired or disposed, shares, price, shares owned after, direct or indirect ownership;
  - derived: `discretionary`, 10b5-1, the price-check ratio, `sharesToday`, value, `duplicateOf`, flags,
    `availableFrom`.
- **`std_insider_persons`**, one row per owner CIK:
  - names seen;
  - first and last filing;
  - issuers;
  - roles over time (first and last filing per issuer and role).
- **`std_insider_builds`**: the pattern of `std_13f_builds`.

## 5. Acceptance checks

1. **Download:** 83 ZIPs with hashes; rows per file per quarter. The README layout matches what the code reads.
2. **Against our own parse:** every accession in the existing cache of the 50 matches the loaded rows (codes, dates,
   shares, prices, owners). Mismatches are listed with their cause.
3. **Prices:** the share of P and S rows within 10% of the as-traded close, per year. Outliers are listed, largest value
   first.
4. **Groups:**
   - the Sequoia case is one group;
   - the 20 largest groups are listed with their members;
   - the number of trades linked as duplicates.
5. **Coverage:**
   - filings per company and year;
   - companies with none;
   - for ten companies, our 2025 filing counts against EDGAR's filing list. Their submissions lists, including the
     older pages under `filings.files`, may be fetched for this: at most 30 requests, cached.
6. **Point in time:** no `availableFrom` before its filing date. Amendments are visible only from their own
   availability, shown on three real 4/A cases.
7. **Sanity list for Claude's review:** the five largest discretionary purchases and sales per year by value, with owner,
   role and price check.
8. **Load:**
   - batches of at most 500 rows, with the build row written last;
   - counts checked against the build;
   - 2,000 random rows read back identical.

## 6. Delivery

- **Commits:**
  - Lab: code and tests (owner groups, amendment views, the 10b5-1 footnote rule, price check, `availableFrom`), each on
    small hand-made cases. The build is provisional until Claude accepts it.
  - Main: one documentation commit: `docs/engine/STANDARD_INSIDERS.md` in the pattern of `STANDARD_13F.md`, and a
    handoff section.
- **Mailbox message:** the commits, counts, each check's numbers and lists, the request counts (ZIPs, indexes, XML).
- **Daily updates:** the script that fetches filings after a date (`--since`) is part of this task. Scheduling it as a
  daily job is a separate step after Claude's review.

## 7. Out of scope

- Engine readings (net buying, clusters, track records) and their test: the owner decides after this task.
- The app's insider tables, pages and the old benchmark.
- Forms 144, 13D and 13G.
- Congressional trading reports: their legal limit (5 U.S.C. 13107) needs the owner's call.
- Production, schema changes in `alpha_engine`, scheduler changes, web restarts.
