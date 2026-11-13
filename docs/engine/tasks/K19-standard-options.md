# K19 — Standard options series: daily implied-volatility readings in the research database

**Owner's approval:** the cleaning order agreed on 2026-11-12 (prices, then 13F, options, insiders) and "go on with your
recommendations" (2026-11-13). **Author of the spec:** Claude. **Coder:** Kimi. **LLM use:** none.
**Scope:**
- The lab repository: a new folder `C:\dev\alpha-engine-lab\src\options\`.
- The research database `alpha_research`. This task grants Kimi the right to create, fill and replace the tables named in
  section 4 there (AGENTS.md 3.2), in batches of at most 500 rows.
- Main-repository code is read and imported, never changed.

## 1. Why

Options are the next family in the cleaning order. The engine needs one reading per company and session that means the
same thing in 2019 and today.

What we hold today:
- **DoltHub chains:**
  - 510 tickers, 2019-02 to 2026-10-28 (the clone date), 58.8 million rows.
  - About three snapshots a week through 2023 and daily from 2025; 2024 has 183 dates.
  - Bid, ask, the vendor's implied volatility and greeks. No volume, no open interest.
- **Schwab chains:** the 50 since 2026-10-31 and the S&P 500 since 2026-11-11. They add volume and open interest.

The current features (`worker/lib/option-features.ts` through `worker/dolthub-features.mts`, schema 3, on D:) have four
problems:
- **Mixed maturities.** They average expirations inside buckets (8-30 days, 31-90 days), so a reading's maturity drifts
  from day to day.
- **Wrong availability dates.** `availableAt` is the snapshot date even on Saturdays and holidays.
- **No checks** against our as-traded prices.
- **Two code paths** for the two sources.

On the 50 companies, four option readings showed no link with later moves (39 companies, 918 release decisions). The
full list can detect correlations of about 0.05. The test itself is the owner's decision, not part of this task.

## 2. Inputs (all read-only)

- **DoltHub chains:** `D:\research\alpha-engine\options-iv\<ticker>\<year>.csv`, with `validation.json` and
  `export-dates-report.json` beside them. Read the files; do not query the Dolt clone. A refresh of the clone (`dolt pull`)
  needs the owner's word, so it is not part of this task.
- **Schwab chains:**
  - The 50: `D:\research\alpha-engine\schwab\chains\<date>\<ticker>.json`.
  - The S&P 500: `D:\research\alpha-engine\schwab-sp500\chains\<date>\<ticker>.json`.
  - Capture times are in the `manifest.json` at each archive's root: one entry per capture, with `capturedAt` in UTC.
  - Folder names are UTC dates. The folder `2026-10-31` holds captures from the evening of Friday 2026-10-30, Eastern
    time.
  - Parse with `normalizeSchwabChain` (`worker/lib/schwab-normalize.ts`). It returns IV as a decimal and flags delayed and
    truncated chains.
- **Standard prices:** `alpha_research.std_prices`, build p1.1. Use the as-traded close, `splitIndex` and `trIndex`, and
  the events. The sessions are in `D:\research\alpha-engine\prices\std\sessions.json`.
- **Companies:** `alpha_research.std_price_companies`, for ticker to CIK, the funds (SPY and the sector funds) and the
  second listings.
- **Release calendar:** `D:\research\alpha-engine\engine\events\quarters-50.jsonl` and `quarters-rest.jsonl`, with
  `firstPublicationEt` per quarter (494 companies). It is used only for the event readings in section 3.4.
- **Spot by parity:** `impliedSpot` in `worker/lib/dolthub-features.ts`. Reuse it.

## 3. Rules

### 3.1 Which session a snapshot belongs to (point in time)

- A DoltHub date D carries end-of-day quotes. Map each snapshot to the session whose close it reflects:
  - Candidates are the last session on or before D and the session before that.
  - The quote session is the candidate whose as-traded close is nearest to the parity spot.
  - Saturdays and holidays map to the previous session.
  - Record the session, the gap and whether D itself was chosen.
- **Schwab:** convert `capturedAt` to Eastern time.
  - On a session day:
    - after 16:00, it belongs to that session;
    - before 09:30, to the previous session;
    - in between, to that session, flagged `intraday`.
  - On a weekend or holiday, it belongs to the last session before.
- **`availableFrom`** is the session after the quote session. A decision taken at a close may use only quotes from an
  earlier close.
- **Two snapshots in one session:** keep the later capture and count the duplicates.
- **Identity:** a snapshot whose parity spot is more than 20% from the company's as-traded close is assigned to no
  company and listed. This catches ticker reuse (COHR, ECHO, DOC, COR, IR) and wrong mappings. Never repair such a
  snapshot with a split factor.

### 3.2 Readings per expiration

- **T** is calendar days from the quote session to the expiration, divided by 365. Expirations under 7 days are left
  out of everything except section 3.4.
- **Forward:** at the strike where call and put mids are closest, F = K + C − P.
- **At-the-money IV:** the vendor IV interpolated linearly in ln(K/F) between the two strikes bracketing F. Average the
  call and put IV at each strike, or use one side when the other is missing.
- **25-delta IVs:** interpolate the vendor IV linearly in delta between the two puts bracketing −0.25, and the two calls
  bracketing +0.25. Never extrapolate.
- **Call-put spread** (Cremers and Weinbaum): the mean of call IV minus put IV at strikes having both, with call delta
  0.3–0.7.

### 3.3 Constant maturity per company and quote session

- **At 30, 60 and 91 days:**
  - Interpolate total variance σ²T linearly in T between the nearest expirations on either side, then convert back to
    σ.
  - When one side is missing, use the nearest expiration only if it lies within 10 days of the target, and flag it
    `extrapolated`.
  - Otherwise the reading is null.
- **Stored readings:**
  - `iv30`, `iv60`, `iv91`;
  - `skew30` = IV(25-delta put) − IV(25-delta call);
  - `putSkew30` = IV(25-delta put) − ATM IV;
  - `cpSpread30`;
  - `termSlope` = iv91 − iv30.
  - Skew and spread are interpolated linearly in T, not in variance.
- **`rv21`:** realized volatility of the 21 sessions up to and including the quote session, √(252 × mean squared log
  return of `trIndex`). Also `vrp30` = iv30 − rv21.
- **`releaseInside30`:** a first publication falls after the quote session's close and within 30 calendar days.

### 3.4 Event readings (quote sessions within 10 sessions before a first publication)

- **E1** is the first expiration after the publication's first trading session; **E2** is the next expiration.
- **`eventMoveTerm`:**
  - σd² = (σ2²T2 − σ1²T1) / (T2 − T1);
  - eventMoveTerm = √((σ1² − σd²) × T1);
  - null when the root's argument is not positive or E2 is missing.
- **`eventStraddle`:** the ATM straddle mid of E1 divided by spot.
- **Availability.** These readings use the actual publication date. Companies announce it ahead, usually 2–4 weeks. Say
  this in the process document; the 10-session limit keeps the readings inside that notice.

### 3.5 Schwab-only readings

- **What:** put/call volume and open-interest ratios, stored only for Schwab sessions.
- **Flag:** marked as Schwab-only in the process document.
- **Limit:** they never form a series that starts before 2026-10-31.

### 3.6 One reader

- Read both sources into one contract shape (`OptionContract`, `worker/lib/options.ts`) and compute every reading with
  the same code.
- TypeScript is recommended, so the main repository's parsers can be imported.

## 4. Tables (alpha_research)

- **`std_option_daily`**, one row per company and quote session:
  - Identity: `cik`, `ticker`, `quoteSession`, `snapshotDate`, `source` (dolthub or schwab), `capturedAt` (Schwab),
    `availableFrom`.
  - Spot check: `spot`, `closeAsTraded`, `spotGap`.
  - Readings: the section 3 readings, plus `nextPublicationEt`, `eventE1`, `eventE2`.
  - Quality: contracts, expirations, zero-bid share, ATM relative spread, and `flags` (JSON: extrapolated, missing25d,
    intraday, delayed, truncated, releaseInside30).
  - `buildVersion`.
- **`std_option_builds`**: the pattern of `std_13f_builds`, with the version, code commit, inputs with hashes, the gates'
  numbers and the row count.

## 5. Acceptance checks

1. **Spot and session.**
   - The parity spot is within 1% of the quote session's as-traded close for at least 98% of snapshots. The rest are
     listed, largest first.
   - Per year, the share of DoltHub dates mapped to themselves and to the previous session.
   - Zero snapshots are mapped to a session after their date.
2. **Coverage.**
   - Companies and snapshots per year and source.
   - Tickers without a company, and companies without chains.
   - Snapshots refused by the identity rule.
3. **Splits.**
   - For every split since 2019 in the standard price events, the spot ratio across the split equals the split ratio
     within 2%.
   - The iv30 change across the split lies within the company's 99th percentile of ordinary changes, or is listed with
     a reason.
4. **Jumps.** The 20 largest one-snapshot iv30 moves, each with its reason (a publication, March 2020, the data).
5. **Seam.** For the 50, compare iv30 at DoltHub's last snapshot with Schwab's first session. Report the median and
   interquartile range of the change, set against the usual change over the same number of sessions. Companies beyond
   the 95th percentile are listed.
6. **Against schema 3.** On snapshots both cover:
   - spots equal;
   - the old 8-30D `atmIv` against the new reading interpolated to the old `dteMedian`, with their correlation and the
     largest differences.
7. **Sanity.** Per year, the rank correlation across companies between iv30 and the realized volatility of the next 21
   sessions is at least 0.6 (the old features gave about 0.8). The forward volatility is computed only for this check
   and never stored.
8. **Load.**
   - Autocommitted batches of at most 500 rows, with the build row written last.
   - Counts are checked against the build.
   - 2,000 random rows are read back identical.

## 6. Delivery

- **Commits:**
  - Lab: the code and tests (the interpolation, the session mapping and the event formula, each on a small hand-made
    chain). The build is provisional until Claude accepts it.
  - Main: one documentation commit.
    - `docs/engine/STANDARD_OPTIONS.md`, the process document in the pattern of `STANDARD_13F.md`.
    - A handoff section.
    - A fast-forward push when only your commit is ahead.
- **A mailbox message:** the commits, the table counts, each check's numbers and the lists of checks 1, 3, 4 and 5.

## 7. Out of scope

- The engine test of option readings. The owner decides it after this task.
- A refresh of the Dolt clone, new Schwab fetches, intraday chains.
- The app's option features, pages and signals. Production, schema changes in `alpha_engine`, scheduler changes, web
  restarts.
