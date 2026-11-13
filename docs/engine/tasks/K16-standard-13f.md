# K16 — Standard 13F series: point-in-time institutional holdings in the research database

**Owner's approval:** 2026-11-13 ("K15 now, K16 after"). **Author of the spec:** Claude. **Coder:** Kimi.
**Scope:** the lab repository (new folder `C:\dev\alpha-engine-lab\src\thirteenf\`) and the research database
`alpha_research`. This task grants Kimi the right to create, fill and replace the tables named in section 3 there
(AGENTS.md 3.2), in batches of at most 500 rows. Main-repository code is read and imported, never changed.

## 1. Why

13F holdings are the next factor family in the owner's order (prices, 13F, options, insiders). The app's `fund_holdings`
table is known to be wrong:
- it keeps one row per CUSIP, so for 2026-06-30 it holds $17.2tn of the $37.6tn filed;
- it reads no put/call column;
- it maps only 377 of 496 companies, 9 of them to the wrong company.

Claude's fund books read the filed reports correctly:
- code: `scripts/build-fund-books.mts`, `worker/lib/thirteenf-table.ts`, `contracts/fund-books.ts`;
- output: `D:\research\alpha-engine\fund-books\`: `filings\<cik>\<accn>.json` checkpoints with cover and rows, `quarters\<q>.json`, `manifest.json`;
- result for 2026-06-30: 307 funds, 493 companies, $60.6tn filed, $43.5tn covered.

K16 turns the books into standard, point-in-time research tables with gates. Replacing `fund_holdings` in the app is a
separate owner decision and not part of this task.

## 2. Inputs (all read-only)

- The fund books on D:, rebuilt first with `npx tsx scripts/build-fund-books.mts` from the main repository. It reuses
  its checkpoints, about 55 seconds.
- The raw 13F cache `worker\cache\13f\<fund cik>\<accn>.xml` and `.primary.xml` (a junction to D:): for the re-read
  check only.
- Filing dates: `alpha_engine.fund_quarters.filingDate` (EDGAR filing day per fund, quarter and accession; read-only).
  - For an accession not there (amendments, additions), EDGAR's submissions list `data.sec.gov/submissions/CIK##########.json` (`filingDate` and `acceptanceDateTime`).
  - Rules for that fetch:
    - at most one request per fund, at most 5 requests a second;
    - the User-Agent the project's EDGAR collectors already use;
    - answers cached in `D:\research\alpha-engine\fund-books\submissions\`.
  - It is the only network access allowed.
- As-traded closes and split index: `alpha_research.std_prices` (build p1) or `D:\research\alpha-engine\prices\std\daily\<cik>.csv`.
- Shares outstanding: the standard fundamentals `sharesBasic`, the version filed by the date (`alpha_research.std_fundamentals`, build v3.1, final).

## 3. Tables (alpha_research)

- `std_13f_filings`: one row per 13F filing the books read.
  - Identity: fund CIK, manager, period of report, accession, form (13F-HR, 13F-HR/A).
  - Kind: original, restatement, addition, or a whole report filed again as "NEW HOLDINGS".
  - Dates: filing date, acceptance time where EDGAR gives it, signed date, and `availableFrom` (the trading session after the filing date).
  - Unit: as decided (dollars or thousands), and how it was decided.
  - Book: declared rows and value, value read, covered value, positions.
  - Options: put and call value, kept apart.
  - Flags: `totalsAgree`, cover page only, confidential treatment, partial table; whether the filing formed the period's book.
- `std_13f_positions`: one row per filing, company and share class.
  - Identity: fund CIK, period, company CIK, share class, CUSIP.
  - Shares as filed and value in dollars.
  - Put and call shares, separate from shares.
  - The split factor from the period end to today's basis (from `std_prices.splitIndex`) and shares on today's basis.
  - `availableFrom` of the filing.
- `std_13f_company_quarters`: one row per company and period, **as known at `knownAt` = the period end + 46 days**
  (the 45-day filing deadline, then one day). Built only from filings available by then:
  - holders (funds with a position), shares held (filed basis and today's basis), value held;
  - percent of shares outstanding, using the fundamentals count filed by `knownAt`, flagged above 100%. Some filers' counts are issued shares (Boeing) or one class only; see `docs/engine/STANDARD_FUNDAMENTALS.md` section 6;
  - funds new and exited against the previous period, shares bought and sold by funds present in both;
  - the share of the ten largest holders;
  - coverage: funds that had filed by `knownAt` ÷ funds that filed the period before.
  - A later amendment never changes a stored row. A row for a later `knownAt` may be added in a later task.
- `std_13f_builds`: build version, code commit, inputs with hashes, the gates' numbers.

## 4. Rules

- **One reader.** Import the books' code (`worker/lib/thirteenf-table.ts`, the decisions in `manifest.json` and the
  quarter files); extend it inside the lab only.
  - Units per filing are decided from prices.
  - A security maps to a company by price levels; share classes by a steady price ratio to the main security.
  - An amendment that repeats at least 80% of a book replaces it.
  - Cover-page copies and confidential-treatment originals are flagged and left out of books.
  - The "not trading" moves stay out of bought and sold: mergers and share-count conversions, a fund's mass moves,
    blocks that newly became reportable, listings. They are listed per company and period.
- **Point in time.** Nothing filed after a row's `knownAt` enters it. `availableFrom` is the next trading session after
  the filing date (the sessions are in `D:\research\alpha-engine\prices\std\sessions.json`).
- **Shares on the filed basis.** Store them as filed; today's basis is derived through the split index, never stored
  in place of the filed shares.

## 5. Acceptance checks

1. Per filing, the positions sum to the filed total (`totalsAgree`), or the difference is explained; counts as in the
   books' manifest.
2. Ten random filings re-read from the raw XML give the same positions, shares and values.
3. Value ÷ (shares as filed × our as-traded close on the period end) is within 2% for at least 98% of position value.
   The rest is listed, largest first.
4. For 2026-06-30, holders, shares and value per company tie exactly to the books' quarter file.
5. Percent of shares outstanding above 100% is listed with its reason (issued shares, one class, a fund double-count).
6. One period's comparison with the app's `fund_holdings` states the known defect in numbers (value held, companies
   mapped). It is documentation only.
7. Load: batches of at most 500 rows; tables counted against the build; 2,000 random rows read back identical.

## 6. Delivery

- Commits:
  - Lab code: a loader in the pattern of `src/prices/load-mysql.mts`; builds are provisional until Claude accepts.
  - Main repository: one documentation commit.
    - New: `docs/engine/STANDARD_13F.md`, the process document in the pattern of `STANDARD_PRICES.md`.
    - A handoff section.
    - A fast-forward push when `main` is ahead of `origin/main` by your commit alone.
- A mailbox message with:
  - the commits;
  - table counts;
  - each acceptance check's numbers;
  - the lists of checks 3 and 5;
  - the EDGAR requests made.

## 7. Out of scope

- The app's `fund_holdings`, signals and pages.
- Fetching new 13F filings: use the cache.
- Production, schema changes in `alpha_engine`, scheduler changes, web restarts.

## 8. Corrections made during review (2026-11-13; they supersede the text above)

1. **`knownAt`** is the first trading session after the filing deadline. The deadline is the period end + 45 days, moved to the next business day when it falls on a weekend or holiday. For 2026-06-30 that is Monday 2026-08-17. "Period end + 46 days" left deadline-day filings out.
2. **Confidential treatment.** Only cover-page copies (no table) are left out. A filing with `isConfidentialOmitted` and a complete public table is used, with the flag kept. Example: Capula, 1,029 rows, $28.0bn.
3. **Share basis per position.**
   - Candidates are the company's own split products after the period end: `splitIndex(today) ÷ splitIndex(t)`, for sessions t from the period end to today.
   - The chosen candidate is the one nearest in log terms to the filed price ÷ the period end's today's-basis close.
   - Each position is classified as one of:
     - basis: within 2%;
     - valuation difference: 2-40%;
     - pricing anomaly: more than 40% from every candidate, kept at the period-end factor and flagged.
   - Funds file shares on the new basis after a split (Lam 2024), and value their books at other dates.
4. **Percent of shares outstanding** puts the denominator on today's basis: `sharesBasic × splitIndex(today) ÷ splitIndex(filed date)`. A raw filed count under 1,000,000 shares is excluded before any factor (Chipotle's v3.1 slip of 27,962 shares).
5. **Check 4 against the books.** A difference is explained when it is one of:
   - a basis correction;
   - a valuation difference;
   - a books error (the books' factor is not among the company's candidates);
   - a pricing anomaly under 1% of the fund's shares of that company for the period.
   Anything else fails.
6. **Load:** autocommitted batches of at most 500 rows, with the build row written last. No single large transaction.

Delivered and accepted as build `k16.3` (lab `147f4df`, main `0359362`; Kimi's handoff sections 154-156).

## 9. K16.4 corrections (2026-11-13 evening; they supersede the text above)

Found after the acceptance of k16.3, whose final status was withdrawn the same evening:
- **Missing big funds.** 83 filing dates were unresolved, so 65 fund-periods of the largest filers had no filing at `knownAt`: State Street, JPMorgan, Morgan Stanley, FMR, Bank of America.
- **Late filings.** 328 more fund-periods were filed after `knownAt`. 147 of them (about $17tn) by one session: accepted on the deadline evening, and stamped with the next day's filing date.
- **Timing counted as trading.** `newFunds` and `exitedFunds` counted whole books present or absent, which is filing timing.

Rules:
1. **Dates:**
   - Unresolved accessions are looked up in the submissions pages listed under `filings.files`. The quick list `filings.recent` holds only the latest 1,000 filings, under a year for the big banks.
   - Only pages whose range covers the signed date (± 10 days) are fetched, each at most once, at most 5 requests a second, and cached beside the existing lists.
2. **`availableFrom`** is the first session whose 09:30 ET open comes after `acceptanceDateTime`. Without an acceptance time, it is the session after the filing date.
3. **Two rows per company and period:** `knownAt` (the first session after the deadline) and that session plus 10 sessions, with the row's kind stored. Each row uses only filings available by its own `knownAt`.
4. **Breadth** among continuing funds (a book at both periods' rows of the same kind), after the bought/sold exclusions:
   - `continuingFunds`;
   - `entries`: continuing funds that hold the company now and did not before;
   - `exits`: the reverse;
   - `breadthChange` = (entries − exits) ÷ continuingFunds (Chen, Hong and Stein).
   - `newFunds` and `exitedFunds` are dropped.
5. **Checks added:**
   - unresolved dates;
   - absent fund-periods per period and row kind, with reasons and value;
   - coverage at both kinds;
   - the 10 largest one-period drops in holders, with reasons;
   - the spread of `breadthChange` per period and its correlation with net shares bought ÷ shares outstanding.

Loaded as `k16.4` (provisional, `--replace`) for Claude's review.
