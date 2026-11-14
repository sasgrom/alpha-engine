# K22 — Daily prediction-market collector (Kalshi and Polymarket), read-only

**Owner's approval:** 2026-11-13 ("lets review improve execute and test" Kimi's prediction-market notes).
**Design:** `docs/DESIGN_POLYMARKET.md`, with the review and results in section 11. **Author:** Claude.
**Coder:** Kimi. **LLM use:** none.
**Order:** right after K16.5. The owner asked "so when do we start collection? the open contracts with probabilities can
go along with sec forms expectations as a decent signal" (2026-11-13).
**Started already:**
- Claude's lab run of 2026-11-13 (`C:\dev\alpha-engine-lab\src\predmarkets\kalshi_companies.py`) took the first
  snapshot and the full history of the company series.
- Reuse its reviewed series-to-company mapping: `D:\research\alpha-engine\predmarkets\kalshi\companies\mapping.json`.
  A series is accepted only when the ticker in its code and the company name in its market titles agree.
- The daily job continues from there: same folders, same row shape.

## 1. Why

The first tests showed:
- **Macro markets** (Fed, CPI, payrolls) are well-calibrated expectations, but give no after-release signal. They serve
  as context for the desk and as scenario priors.
- **Company KPI markets** on Kalshi (about 150 companies) bet on a company's own figure before its release, which is the
  engine's question. They started in mid-2026 and need forward collection before a test.
- **Settled prices** can be fetched later from both venues. Order-book depth and the exact quotes at a known fetch time
  cannot, which is why collection runs daily.

## 2. What to collect, every day

- **Macro, both venues where listed:**
  - Fed decisions (the next four meetings);
  - CPI (month on month, core, year on year), payrolls and unemployment (the next release);
  - US recession.
  - Market lists come by rule from the series and events, with no hand-picked markets. Kalshi series: `KXFED`,
    `KXCPI`, `KXCPICORE`, `KXCPIYOY`, `KXPAYROLLS`, `KXU3` if it exists, `KXRECSSNBER`. Polymarket: the "Fed decision in
    <month>" events and the CPI and recession events, found through gamma search.
- **Company markets, Kalshi:**
  - every open KPI and earnings-call series whose company is in our registry;
  - the mapping is company name → CIK from `std_price_companies`, in a reviewed file `company-series.json` (series,
    company, CIK, how matched), with ambiguous names listed and left out;
  - political, sports and entertainment series are never collected.
- **Per market and day:** fetch time; bid, ask, last; volume, open interest; the liquidity flag of section 6; rules
  text hash; status. When a market settles, also its result, settlement value and full daily candle history.
- **Storage:** `D:\research\alpha-engine\predmarkets\daily\<date>\<venue>.jsonl`, append-only, with a manifest per run.
  Settled histories go to `D:\research\alpha-engine\predmarkets\<venue>\…` as the lab fetchers store them.

## 3. Rules

- **Read-only public endpoints:** no key, no account, no order or portfolio endpoint. If an endpoint starts asking for a
  key, the job stops with an honest error.
- **Pace:** one request at a time, at least 0.25 s apart; backoff on 429 and 5xx; at most two retries.
- **Availability** is the fetch time. Nothing is backdated.
- **Political markets stay off** (section 3 of the design).
- **Reuse the lab code** (`C:\dev\alpha-engine-lab\src\predmarkets\`) as reference. The collector lives in the main
  repository as a worker script with tests.

## 4. Desk use (small, in this task)

- One owner-and-member card on desk Macro, "What the market expects":
  - the next FOMC meeting's outcome probabilities, from both venues where available;
  - the next CPI release's expected value with its spread;
  - the recession probability.
- Each card shows its as-of time and the calibration figure from section 11 of the design, e.g. "Fed markets: 0.99
  skill the day before, 2022–2026".
- No provider names in the reader's view (design section 3); lineage stays in Operations.

## 5. Acceptance

1. **One manual run and one scheduled-style run:** counts per venue, series and company. The company mapping file is
   listed in the delivery for Claude's review.
2. **Tests** on recorded responses (clearly fixtures):
   - the parsers of both venues;
   - the liquidity flag;
   - the political filter;
   - settlement capture;
   - the "stop when a key is required" rule.
3. **The desk card:** render, empty state, closed-market state, light and dark.
4. **Job** `prediction-markets-daily` in `contracts/operations.ts` (daily, after US close), plus `docs/OPERATIONS.md`.
5. **Gates** `npm run check`, `npm test -- --run --maxWorkers=4`, `npm run build`, `git diff --check`, with notes to
   Claude before the full run, the build and the commit.
6. **A handoff section and a mailbox message.** Claude restarts the scheduler and the web server after review.
