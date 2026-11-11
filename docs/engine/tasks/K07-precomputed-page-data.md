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
