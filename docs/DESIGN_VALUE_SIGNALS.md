# DESIGN — Factor Library, Intrinsic Value, Insiders/Short-Interest, Signals Encyclopedia

> Design memo (iteration 4i, decisions D41–D43). Protocol-before-data: this
> memo pins formulas, schemas and validation BEFORE implementation.
> Owner directives encoded here: free sources only; cloud processing limited
> to 2–3 companies (the owner's trimmed universe); heavy pulls and LLM nuance
> are the LOCAL WORKER's job (Variant C) — everything deferred is listed in
> §7 and mirrored in LLM_CONTEXT.md.

## 0. Track order (owner-approved 2026-10-19)

1. **4i — Factor library + intrinsic value** (zero new data sources; pure
   computation over `series_points` + `prices` + `events`).
2. **4j — Insiders (Form 4) + short interest** on the events machinery.
3. **4k — Signals encyclopedia v1** (GDELT tone + Stocktwits labels, Signals
   tab); schema is coded in 4i, heavy/historical pulls are worker-deferred.

---

## D41. Factor library (computed from our own tables)

Layer: `api/services/factors.ts` — pure functions over per-company quarterly
series; computed ON DEMAND per company page (2–3 companies scope), cached in
`external_cache` (`factors:<cik>`, 20h TTL). No table in v1; the worker's
batch materialization schema is pinned in §4 for later.

Vintage discipline (D2): factors compute on the chosen vintage
(latest / first / as-of-T); backtests use as-of only.

| Factor | Formula (our concepts) | Anchor |
|---|---|---|
| Accruals quality | (NetIncome − CFO) / TotalAssets, quarterly | Sloan 1996 |
| Gross profitability | GrossProfit / TotalAssets | Novy-Marx 2013 |
| Asset growth | Assets_t / Assets_{t-4q} − 1 | Cooper–Gulen–Schill 2008 |
| Buyback yield | −Δ CommonStockSharesOutstanding + dividends/price | FF; Loughran–Ritter |
| Piotroski F | 9 binary signals (ROA, CFO>0, ΔROA, accruals, Δleverage, ΔcurrentRatio, issuance, ΔgrossMargin, Δturnover) | Piotroski 2000 |
| Beneish M | DSR GMI AQI SGI DEPI SGAI LVGI TATA composite | Beneish 1999 — pairs with our revision metrics (D7) |
| Altman Z | 1.2·WC/TA + 1.4·RE/TA + 3.3·EBT/TA + 0.6·ME/TL + 1.0·S/TA | Altman 1968 |
| Momentum 12-2 | price return, skip last month | Jegadeesh–Titman 1993 |
| 52w-high proximity | close / 52w high | George–Hwang 2004 |
| SUE (time-series) | (EPS_q − EPS_{q-4}) / σ(diffs over 8q) | Chan–Jegadeesh–Lakonishok 1996 |
| PEAD support | AR around our 8-K Item 2.02 events × SUE sign | Bernard–Thomas 1989 |
| Revision factors | revision_rate / magnitude / lag | ours (Stage 1.6, D7) |

Known data edges (honest): Beneish needs receivables/DSR (we have), SGI needs
YoY revenue (have), DEPI needs depreciation & PP&E (have), LVGI leverage
(have), TATA = accruals/assets (have). F-score quarterly: ROA/CFO/ΔROA/
accruals fine; Δleverage & Δcurrent-ratio fine; issuance from diluted shares
flow (have); Δgross-margin fine; Δturnover = Δ(rev/assets) fine.

## Intrinsic value panel (api/services/valuation.ts)

NO point estimates. Outputs are ranges and expectation reads:

1. **Reverse DCF (primary, Mauboussin/Rappaport "Expectations Investing")** —
   solve implied FCF growth g* such that DCF(FCF_TTM, g*, fade, WACC) = price.
   Report g* vs historical FCF CAGR and our TTM margin path: the market's
   priced-in expectation vs the fundamental trajectory. WACC = rf + β·ERP
   with rf/ERP constants (FRED feeds them later); β = our beta5y.
2. **Residual income (EBO/Ohlson)**: V = B + Σ (ROE−r)·B_t/(1+r)^t + terminal;
   bear/base/bull via ROE scenarios (worst/median/best of last 8 quarters).
3. **Earnings Power Value (Greenwald)**: EPV = EBIT_TTM·(1−tax)/WACC, zero
   growth — the conservative floor.
4. **V/P ratio** (Frankel–Lee 1998) + multiples z-scores vs own 5Y median
   (P/E) and vs sector peers in the shared registry.
5. DDM Gordon for dividend payers (AAPL/MSFT/T/PLD pay) — payout-capped g.

UI: Company page → **Value** tab (factor cards with z-scores + intrinsic
panel with implied-expectation read). Screener value columns come later
(per-user, after factor coverage is validated).

## D42. Insiders (Form 4) + short interest (4j, schema coded in 4i)

**Form 4 acquisition**: issuer-side via EDGAR full-text search
(`efts.sec.gov/LATEST/search-index` equivalent JSON endpoint, forms=4,
cik filter) or browse-edgar getcompany&type=4 — both free, both through
edgar.ts fair-access. XML parse → `insider_trades` (DDL 014, §4).

Derivatives: net insider buying $/quarter; cluster buying (≥3 distinct
insiders purchasing within 30d); routine filter per Cohen–Malloy–Pomorski
2012 (same calendar month ≥3 consecutive years = routine — only non-routine
trades carry signal); 10b5-1 / F-tax / M-exercise exclusion (2023+ XML
checkbox); conviction = trade $ / holdings.

**Short interest**: FINRA biweekly files (free, settlement-dated) primary;
Yahoo via agent-gw as fallback (prod egress to Yahoo is blocked, the plugin
rides the gateway). Derivatives: SI % float, days-to-cover, ΔSI between
settlement dates, SI z-score vs own history. Overlay, not standalone
(Dechow 2001; Boehmer–Huszar–Jordan 2010; Rapach 2016 RFS).

Events integration: `events.type` gains 'insider_cluster' / 'si_spike'
(token rules from the same rebuild hooks as 4a).

## D43. Signals encyclopedia (4k v1; schema coded in 4i)

**Feature store** `signals` (DDL 013, §4): every signal carries BOTH
timestamps — `eventTs` (content publication time) and `ingestedAt` (when it
reached us). Backtests read ingestedAt ≤ T only; backfills are marked
`source='backfill'` and used with eventTs under an explicit research flag.
This is the owner's "честно и аккуратно следить за датой и временем сигнала".

**v1 sources (free, timestamped, machine-readable tone):**
- **GDELT 2.0** (GKG): company-mention news every 15 min, native Goldstein
  tone, history to 2017 — the free firehose. Pull: per-ticker query JSON,
  15-min cadence (worker) / on-demand now.
- **Stocktwits** public symbol stream: user-labeled bullish/bearish — free
  labeled retail sentiment (Cookson–Niessner 2020 RFS; Renault 2017).

**Network reality (proven 2026-10-19, sandbox egress probes):** Stocktwits =
Cloudflare 403 from datacenter IPs; Google News RSS and Reddit = egress
timeout; GDELT answers but per-IP throttles hard (429). ⇒ the collectors run
on the HOME WORKER (residential IP), never from the cloud/sandbox. The
pipeline modules `api/services/signals.ts` + `api/services/insiders.ts` are
the worker's code path — parsers unit-tested with fixtures, inserts
idempotent via UQ keys.

**v2 sources (worker-deferred):** Reddit sub JSONs (WSB daily), YouTube CC
transcripts of profile influencers (timedtext API, no key for CC videos),
Google Trends (FEARS-like; weekly — Stage 4 regime input rather than
signals). Twitter/X skipped honestly (paid API / ToS).

**Scoring v1 without LLM spend:** GDELT native tone; Stocktwits label counts;
texts (v2) via Loughran–McDonald lexicon counts (free, deterministic,
literature-standard). LLM nuance scoring reuses the Stage 2.2 contract
(SCORE_JSON_SCHEMA) — worker-deferred.

**UI (the terminal surface):** Company page → **Signals** tab (reserved since
3c): source-colored signal timeline, 7d tone sparkline vs price, 24h/7d
aggregates. Screener columns later: Buzz (intensity), Tone 7d.

**Validation (extends the Lab's pre-registered protocol):** Spearman ρ of
aggregate signal vs forward AR vs SPY (ingestedAt+1..+3d), aggregate-only,
n≥30 days × ≥20 companies, quality gates on source coverage. No ρ below n=30.
Backtest only on ingestedAt semantics; eventTs backfill is research-mode with
the flag.

## 4. Schemas (coded in 4i, populated by the worker later)

DDL 013 `signals`:
`signals(id PK, cik, source('gdelt'|'stocktwits'|'reddit'|'youtube'|'trends'), signalType('tone'|'buzz'|'label'), eventTs datetime, ingestedAt datetime, score double NULL, magnitude double NULL, payloadKey varchar(255) NULL, src varchar(24), UQ(cik, source, eventTs, signalType), KEY(cik, ingestedAt), KEY(eventTs))`

DDL 014 `insider_trades`:
`insider_trades(id PK, cik, accessionNo, insiderName, insiderRole, code varchar(2), shares double, price double NULL, sharesAfter double NULL, tradeDate, filingDate, is10b5 boolean, UQ(cik, accessionNo, code, shares))`
`events.type` gains 'insider_cluster' | 'si_spike' at rebuild-hook time (no DDL — varchar already).

## 5. Deferred to the local worker (Variant C) — the standing debt list

Mirrored in LLM_CONTEXT.md §NOW; updated whenever this moves:
1. Universe growth beyond the test set (bulk SEC pulls, full Metastock
   history import, daily price deltas, zip downloads);
2. GDELT/Stocktwits continuous pulls + history backfill (GDELT to 2017);
3. Reddit/YouTube-CC/Trends collectors;
4. LLM nuance scoring of signals (Stage 2.2 contract, temp=0+seed, GBNF);
5. Factor batch materialization (`factor_points`) + factor IC monitor
   (Stage 5-alpha);
6. FRED macro for Stage 4 regimes (free key);
7. Options data source decision (Stage 6 blocker: CBOE delayed / home IBKR /
   ORATS) + skew surface storage;
8. Strict-reproducibility rescoring (local Qwen) of cloud calibration scores.

## 6. What 4i ships in code

- `api/services/factors.ts` — the D41 library (pure, unit-tested);
- `api/services/valuation.ts` — D41 value models (pure, unit-tested);
- `company.factors` / `company.value` endpoints (authedQuery, per-company,
  external_cache 20h);
- Company page **Value** tab;
- DDL 013/014 schemas (empty tables, worker-populated later);
- tests + QA on AAPL real numbers; manuals + LLM_CONTEXT updates.
