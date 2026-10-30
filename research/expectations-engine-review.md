# Management Expectations Engine — Filing Review and Research Design

Date: 2026-10-30
Status: extraction design and local shadow implementation; no predictive result yet

## 1. Why this is different from tone

The reviewed videos and filings describe an expectations problem, not a text-sentiment problem. A company can beat its previous guidance and still fall when a core segment decelerates, future guidance disappoints, financing quality deteriorates, or the valuation already required near-perfect execution. The useful unit is therefore a timestamped statement with scope, period, basis and vintage, followed by deterministic comparisons.

The extractor must not infer investor psychology. It extracts management guidance, reported actuals, revisions, assumptions, financing and timing explanations with verbatim evidence. Market reaction and possible overreaction are measured later against availability-anchored prices and, where available, option-implied expected move.

## 2. Independent filing sample

Thirty-six current documents were reviewed from official SEC archives: the latest 10-K, 10-Q and earnings 8-K exhibit for AMZN, MSFT, GOOGL, META, AAPL, NVDA, JPM, XOM, CAT, UNH, WMT and PFE. No document was used as a predictive training label.

| Company | Earnings-release pattern | 10-K / 10-Q pattern | Extraction consequence |
| --- | --- | --- | --- |
| AMZN | Numeric sales and operating-income ranges, FX and Prime Day timing assumptions, maintained capex | Next-quarter guidance embedded in MD&A | Range, assumption, timing and reaffirmation must remain separate |
| MSFT | Release delegates forward guidance to the earnings call | Periodic filings contain actuals and accounting guidance, not a substitute for call guidance | `deferred_to_call`; do not mark as zero or invent a range |
| GOOGL | No comparable numeric company guidance in the reviewed release | Periodic filing contains operating results and outlook/risk narrative | `not_found` is a coverage state, not a bearish signal |
| META | Revenue range, raised expenses, narrowed capex, explicit absence of FY2027 revenue outlook | Large MD&A with multiple qualitative outlook statements | Support revision, non-disclosure and qualitative statements in one document |
| AAPL | No numeric guidance in the reviewed release | No guidance candidate in the reviewed 10-Q | Preserve no-candidate status; actuals remain useful |
| NVDA | Point estimate with ± tolerance, GAAP/non-GAAP margin and opex, China assumption | Outlook also appears in periodic MD&A | `plus_minus`, tolerance, basis and assumption are mandatory |
| JPM | Main release and financial supplement are separate exhibits | 10-Q states NII and adjusted-expense outlook with issue date and market dependence | Multiple EX-99 documents and market-dependent assumptions are required |
| XOM | Actual capex is compared with an existing annual range | Periodic filings include production/end-market outlook | Link actual to the correct prior vintage and metric |
| CAT | Strong actual results, backlog and qualitative end-market outlook | 10-Q contains end-market outlook and pension-contribution estimate | Do not force qualitative outlook into numeric revenue guidance |
| UNH | “At least” GAAP and adjusted EPS, projected non-GAAP reconciliation | Periodic filings contain segment and medical-cost metrics | Support floors, GAAP/non-GAAP basis and projected reconciliation rows |
| WMT | Constant-currency growth ranges and original/as-of guidance columns | 10-Q/10-K provide comparison bases and timing explanations | Preserve every vintage date; constant currency is not reported FX |
| PFE | Raised revenue midpoint, reaffirmed EPS, offsetting COVID/non-COVID drivers | Detailed previous/revised guidance table and non-GAAP caveats | Revision decomposition is as important as headline direction |

Representative official sources:

- [Amazon Q3 2026 EX-99.1](https://www.sec.gov/Archives/edgar/data/1018724/000101872426000038/amzn-20260930xex991.htm)
- [Microsoft Q1 FY2027 EX-99.1](https://www.sec.gov/Archives/edgar/data/789019/000119312526436122/msft-ex99_1.htm)
- [Meta Q3 2026 EX-99.1](https://www.sec.gov/Archives/edgar/data/1326801/000162828026066700/meta-09302026xexhibit991.htm)
- [NVIDIA Q2 FY2027 release](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm)
- [JPMorgan Q2 2026 10-Q](https://www.sec.gov/Archives/edgar/data/19617/000162828026054343/jpm-20260630.htm)
- [Walmart Q2 FY2027 release](https://www.sec.gov/Archives/edgar/data/104169/000010416926000145/earningsreleasefy27q2.htm)
- [Pfizer Q2 2026 release](https://www.sec.gov/Archives/edgar/data/78003/000007800326000094/pfe-6282026xex99.htm)

## 3. Extraction contract

Each statement retains:

- kind: guidance, actual, assumption, financing, timing or explicit non-disclosure;
- raw and canonical metric, consolidated/segment scope, target and comparison periods;
- range, point, plus/minus, floor, ceiling, approximate, unchanged or qualitative value form;
- unit, accounting basis (GAAP/non-GAAP/reported/adjusted) and a separate currency basis (reported/constant-currency);
- initial/raised/lowered/narrowed/widened/reaffirmed revision and prior guidance values when stated in the same document;
- assumptions, source section and a contiguous verbatim evidence quote.

No midpoint, unit conversion, annualization, consensus estimate, sentiment score or market interpretation is delegated to the LLM. Statements without source evidence are rejected. All availability metadata comes from the filing manifest rather than the model.

## 4. Deterministic expectation features

For compatible units, bases and periods only:

- `GuidanceMid = (Lower + Upper) / 2`
- `GuidanceWidth = (Upper − Lower) / max(|GuidanceMid|, Scale)`
- `Revision = (NewMid − PriorMid) / max(|PriorMid|, Scale)`
- `GuidanceSurprise = (Actual − PriorMid) / max(|PriorMid|, Scale)`
- `ConsensusSurprise = (Actual − ConsensusAtCutoff) / max(|ConsensusAtCutoff|, Scale)`
- `GuidanceHit = 1[Lower ≤ Actual ≤ Upper]`
- `ReactionZ = CAR[0,1] / ExpectedMoveReturn`, only when an availability-matched option estimate exists
- `Reversal = −sign(CAR[0,1]) × CAR[2,10]`

Company-specific guidance credibility uses a minimum-history, shrunk estimate of hit rate and signed guidance error by metric and horizon. It must never pool all metrics into one meaningless “management accuracy” score.

## 5. Preregistered economic hypotheses

1. **Own-guidance miss:** actual below the prior lower bound has negative announcement CAR.
2. **Beat-but-lower:** a headline beat combined with lower forward guidance or a core-segment deceleration has a more negative reaction than the headline beat alone predicts.
3. **Narrative fragility:** high pre-event valuation/run-up and deteriorating cash conversion or external financing amplify the reaction to a core-business disappointment.
4. **Timing explanation:** a large initial reaction without a forward revision and with a source-supported timing explanation is more likely to reverse than a reaction accompanied by lower forward guidance.
5. **Guidance credibility:** systematically conservative guidance reduces the information content of small routine beats but increases the information content of genuine misses.

These are hypotheses, not accepted alpha. Every test needs an equal-information baseline, independent companies, calendar regimes, FDR control and realistic event-time execution.

## 6. Coverage and bias warnings

- Company guidance is not analyst consensus. The two series must remain separate.
- The price reaction can reflect information already priced in, positioning, macro news and other same-window disclosures; raw return is not enough.
- Legacy tone still uses only the largest textual EX-99 exhibit. The expectations-specific exhibit worker now preserves the complete substantive set with hashes. JPM’s main narrative and supplement were verified as two separate files; full-universe coverage remains a gate.
- GAAP actuals must not be compared with non-GAAP guidance, and reported growth must not be compared with constant-currency guidance without an explicit compatible series.
- Independently selected latest forms can mix a new-quarter 8-K with an older-quarter 10-Q. Latest mode is extraction smoke only; guidance vintages and actual outcomes require full history and accession/reportDate/eventTs-aligned cohorts.
- Current-company universes have survivorship bias. Departed/delisted firms remain mandatory for production claims.
- Post-close filings require next-session execution; after-hours commentary is not an executable close price.
- Blogger/LLM narrative is a hypothesis about what other investors may notice, not source evidence for the underlying financial claim.

## 7. Timing and the post-factum hypothesis

Immediate reaction, delayed processing and post-event reversal are separate events. The current EOD dataset cannot establish whether the market took minutes, hours or part of a session: that requires timestamped intraday prices. It can measure the first executable close-to-close reaction and later drift without pretending that the first print was tradable.

The preregistered windows are `[0,1]` for measurement only, `[2,5]` for early continuation/reversal, `[6,21]` for delayed processing and `[22,63]` for a separate fundamental-realization model. A position using the first reaction as a feature can be entered only after that reaction is observable. A quiet market is a valid null result, not a reason to invent a position.

Post-factum calm analysis is useful only when it estimates residual reaction after compatible guidance, consensus, segment and financing revisions. A large decline by itself does not establish undervaluation. If forward cash-flow expectations broke, continuation may be rational; if the reaction is large relative to a mostly unchanged forward path and a source-supported timing explanation, reversal becomes a testable hypothesis.

Academic literature supports testing both underreaction and overreaction rather than assuming one universal delay. In particular, [Hirshleifer, Lim and Teoh (2009)](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.2009.01501.x) study distraction-related underreaction, while the broader PEAD literature reports continuation and reversal in different conditions. These references guide windows; they do not substitute for a local preregistered test.

## 8. Implementation state

`worker/edgar-expectations.mts` is a local-only expectations-v3 shadow extractor with deterministic candidate routing, strict typed output, evidence rejection, atomic per-company checkpoints and no production delivery. The existing tone v1 runner and its manifests are unchanged. A dry-run over all 36 sampled documents routed 31 documents to extraction and returned `no_candidate_text` for five, avoiding LLM calls where no relevant block was found.

An independent gold benchmark now covers 12 official documents and 27 required statements across range, floor, point-tolerance, qualitative non-disclosure, revision, GAAP/non-GAAP and constant-currency cases. It fails closed when extraction results are absent and treats additional statements as review items rather than automatic errors.

Bounded `cohort-pack-v2.json` and merged `cohort-v2.json` are now implemented. Packs use content-derived fiscal periods, preserve complete sections, expose KiB/token estimates, split by documents or whole section boundaries and fail closed on indivisible oversized tables. Per-source prompts keep other period documents as context but validate evidence only against the target source.

The next gate is to run the extractor on this benchmark and review mismatches before any full-history GPU run. Full-history performance tests are prohibited until extraction accuracy, multi-exhibit coverage and period/basis matching pass review.
