# Revenue pilot protocol — DRAFT, not approved for training

Date: 2026-11-08
Status: **methodology draft only — no model, no IC, no Bayes, no production promotion**

## 1. Purpose and hard boundary

Evaluate **one existing fundamental factor, Revenue**, with explicit point-in-time evidence and an independently inspectable protocol. Do not add factors, tune until a desirable result appears, or convert this pilot into a probability model.

Before implementation, the owner must select exactly one target:

- **Option A — Market Cap / Revenue:** `ln(MarketCap_t) = α + β·ln(Revenue_{t-1}) + ε`, expanding log-log estimation and one-step-ahead prediction only.
- **Option B — Investment direction:** 63-session excess return versus SPY, using an explicitly named Revenue transformation.

**No default target is selected in this draft.** If the target remains ambiguous, implementation stops.

## 2. Eligible data and exclusions

Use only the presentation-50 universe and reviewed sources already accepted by the project. Do not expand the universe, collect new data, or substitute XOM_PRE or another security for a missing issuer.

Fundamental values use first-filed availability known at each anchor. Price observations use one eligible source per company/date, with `observation <= anchor` and `fetchedAt <= evaluation-asOf`. Backfill ingestion time is not market availability time.

`NULL` tombstones are excluded from research coverage but remain preserved in storage. Instant facts without a duration do not enter flow/TTM calculations. Independent `netDebt/ROE/ROA` checks already found zero mismatches across all 50; this is a data-quality result, not evidence of predictive power.

The current exclusion map contains:

- **88 exact-fact exclusions** for availability inversions, unit conflicts and missing durations;
- **2,774 TTM-window exclusions** for continuity gaps;
- **569 review-required warnings**, which are not automatic deletions or silent inclusions.

Exact invalid facts are excluded, not whole companies or whole concepts. A continuity gap excludes only affected TTM windows and never permits interpolation. The map is `research/revenue-pilot-exclusions.json`; its human-readable companion is `docs/REVENUE_PILOT_EXCLUSIONS.md`.

## 3. Point-in-time design

Every anchor requires a reproducible eligibility proof:

- observation period is known at/before the anchor;
- source filing/vintage is eligible at the anchor;
- every required concept has valid availability and compatible periods/units;
- every target exit price/return, when applicable, was already knowable at the anchor;
- no selected-after-anchor facts, prices, revisions or labels.

For Option A, use an expanding window with a minimum of 20 earlier quarters and strictly one-step-ahead predictions. For Option B, use chronological fit/calibration/evaluation splits with company, sector and chronological holdouts. In both cases, a sealed holdout is never used for fitting, calibration, thresholding or model selection.

Preserve the raw inclusion/exclusion decision for every candidate anchor. Dropping an anchor because it is inconvenient or produces a negative result is forbidden.

## 4. Error taxonomy and uncertainty

Keep the owner's definitions exactly:

- `ei+ = P(wrong UP | actual DOWN)` — the forecast is UP while the actual outcome is DOWN;
- `ei- = P(wrong DOWN | actual UP)` — the forecast is DOWN while the actual outcome is UP.

Report raw counts and conditional rates before any smoothing. Use Wilson intervals for conditional error rates and a circular block bootstrap over anchor dates for time-series uncertainty. Do not present rows as independent when they are serially or cross-sectionally dependent.

`lpp/lmm`, if later required for Bayes compatibility, use the existing Beta(1,1) smoothing only after the raw error definition is accepted. They are not raw confidence, not validation of the model, and not a reason to promote it.

## 5. Evaluation outputs and negative results

Option A reports out-of-sample R² (including negative values), log-space RMSE and directional errors. Option B reports rolling IC/rank-IC, balanced accuracy and conditional errors, with company, sector and chronological robustness checks.

Every run preserves negative R², unstable signs, weak coverage and `insufficient_data` outcomes. High performance at one company is not causal evidence and is not a production model. No parameter search is allowed on the sealed holdout.

Final factor status is one of:

- `candidate` — eligible for a separately reviewed next experiment, not production;
- `rejected` — evidence does not support the predeclared hypothesis;
- `insufficient_data` — not enough eligible evidence to judge.

## 6. Stop conditions

Do not implement or evaluate if any of these remains true:

- target selection is unresolved;
- availability or leakage checks fail;
- hard exclusions are unapplied;
- source/value conflicts are unresolved;
- the eligible sample is too small for the chosen method;
- report generation hides exclusions, missing values or negative outcomes.

## 7. Next reviewed implementation step

After target selection, implement the smallest evaluator for that target, then independently re-read its predictions, availability and exclusions. Only after that review should further factor categories be considered. There is no automatic production sync, Bayes update, Event Study, Atlas rebuild or probability promotion in this protocol.
