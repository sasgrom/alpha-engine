# Alpha Engine — Project Strength Review

**Assessment date:** 2026-10-27

**Purpose:** evaluate the project as a research and prediction system, not as a code review.

## 1. Executive verdict

Alpha Engine has become a **serious research platform**, but it is not yet a **proven alpha machine**.

The strongest parts of the project are engineering, provenance, idempotency, recovery, availability discipline and evaluation infrastructure. The weakest part is predictive evidence: the current models do not demonstrate a stable advantage over simple baselines, and the cross-section required for serious evaluation is still too small.

The right description today is:

> **A disciplined research environment with strong data plumbing and honest negative results, rather than a finished trading system.**

| Area | Assessment | Why |
|---|---:|---|
| Engineering reliability | 8/10 | Manifests, outbox, retries, idempotent writes, resume, typed APIs and tests |
| Data provenance and availability | 8/10 | SEC filing dates, availability anchors, known label exits and leak fixes |
| Data completeness | 4/10 | 495 companies in the registry, but factor_points only for 5; options history is mostly samples |
| Statistical discipline | 6/10 | Walk-forward, nested evaluation, cost model and bootstrap CIs, but small samples |
| Predictive evidence | 2/10 | No durable advantage over majority or always-up baselines |
| Live-trading readiness | 1/10 | Real capital is not appropriate yet |

## 2. What is genuinely strong

### 2.1. Variant C: cloud, home worker and local-first data flow

The architecture is a real strength:

- the cloud acts as control plane and production terminal;
- the home machine runs collectors and the local LLM;
- raw documents and large archives remain on the home drive;
- production receives normalized signals and derived features, not the entire corpus;
- manifests, outboxes, watermarks and checkpoints make interrupted work resumable;
- timestamped snapshotIds prevent history from being overwritten;
- `realpathSync` makes the disk guard follow the real cache target through the junction.

This is exactly the kind of infrastructure needed for long-running historical work.

### 2.2. EDGAR: from bulk downloading to a governed corpus

Implemented and verified:

- full submissions history with archive paging;
- 10-K, 10-Q, 8-K, amendments and SC/SCHEDULE 13D/G;
- MD&A and body extraction with exhibit fallback;
- TOC-aware heading detection, bare-label and nbsp-page handling and last-signature truncation;
- permanent 404/410 fast-fail instead of repeated exponential waits;
- bounded LLM retries and JSON schema for score/why;
- smaller overlapping windows that preserve document coverage;
- per-company manifests and explicit skip reasons;
- outbox before delivery confirmation and real filing dates.

A particularly good decision was to turn failures into diagnostic artifacts. `llm-failures.jsonl` records promptChars, responseChars, evalCount, totalMs and the model's actual response, so prompt/parser problems can be diagnosed from evidence instead of GPU wattage.

What remains unproven:

- whether EDGAR tone predicts returns rather than merely reading fluently;
- whether every document class is extracted without semantic loss;
- whether JSON schema permanently removes `no parseable score` rather than moving the problem to another document class.

### 2.3. 13F: a major engineering success

Production currently contains:

- **875,860 holdings**;
- **300 funds**;
- **371 companies**;
- **3,372 fund_quarters**, with no missing filingDate;
- **16,422 position events**, all with notes and actual filing dates.

Difficult issues were solved properly:

- RESTATEMENT and NEW HOLDINGS are merged by meaning instead of treating the latest accession as the whole book;
- negative OpenFIGI cache no longer freezes history;
- `fund_jobs` no longer marks incomplete work complete forever;
- full snapshot upserts can heal old rows instead of only appending;
- sector and 3D flows no longer compare 9 early filers with 299 complete funds, so the artificial all-red view is gone;
- Institutional ownership uses a stable panel and shows coverage.

Important limitations remain:

- the top-300-by-AUM universe is selected today, which creates historical selection/survivorship bias;
- `ΔvalueUsd` mixes actual position changes with price movement;
- 13F is delayed disclosure, not a real-time smart-money feed.

The next step must be shares and weights, not simply more dollar deltas.

### 2.4. Fundamentals and availability discipline

Current data includes:

- **608,720** facts from **25 companies**;
- **51,703** price bars from **6 tickers**;
- **47,901** macro observations from **8 series**;
- only **1,518 factor points from 5 companies**.

The availability work is unusually important:

- entries occur strictly after the anchor;
- `forwardReturnInfo` exposes the actual exit date;
- market factors no longer receive an artificial 45-day delay;
- fundamental points are tied to the first filing, not to later comparative filings;
- macro is evaluated per anchor, not by the latest row in the database;
- a training label is used only when its exit was already known at prediction time.

These are exactly the fixes that prevent an attractive backtest from becoming an example of leakage.

### 2.5. Options: a real foundation, but not yet a history

Implemented:

- Cboe delayed-chain collection;
- ORATS near-EOD full-market sample;
- ORATS minute samples;
- Alpha Vantage historical IBM sample;
- EODHD time series grouped by `tradeDate`;
- snapshotIds, raw/normalized separation, quality metrics, atomic writes and a manifest.

Actual normalized examples include:

- Cboe: **95,330 contracts**;
- ORATS near-EOD: **60,128 call/put contracts** for our 35 underlyings;
- Alpha Vantage IBM: **998 contracts**;
- EODHD: **62 daily chains / 11,000 rows / 9,515 unique contracts**;
- ORATS intraday: **9,200 contracts**.

This is not a long options history. It is a schema and a first snapshot set. A serious options backtest needs an ORATS backfill, Cboe DataShop or another deep historical source.

### 2.6. Probability and evaluation

Strong protocol elements:

- rolling IC selection instead of full-history factor selection;
- sign-aware Bayes with a dependence root;
- Beta(1,1) smoothing for reliability;
- a bounded macro prior;
- partial-pooled logistic intercepts;
- isotonic calibration;
- fit/calibrate/evaluate plus final holdout;
- non-overlapping returns, costs, turnover, Sharpe, max drawdown and bootstrap CIs.

Weak evidence:

- AAPL: 47.1% Bayes / 41.2% logistic versus a 54.9% majority baseline;
- NVDA: 64.8%, exactly the always-up baseline;
- MSFT: 57.7% / 42.3% versus a 65.4% majority baseline;
- MSFT logistic reaches 100% on only four holdout anchors, which proves nothing.

The negative result is valuable. It tells us to improve data and evaluation before adding model complexity.

## 3. Main gaps

### 3.1. There is almost no cross-section

The question “which stock will rise more?” requires many companies at the same timestamp. Today:

- factor_points covers only 5 companies;
- prices cover only 6 tickers;
- only AAPL, MSFT, NVDA and PLD are currently suitable for magnitude;
- GOOGL has four factors and no price history.

Therefore rank IC and bucket spread correctly return `insufficient`, rather than producing a convincing but meaningless number.

This is the main blocker for the next stage.

### 3.2. Prices are stale for live use

The latest price date is **2026-10-09**. Historical research can tolerate this; live prediction cannot. A daily price worker is required before treating any current signal as current market information.

### 3.3. EDGAR tone still needs economic validation

JSON schema and retry limits fix technical failures, not economic value. The next validation must include:

- human-labeled samples by form and company;
- confusion matrices against human labels;
- error classes for TOC, procedural documents, references, qualifications and genuine bad news;
- score stability across models and windows;
- incremental IC after fundamentals and 13F.

Without this, EDGAR tone is just another noisy feature.

### 3.4. 13F is not yet a clean smart-money flow

Using `ΔvalueUsd` alone conflates trades with market movement. In addition, the current top-300 universe creates historical selection bias. Repeated ownership by many funds can also produce a false consensus signal.

The correct next metrics are:

- `Δshares / sharesOutstanding`;
- `Δ(position weight in fund)`;
- `Δ(position weight in company)`;
- the number and type of funds that actually changed position.

### 3.5. Options lack a historical basis

We cannot yet honestly test:

- IV term structure and skew across years;
- dealer/gamma scenarios;
- the options market's response to earnings and macro events;
- the difference between short- and long-dated volatility.

That requires a proper historical archive, not demos or a current chain.

### 3.6. The models have not earned the word “alpha”

Probability and magnitude are currently a protocol and a baseline, not a validated edge. There is no justification for that word while:

- cross-section is tiny;
- sector-neutral evidence is absent;
- multiple market regimes are not validated;
- out-of-sample, net-of-cost performance is not established;
- parameters are not stable across windows.

## 4. The actual project network

### 4.1. Data layer

| Node | Status | Meaning |
|---|---|---|
| EDGAR fetch/cache | Done | Resumable download, manifests, 404 fast-fail and EX-99 |
| EDGAR tone | Partial | Real rows exist, but economic value and stability are unproven |
| 13F raw holdings | Done | Full synchronization, amendments and full-book totals |
| 13F share-based flows | Missing | Needs normalized share/weight flows, not only USD deltas |
| Fundamentals/XBRL | Partial | 25 fact companies, but only 5 factor-point companies |
| Prices | Partial | Long history exists, but only 6 tickers and stale latest data |
| Macro/FRED | Partial | 8 series and a bounded prior; a wider regime pack is needed |
| Options raw | Partial | Snapshots and normalization exist, but no long history |
| CUSIP crosswalk | Partial | It works for the current set, but coverage needs an independent audit |

### 4.2. Feature layer

| Node | Status | Meaning |
|---|---|---|
| Fundamental factor library | Partial | Base factors exist, but broad materialization is missing |
| Availability anchoring | Done | One of the strongest parts of the project |
| EDGAR tone | Partial | The format is fixed; economic validation is still ahead |
| 13F normalized flow | Missing | Must be share/weight-based, not merely value-based |
| Options features | Missing | Raw chains exist; features have not been built |
| Macro regime features | Partial | A limited rule-based prior, not a complete regime model |
| Structured guidance | Missing | A separate numeric forward-looking stream has not been built |

### 4.3. Model and evaluation layer

| Node | Status | Meaning |
|---|---|---|
| Rolling IC | Done | Good leakage protection, but limited sample size |
| Sign-aware Bayes | Partial | Formula corrected, predictive advantage unproven |
| Panel logistic | Partial | Partial pooling exists, but no evidence of edge |
| Nested evaluation | Done | One of the strongest parts of the system |
| Magnitude kernel | Partial | Baseline exists, but no feature-based expected-return model |
| Cost model | Done | Non-overlap, costs, turnover, Sharpe and maxDD |
| Calibration | Partial | Isotonic exists, but stability is limited by small samples |
| Cross-sectional validation | Missing | No ≥30/≥300-company evaluation |
| Portfolio/risk | Missing | Too early to build |
| Independent validation | Missing | Needs another provider or independent dataset |

### 4.4. Operations layer

| Node | Status | Meaning |
|---|---|---|
| Worker ingest/outbox | Done | Reliable delivery and deduplication |
| Storage/junction | Done | Large cache on D:, realpath-aware disk guard |
| UI/monitoring | Partial | Good tables and QA, but limited alerting |
| Documentation/tests | Done | 274 tests plus real browser QA |
| Scheduler/alerts | Partial | Tasks exist, but failure watchdogs are weak |
| Backup/restore | Partial | Cache is on D:, but MySQL restore is untested |
| Live monitoring | Partial | Logs exist, but operational quality and drift metrics are missing |

## 5. What is required for genuine alpha

### 5.1. Minimum data requirements

1. **At least 30 companies** for a technical cross-section and **at least 300** for robust deciles.
2. Complete fundamentals and price history for those names, including delisted/departed names.
3. Availability and vintage discipline for every source: filedAt, revision dates, known label exits and no future leakage.
4. Share/weight-based 13F flows instead of value-only changes.
5. A real options history with NBBO, OI, IV, Greeks, expirations, strikes, corporate actions and delisted names.
6. Daily price and macro updates.

### 5.2. Required features and models

1. Sector and style factors, not just a handful of generic formulas.
2. Sector-neutral residuals: remove market and sector beta before learning direction and magnitude.
3. Expected return `E[r] = p·μ_plus + (1−p)·μ_minus`, not merely `P(up)`.
4. Quantile/Huber models for tails, not only sign classification.
5. Observable options features: ATM IV, slope, skew, volume/OI, spread and earnings IV crush, without inventing dealer direction.
6. Structured guidance numbers: revenue, EPS, margin, capex and buybacks, not only tone.

### 5.3. Required proof

1. Walk-forward evaluation by time, not random splitting.
2. Simultaneous out-of-time and out-of-company evaluation.
3. Multiple regimes: 2008, 2020, 2022, calm bull and sideways markets.
4. Net-of-cost evaluation: spread, slippage, borrow, turnover and capacity.
5. Baselines: always-up, majority, equal-weight, sector-neutral momentum and simple value.
6. Block-bootstrap confidence intervals and multiple-testing control when many factors are tried.
7. Independent validation on another provider or an independent dataset.

### 5.4. Conditions for live trading

Live trading is appropriate only when all of these are true:

- positive expected excess return after costs across independent samples;
- no collapse in bear regimes;
- monotonic returns across score buckets;
- no dependence on a single company, sector or year;
- drawdown and turnover remain within pre-set limits;
- paper trading confirms the execution model.

If any condition fails, the project should remain a research tool.

## 6. Prioritized roadmap

### P0 — finish data honesty and operational completeness

- finish the 35-company EDGAR crawl and analyze skip reasons;
- update prices to the current date;
- materialize factor_points for all 35;
- close PG/WMT/XOM and GOOGL data gaps;
- implement share/weight-based 13F flow;
- back up MySQL on D: and verify a restore;
- verify fund_quarters, holdings, signals, manifests and error reports.

### P1 — the first real panel (30+)

- assemble at least 30 companies with fundamentals, prices and history;
- test conditional magnitude and rank IC rather than tuning on 3–4 names;
- run initial sector and cross-section checks;
- start an offline options-feature baseline, without treating samples as history.

### P2 — full cross-section (300+)

- expand to at least 300 companies with delisted/departed data;
- add sector-neutral z-scores and residual returns;
- build a proper Huber/quantile expected-return model;
- run out-of-time and out-of-company tests across several regimes;
- only then discuss portfolio weights and capacity.

### P3 — independent validation and portfolio construction

- validate factors on an independent source or dataset;
- construct a long/short or benchmark-relative portfolio with weight, sector, liquidity and cost constraints;
- run paper trading and compare actual execution with the model;
- if the edge is not statistically and economically meaningful, keep the system in research mode.

### P4 — live readiness

- monitor factor drift, data drift and execution quality;
- alert on IC deterioration, wider spreads, source errors and turnover spikes;
- define kill criteria and automatic stops when the model stops working;
- only then consider a small real position with tightly limited risk.

## 7. What not to do

- Do not add model complexity to hide a narrow or dirty panel. LightGBM and neural networks will not rescue it.
- Do not tune thresholds on 3–4 companies or on four holdout anchors.
- Do not treat the current top-300 as a neutral historical universe.
- Do not call LLM tone a proven factor before human-labeled validation.
- Do not backtest options on demo samples.
- Do not mirror raw archives to prod or move MySQL without a restore test.
- Do not wake GDELT; its moratorium remains in force.
- Do not call current probabilities “alpha” when no advantage has been demonstrated.

## 8. Final assessment

**The project's strength is not prediction; it is the way data and failures are handled.** SEC, 13F, cache, availability, outbox, nested evaluation, costs, documentation and tests already form a serious research infrastructure.

**The weak part is the predictive layer itself.** It is limited by a narrow panel, incomplete coverage, missing options history and unproven tone.

The correct next bet is therefore:

> **Expand and validate the data and cross-section first, then make the model more sophisticated. Right now Alpha Engine's most valuable feature is that it can honestly show where the evidence is missing.**
