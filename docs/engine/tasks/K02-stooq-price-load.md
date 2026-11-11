# K02 — Load S&P 500 prices from the owner's Stooq archive

Prep task for Kimi Code. Context: [`../DESIGN.md`](../DESIGN.md) sections 1.5, 1.7 and 2.

## Goal

The engine needs one consistent, long daily price history for every company it may cover, for the
market, and for each sector. Only 55 tickers are loaded today. The owner's archive
`D:\stooq data 102726\d_us_txt.zip` (Stooq daily bulk file, 13,289 US stocks and ETFs, through
2026-10-26) has the rest and has never been loaded.

## LLM use

None. The task is unzip, parse, upsert and count. Do not open price files in the agent session
beyond a few header lines for test fixtures; the script does the bulk work.

## Inputs

- `D:\stooq data 102726\d_us_txt.zip`. Entries look like
  `data/daily/us/nasdaq stocks/1/aapl.us.txt` with header
  `<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>`.
  Prices are adjusted for splits and dividends as of the archive date. Class shares use a dash
  (`brk-b.us`).
- Existing loader `scripts/import-research-prices-file.mts` (currently limited to
  `research-universe-53.json` plus SPY) and `api/services/price-import.ts`.
- Company list: `worker/edgar-universe.json`, the S&P 500 snapshot used by the nightly
  `sp500-facts-daily` job, plus `worker/research-universe-50.json`. GICS sectors are in local
  `companies`.

## What to load

Into local MySQL `prices` with `source = 'stooq'`, open/high/low/close/volume:

1. every company in the two lists above, including CSCO, which has no Stooq history loaded
   today;
2. SPY (keep its existing key);
3. the eleven sector ETFs: XLB, XLC, XLE, XLF, XLI, XLK, XLP, XLRE, XLU, XLV, XLY.

ETFs have no company CIK. Propose a key convention that fits the existing schema without a schema
change, cannot collide with a real CIK, and is defined in one place in code; state it in the
delivery report.

Rules:

- Idempotent upsert, at most 500 rows per insert, no deletion of existing rows.
- Local database only. Confirm that the scheduled production price push cannot pick these rows up.
- Do not merge these bars with Schwab rows: Stooq bars are adjusted, Schwab bars are raw.

## Deliverables

1. Loader change with tests (ticker mapping including class shares, header parsing, ETF keys).
2. `research/engine/price-load-stooq-2026-10-27.summary.json`, committed: archive SHA-256 and size,
   load time, tickers requested / matched / unmatched (with reason for each unmatched), rows
   written, and per ticker: first date, last date, row count.
3. Quality report in the same file:
   - gaps of more than 5 consecutive missing sessions inside a ticker's history (use SPY's dates
     as the calendar);
   - non-positive prices, `high < low`, duplicate dates;
   - daily close-to-close moves beyond ±50%, listed for review (not removed);
   - companies with no GICS sector in `companies` (report only; do not fill by guess).

## Acceptance checks

1. At least 98% of current S&P 500 members matched; every unmatched ticker explained.
2. SPY and all eleven sector ETFs loaded; report each one's first date (XLRE and XLC start late).
3. For the 53 tickers already loaded, the new load changes no existing bar for dates up to
   2026-10-26 (report the count of differing bars; expected 0).
4. A second run writes 0 new rows.
5. `npm run check` and the targeted tests pass; no production write.

## Known limits to state in the report

- The archive contains only tickers listed today, so the history describes survivors.
- SPY and some tickers start on 2005-02-25 in this archive.
- Bars after 2026-10-26 need a newer archive; this task does not fetch one.

## Delivery

Append a "Delivery report" section to this file with the numbers for checks 1–5 and the key
convention for ETFs. Add the usual note to `docs/KIMI_CODE_HANDOFF.md`.

## Delivery report

Implemented in `scripts/load-stooq-prices.mts` and `worker/lib/stooq-price-load.ts`. The loader reads
and hashes `D:\stooq data 102726\d_us_txt.zip` once, parses those verified bytes in memory, and uses
the existing upsert in batches of at most 500 rows. It does not delete bars or use an LLM. Archive
size is **542,554,531 bytes**, SHA-256
`52d556a45701b5e3ba65b61df52b6341de2c2fe9fb628852f99ee2d08239380a`.

Two rerun attempts failed during archive reads with `EPERM` and then `ENOENT`, although the source
was readable in independent checks and its hash was unchanged. `unzipper.Open.file` opens a separate
read stream for archive ranges; the final loader instead uses the project's established `Open.buffer`
pattern on one immutable, hash-verified buffer, avoiding later per-entry filesystem opens. The source
stays on D:; no permissions or archive contents were changed. The underlying intermittent OS error
was not otherwise established. Original-bar snapshots are read in ID batches of 10,000, and their
value hashes are compared in batches of 1,000, rather than retaining millions of raw row objects.

### Key conventions and dual-class correction

- SPY retains `cik=0`. The sector ETF keys are XLB=-1001, XLC=-1002, XLE=-1003, XLF=-1004,
  XLI=-1005, XLK=-1006, XLP=-1007, XLRE=-1008, XLU=-1009, XLV=-1010 and XLY=-1011.
- The first archive pass inserted **2,526,859** rows, increasing the Stooq store from **1,097,787**
  to **3,624,646** rows; all original IDs remained present and **0 original bars differed**. An
  independent database readback then found that FOX/FOXA, GOOG/GOOGL and NWS/NWSA share a CIK,
  while `uq_prices_bar` is `(cik,date,source)`. The second listing had therefore overwritten the
  first on shared dates. This was corrected before delivery rather than reporting archive matches
  as stored coverage.
- `stooqPriceCik` assigns local price-series keys GOOG=-2001, FOX=-2002 and NWS=-2003. Primary
  listings GOOGL, FOXA and NWSA retain the shared SEC CIK. These negative keys are not SEC CIKs;
  `companies` is unchanged. Consumers resolving a particular listing use the exported mapping.
  Both the ETF and second-listing conventions avoid real positive CIKs and require no schema change.
- The loader now checks every requested ticker's stored row count and first/last dates against the
  archive. It fails if that readback, original-bar preservation, benchmark coverage or the S&P
  matching threshold fails. The summary contains the readback result.

### Benchmark dates and archive quality

SPY, XLB, XLE, XLF, XLI, XLK, XLP, XLU, XLV and XLY start on **2005-02-25**; XLC starts on
**2018-06-21**; XLRE starts on **2015-10-08**. All twelve benchmark series end on **2026-10-26**.
Their row counts are 5,450 each for the 2005 starts, 2,098 for XLC and 2,774 for XLRE.

The complete archive scan found **0** gaps of more than five SPY sessions inside ticker histories,
**0** non-positive OHLC values, **22** `high < low` observations and **0** duplicate dates. The
high/low observations are retained and enumerated in the summary: ARE 3, BEN 4, DE 3, FITB 1,
HUM 1, LII 4, PCG 2 and USB 4. **79** close-to-close moves beyond ±50% are also retained with
`reviewOnly=true`, not silently removed or treated as validated corporate actions. Six companies
have no local GICS sector and were not filled by guess: ENLT, IBM, LMT, META, RIVN and XOM_PRE.
The gap calculation uses a sorted, deduplicated SPY calendar in one pass; regressions cover
unsorted bars, duplicate unsorted calendar dates and exclusive gap endpoints.

### Known limits

- The archive contains only tickers listed today, so the history describes survivors.
- SPY and some tickers start on 2005-02-25 in this archive.
- Bars after 2026-10-26 need a newer archive; this task does not fetch one.

### Acceptance checks and final run evidence

1. **Coverage — pass.** All **502/502 (100%)** S&P snapshot tickers matched, exceeding the 98%
   threshold; `unmatched=[]`. All **514** requested series matched and passed stored-row/date readback.
   CSCO is present with **9,213 rows**, from 1990-03-26 through 2026-10-26.
2. **Benchmarks — pass.** SPY and all eleven sector ETFs are loaded. Each first date is listed above:
   ten start on 2005-02-25, XLC on 2018-06-21 and XLRE on 2015-10-08. Every benchmark ends 2026-10-26.
3. **Original bars preserved — pass.** The initial comparison covered all **1,097,787** pre-existing
   Stooq rows, including the previously loaded 53 tickers: **0 missing original IDs / 0 differing bars**.
   Comparison covers IDs and bar values, excluding the intentionally refreshed `fetchedAt` timestamp.
   The final rerun also reported **0 / 0**, with before=after **3,633,084** rows.
4. **Idempotency — pass.** The completed second run of `npx tsx scripts/load-stooq-prices.mts` wrote
   **0 new rows**. The store stayed at **3,633,084 rows**; readback verified **514/514** requested
   series with **0 mismatches**. Across the initial load and dual-class correction, **2,535,297**
   distinct rows were added. The full Stooq inventory has **517 series**: the 514 requested series plus
   pre-existing ENLT, RIVN and XOM_PRE histories, which were preserved rather than deleted.
5. **Checks and production isolation — pass.** `npx vitest run worker/lib/stooq-price-load.test.ts`
   passed **5/5**; `npm run check`, the full suite (**183 files / 1,009 tests**) and production build
   passed. `worker/lib/prod-push.ts` constructs `pricesDaily` from Schwab raw files, not this table;
   Stooq and Schwab remain separate by `(cik,date,source)`. No production write, schema change,
   deployment, model call or new service occurred.

The successful idempotency run started at `2026-11-11T03:49:36.014Z` and generated its summary at
`2026-11-11T04:19:17.240Z`. The committed summary is
`research/engine/price-load-stooq-2026-10-27.summary.json`, **79,885 bytes**, SHA-256
`5f5404b8c4191cc7cac1bc56837bd9b651da1b9acb27ed22a604d42d00961f2b`. It records
`readStrategy="single-buffered-read"`, all per-ticker dates/counts, quality findings, original-bar
comparison, readback and `productionWrite=false`.
