# K21 — Intraday candles: an evening collection and the desk views

**Owner's approval:** 2026-11-13 ("7. yes" to Claude's suggestion: real 5-minute candles plus views in the Company,
Markets, Watchlist and Today pages). **Author:** Claude. **Coder:** Kimi. **LLM use:** none.

**Two parts:**
- **K21a, collection:** right after K16.4. Every day without it is a day of candles that may not be fetchable later.
- **K21b, views:** after K20.

## 1. Why

- **What runs today:**
  - Since 2026-11-13 the job `schwab-intraday` snapshots the quotes of all 514 price series every 20 minutes of the
    session.
  - It builds `D:\research\alpha-engine\schwab-intraday\<session>\bars.json` (20-minute bars) and `live.json`, the
    desk's live prices.
- **The gaps:**
  - The desk shows only the latest price.
  - These bars come from quote snapshots, so their highs and lows are approximate and nothing exists between
    snapshots.
- **What Schwab offers:** its price history serves real minute candles. `worker/schwab-context.mts` already takes 5-day,
  5-minute candles for AAPL and SPY.
- **Research value:** from now on, the shape of every release day (opening gap against the drift through the day,
  pre-market and after-hours moves) is recorded for the engine's reaction family.

## 2. K21a — evening collection of 5-minute candles

- **Job:**
  - `schwab-candles-5m`: one request per price series, `pricehistory?symbol=…&frequencyType=minute&frequency=5&needExtendedHoursData=true`;
  - cron 17:15 local on weekdays, after the after-hours session ends at 20:00 ET;
  - the series list is `schwabPriceSeries()`, which K18 extends with registry companies outside the S&P 500.
- **Pace and access:**
  - Use the token handling and pacing of the existing Schwab collectors, at most 100 requests a minute.
  - Market data only (AGENTS.md section 3).
- **Depth:**
  - Measure how far back Schwab serves 5-minute candles: try `periodType=day&period=10`, then `startDate`/`endDate`
    going back.
  - Run one backfill as deep as it serves, and report the depth per series.
- **Storage:**
  - `D:\research\alpha-engine\schwab-candles\m5\<TICKER>\<yyyy-mm>.json`: candles keyed by start time (UTC), OHLCV,
    and the session part (pre, regular, post).
  - Atomic writes, merged idempotently.
  - A manifest per run: series, candles, first and last time, errors.
  - Raw responses are kept for the run only.
- **Checks:**
  - The regular-session candles of a day add up to the official daily candle: open, high, low, close within one tick,
    volume within 2%. This is checked for 20 series and the deviations are listed.
  - Gaps inside the regular session are listed.
  - Split days are noted. Schwab re-bases history after a split, so a basis check runs against the daily bars' basis
    change. On a split, the stored candles before the split date are re-based like the daily bars, and the event is
    logged.
- Tests for the merge, the session part, the daily tie-out and the re-base.

## 3. K21b — views in the desk

Follow the desk's tokens and chart rules: the data-viz reference palette, one axis per chart, a hover tooltip on every
mark, light and dark, phone width. **Audience:** the same as the live prices today.

- **Data:**
  - A procedure `desk.intraday({ ticker, sessions ≤ 10 })` reads the stored candles (cached by file time).
  - The session not yet fetched in the evening takes today's 20-minute snapshot bars, marked as such.
  - It returns the company, SPY and the company's sector fund.
  - It also returns per-session VWAP, the previous close, and the release or 8-K times within the window: the app's
    filings and the release calendar `D:\research\alpha-engine\engine\events\quarters-*.jsonl`.
- **Company page: "Today / 5 days".**
  - Candles with volume, VWAP, the previous close line, the opening gap.
  - Markers with time for releases and 8-Ks.
  - The stock against SPY and its sector fund, as returns from the previous close on one axis.
  - Pre-market and after-hours shaded.
- **Markets page: "Through the day".**
  - Breadth: the share of the 500 above the previous close per 20-minute step.
  - The 11 sector funds and SPY against the equal-weighted 500, as returns from the previous close.
  - Movers with their day path.
  - Built from the 20-minute snapshots by the live snapshot job, which keeps the payload small.
- **Watchlist and Today:** a small line of today's path per company, with the as-of time.
- **Honest labels:**
  - the as-of time;
  - "20-minute snapshots" against "5-minute candles";
  - the delayed flag where a quote is delayed;
  - outside a session, the last session is shown and named.
- **Polling:** every 5 minutes while the page is visible and the market is open, otherwise none.
- Each page's `DevNotes` is updated.

## 4. Rules

- Nothing in `api/lib/`, `api/kimi/`, `.env`; no schema change in `alpha_engine` (the candles live on D:).
- No production write.
- One scheduler, one web server. Claude restarts after review; say in the delivery what needs a restart.
- AGENTS.md section 3.1 for D: interruptions.

## 5. Acceptance

- **K21a:**
  - one manual run and one scheduled-style run, with manifest numbers;
  - the depth per series;
  - the daily tie-out list;
  - tests;
  - the job in `contracts/operations.ts` and `docs/OPERATIONS.md`;
  - a handoff section;
  - the gates (`npm run check`, `npm test -- --run --maxWorkers=4`, `npm run build`, `git diff --check`) with notes to
    Claude before the full run, the build and the commit.
- **K21b:**
  - desk tests for each view: render, empty state, the "snapshot vs candles" label, the tooltip;
  - screenshots in light and dark at desktop and 390 px;
  - `docs/desk/UI_MIGRATION.md` updated;
  - a handoff section, the same gates and notes.
