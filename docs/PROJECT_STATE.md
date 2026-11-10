# Alpha Engine — Project State and Owner Workflow

> Reviewed snapshot: **2026-11-10**. This document explains the operating model and the current implementation queue. Live collection status belongs to `/project-state` and `/workers`; do not treat this snapshot as a live manifest.

## 1. One project, four kinds of progress

Alpha Engine must not collapse these into one “done” percentage:

| Layer | Question | Current reviewed state |
|---|---|---|
| **Code** | Is the implementation committed and tested? | F-01…F-11, exposure rebuild, 13F remediation and macro remediation remain complete. Since 2026-11-04 added: Form 4 insider-buy MVP (worker fetch/parse/QA + Insider buys UI), fail-closed cohort QA with evidence anchoring, production backup channel (direct + via-api with restore drill), scheduled outbox lane (pricesDaily / macroPoints / reportFile) with honest prod targeting, live DB-backed /reports, ops status banner, local↔prod inventory tool. FundFlows UI frozen (server query kept). |
| **Data** | Which collectors have actually run and what is their coverage? | Prod-verified 2026-11-10: 495 companies, 23,485 filings, 1,390,442 facts, 447,382 price bars (latest 2026-11-05 — Schwab token lapse 11-07→11-09, re-authorized; backfill via the new lane), 408,878 macro points (8 series), 39,233 signals, 1,617,277 fund holdings / 6,517 quarters, 39,940 documents registry. Expectations staged on prod: 26,787 results / 9,464 statements (v3.4). Form 4 full-universe collection in progress (41/50). cusip_map transport pending. |
| **Research** | Are derived artifacts current and strong enough to use? | Factor OLS first full run was honestly negative (~0.50 balanced accuracy; betas not promoted). Expectations normalization v3.4: blockers 3,601/865/109/106 → 0-blocking + 248 review items; recent-slice salvage rate honestly low (4.39%). Event Study ready; Atlas partial; no alpha claim. |
| **Delivery** | Has the owner reviewed and explicitly authorized a destination change? | Reviewed staging applies executed with backup gate + drill + independent post-check: expectations v3.3 then v3.4 (2026-11-09/10). New owner-approved exception: append-only QA-passed scheduled outputs (prices, macro vintages, whitelisted report files) auto-push to prod via the worker ingest lane; derived artifacts stay reviewed-only. |

## 2. Reviewed-only data flow

```text
SEC / Schwab / FRED / OFAC
            │
            ▼
HOME COLLECTION
raw archives + local MySQL
            │
            ▼
AVAILABILITY + VINTAGE QA
coverage, source hashes, first-filed/realtime anchors
            │
            ▼
LOCAL RESEARCH + OWNER REVIEW
factors, event study, Atlas, scenarios, dry-runs
            │
            ▼
SEPARATE OWNER DECISION
reviewed production sync only — never a collector default
```

There is no default direct-to-production collection. A successful collector run does not authorize production sync, a research-universe expansion or model promotion.

**Owner-approved update (2026-11-10):** one bounded exception now exists — the scheduled outbox lane. Append-only, point-in-time collector outputs that pass their QA gate (daily Schwab prices, FRED macro vintages, whitelisted operational report files) push to production automatically after a successful scheduled run, via the worker ingest API with server-side validation and exact-key upserts. Everything derived or semantic (expectations packages, canonical series, factors, documents) remains reviewed-only with pinned packages, a verified backup gate and an independent post-check.

## 3. Current implementation block — S&P 500 companyfacts

The implementation, real smoke/scheduler reload and initial backfill evidence are complete. The initial run processed **499/499 CIKs: 490 refreshed + 3 unchanged + 6 failed**. Final documentation was integrated and pushed as `b951f5c`; task completion does not mean 100% successful CIK coverage.

The six HTTP 404 failures were subsequently traced to **incorrect ticker/CIK mappings**, not missing SEC companies. All 502 ticker mappings were checked against the official SEC `company_tickers_exchange.json` directory on 2026-11-04; exactly those six were wrong and have been corrected. A later scheduled incremental run collected the corrected CIKs. Integrated verification confirmed all six as **collected/valid** through manifests, expected payload CIKs, non-empty `factsToRows`, successful ingest and matching SHA256; no additional collector or reload was needed. Initial-backfill failures remain historical evidence.

```text
[done] Code + tests
[done] Real smoke
[done] Controlled scheduler reload
[done] Initial backfill — 493 successful, 6 failed
[done] Coverage/health evidence + final documentation
[done] CIK mapping remediation against the SEC directory
[done] Corrected-CIK collection and manifest verification
```

Collection contract:

- Snapshot: `edgar-universe.json`, GICS as of `2026-10-11`; 502 rows / **499 unique CIKs** after deduplication.
- New job: independent `sp500-facts-daily`, **23:30 home local time**.
- Destination: local raw cache and local MySQL only.
- Per-CIK atomic manifests support resume and next-day retry of missing/failed companies.
- The job does **not** parent `research-series` or `research-factors`; its failures do not block the research-50 chain.
- The current S&P 500 snapshot is a **collection universe**, not historical point-in-time index membership.

The existing research-50 companyfacts job remains independent at 03:00 home local time and feeds `research-series → research-factors`.

## 4. What updates where

| Workflow | Schedule / trigger | Destination | What it does not mean |
|---|---|---|---|
| S&P 500 companyfacts | 23:30 home local + reviewed initial backfill | Raw cache + local MySQL | Full-S&P research or production promotion |
| Research-50 companyfacts | 03:00 home local | Local MySQL → canonical series → factors | A claim of predictive alpha |
| Schwab REST/options | 04:00 home local for the full daily snapshot; independent hourly context; pre-slot is pending, not failure | Local raw snapshots, normalized reports and Feature Lab | Accounts, orders, production sync or a successful capture before it happens |
| FRED | Weekly refresh plus artifact freshness checks | Local macro archive with realtime vintages | Automatic scenario/probability changes |
| OFAC Recent Actions | Daily incremental collection | Local event archive | A complete historical OFAC archive or causal forecast |
| Macro derived research | After successful QA and dependency gates | Local Scenarios, Calibration, Event Study and Atlas reports | Investable alpha or model promotion |
| Scheduled outbox lane (auto-push) | After each scheduled job completes OK | Prod via worker ingest (pricesDaily, macroPoints, reportFile) | Derived/semantic artifacts; anything failing QA stays local |
| Reviewed pinned packages | Separate reviewed owner action with backup gate | Prod staging tables via pinned ZIP (direct or via-api) | Never serving promotion without owner decision |

## 5. Research state that must stay visible

**2026-11-10 update (prod-verified unless noted):**

- Expectations: v3.4 staged on prod — 26,787 exact-key results / 9,464 statements / 50 companies; normalization blockers resolved from 4,681 queue items to 248 human-review items (236 scale without evidence anchor, 10 qualifier, 2 combined-basis); benchmark remains post-remediation regression, not an accuracy claim. Thin trio remediated (AMZN 622/503, MSFT 559/241, GOOGL 240/14 at ctx 131072).
- Production backup channel operational: SELECT-only backup + restore drill + fail-closed apply gate (direct and via-api modes); first real restore point taken before v3.4 apply.
- Scheduled outbox lane live: first reportFile (daily-prices-schwab.json) verified in prod `reports` table; /reports/* serves the fresher of DB/static with explicit generatedAt.
- Form 4 insider-buy: worker pipeline + QA + Insider buys UI (preview sample from two real EDGAR filings); full-universe collection running (41/50 at last report).
- Second-column (feature layer) audit: CUSIP crosswalk is local-only (prod cusip_map was empty; TEXT migration now applied, transport next); factor library honestly negative on first OLS; share/weight flows implemented, comparable-fund evaluation pending; options features computed but stalled during the Schwab token lapse; macro prior needs re-evaluation after current QA; data QA lacks a recurring coverage/drift report.
- Older bullets below remain the historical record of their dates.


- Latest reviewed factor rematerialization: **51 companies / 21,489 factor points / 51/51 current-universe coverage**.
- Latest post-facts IC comparison: 2,840 → 2,834 rows, 58 changed Spearman values and 3 sign flips. This is changed descriptive evidence, not repaired alpha.
- Macro Event Study: ready; 47/47 eligible events have outcomes.
- Macro Transmission Atlas: partial; **904 records**, 24 studies, 6 estimated / 18 insufficient, no full_sample and two OOS evaluations. The reviewed fail-closed rebuild reduced records from 1,462; no universe or threshold was changed.
- Reviewed 13F event/flow/probability remediation is complete. Backup covers 16,912 position rows / 879,289 holdings / 3,416 fund_quarters. Audit found **16,912 VALID / 0 STALE_FALLBACK / 0 MISSING_REQUIRED_AVAILABILITY / 0 DUPLICATE / 0 UNKNOWN** and apply affected zero rows. One DB-only rebuild inserted one event with zero missing availability. Post-rebuild: **16,913 VALID / 0 duplicates / 0 missing availability**. Source commits `9381059` and `29acca9` are pushed. Full evidence: `docs/THIRTEENF_REBUILD_2026-11-04.md`.
- The 13F evaluation completed with three company and six nested reports. Each company has 14 flow points with actual MAX availability `2026-10-22`, zero skipped quarters and zero missing funds; 393/485 evaluated anchors per company lack eligible flow. Macro prior remains a neutral fallback because eligible macro vintages are absent. Historical comparison only, not direct same-DB pre/post or repaired alpha.
- 13F verification: targeted remediation suites passed **3 files / 15 tests**; the final full suite passed **119 files / 681 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These gates verify the utility and evidence, not production readiness or alpha.
- F-04 replaces the MAX(date)-only macro prior join and date-only dashboard read with one shared bounded selector: `date <= T`, non-null `realtimeStart <= T`, and `(realtimeEnd IS NULL OR realtimeEnd >= T)`, ordered by `date DESC, realtimeStart DESC, id DESC`. Unknown null starts and future revisions are excluded; open-ended vintages and inclusive endpoints are supported; the newest eligible null value stays missing. A reviewed macro evaluation was subsequently completed; its neutral-fallback coverage limitation is described below.
- F-04 verification: targeted macro/probability suites passed **3 files / 28 tests**; the full suite passed **118 files / 648 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These gates verify correctness code, not refreshed historical research evidence or production readiness.
- F-05 replaces single-component exposure dates with `MAX(sourceFiled)` across every required TTM, debt, ratio and foreign-revenue input. Unknown dates and future revisions fail closed; ratios require identical periods and units. Non-consecutive TTM remains partial for display only, while Scenario and Atlas accept only genuinely available evidence with valid availability. The reviewed rebuild below refreshed these reports; lower available coverage is retained, not hidden.
- F-05 verification: targeted Company Exposure/Scenario/Atlas suites passed **3 files / 31 tests**; the full suite passed **118 files / 657 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These results verify the corrected code, not refreshed research evidence or production readiness.
- F-10 makes missing debt or cash unknown rather than zero; explicit reported zero remains valid. Complete current+noncurrent components take precedence, while curated total debt is a single fallback rather than an extra addend. Historical Statements netDebt history requires a reviewed rebuild where zero substitution was used.
- F-11 requires four existing, non-null finite and calendar-consecutive quarters for quarterly TTM; a grid hole now returns null. Actual period ends support 53-week calendars without a day-count gate. Annual mode, ROE/ROA formulas, YoY and company-exposure F-05 behavior are unchanged. Historical ROE/ROA TTM history requires a reviewed rebuild where applicable.
- F-10/F-11 verification: F-10 targeted Statements passed **17 tests**; F-11 targeted Statements/company-exposure passed **2 files / 38 tests**. The final full suite passed **118 files / 668 tests**; `npm run check`, `npm run build` and `git diff --check` passed. Build retains the established chunk-size warnings. These gates verify code, not rebuilt historical evidence or production readiness.
- The reviewed manual Company Exposure → Macro Scenarios → Atlas rebuild completed once after both numeric fixes. Company Exposure has 51 companies, debt 47, interestCoverage 6, fuelCost 1 and foreignRevenueShare 0; 64 available→missing transitions are documented period mismatches. Scenario statuses are unchanged. Manual runs did not change registered scheduler lastRuns, and the evidence index passes 36/36 SHA256 checks. Full report: `docs/EXPOSURE_REBUILD_2026-11-04.md`.
- **Scenario Lab production presentation rebuilt on 2026-11-07:** the evidence builder now covers all 50 presentation companies from reviewed stored SEC facts, with no external collection or production DB writes. Rates has 43 explicit upper bounds (26 current / 17 historical; seven debt gaps); credit has 42 scheduled-refinancing upper bounds (36 current / 6 historical; eight maturity gaps). Oil has one current and three historical direct exposures; USD has eight historical direct foreign-revenue ratios. No fixed-rate split, fuel/oil exposure, foreign revenue or issuance terms are inferred. Rates/credit baselines come from current production `macro_points`; oil/USD retain their separately reviewed scenario snapshots with visible provenance. Event Study, Atlas, shock calibration, new issuance estimates and Bayes were not rebuilt or promoted.
- Daily Operations at `2026-11-04T08:58:55.248Z` is **degraded**, 14 OK / 1 warning / 0 errors / 23 pending. Schwab is **awaiting_scheduled_capture** for the 04:00 home-local slot with a 60-minute grace period, not a failure and not ok. Hourly context is independently healthy; Atlas partial/904 remains a warning and macro derivedCurrent=true. No pre-slot collector was started.
- S&P 500 mapping remediation and daily collection remain separate operational work. Integrated operational verification confirmed all six corrected CIKs as **collected/valid**, with per-CIK manifest, payload, row-count and SHA256 evidence. The initial backfill's six failures remain historical evidence; old wrong-CIK manifests were not deleted. A pre-existing scheduled daily run completed before this verification; no additional collector or reload was required.
- The initial macro block restored VIXCLS and BAMLH0A0HYM2 with 85,480 new rows while preserving all 47,901 original rows. Its partial report and historical limitations remain in `docs/MACRO_VINTAGE_REMEDIATION_2026-11-04.md`.
- The reviewed follow-up repaired all five exact legacy one-day closures. One committed transaction changed only `realtimeEnd` to NULL for DGS10 id 44671, DGS2 id 46182, T10Y2Y id 47694, CPIAUCSL id 31824 and UNRATE id 32769. Independent verification proves **5 changed / 133,376 unchanged / 0 new / 0 unexpected**, with full backup hashes and fingerprints. A failed scheduler guard stopped the apply until natural idle; a new full guard passed. A raw UTC timestamp formatting issue was normalized with regression tests before the successful transaction.
- Earlier partial macro evidence and the initial FEDFUNDS registry failure remain preserved in `docs/MACRO_VINTAGE_REMEDIATION_2026-11-04.md` and `docs/MACRO_VINTAGE_FOLLOWUP_2026-11-04.md`. After the registry correction, one new targeted FEDFUNDS run collected **4,510 official ALFRED rows** with observations 2000-01-01→2026-10-01 and vintages 2000-02-08→2026-11-02. Raw hash `2f880c343538a8f80cbd638608ede4d1d29e1d1df89139365b17debc5d2a07dc`; normalized hash `1353c310b5d09b39acdd3912bede88ea9b24582bc7c2748eff9570a770d4e2a6`. Macro QA passed for **22 series** with zero errors/warnings.
- One limited six-series backfill inserted **275,481 rows**: DGS10 94,622; DGS2 94,621; T10Y2Y 71,173; FEDFUNDS 4,510; CPIAUCSL 5,773; UNRATE 4,782. It had zero conflicts/errors and did not repeat exact-ID repair or VIXCLS/BAMLH0A0HYM2 backfill. At that stage the total was **408,862 rows**. Backup SHA256 `21bbff9dc427a94b9e28f83ff0a3253bf91a28273f5f27f8fb785a4292e03319`; fingerprint `ad14687c6161a8f0ffd518139f7ebce57c3e385d620ec8bf54e385514af2ef63`. All 133,381 preexisting rows were unchanged and every new row matched official archive. Full evidence: `docs/MACRO_VINTAGE_FEDFUNDS_COMPLETION_2026-11-04.md`.
- Independent source remediation then removed exactly two proven noncanonical legacy duplicates: FEDFUNDS id **47763** and CPIAUCSL id **47832**, while canonical ids **410405** and **31824** were preserved. The disputed BAML `2023-10-31` chunk was classified `UNVERIFIED_OR_STALE_CHUNK` and quarantined rather than normalized. Current `macro_points` total is **408,860 rows**; 22-series QA passes with zero duplicates, inversions, null starts or selected-after-anchor, and **all 8/8 curated series have current eligible vintages**. Full evidence: `docs/MACRO_SOURCE_REMEDIATION_2026-11-04.md`.
- Frozen evaluation completed three company and six nested reports over 485 anchors: **794/1,455 eligible checks**, 661 missing, **84 complete three-series anchors** and selected-after-anchor=0. VIX has 388/97 eligible/missing, HY 84/401 and curve 322/163. Prior distribution is 0.50 on 195 anchors, 0.54 on 189, 0.42 on 31, 0.47 on 66 and 0.39 on 4; 290 non-neutral anchors and current prior 0.50. AAPL/MSFT metrics changed from the previous partial evaluation; comparison is historical only, not causal attribution or promotion. Macro remediation is **complete for the reviewed official available history**, but historical coverage remains limited by source availability.
- The existing source commit `ed939f307be66d5120193a914ae0ad6abd2c173f` was reused with **5 files / 31 targeted tests** and **122 files / 698 full tests**; no extra source/empty commit was needed. New evaluation JSON is 688,036 bytes with SHA256 `33f17617c55be8acfcdf716b296abafbe657df2f0ba84c4cc5c2351d8ceb87c9`. Full evidence index is under `worker/.runs/macro-vintage-fedfunds-20261104T192256Z`.

- **EDGAR tone reviewed production sync completed on 2026-11-07:** the 18,030-row / 50-company v1 snapshot passed package and per-row validation before a complete 32,663-row production backup. Dry-run found zero conflicts and planned 6,570 exact-key inserts plus 11,460 exact-ID legacy→v1 rekeys with identical score/magnitude/note/src/eventTs. Transaction re-verified the full-table backup fingerprint before writing. Independent post-check confirms 39,233 total signals, 22,703 EDGAR tone rows, 18,030 versioned rows / 50 companies, zero missing original IDs, zero unexpected original changes, zero unexpected new rows and zero duplicate exact keys. All 21,203 original rows outside rekey, including other sources and out-of-universe history, are unchanged. `ingestedAt` for new rows is production receipt time only; rekeys preserve original availability and IDs. No Event Study, IC, Atlas, shock calibration or Bayes rebuild was performed.

- **Baseline and Fundamentals Data QA completed on 2026-11-07:** clean checkout `f4c0b50` restores `document-presentation` and passes install, TypeScript and production build. Existing DDL 028 widened production `signals.note` from varchar(512) to varchar(2000) after a complete 39,233-row backup; repeat apply was idempotent and every row fingerprint matched. Factor rematerialization covered 21,263 active rows with 4,706 exact-key inserts and 4,740 stale keys preserved as `value=NULL`, not deleted. Final independent post-check found zero missing original IDs, unexpected changes, reviewed mismatches, unexpected new rows or active availability inversions. Readiness is explicitly **partial**: 14 mechanical pilot candidates, 2 limited factors and 6 not evaluated, with 1,280 integrity issues (904 continuity gaps, 9 availability inversions, 15 unit conflicts, 72 instant facts) retained as per-period exclusions. Market factors no longer produce false `factor_before_fact` findings. Independent Statements checks across all 50 found zero netDebt/ROE/ROA mismatches and no zero substitution; instant dividend facts are excluded by the flow builder and do not enter TTM. Full exclusions are in `public/reports/fundamentals-research-readiness.json`; no IC, OLS, Bayes or model promotion occurred.

- **Production reliability and Fund Flows restored on 2026-11-08:** direct SPA routes with HTML Accept return the built index, while unknown API routes remain JSON 404; regression covers both. Documents local-cache fallback is isolated in `document-cache` and tested without filesystem fixtures. Fund Flows now renders fixed-color fund/sector groups with the 150 strongest share changes, accessible table mode, search, mobile layout, reduced-motion handling and a no-WebGL fallback. Presentation reviewers regain access through the NDA-aware read-only query. Browser QA covers a real 100-fund/495-company/400-edge snapshot, forced WebGL failure and reviewer access with zero console errors. `docs/REVENUE_PILOT_EXCLUSIONS.md` and `research/revenue-pilot-exclusions.json` add 88 exact-fact exclusions, 2,774 TTM-window exclusions and 569 review warnings. `docs/REVENUE_PILOT_PROTOCOL.md` remains a draft with no selected target and no IC/OLS/Bayes run.

## 6. Next queue

1. **Reviewed Statements netDebt/ROE/ROA historical rebuild or evaluation:** required where missing debt was replaced by zero or non-consecutive quarters produced TTM. This was not started in the macro block.
2. Numeric correctness: F-15, F-16.
3. **Atlas coverage:** add new documented exposure evidence instead of repeating runs or tuning thresholds.
4. Production/security findings and the remaining audit queue.
5. **Fund Flows 3D repair:** the view is blank for presentation users and is temporarily admin-only. Reproduce the rendering failure, restore a verified view, then re-enable reviewer access.
6. **Legacy Dashboard audit:** the new `/terminal` now provides the retail universe/portfolio-style snapshot, sector/risk charts and disclosure timeline, while `/dashboard` remains a legacy surface. Decide later whether any redundant legacy content should be retained, consolidated or retired.

## 7. Deferred model and data strategy — after the current remediation tails

The owner’s working hypothesis is a **pooled statistical law across companies**, not an independent physical model fitted separately to every company. That distinction determines how much history we actually need.

### Default model family: pooled statistical regularities

We may train and evaluate on a limited research universe that has complete evidence (research-universe-50 across factors and Atlas) **without first collecting complete history for every other company**. This is valid only when the model is pooled: shared coefficients and allowed sector effects are learned on discovery data and frozen for out-of-sample evaluation. Company-specific intercepts or separately fitted company models are not part of this default.

The hypothesis is not considered proven merely because 51 companies are available. Statistical power depends on independent companies, events, sectors and market regimes, not on a large row count created by repeatedly measuring the same observations.

Required evaluation protocol:

- discovery-fit pooled coefficients, with any sector levels learned only on discovery and frozen for OOS;
- chronological OOS plus held-out companies, not only a time split of the same companies;
- leave-one-sector-out and independent-company universes;
- explicit model-complexity budget relative to effective independent observations;
- simple pooled models first, with shrinkage/regularization rather than company-specific parameters;
- availability-anchored evidence and honest `not_available_before` for sources that cannot be backfilled;
- economic risk and OOS robustness, not only IC or a positive in-sample mean.

### Forward-only insurance: S&P 500 collection

Continue building S&P 500 forward history now, independently of the pooled-model decision. This is insurance against two possibilities: the pooled hypothesis later fails, or per-company analysis becomes necessary. Do not wait for that decision before collecting fresh evidence.

This collection is bounded:

- SEC companyfacts continues incrementally by CIK;
- Schwab and Stocktwits expand only after source-hardening, security-identity and rate-budget checks;
- per-source manifests record `historyStart`, `availabilityMode=backfill|forward_only`, captures, ingest and permanent-missing states;
- there is no automatic expansion into research or production;
- there is no immediate requirement to backfill every US ticker or to launch an LLM for the full universe.

### When retrospective backfill is actually required

Start a targeted retrospective backfill only for a documented research need:

1. a company-specific model or case is explicitly approved;
2. pooled coefficients or regime effects prove unstable across held-out companies or sectors and heterogeneity is a credible explanation;
3. missing history prevents a required evaluation or creates a demonstrated bias;
4. the source officially supports the required history and the API/rate budget allows it.

If a source cannot provide retrospective data, record `forward_only` and its start date. Never substitute zero sentiment, zero exposure or a current snapshot for missing history.

### Decision gates after the current remediation tails

1. Finish the active 13F, macro vintage, Statements, Schwab correctness and production/security remediation queue.
2. Run the pooled hypothesis evaluation with company, sector and chronological holdouts on the existing complete-evidence universe.
3. If pooled results are robust across unseen companies, sectors and regimes with acceptable economic risk, expand research in reviewed batches. Long per-company history is not a prerequisite for this pooled model family.
4. If pooled results fail or credible company-specific structure dominates, stop broad scaling and open a small per-company pilot. Backfill only the target companies and only to the depth required by that pilot.
5. Use the already accumulating S&P 500 history as the fallback baseline; expand to the wider US universe organically when the model and evidence justify it.

**Default now:** pooled statistical hypothesis plus full S&P 500 forward collection. **Not default now:** full retrospective backfill for every ticker or full-universe LLM processing.

## 8. Private reviewer presentation

A separate reviewer experience is now code-ready for an academic preview:

- 50 presentation companies from `research-universe-50.json`, read-only navigation and no Operations access.
- First-IP HMAC binding and a short versioned NDA. Consent stores timestamp, IP hash, user agent and session identity, never raw IP or credentials.
- NDA is enforced both by tRPC and direct `/reports/*` access. Reviewer mutations remain read-only after acceptance.
- Two guided tours: geography and technical, with persisted progress, completion and permanent dismissal.
- Activation and migration remain owner-gated. `apply-ddl-029.mts` and the env-based reviewer seed are ready but were not run here.

Full contract and activation: `docs/REVIEWER_EXPERIENCE.md`.

## 8a. Priority plan — strategic and tactical (2026-11-10)

**Strategy (unchanged):** availability-anchored evidence → validated signals → probability engine → (much later) execution. Current phase: finish the feature layer and make expectations serving-grade; no alpha claims until independent, accuracy-based benchmarks exist.

**Tactical order by execution importance:**

1. **P0 — freshness plumbing:** publish the outbox-lane version; run the first backfills (pricesDaily from 2026-11-07, macroPoints, reportFile set); keep the Schwab keepalive healthy — the ops banner on the dashboard now surfaces exactly this class of failure.
2. **P1 — zero-diff local↔prod:** run `scripts/reconcile-inventory.mts` on both sides, diff counts/hashes per table, close deltas through the lane or reviewed packages; CUSIP map transport + uncovered-CUSIP reason audit.
3. **P2 — roadmap graph column 2:** macro re-evaluation chain (research-factors → company-exposure → scenarios → atlas) + analytics snapshot rebuild; weekly coverage/drift report; options features resume (token fixed); share/weight flows evaluation after the 24-quarter transport.
4. **P3 — expectations → serving:** 248 human-review items; design an independent accuracy benchmark (ground truth, not regression); only then a serving-promotion decision.
5. **P4 — new signals:** finish Form 4 universe run, then features + forward-return benchmark with availableAt discipline; Polymarket probability collector only after an explicit owner go (design doc ready).
6. **P5 — research deepening:** rolling IC/rank-IC with conditional forecast errors; sector-neutral residuals; probability engine revisited with expectations as a feature channel.

## 9. Where to look

- **`/project-state`** — simple owner workflow, current block, data meanings and next queue.
- **`/workers`** — registered jobs, current scheduler state, logs, Daily Operations and remediation.
- **`/scenario-lab`** — availability-anchored scenarios and calibrated shocks.
- **`docs/OPERATIONS.md`** — exact operational commands and job registry.
- **`docs/PROJECT_AUDIT_2026-11-03.md`** — correctness/security findings and recommended order.

If live home state is unavailable, the UI must say so. It must not invent a completion percentage, healthy status or successful collection run.
