# Legacy model review (cbai, Tiingo/Postgres, ~2021) — what we adopt, what we rebuild

Status: reviewed 2026-10-23 from the full source zip + live DB schema.
Purpose: adoption plan for Stage 5 (factor evaluation → probability engine → portfolio sim).

## 1. Pipeline anatomy (as built)

ETL: Tiingo daily prices (+weekend/holiday fill), marketcap, ~64 fundamental
concepts per company per quarter, dividends. Manual copy-on-write backups.

Analysis (per ticker, quarterly):
1. **pearsonr** — r(concept at quarter T, marketcap at T+~2.5 months). The lag
   is a CALENDAR proxy (`months=2, day=15`) for the 45-day EDGAR filing delay.
   Lead-lag via x[:-1]/y[1:]. Leading zero-values trimmed.
2. **best_match** — top-25 concepts per ticker by |r|, tie-broken by p.
3. **ols** — walk-forward per concept: marketcap_{t+1} ~ concept_t,
   concept_{t-1}, concept_{t-2}; refit every step; next-quarter marketcap
   predicted; non-positive predictions skipped.
4. **predict_correct** — recentring: predict_correct = mcap_prev ×
   (predict / predict_prev) — transfers predicted GROWTH onto the real level.
5. **concept_stats** — per concept-date confusion flags
   (profit_up_up / safe_down_down / miss_up_down / loss_down_up).
6. **concept_stats_probability** — per-concept reliability: e_plus = share of
   wrong "up" calls among realized downs ("lost money"), e_minus = wrong "down"
   among ups ("unrealized profit"); likelihoods l_plus_plus = 1−e_minus,
   l_minus_minus = 1−e_plus; clamped to [0.1, 0.9] to avoid zero-products.
7. **reit_probability** — naive Bayes over concepts: p(up) = (Π l+·p0)^(1/n) /
   ((Π l+·p0)^(1/n) + (Π l−·(1−p0))^(1/n)), p0=0.5, geometric-mean
   normalization by concept count.
8. **reit_probability_limit** — a constant 0.6 for every ticker (hardcoded).
9. **reit_weights** — market-cap weights at calc dates.
10. **investment_probability** — accept tickers with p ≥ 0.6; weight =
    marketcap share among accepted; normalize to 100%; 10% cap with iterative
    water-filling redistribution.
11. **portfolio** — monthly rebalance simulation: floored share counts, cash
    accounting, dividends accrued, and a SECTOR STOP: sell every holding of a
    sector whose daily average/median return < −15%.

## 2. Strengths worth adopting

- **Walk-forward evaluation as the default shape** — refit per step, artifacts
  stored per date (auditable, replayable).
- **Lead-lag alignment thinking** — concepts are evaluated against FUTURE
  prices with an explicit availability lag; our exact `sourceFiled` makes this
  idea precise.
- **Per-ticker adaptive factor sets** instead of one global factor list.
- **Asymmetric error taxonomy** (e_plus "lost money" vs e_minus "unrealized
  profit") — an honest quality metric for any signal, including our edgar tone
  and 13f events.
- **Transparent ensemble**: naive-Bayes with geometric-mean normalization is
  debuggable per component — unlike a black box.
- **Cap + water-filling allocation** — the iterative redistribution to 100%
  under a 10% cap is algorithmically correct; take it as the reference.
- **Corporate actions in the price rows** (daily split_factor, div_cash) —
  the right way to keep quantities consistent (validates our split-map design).
- **Sector-regime trigger as an idea** (risk-off rule) — the concept is fine;
  the threshold is the problem (see below).

## 3. Errors and naiveties (with evidence)

1. **Selection leakage.** best_match is computed over FULL history; the OLS
   walk-forward then uses that fixed concept set — the evaluation period
   leaked into factor selection. Fix: re-select factors inside each window.
2. **Non-stationary target.** Predicting the market-cap LEVEL: r is inflated
   by the shared market trend/beta — the model predicts the index, not the
   company. Fix: forward-RETURN targets.
3. **Calendar-shift alignment** (`months=2, day=15`) instead of real filing
   timestamps — a noisy anchor; x/y length mismatches are patched by trimming,
   which silently re-pairs wrong quarters.
4. **Data hygiene in-series:** leading-zero trimming mutates alignment;
   string `'0'` substituted for NULL marketcap → zeros fed to OLS.
5. **Hardcoded probability limit (0.6)** and no calibration check (no
   reliability curve anywhere in the codebase).
6. **Naive-Bayes independence violation:** concepts are heavily correlated
   (revenue/rps/grossMargin/opex…) → overconfident probabilities; no
   correlation dedup or shrinkage.
7. **Multiple testing ignored:** 64 concepts × ~500 tickers × |r| ranking with
   p recorded but never used as a filter.
8. **Simulation realism:** no transaction costs/slippage; the sector stop
   sells at the close AFTER a −15% day (gap risk, arbitrary threshold);
   CLNY hardcoded-skip; splits handled inconsistently (start_split_factor
   commented out, daily split_factor applied).
9. **Ops/code quality:** SQL built by string interpolation with `$$` quoting,
   TRUNCATE+RESTART-IDENTITY as the update method, global warnings
   suppression, plaintext secrets in config.yml, zero tests.

## 4. Adoption plan into alpha-engine

**Iteration 6a — Factor IC monitor (Stage 5-alpha):**
- `factor_points` materialized per company per filing, anchored on EXACT
  `sourceFiled` (never a calendar proxy);
- IC per factor vs forward 1Q/2Q RETURNS (split-adjusted): Pearson + Spearman,
  per company and cross-sectionally;
- rolling re-selection per window (kills the leakage at the root);
- the e_plus/e_minus reliability taxonomy applied to ALL our signals
  (edgar tone, 13f position events, factor signals) as the QA layer.

**Iteration 6b — Probability engine (candidate, gated by 6a results):**
- per-company factor set via rolling IC;
- naive-Bayes ensemble with correlation shrinkage (cluster |ρ|>0.7 factors,
  one vote per cluster) and geometric-mean normalization;
- an isotonic calibration curve BEFORE any thresholding; thresholds learned
  per horizon on the backtest — a hardcoded constant is a rejected pattern.

**Iteration 6c — Portfolio simulation:**
- cost model (bps commission + slippage) from day one;
- splits only via adjusted prices (single consistent convention);
- NO sector −15% stop (proven arbitrary); regime filtering instead via the
  FRED macro pack (D46) with measured, not guessed, thresholds;
- allocation: probability gate → market-cap weights → 10% cap with the
  water-filling redistribution (adopted as-is — the algorithm is correct).

**Data bricks:** `corporate_actions` register (rename/merger/bankruptcy) +
the 101 departed tickers with full history (already extracted to
output/departed_*.sql) for negative-case fixtures; CRSP/Sharadar remains the
full-universe answer at Stage 5.

## 5. Explicitly discarded

- marketcap-level OLS target; calendar-shift alignment; hardcoded limits;
  sector panic-stop rule; TRUNCATE-rebuild ops; config-file secrets;
  zero-padding of missing data; global warning suppression.
