# K07 — Precomputed page data: fast first load

Task for Kimi Code. Owner request on 2026-11-11: "go on with your recommendation on precalculation for
faster page load". The recommendation (Claude's findings of 11 November, item 8): the Company page is
slow, Overview needs about 20 s for prices and holdings, and Company → Value recomputes factor IC and the
probability on every visit; expensive results should be computed once and read by the page.

## Goal

Every page of the local app shows its main content within 2 s on a warm local server, and no page visit
recomputes research data. Expensive results are computed by a scheduled local job after their inputs
change, and the page reads them.

## LLM use

None.

## What was seen (2026-11-11 01:45 local, headless browser, admin, localhost:3000)

- Company → AAPL, Overview: about 20 s before prices and holdings appear.
- Company → Value: "computing factor IC…" and "evaluating probability…" on every visit.
- Still showing a loading state after 20 s: Dashboard, Screener, Messages, Wiki, Sentiment Lab, Admin,
  Operations, Project State, Analytics (three pages), Market Data. Some of these may be polling rather
  than slow requests; step 1 establishes which.

## Step 1 — measure before changing anything

For every sidebar page and every Company tab, list each request the page makes with server time cold
(first call after a server start) and warm (second visit), response size, and what it computes. Use the
existing server on port 3000; no second server. Requests above 1 s warm or 3 s cold are in scope; the rest
stay as they are.

## Step 2 — precompute what is slow

For each request in scope:

- Move the computation into a local builder that runs as a scheduler job after the jobs that change its
  inputs (`dependsOn`). It writes a JSON artifact (one file per company for per-company data, one per page
  otherwise) with `generatedAt`, the evidence of its inputs (row counts, latest dates or hashes) and the
  code version. Reuse existing patterns: the Screener's DB cache (D27), static reports fetched on demand,
  `writeJsonAtomic`.
- The API reads the artifact. If it is older than its inputs, the page shows it with a visible "as of"
  time and a stale mark; if there is no artifact, the request computes as today. Never a blank page.
- Values must not change: for at least 10 companies (include AAPL, NVDA, JPM, a REIT and a utility) a test
  compares the precomputed response with the on-request response field by field (floats to 1e-12).
- Point-in-time behaviour stays exactly as it is.
- A slow query that precomputing cannot help (N+1 queries, unbounded reads) may be fixed in code. A new
  index or table is a schema change: stop and describe it for the owner instead.

## Out of scope

- Production: artifacts stay local and enter no push lane; using them in production is an owner decision.
- `api/lib/`, `api/kimi/`, `.env`, infrastructure scripts, credentials, GDELT.
- Content changes to pages beyond the "as of" time; the Engine page (separate task).

## Working beside Claude (same working tree)

- K06 stays first: if the release run needs attention, it comes before this task.
- Claude is changing at the same time and owns until it reports them committed:
  `scripts/load-stooq-prices.mts`, `worker/lib/stooq-price-load.ts` and its test, `worker/schwab-fetch.mts`,
  new `worker/schwab-daily-bars.mts`, new `worker/schwab-history-backfill.mts`, a new universe file under
  `worker/`, and `contracts/operations.ts` (two new Schwab jobs). Add your job to `contracts/operations.ts`
  after Claude's commit. Stage and commit only your own paths.
- Scheduler restart to load new jobs: tell Claude through the mailbox first; one restart for both. Web
  server restart to load new server code is fine once you have shown that only one server runs on port 3000.

## Acceptance checks

1. A before/after table of every request in scope, cold and warm: each in-scope request ≤ 1 s warm, the
   Company page main content ≤ 2 s.
2. The equality test for at least 10 companies passes.
3. The builder is a registered scheduler job with `dependsOn`; a manual run writes the artifacts; a test
   shows the stale state.
4. `npm run check`, `npm test -- --run`, `npm run build` and `git diff --check` pass.
5. No production write, no schema change.

## Delivery

Append a "Delivery report" to this file (timings table, artifacts and their sizes, jobs), add the usual
handoff note, and report to Claude by mailbox.


## Delivery report — 2026-11-11/12

Implemented in source commits **`32692c2`** (precomputed serving) and **`6a3c3b4`** (single-pass
build plan, validated resume and source-job health). Local artifacts are complete and all acceptance
checks pass. No production write, database write, schema change, new table/index, model call or new
service occurred.

### Before/after request timings

Timings are browser-measured HTTP wall time. The before/after server was restarted once for each
measurement series; isolated cold calls precede the corresponding warm calls. `server-timing` was
absent, so no internal server duration is invented. The initial isolated attempt was interrupted by
Claude's coordinated server restart; only its two already-complete dashboard results were retained,
and the affected requests were rerun on the new server. The full 50-visit baseline was not interrupted.

| Request | Cold before | Warm before | Cold after | Warm after |
|---|---:|---:|---:|---:|
| `dashboard.stats` | 20,466 ms | 19,722 ms | 70 ms | 10 ms |
| `dashboard.sectorFlowsDetailed` | 15,659 ms | 14,583 ms | 7 ms | 6 ms |
| `company.institutional` | 13,266 ms | 14,686 ms | 8 ms | 7 ms |
| `company.probability` | 4,469 ms | 4,159 ms | 9 ms | 9 ms |
| `schwab-market-data.json` | 987 ms | 1,188 ms | 478 ms | 469 ms, gzip |

`company.factorIc` itself was not slow: **572 ms cold / 319 ms warm** before and **495 ms / 366 ms**
after. It remains on request; only its batching isolation changed. It had been waiting behind the
probability evaluation in the same tRPC batch. The six procedures that were slow or shared those
batches now use `splitLink` with one operation per request; ordinary fast queries retain batching.

All **50** after-visits (19 sidebar routes and six AAPL tabs, cold and warm) completed with
`finalAuth=200`, `mainContentReady=true`, no timeouts, no residual loading flags, no page errors and
no failed requests. Every warm page's main content was ready within **1,465 ms**. The delivery JSON
contains all **240 baseline requests** and **318 after-requests**, with page, phase, procedure,
method, response bytes, wall time, status and any error. No after-request exceeded 1,000 ms; all
in-scope requests are below 3,000 ms cold and 1,000 ms warm.

### Artifacts and equality

The local ignored root is `worker/.runs/precomputed-page-data/`. It contains **103 unique artifacts**:
global dashboard counts, guarded sector flows, 50 institutional responses, 50 probability responses
and one compressed-report descriptor. Their JSON metadata totals **2,074,393 bytes**, excluding the
gzip file. Every artifact records `generatedAt`, source-job/evaluation-day versions, input counts and
latest dates or hashes, a code version and payload hash. Stale data is served with an as-of/stale
mark; missing or invalid artifacts use the original on-request computation. Failed or running source
jobs also mark the artifact stale. Live universe membership and running/queued job counts are not
cached.

The combined-build mistake that would have computed institutional data twice was stopped without
deleting work. The partial summary is preserved in `worker/.runs/k07-interrupted-summary.json`.
The corrected single-pass resume reused **52** results from `32692c2` after checking source-job
versions, evaluation day and the explicitly accepted code version, then computed **51** from
`6a3c3b4`. Summary entries are unique by artifact key and retain `reused` and actual code-version
evidence.

`research/engine/precomputed-page-data.equality.json` proves **22/22 checks**, **13,639 field
comparisons and zero differences**, with float tolerance **1e-12**, against fresh on-request
functions. Companies: **NVDA, PLD, NEE, JPM, AAPL, AMD, INTC, PLTR, META and NFLX**, including the
required REIT and utility. No compared artifact was stale. Factor IC remains on the unchanged
on-request path.

### Gzip report

The existing `schwab-snapshot` writer now creates gzip immediately after writing the public and
bundled JSON, so a later independent push failure cannot block local compression. The serving path
revalidates raw-source and gzip SHA-256 before selecting the artifact; development/bundle mtimes are
not used as identity. A changed source or failed hash falls back to the original JSON, and the
database-versus-static freshness rule is unchanged.

- Raw: **76,788,384 bytes**, SHA-256 `7f025317e64783ad990ad56a514d3c4fbf2533d8aab01d02449a063bfd03e5e4`.
- Gzip: **5,301,467 bytes**, SHA-256 `93533271a7658d9b6ef7c42fc85e50f7e24ba005b2b3ba06bc9759d556730167`.
- Decompression is byte-identical with the source. No raw option chains or new reportFile transport
  were added.

### Scheduler and UI

Six local jobs were registered in `contracts/operations.ts`: `page-data-dashboard` after
`facts-fetch-daily`, `sp500-facts-daily` and `edgar-fetch-daily`; `page-data-13f` after `13f-refresh`;
`page-data-fundamentals` after `research-factors`; `page-data-prices` after `schwab-daily-bars`;
`page-data-macro` after `macro-fred-weekly`; and `page-data-tone` after `edgar-tone-nightly`.
Separate triggers prevent a weekly parent from blocking daily refreshes through the 48-hour gate.
The tone parent stays paused; this builder never calls a model. The existing snapshot job supplies
the gzip refresh path. The runbook has **77 jobs** after Claude's separately approved desk job.

The six new jobs were temporarily disabled only in ignored local config while the scheduler was
restarted and the manual build/equality ran, preventing duplicate execution. They were restored after
equality passed, with no page-data job running or queued and no further scheduler restart. Claude's
separate `renameWithRetry` fix handles transient Windows file locks.

Browser checks confirm visible `stats as of`, `13F data as of` and `research data as of` markers,
with no page errors. The final screenshot is `worker/.runs/k07-value-after.png`; the completed
probability card and all loading-free content are visible. Stale presentation has regression tests;
no equality artifact was stale.

### Verification and evidence

- `npm run check` and the forced worker/script TypeScript check pass.
- Focused cache/resume/API-wrapper/gzip/batching/timestamp tests pass.
- Full suite: **209 files / 1,156 tests passed** with supported `VITEST_MAX_WORKERS=2`; production
  build and `git diff --check` also pass. The default parallel run twice hit the pre-existing
  five-second `worker-expectations` timeout under load; that test passes alone (2.077 s), and no
  timeout or test content was bypassed or changed by K07.
- Builder: `npx tsx scripts/build-precomputed-page-data.mts --group all`.
- Validated resume: add `--resume`; an explicit prior semantic version can be accepted with
  `--resume-code-version <commit>`. Missing/stale/other-version artifacts are recomputed.
- Equality: `npx tsx scripts/verify-precomputed-page-data.mts`.

| Evidence | Bytes | SHA-256 |
|---|---:|---|
| `research/engine/precomputed-page-data.summary.json` | 96,763 | `3f68026a6e9dae8e990a4ed3b8c174b026339d2dc294c7d28263ea966e1b7cb8` |
| `research/engine/precomputed-page-data.equality.json` | 9,004 | `16de3e10ba93d37af292459fd65ab0aa3e4045f9b4114c486d413147c85884f0` |
| `research/engine/precomputed-page-data.delivery.json` | 185,630 | `c52f3c5001ffb85a6a073965401b9b154401327838801700b6c32f86ff5709d0` |

The delivery JSON includes all page/request evidence, isolated timings, equality counts, gzip proof
and visible-as-of checks. All evidence records `productionWrite=false` and `databaseWrite=false`.
No model, factor, probability or trading signal is promoted by this serving optimization.
