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
