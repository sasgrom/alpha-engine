# DESIGN — 6d MAGNITUDE ENGINE + 13F READ-SIDE GUARD

Status: implemented as a research kernel and read-side safety fix, 2026-10-25. Owner approved careful design-first execution. This is NOT a claim of alpha and NOT a new production trading model.

## 1. Scope and non-goals

Ship:
- Pure conditional-magnitude primitives, distribution metrics, cross-sectional metrics, and a partially pooled historical baseline.
- A smoke runner reusing the 6c availability/nested protocol. Final holdout remains untouched.
- Read-side 13F quarter selection, comparable-fund filtering, coverage metadata, and honest UI warnings.
- Unit tests, direct script checks, full project tests/typecheck/build, manuals, git history.

Do NOT ship:
- Portfolio sizing, automated trading, LightGBM/neural models, a magnitude UI card, or threshold tuning on 3–4 companies.
- A second 13F collector, prod deletes/pushes, heavy SEC crawls, or writes to the running home repair.
- Any claim based on in-sample fit, final holdout selection, or a cross-section smaller than the declared minimum.

## 2. Current evidence and hard constraints

Panel audit before coding: AAPL/MSFT/NVDA/PLD each have ≥6 factors, ≥61 factor anchors, and long price histories. GOOGL has 4 factors and zero price bars. Only 4 companies pass the technical `≥5 factors + ≥24 anchors + ≥1000 bars` gate. Therefore cross-sectional metrics with `minNames=5` MUST return `insufficient`, not a numeric IC.

Known failure history that shapes this design:
- Global-row indexes were once reused as per-factor indexes; all series now share explicit availability calendars.
- Market factors were incorrectly delayed by 45 days; fundamentals could move to later comparative filings.
- A 63-day label was used before its exit was known; `exitDate < predictionDate` is now mandatory for training.
- Overlapping 63-day returns were summed as trades; money metrics require non-overlapping windows.
- Latest 13F accession was treated as a full book; NEW HOLDINGS amendments were partial. Semantic original/RESTATEMENT/NEW-HOLDINGS merging is now required.
- Negative CUSIP cache and `fund_jobs` could permanently freeze sparse quarters; explicit repair is required.
- Sparse early-quarter 13F data made all graph edges red and all sectors negative. Read-side guards are mandatory even after collector repair.

## 3. Invariants

I1. Target remains forward 63-session excess return over SPY. Raw market beta is not alpha.

I2. One row per company/availability anchor. Cross-section groups by anchor, never mixes dates, and deduplicates repeated company keys deterministically.

I3. Fit/calibration labels must be known before their segment cutoff. The final four-anchor holdout is not read by the smoke baseline.

I4. `P(up)` and conditional magnitudes answer different questions. Ranking by probability alone is forbidden.

I5. `expectedExcess = p × muPlus + (1 − p) × muMinus`, with `muPlus > 0` and `muMinus ≤ 0` when both classes exist. Missing classes produce null, never fabricated zero.

I6. Return magnitudes stay in decimal return units. Volatility standardization may be a feature later, never a hidden replacement for economic returns.

I7. Partial pooling shrinks company conditional means toward panel means using the count for that specific side (up/down), not total rows.

I8. Quantiles use sorted finite values and linear interpolation. Empty input, invalid probabilities, and degenerate cross-sections return null/insufficient explicitly.

I9. 13F level, QoQ change, sector flow, and 3D graph are different products. Current-quarter level may use all funds in the selected quarter; QoQ/flows use comparable funds only.

I10. A 13F quarter is not eligible before quarter-end + 45 calendar days. Eligibility alone is not proof of completeness.

I11. Read-side guards fail closed for flows: no eligible pair or fewer than two comparable funds means null/empty flows plus a warning, never a fabricated all-red/all-green graph.

I12. Collector repair and read-side presentation are independent. UI guards must not write to the database or depend on prod `fund_jobs`, which is currently empty.

## 4. 13F read-side contract

Constants (presentation safeguards, not predictive thresholds):
- `FILING_DELAY_DAYS = 45`: legal availability lag.
- `MIN_QUARTER_COVERAGE = 0.80`: minimum fund-count coverage for a usable quarter, relative to the maximum fund count in the latest four eligible quarters.
- `PARTIAL_COVERAGE = 0.95`: below this, metadata is explicitly partial.
- `MIN_BOOK_COUNT_RATIO = 0.25`: when a fund has ≥50 mapped rows in one quarter and the smaller quarter has <25% of the larger count, treat it as a coverage anomaly and exclude it from flows.

Quarter selection:
1. Aggregate distinct funds per quarter and sort descending.
2. Remove quarters whose deadline is not strictly before `asOf` and quarters with zero funds.
3. `expectedFunds = max(funds)` over the latest four eligible quarters.
4. Current = latest quarter with at least `ceil(expectedFunds × 0.80)` funds, minimum two. Previous = next earlier quarter passing the same rule.
5. Record the skipped latest quarter, expected/current fund counts, and warnings.

Comparable funds for QoQ/flows:
- Fund must have COM rows in both quarters.
- Exclude new/missing funds from the flow panel.
- Exclude the row-count anomaly above (example: 6 versus 371). This catches coverage failures but is NOT a proof of completeness.
- Return stable, missing, and suspect counts. Fewer than two stable funds disables flows.

Metadata must expose current/previous quarter, expected/current/stable/missing/suspect fund counts, skipped latest quarter, partial flag, and warnings. Dashboard, company Institutional, and 3D graph display the pair and stable-fund count. The legacy sector endpoint remains available but uses the same safe rows.

## 5. Magnitude mathematical contract

Conditional moments for one return set:
- `nUp`, `nDown`, `muPlus`, `muMinus` (null for an absent class);
- `q10`, `q50`, `q90` over the full distribution.

Baseline fit:
- Compute panel moments on training rows only.
- Compute company moments and shrink each side independently: `w = nSide / (nSide + tau)`, default `tau=8`.
- Prediction uses the existing calibrated/walk-forward `rawP` only as P(up); expected excess uses the pooled company means. The baseline is explicitly uncalibrated for return magnitude and is not a model-selection candidate yet.

Metrics:
- MAE, median absolute error, RMSE, bias;
- pinball loss for quantiles;
- per-anchor Spearman rank IC, with mean and median across anchors;
- score-bucket top-minus-bottom return spread and positive-spread fraction;
- predicted-return calibration bins with predicted mean, actual mean, and actual median.

Cross-section rules:
- Group by anchor and deduplicate company IDs by keeping the last input row.
- Rank IC requires at least 5 unique companies and non-degenerate scores/returns.
- Bucket spread requires at least 8 unique companies and at least 2 buckets.
- Insufficient cross-section is a structured result, not zero and not an exception.

## 6. File and interface plan

New pure modules:
- `api/services/institutional-guard.ts` — quarter/deadline/comparable-fund logic, no DB.
- `api/services/institutional-guard.test.ts` — synthetic eligibility, fallback, anomaly, and failure tests.
- `api/services/magnitude.ts` — moments, baseline, errors, quantiles, rank IC, buckets, calibration.
- `api/services/magnitude.test.ts` — formula and degenerate-case tests.

Integration:
- `api/services/institutional.ts` uses the guard; old sector endpoint keeps its shape but safe rows; a detailed endpoint adds metadata. Graph/Institutional responses gain metadata additively.
- Dashboard/Company/FundFlows show the quarter pair and warnings without layout redesign.
- `nested-eval.ts` only exports its existing dataset loader and `knownBefore`; behavior is unchanged.
- `scripts/_magnitude-smoke.mts` loads AAPL/MSFT/NVDA/PLD, fits only on fit-known rows, evaluates the uncalibrated baseline on evaluation, excludes holdout, and prints insufficient cross-section.
- `docs/DESIGN_MAGNITUDE.md` is registered in bundled manuals.

## 7. Acceptance gates

G1. All new pure tests pass, including negative and insufficient-data cases.
G2. Direct TypeScript/bundle checks pass for scripts, which the root tsconfig does not fully cover.
G3. Full tests, full typecheck, and production build pass.
G4. The 2026-10-25 read-side query selects 2026Q2 vs 2026Q1 and excludes 2026Q3 because its filing window is open. It never returns 400 all-red edges solely from 9 early filers versus 299 later filers.
G5. Smoke prints evaluation-only baseline diagnostics and `insufficient cross-section` for the four-company panel. No final-holdout numbers are printed.
G6. No production data writes, no collector restart, no model tuning, no alpha claim.
G7. RU/EN manuals and LLM_CONTEXT describe actual shipped behavior and remaining limitations; bundled manuals regenerate.
G8. Git is restored after snapshot stripping, work is committed/pushed, and version state is clean.

## 8. Later gates, deliberately out of this iteration

- ≥30 companies for a technical panel prototype; ≥300 for decile/sector claims.
- Feature-based Huber/quantile models, sector-neutral residuals, point-in-time consensus/guidance features.
- Share-based 13F flow features after repair and accession filingDate persistence.
- Return calibration, cross-sectional portfolio evaluation, costs/capacity, then and only then sizing and UI promotion.

## 9. Implementation evidence (2026-10-25)

Shipped exactly the scoped kernel:
- 5 guard tests + 11 magnitude tests cover eligibility, fallback, anomalies, missing classes, pooling, formulas, deduplication, rank/bucket insufficiency, and calibration.
- Live read-side check selects 2026Q2 vs 2026Q1, skips 2026Q3, reports 285 stable / 7 missing / 7 suspect funds. Graph signs are 326 positive / 74 negative instead of the former artifactual 0 / 400. Sector signs are 10 positive / 1 negative, with partial-coverage warnings visible.
- AAPL Institutional uses the same quarter pair and stable-panel QoQ calculation.
- Smoke fits only fit-known labels and prints no holdout values. AAPL/MSFT/NVDA/PLD produce baseline diagnostics only; both cross-sectional metrics return `insufficient`, exactly as required for a four-company panel.
- No model was selected, no coefficients were tuned, no production data was written, and no magnitude UI was promoted.
- Final verification: 252/252 tests, full-project typecheck, direct smoke-script type/bundle checks, and production build. Real Chromium QA on Dashboard, Company Institutional, and 3D Fund Flows confirmed the correct quarter pair and `stable funds 285` with zero failed requests and zero page errors.

Remaining work is deliberately unchanged: complete the 13F filingDate backfill and repaired-history delivery (5j code is ready), build a ≥30-company technical panel, then a ≥300-company evaluation panel before any feature-based magnitude model or portfolio conclusion.
