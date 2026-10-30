# ATM IV versus RV20 Volatility Targeting — Result Review

Input: `research/dolthub-vol-target.json`, generated 2026-10-30T01:30:59.609Z
Protocol: `alpha-option-vol-target-v1`
Review status: working research evidence, not a production allocation

## Data and reproducibility

- 52,292 option snapshots, 3,720 monthly candidates, 3,640 usable ticker-months from 40 tickers.
- Ninety-one monthly portfolio observations; 80 candidates excluded only because forward labels were not yet available.
- Discovery: 2,360 samples / 59 months. Validation: 960 / 24. Sealed holdout: 320 / 8.
- Policy parameters match the repository exactly. The uploaded protocol hash is the current protocol file encoded with Windows CRLF rather than Linux LF; this is a byte-format difference, not a parameter difference.
- Latest label exit: 2026-10-01. `oosUsedForTuning=false`.

## Headline result

| Metric, 20 bps base cost | Equal weight | RV20 scalar | ATM IV scalar |
| --- | ---: | ---: | ---: |
| Annualized net return | 17.89% | 10.82% | 9.77% |
| Annualized volatility | 16.13% | 9.95% | 8.45% |
| Sharpe-like ratio, no risk-free rate | 1.110 | 1.087 | 1.151 |
| Max drawdown, monthly observations | 24.10% | 14.87% | 11.40% |
| Average gross exposure | 100.00% | 74.09% | 66.89% |
| Annualized cost | 2.64 bps | 38.28 bps | 22.75 bps |

ATM IV reduced annualized volatility by 15.11% and monthly-observed max drawdown by 23.33% versus RV20. It also required less turnover and cost. Average exposure was lower, so lower raw return is not evidence of inferior forecasting by itself. Descriptive annualized return divided by average exposure is 14.61% for ATM IV and 14.60% for RV20, but this ratio is not a formal performance estimator.

## What is robust

- Annualized volatility and monthly max drawdown are lower for ATM IV than RV20 in every calendar year present.
- ATM IV has lower volatility and drawdown in both odd-CIK and even-CIK independent universes.
- ATM IV has a higher Sharpe-like ratio than RV20 at 5, 20 and 50 bps cost scenarios.
- ATM IV has lower annualized cost in every scenario.

## What is not proven

- ATM IV does not prove higher net return. Overall mean monthly ATM-minus-RV20 net return is −9.13 bps with a 95% moving-block CI of −21.24 to +6.42 bps. The interval includes zero and only 36.26% of months are positive.
- Discovery delta is −11.87 bps per month, validation −5.65 bps, holdout +0.26 bps. The holdout contains only eight months and cannot establish a regime change.
- ATM IV has a higher Sharpe-like ratio than RV20 in only three of eight calendar years. Risk reduction is much more consistent than risk-adjusted outperformance.
- Sector and liquidity caps never bind in this sample. Their implementation is tested, but their effect under constrained conditions is not measured.
- The current universe has no departed/delisted names. Survivorship bias remains a production blocker.
- The 21-session labels and monthly series are not a daily executable equity curve. Drawdown is computed on monthly observations and can miss intra-month troughs.

## Verdict

**Supported as a candidate volatility and drawdown-control scalar. Not supported as directional or return alpha.**

ATM IV belongs in the risk layer beside RV20, not in the probability-of-price-increase layer. The next research gate is a paired uncertainty estimate for risk metrics, a non-overlapping daily execution study, binding liquidity/sector stress scenarios and an expanded departed/delisted universe. No production weight should be inferred from the Sharpe point estimates alone.
