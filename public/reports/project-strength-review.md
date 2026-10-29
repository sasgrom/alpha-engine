# Alpha Engine — Project Strength Review

**Assessment date:** 2026-10-29

**Purpose:** evaluate the project as a research and prediction system, not as a code review.

## 1. Executive verdict

Alpha Engine is a **serious research platform**, but it is not yet a **proven alpha machine**.

The strongest parts are engineering, provenance, idempotency, recovery, availability discipline and evaluation infrastructure. The research panel now covers 53 CIKs with fundamentals, canonical series and factor points, plus 53 CIKs with EDGAR tone. The weakest parts remain long options history, daily freshness and regime-stable predictive evidence.

> **A disciplined research environment with substantially better coverage and honest uncertainty, rather than a finished trading system.**

| Area | Assessment | Why |
|---|---:|---|
| Engineering reliability | 8/10 | Manifests, outbox, retries, idempotent writes, resume, typed APIs and tests |
| Data provenance and availability | 8/10 | Filing dates, availability anchors, known label exits and lineage checks |
| Data completeness | 6/10 | 53-CIK research coverage is real; 300+ and full options history are still missing |
| Statistical discipline | 7/10 | Walk-forward, independent universes, event studies, robustness, FDR and cost checks |
| Predictive evidence | 3/10 | Tone has a positive 126-session result, but short-horizon and yearly evidence is unstable |
| Live-trading readiness | 1/10 | Real capital is not appropriate yet |

## 2. Current measured coverage

| Stream | Current measured state |
|---|---|
| Registry | 495 companies, 11 sectors |
| Fundamentals | 1,348,866 facts from 53 CIKs |
| Canonical series | 1,093,785 points from 53 CIKs |
| Factors | 21,894 factor points from 53 CIKs and 16 factors |
| Prices | 447,282 bars from 54 series, latest date 2026-10-26 |
| EDGAR tone | 16,133 rows from 53 CIKs, latest event 2026-10-23 |
| 13F holdings | 875,860 holdings, 300 funds, 371 companies, 3,372 fund_quarters |
| Position events | 16,422 events with actual filing dates |
| Macro | 47,901 observations from 8 series |
| Options | 250 snapshots and 310,634 normalized rows |
| Tests | 367 tests plus desktop/mobile browser checks |

These values describe the current database and local manifests, not an invented weekly trend.

## 3. What is genuinely strong

### 3.1. Variant C: cloud, home worker and local-first data flow

- The cloud acts as control plane and production terminal.
- The home machine runs collectors and the local LLM.
- Raw documents and large archives remain on the home drive.
- Production receives reviewed normalized signals and derived features, not the entire corpus.
- Manifests, outboxes, watermarks and checkpoints make interrupted work resumable.
- Timestamped snapshotIds and realpath-aware disk guards prevent accidental overwrites.

This is the correct infrastructure for long-running historical work.

### 3.2. Fundamentals and availability discipline

The panel now includes all 53 research CIKs, including XOM and XOM_PRE as separate evidence entities.

Important invariants:

- entries occur strictly after the anchor;
- forward-return calculations expose the actual exit date;
- market factors do not receive an artificial 45-day delay;
- fundamentals use first-filed availability, not later comparative filings;
- macro is evaluated per anchor, not by the latest database row;
- a training label is used only when its exit was already known at prediction time;
- per-CIK reconciliation checks registry, facts, canonical series, factors and price coverage.

The latest reconciliation found one concrete registry gap, XOM_PRE, rather than hiding it behind aggregate totals. A reviewed one-row registration repair is prepared.

### 3.3. 13F: from USD deltas to share and weight flows

Implemented and verified:

- 875,860 holdings from 300 funds and 371 companies;
- 3,372 fund_quarters with actual filing dates;
- 16,422 position events;
- semantic RESTATEMENT and NEW HOLDINGS merging;
- full-book totals and comparable-fund guards;
- share-count direction and edge thickness instead of price-driven false buying;
- full-book portfolio-weight changes instead of treating USD appreciation as institutional buying.

Remaining limitations are historical manager selection, delayed disclosure and CUSIP coverage. These are not reasons to return to USD-only flow logic.

### 3.4. EDGAR tone: technically governed, economically conditional

The corpus has manifests, full-history fetching, amendments, EX-99 fallback, bounded retries, atomic checkpoints, explicit skip reasons and JSON score/why extraction.

Prompt v1 currently shows:

- 63-session weighted Spearman 0.0302, with a confidence interval that includes zero;
- 126-session weighted Spearman 0.0757, with bootstrap CI 0.04897–0.10293;
- 126-session quantile top-bottom 0.0913;
- quarterly long-short turnover 0.6043.

A separate market-model event study evaluates 2,515 usable events. Positive and negative tone groups have different long-horizon CAR behavior, but yearly splits and independent checks show that the relationship is not universal or stable enough for production promotion.

The current turnover-drag scenarios are 0.12%, 0.48% and 1.21% annualized at 5, 20 and 50 bps per one-way turnover. These are sensitivity checks, not a complete portfolio backtest.

### 3.5. Options: working features and QA, but incomplete history

Implemented:

- normalized Cboe, EODHD, ORATS and sample-provider snapshots;
- DTE-bucket ATM IV, term slope, 25-delta skew, put/call volume and OI, volume/OI and ATM spread;
- offline quality reports for duplicates, zero-bid, zero-ask, crossed/locked quotes, invalid rows and timestamp coverage;
- matched cross-provider checks with explicit time deltas and near-ATM subsets;
- a 22-hypothesis preregistered research ledger with formulas, targets, falsifiers and dated evidence.

DoltHub coverage probe found 40 tickers present on all five historical anchor dates and 50 of 52 with recent chains. However, the sampled latest chains contain only four expirations per ticker and no volume, OI or underlying price. This is useful mid-DTE IV research data, not a complete options archive.

The first 52,292-snapshot research panel now separates volatility prediction from directional alpha. ATM IV has strong forward-RV evidence: IC 0.737 with 95% moving-block CI 0.687–0.778, sector-neutral IC 0.582 and positive values across all 90 months and both independent universes. Term slope is weak and holdout-unstable at −0.070. The 25-delta skew has no robust directional evidence at 0.041 with a zero-crossing CI and no FDR rejection. The IV–RV premium is unstable at −0.029, with sign flips across universes and years. ATM IV is therefore a volatility-model candidate, not a directional trading signal; an incremental test against a simple trailing-RV baseline remains mandatory.

Yahoo option chains were independently rejected for IV/Greeks/OI use because two-sided quote coverage and OI coverage are too weak. That negative QA result is preserved rather than hidden.

### 3.6. Research and evaluation protocol

Current protocol elements include:

- rolling IC selection rather than full-history selection;
- sector-neutral residuals and independent odd/even CIK universes;
- macro-regime validation;
- market-model abnormal returns and CAR event studies;
- preregistered discovery, validation and sealed-holdout windows;
- Benjamini–Hochberg FDR across primary hypothesis endpoints;
- robustness runs that retain failures and grade the weakest material slice;
- equity impact, option spread/commission and liquidity-stress scenarios;
- academic replication scopes with exact/near/conceptual fidelity labels and checksums for authorized papers.

This is a substantially stronger evaluation framework than a single backtest, but it does not manufacture predictive evidence.

## 4. Remaining gaps

### 4.1. The panel is still far from 300+

Fifty-three CIKs are enough to test a real cross-section, but not enough for robust sector deciles or universal production claims. Departed and delisted names remain mandatory to control survivorship bias.

### 4.2. Prices are fresh only through 2026-10-26

Historical research can use this panel. Live prediction requires automated daily updates, corporate-action handling and explicit freshness checks.

### 4.3. Options history remains the largest data gap

Current snapshots support feature engineering and QA, but they do not provide long, synchronized, full-chain history with volume/OI across all DTE buckets. DoltHub, Hugging Face and free samples must remain labeled as different evidence grades rather than being merged into a fictitious complete source.

### 4.4. Tone evidence is regime-dependent

The positive 126-session IC is worth retaining as a slow narrative-factor candidate. It is not short-term timing evidence, and the event-study sign is not stable across years. Production requires the remaining crawl review, sealed-holdout confirmation and cost-aware validation.

### 4.5. Operational blockers remain

- MySQL backup on D: and a real restore test are still required before schema migration or C: cleanup.
- XOM_PRE registry repair must be applied and reconciliation rerun.
- Current EDGAR crawl completion and skip/failure/token review remain open.
- Automatic freshness, drift and failure alerts are still incomplete.

## 5. Prioritized roadmap

### P0 — operational honesty and freshness

- finish and audit the current EDGAR tone run;
- apply the reviewed XOM_PRE registry repair and rerun reconciliation;
- complete MySQL backup on D: and a restore test;
- automate daily price updates and freshness alerts;
- apply the reviewed signals.note migration only after backup verification.

### P1 — validate the 53-CIK research panel

- preserve first-filed and per-CIK lineage checks;
- run source-specific walk-forward and event-study tests with FDR control;
- clone DoltHub on D: for the 40-core mid-DTE IV panel;
- keep Hugging Face volume/OI proxies separate from full-chain features;
- retain all negative and unstable results in the evidence ledger.

### P2 — expand to 300+ with departed names

- add delisted/departed companies and corporate-action histories;
- re-run sector-neutral and independent-universe validation;
- compare base engine versus base plus options on identical walk-forward anchors;
- evaluate calibration, Brier score, log loss and incremental IC before portfolio construction.

### P3 — execution and portfolio research

- add contract-level liquidity, multi-leg, assignment and borrow constraints where applicable;
- test capacity and stress liquidity rather than assuming calm-market execution;
- only after durable net evidence, evaluate volatility-scaled and drawdown-budgeted sizing;
- paper trade before any real-capital discussion.

## 6. What not to do

- Do not add model complexity to hide incomplete history or weak coverage.
- Do not treat a positive 126-session IC as a universal trading signal.
- Do not call DoltHub a complete full-chain options archive.
- Do not use Yahoo as an IV/Greeks/OI provider after the measured QA failure.
- Do not mix aggregated volume/OI proxies with exact DTE-bucket calculations.
- Do not mirror raw archives to production or move MySQL without a restore test.
- Do not wake GDELT; its moratorium remains in force.

## 7. Final assessment

**The project has moved from a narrow prototype to a credible research panel.** Fundamentals, factor points, 13F flows, price history, option features, provider QA and preregistered evaluation now cover substantially more of the system.

**The correct next step is still validation rather than prediction.** Complete the operational repairs and daily freshness, expand independent history, and let the preregistered tests decide whether any factor earns production status.
