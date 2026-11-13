# K21 — Intraday views: the desk looks alive during the session

**Owner's approval:** 2026-11-13 ("7. yes"). Clarified the same day: "wanted for the page look alive, did not plan to
store all of it". If 5-minute history is ever needed, Stooq offers a historical 5-minute download (about 714 MB), "very
easy fetch" by the owner. **Author:** Claude. **Coder:** Kimi. **LLM use:** none. **Order:** right after K16.4.

## 1. Why

- **What runs today:**
  - Since 2026-11-13 the job `schwab-intraday` snapshots the quotes of all 514 price series every 20 minutes of the
    session, in about three batched requests per run.
  - It writes `D:\research\alpha-engine\schwab-intraday\<session>\<HHMM>.json` (compact quotes), `.raw.json`
    (responses), `bars.json` (bars built from the snapshots) and `live.json`, the desk's live prices.
- **The gap:** the desk shows only the latest price. Nothing shows how the day has moved.
- **Scope:** this task is about display. Research history of intraday candles is not collected here. When the engine
  needs it, the owner's Stooq 5-minute download is the source.

## 2. Data

- **Cadence:**
  - During regular hours, `schwab-intraday` runs every 5 minutes instead of 20, which is about 240 requests a day.
  - Keep its token handling and the market-hours check. Market data only (AGENTS.md section 3).
  - Bars become 5-minute bars from snapshots.
  - Check the pacing against the other Schwab jobs that run in the same minutes.
- **Storage, with nothing deleted:**
  - Raw responses (`.raw.json`) are written only at the 20-minute marks, as today, about 9 MB a day.
  - The runs in between keep only the compact snapshot (about 65 KB each).
  - `bars.json` is kept.
- **Procedure `desk.intraday({ ticker, sessions ≤ 5 })`:**
  - reads the stored session bars, cached by file time;
  - returns the company, SPY and the company's sector fund;
  - returns per-session VWAP from the bars, the previous close, and the release or 8-K times in the window: the app's
    filings and the release calendar `D:\research\alpha-engine\engine\events\quarters-*.jsonl`.
  - **Splits:** a window across a split takes the split from the price-adjustment log and puts earlier sessions on the
    new basis.
- **Market summary,** built by the live snapshot job (`desk-snapshot-live`) from the latest session bars:
  - breadth per step (the share of the 500 above the previous close);
  - SPY and the 11 sector funds as returns from the previous close;
  - the equal-weighted 500;
  - the top movers with their day path.

## 3. Views

Follow the desk's tokens and chart rules: the data-viz reference palette, one axis per chart, a hover tooltip on every
mark, light and dark, phone width. **Audience:** the same as the live prices today.

- **Company page: "Today / 5 days".**
  - Bars with volume, VWAP, the previous close line, the opening gap.
  - Markers with time for releases and 8-Ks.
  - The stock against SPY and its sector fund, as returns from the previous close on one axis.
- **Markets page: "Through the day".** Breadth, the sector funds, SPY against the equal-weighted 500, and the movers with
  their day lines.
- **Watchlist and Today:** a small line of today's path per company, with the as-of time.
- **Honest labels:**
  - the as-of time;
  - "built from 5-minute price snapshots; highs and lows are approximate";
  - the delayed flag where a quote is delayed;
  - outside a session, the last session is shown and named.
- **Polling:** every 5 minutes while the page is visible and the market is open, otherwise none.
- Each page's `DevNotes` is updated.

## 4. Rules

- Nothing in `api/lib/`, `api/kimi/`, `.env`; no schema change; no production write.
- **Restarts:** the cadence change needs a scheduler restart, and the new procedure needs a web restart. Claude does
  both after review; say in the delivery which ones are needed.
- AGENTS.md section 3.1 for D: interruptions.

## 5. Acceptance

1. Job tests for the cadence, the 5-minute bars, and raw responses written only at the 20-minute marks.
2. Procedure tests: one company with SPY and its sector fund, the VWAP, the previous close, the markers, and a window
   across a split.
3. Desk tests for each view: render, empty state, the "snapshots" label, the tooltip, the closed-market state.
4. Screenshots in light and dark, at desktop and 390 px.
5. Gates: `npm run check`, `npm test -- --run --maxWorkers=4`, `npm run build`, `git diff --check`. Send Claude notes
   before the full run, the build and the commit.
6. One commit with:
   - code and tests;
   - `contracts/operations.ts` and `docs/OPERATIONS.md` for the cadence;
   - `docs/desk/UI_MIGRATION.md` updated;
   - a handoff section.
   Then a mailbox message.
