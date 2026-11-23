# Project review — what is complete, what is not, what to prune (2026-11-22)

Author: Claude, on the owner's request ("re-analyze our project … complete and incomplete things as far as ui, backend,
algorithms, data fetch, current tasks, we need to prune old unnecessary code, pages, logs").

Everything here was measured on the home machine on 2026-11-22: the repository at `0f21d5b`, the scheduler state,
the local databases (row counts are MySQL estimates), disk sizes on C: and D:, and an import graph of the tracked
TypeScript (which files are reachable from the web app, the server and the scripts the scheduler runs).
**Nothing was deleted or changed for this review.** Every removal below needs the owner's go; table drops and data
deletion are stop conditions of AGENTS.md section 6.

## 1. Size of the project

| | Measured |
|---|---|
| Main repository | 676 commits; 1,276 tracked files; 965 TypeScript and JavaScript source files |
| Source reachable from what runs | 429 of 965 files (web app, server, the 68 scripts in the job registry) |
| Tests | 261 files, 1,479 tests, all passing (2026-11-18) |
| Scheduler | 83 registered jobs: 43 scheduled, 24 manual, 8 paused, 7 blocked, 1 frozen |
| Research repository (lab) | 202 commits, local only (no remote) |
| App database `alpha_engine` | 34 tables, 6.5 GB (`facts` 4.2 GB, `prices` 1.2 GB) |
| Research database `alpha_research` | 23 tables, 5.5 GB |
| C: drive | 74.7 GB free; `worker\.runs` holds 5.5 GB in 17,290 files (1.4 GB of it is a junction to D:) |
| D: drive | 394 GB free; project data 432 GB |

## 2. User interface

**Complete (the desk, `/desk/*`, the product):**
- Today, Markets, Screener, Company, Watchlist, Messages.
- Research: Signals ledger, Earnings, Volatility, Macro, Ownership, Library.
- Flows (the 3D hall of fund flows) and its reading view.
- Engine page (the traced engine-v1 run, step by step).
- Owner tools: People, Reviewers, Manuals, Logs, Monitors; Operations health.
- Intraday 1D/5D ranges on the company price chart; light and dark themes; phone width.
- Server-side access guards (47 owner procedures have guard tests).

**Incomplete:**
- **The move from the classic view stopped after phase 1.** Plan: `docs/desk/UI_MIGRATION.md`. Kimi was to build it.
  - Phase 2, Operations console (run and stop controls, schedules, logs, coverage): specified as K17b, not built.
  - Phase 3, Company statements and Screener columns on the standard data: not specified.
  - Phase 4, the research pages (guidance record, scenario lab, insider list, option chains, hypothesis ledger): not started.
  - Phase 5, retire the classic view, new sign-in, password reset, invitations: not started.
- **18 classic routes are still live** and linked from the desk's Library: terminal, dashboard, universe, screener,
  company, jobs, wiki, database, lab, workers, project-state, analytics, methodology, risk-lab, scenario-lab,
  expectations, insider-activity, market-data, plus login and signup.
- **Each desk page lists its own gaps** (`src/desk/devnotes-data.ts`): 55 "missing" items over 15 pages. Flows has 11.
- **The Engine page shows engine v1** of 2026-11-12. The later work (per-company, pooled engine, ceilings, the miss
  forecaster) has no view.
- **The classic Expectations page bundles a 27 MB generated file** (`src/data/expectations-report.ts`, 488,560 lines).

## 3. Backend

**Complete:**
- API: 15 routers, 83 service files; sign-in, roles, reviewer access with NDA.
- One home server on port 3000 and one scheduler with a lock, a 15-minute watchdog and a command queue.
- Daily operations report with health checks; data-health report.
- Recovery after the 2026-11-18 power cut worked without data loss.

**Incomplete or open:**
- **K17b server items:** `/reports/*` still admits any NDA reviewer to the owner's operations reports; the macro
  lineage check raises a warning every day because it compares run times, not content.
- **Backup and restore** has only been drilled as JSON round trips. MySQL stays on C: until a real restore is tested.
- **Production is off** by the owner's decision of 2026-11-13. The push code, the presentation exporters and six
  delivery jobs are still in the tree.
- **The parked audit** of 2026-11-10 was never finished; Kimi's remediation of its three urgent items was not
  verified on the production side.

**Found during this review:**
- **`alpha-bridge-agent` runs every two minutes.** AGENTS.md section 9 and the job registry say it stays paused until
  the owner configures deny rules. `operations-config.json` has it enabled; it has written 11,606 of the 14,013 log
  files. It answers "idle" each time. With Kimi gone it has no purpose.
- **`daily-digest` has failed since 2026-11-21** ("Local Ollama is unavailable"): a consequence of stopping Ollama on
  the owner's word to free the GPU. The 07:15 morning brief needs the model.
- **Eight generated files are modified and three untracked** in the working tree (reports, summaries, the analytics
  snapshot). They are machine output, rewritten daily.

## 4. Algorithms

**Built and tested (all in the lab, findings documented):**
- Engine v1; the per-company Bayes engine; the pooled two-stage engine with $1M switch accounts and controls.
- Nowcasts of next quarter's figures (ridge and a neural network).
- The factor test method (`docs/engine/FACTOR_TEST_METHOD.md`).
- Perfect-foresight ceilings, the surprise ceiling, the forecaster of the miss against guidance.
- Tests of: 64 fundamentals, 39 ratios, guidance and its revisions, insider trades, 13F, short interest, options,
  peers, technical patterns, Fed and CPI prediction markets.

**Result so far:** no input predicts returns out of sample on S&P 500 companies. The switching logic earns only with
next-quarter information (+$137k per $1M over holding on all companies, +$240k on the guiding ones, about 2.5 years).

**Incomplete:**
- Final guidance build g1.2 (the GPU rerun finished 2026-11-19; 4,040 of 4,041 exhibits), then the reruns of the
  guidance, pooled and miss tests on it.
- Analyst consensus (the estimates pilot) and non-GAAP EPS: never tested, no data.
- Nothing is promoted into the app: no model has passed.

**Stale:**
- **The app's own factor engine** (probability, IC and factor services; `research-series` and `research-factors` run
  nightly; the classic Company page and the two manuals describe it) predates the lab work and never passed an
  out-of-sample test. It is shown in the classic view as if it were a signal.

## 5. Data collection

**Running** (39 jobs ran in the last two days):
- Schwab: 50 option chains daily, S&P 500 price series, intraday snapshots every 20 minutes, hourly market context.
- SEC: companyfacts for the 50 and the S&P 500, filings and exhibits, 13F refresh.
- Macro: FRED weekly, events daily. Prediction markets daily. Split calendar daily. Stocktwits hourly (without
  the model since 2026-11-21). Standard prices weekly refresh.

**Standards in `alpha_research`:** fundamentals v3.1, normalized panel n1, prices p1, options o1, 13F k16.5,
insiders i1.1.

**Not loaded yet:** guidance (g1.2, files only), release figures (K12.1, files only), prediction markets (files).

**No recorded run in the scheduler state:** 40 of the 83 jobs. They are the manual, paused, blocked and frozen ones: tone,
the old expectations pipeline, Cboe and ORATS options, DoltHub, production pushes, GDELT.

**Open data defects:**
- 13 companies quarantined in the release figures (K12.1).
- One exhibit without a result in the guidance rerun (UNH, 2026-07-16).
- A false price session on 2007-01-06 in standard prices p1; the TPL price gap.
- The full SEC financial-statement data sets download waits for the owner's go.

## 6. Prune candidates

### 6.1 Logs and run folders on C: (`worker\.runs`, about 4.8 GB reclaimable)

| What | Size | Note |
|---|---|---|
| 24 `expectations-reviewed*` folders | 3.9 GB | Export packages of 2026-11-07..09, many of them repeats |
| 6 `macro-*` remediation folders | 0.36 GB | One-off repairs of 2026-11-04..06 |
| `local-generated-backup` | 0.26 GB | Backup of 2026-11-05 |
| 3 `k07-*` folders (a browser profile) | 0.12 GB | 2026-11-11 |
| 9 large loose files (failure logs, rejected packages) | 0.14 GB | 2026-11-06..08 |
| 14,013 job logs | 42 MB | 11,606 from `alpha-bridge-agent`; 3,999 older than 14 days. No retention rule exists |
| About 40 small one-off folders | small | Remediations and checks of 2026-11-04..10 |

Keep: `local-generated` (rewritten daily), `engine-flow` (a junction to D:), `desk-flows`, the scheduler state files.

### 6.2 Superseded builds on D: (about 106 GB reclaimable, or 117 GB with the first accepted K12 builds)

| What | Size | Keep |
|---|---|---|
| `insiders\std`: 11 superseded builds | 63.8 GB | The final `20261116T223552Z` (8.7 GB) |
| `insiders\std-smoke` | 23.5 GB | Nothing |
| `engine\flash-k121-rest`, `flash-k121-50` | 10.9 GB | `flash-k121b-*` (current) |
| `engine\flash-rest`, `flash` (first accepted K12) | 10.5 GB | Owner's call: superseded, but recorded as the accepted K12 evidence |
| `options-std`: 20 superseded builds | 2.9 GB | `20261114T135938Z` |
| `prices`: 2 older weekly refresh snapshots, 2 backups | 1.7 GB | The newest refresh and `std` |
| `guidance\std` and `dryrun`: superseded builds | 1.8 GB | Decide after the final g1.2 |
| `scratch-clean-tree`, `fund-books-trial`, `desk-flows-scratch` | 1.3 GB | Nothing |
| `fundamentals\standard`: 16 older versions and tests | 0.6 GB | `v3.1` |

The 209 GB EDGAR download cache and the 14 GB 13F cache are raw archives and stay.

### 6.3 Code that nothing uses

| What | Size | Evidence |
|---|---|---|
| 52 `t_*.mts` scripts in the repository root | part of 3,163 lines | One-off checks, last touched 2026-10-21 |
| 28 `apply-ddl-0NN.mts` in the root | | Already applied; the DDL itself is in `db\ddl` |
| `53tickers.zip` (8.9 MB), `merge-backup.patch`, `info.md` in the root | | Tracked leftovers |
| 42 unused interface kit components in `src\components` | 5,090 lines | Imported by nothing |
| `src\hooks\use-mobile.ts`, `contracts\types.ts` | 21 lines | Imported by nothing |
| 5 files used only by their tests | 641 lines | `execution-cost`, `signals`, `expectation-metrics`, `gamma-exposure`, `standard-fundamentals-gaps` |

`api\lib\http.ts` is also imported by nothing, but AGENTS.md forbids changes under `api\lib`.

### 6.4 Code that only old, unscheduled scripts use (owner's decision per group)

90 scripts in `worker\` and `scripts\` are not in the job registry, and 50 library files (8,445 lines) are reached only
through them. Some are still wanted as manual tools. By group:

| Group | Files | Recommendation |
|---|---|---|
| Kimi bridge: MCP server, captain executor, live executor, mailbox, `ALPHA_BRIDGE.jsonl`, `ALPHA_COMMANDS.jsonl`, AGENTS.md sections 8-10 | about 8 + docs | **Remove**: Kimi left on 2026-11-18. Disable the two-minute job first |
| GDELT: collector, backfill, CSV import | 5 | **Remove**: frozen by rule, never to be requested |
| Old Form 4 pipeline (fetch, parse, features, QA, benchmark, export) and table `insider_trades` (3,091 rows, 50 companies) | 11 | **Remove after** the desk Ownership page reads the insider standard (i1.1) |
| Old expectations pipeline (cohorts, extraction, benchmark, v3.3 and v3.4 exports, normalization, remediation scripts) | about 25 | **Remove after** the guidance record moves to the guidance standard (g1.2) |
| Tone pipeline (model A/B, event study, IC) | about 6 | Remove or keep parked: paused, never run by the scheduler |
| ORATS and Cboe option lanes, Yahoo option QA | about 6 | Remove: the option standard comes from DoltHub and Schwab |
| One-off remediations of 2026-11-04..10 (macro vintages, macro source, registry tickers, NVDA expectation, 13F scale) | about 15 | Remove: done and recorded in the handoff |
| Presentation exporters and production push (`*-presentation.mts`, `prod-push`, `push-local-*`, six delivery jobs) | about 12 | Owner's call: production is off; remove, or keep for a later relaunch |
| Old research evaluators (`evaluate-factor-ols`, `evaluate-market-cap-ols`, causal imputation, nested evaluation, logistic, magnitude) | about 10 | Remove: superseded by the lab |
| Still-used manual tools: the release-figures builder and its golden check, fund books and flows builders, Stooq loader, event calendar, seeds, verifiers | about 20 | **Keep**; register the ones that should run |

### 6.5 Pages

| What | Recommendation |
|---|---|
| Classic routes already marked "drop" in the migration plan: `/lab`, `/project-state`, `/analytics/risk-lab`, `/terminal` | Remove now (terminal's three charts are not in the desk yet: move them or accept the loss) |
| `/dashboard`, `/jobs` | Remove with K17b (their useful parts are specified there) |
| The other 13 classic routes | Remove page by page as their desk destination is built |
| `src\data\expectations-report.ts` (27 MB in the bundle) | Replace with a lazy-loaded slim report, or remove with the Expectations page |

### 6.6 Scheduler registry

- 40 jobs have no recorded run. After 6.4, most of them disappear with their scripts; the registry should then hold the 43
  scheduled jobs plus the manual tools still wanted.
- `alpha-bridge-agent`: disable.
- `daily-digest`: either accept that it needs the model each morning, or pause it while Ollama is off.

### 6.7 Documents (76 files)

| What | Size | Recommendation |
|---|---|---|
| `KIMI_CODE_HANDOFF.md`, 208 sections | 583 KB | Rename to a neutral handoff; move sections before about 190 into an archive file |
| `LLM_CONTEXT.md` | 196 KB | Rewrite short: it carries stale "now" entries |
| 12 dated one-off reports of 2026-11-03..04 | about 250 KB | Move to `docs\archive` |
| `ALPHA_ENGINE_MANUAL.md` and `_EN.md` | 520 KB | They describe the app's old factor engine; keep as history or rewrite after the engine question is settled |
| `REVENUE_PILOT_EXCLUSIONS.md` | 367 KB | Generated; archive |
| `AGENTS.md` | | Title and sections 8-10 are about Kimi; update with the owner |
| `docs\engine\*` and `docs\engine\tasks\K*` | | Keep: the standards and their task records |

### 6.8 Database tables (drops are schema changes: owner only)

- Empty or nearly empty in `alpha_engine`: `settings`, `reports`, `worker_keys`, `messages` (0 rows), `jobs` and
  `job_logs` (4 rows each), `sentiment_scores` (88), `short_interest` (56).
- Superseded by a standard: `insider_trades` (3,091 rows) by i1.1.
- Two scratch databases from restore drills (`alpha_restore_scratch`, `alpha_expectations_restore_scratch`), six empty
  tables.

## 7. Current tasks, in order

1. Final guidance build g1.2, the reruns on it, and the load of `std_guidance_*` (ready; no GPU needed).
2. Owner's decision on the estimates pilot (the one input never tested).
3. Owner's decisions on this prune list; then the removals in separate, reviewable commits with the gates run.
4. The desk migration K17b to K17e, now Claude's work.
5. Older open decisions: the false price session of 2007-01-06, the TPL price gap, the SEC data-set download,
   whether Ollama may run each morning for the digest.

## 8. First prune pass, done 2026-11-22 (owner: "1. yes")

| What | Result |
|---|---|
| Root leftovers | 52 `t_*.mts`, `53tickers.zip`, `merge-backup.patch`, `info.md` removed (`74279ad`). **The 28 `apply-ddl-*.mts` stay:** two have tests and the production runbooks name them |
| Unused interface code | 42 components, `use-mobile.ts`, `contracts/types.ts` removed (`c919504`), 5,111 lines |
| Run logs | New daily job `run-log-retention` (`29c95ea`), 14 days; first run removed 3,979 logs |
| Run folders on C: | 71 folders and packages, 5.19 GB. Kept: production rollback evidence (`production-sync-2026-11-05`, two `cusip-map-ticker-text-*`), folders the code reads (`precomputed-page-data`, `cohort-qa`, `form4-qa`), `k17a-ui`, `k21-ui`, two loose failure logs of paused pipelines |
| Superseded builds on D: | 40 folders, 103.4 GB: 11 insider builds and `std-smoke`, `flash-k121-rest` and `-50`, 20 option builds, 2 price refreshes and 1 backup, 3 scratch folders |
| Not removed | Older fundamentals versions (0.6 GB) and guidance builds (1.8 GB): wait for the final guidance build. `flash-rest` and `flash` (10.5 GB): owner's call |
| Scheduler | `alpha-bridge-agent` disabled, `daily-digest` paused (both in `operations-config.json`). Bridge code, mailbox and AGENTS.md sections 8-10 stay until Kimi's credits end on 2026-11-30 |

Manifests of every removed folder: `D:/research/alpha-engine/prune-manifest-*-20261122.json`, log `prune-20261122.log`.
Free space after the pass: C: 79.1 GB (was 74.7), D: 491.2 GB (was 393.7).
A guard stopped one removal: `scratch-clean-tree/node_modules` was a junction to the repository's real `node_modules`.
Only the link was removed.
