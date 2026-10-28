# ALPHA-BAYES-MOE-1.0 — System Manual

> Living document. Extended every development iteration.
> Audience: economist / mathematician / programmer.
> Document version: **v2-en** (iteration 3b state; English edition of the Russian master).

---

## 1. Project vision

A programmatic end-to-end system extracting mid-term (quarterly) alpha from S&P 500 equities.
The system **deliberately avoids** technical price-chart analysis. Instead it builds alpha from
three sources:

1. **Structural business anomalies** — changes in fundamentals (SEC XBRL facts);
2. **Narrative/accounting transformations** — MD&A language, footnotes, restatements, litigation (LLM text analysis);
3. **Option liquidity constraints** — 25-delta skew surface (Stages 5–6, later).

Architectural metaphor: the market is a non-stationary physical system where fundamentals set
the structural trajectory and derivatives/volatility set the execution boundaries.

## 2. Six stages (roadmap)

> Statuses as of 2026-10-12. ITERATION numbers (2, 3a…3l, 4a) are development
> cycles — they do NOT map onto stage numbers. "4a" did not start stage 4.

| Stage | Name | Status |
|---|---|---|
| 1 | Ingestion — SEC EDGAR collection | ✅ working (cloud) |
| 1.5 | Document Registry — text corpus for the LLM | ✅ done (iteration 2) |
| 1.6 | Series Builder — canonical time series | ✅ done (iteration 2) |
| 1.7 | Prices — daily OHLCV + SPY benchmark | ✅ done (3f/3g/3l; 5 tickers + SPY, 100% coverage) |
| 2 | Semantic Triage — LLM scoring of MD&A/footnotes (−1…+1) | 🚧 PARTIAL: 2.1 section slicing ✅, 2.2 cloud scoring prototype ✅ (calibration + Lab); full local LLM ⬜ (awaits home worker) |
| 3 | Purification — Huber M-estimation + FFT denoise | ⬜ not started; design under review (see the 3h memo: FFT has little to denoise on quarterly series — causal filters for prices instead) |
| 4 | Regime & Probability — MS-AR/HMM + Bayesian posterior | ⬜ not started; next candidate input — FRED macro |
| 5 | Conformal Prediction — intervals and sizing | ⬜ not started; proposed entry point — factor IC monitor (Stage 5-alpha) |
| 6 | Execution — covered calls, skew overrides, orders | ⬜ not started; blocker — the options data source decision |

Cross-stage additions: earnings events from 8-K Item 2.02 and the Screener
page (iteration 4a) are infrastructure on top of stages 1–2, not stage 4.

**Target hybrid architecture (Variant C):** cloud = control plane (UI, registries, task queue);
local machine (Mac, later Mac Studio) = worker for heavy lifting (full SEC mirror, LLM processing).
The worker authenticates with an API key and pulls tasks from the shared queue.

## 3. SEC EDGAR data sources (all free)

| Source | Provides | Endpoint |
|---|---|---|
| company_tickers.json | ticker → CIK mapping | sec.gov/files |
| submissions API | company metadata + full filing index | data.sec.gov/submissions |
| companyfacts API | **all XBRL fundamentals** as time series | data.sec.gov/api/xbrl/companyfacts |
| Archives | filing documents themselves (primary + exhibits) | sec.gov/Archives/edgar/data/... |
| atom feeds | near-real-time stream of new filings | sec.gov/cgi-bin/browse-edgar |

Access discipline: declared User-Agent, ≤ 8 requests/s, exponential retries (429/5xx).

## 4. Data layer

### 4.1. Raw tables (Stage 1)

- `companies` — company registry (cik PK, ticker, SIC, fiscal year end, `inUniverse` flag);
- `filings` — filing index (unique: cik + accessionNo);
- `facts` — **raw** XBRL facts (long table). Key feature: every row carries
  `filed` (filing date) and `accn` (source filing) — this reconstructs any
  historical data "vintage";
- `jobs`, `job_logs` — ingestion task queue and their logs.

### 4.2. Document Registry (iteration 2)

Every document of every filing (not only the primary doc but also EX-99.x exhibits — those
are the press releases and earnings releases) is registered under a canonical key:

```
CIK########## / accession-nodash / filename     ← identical in cloud and on the local mirror
```

- **Storage**: raw HTML — immutable original with SHA hash; plaintext — derived artifact with
  `parser_version` (re-derivable from raw; SEC is never re-downloaded);
- **Location**: `cloud | local | both` — flags sync once the local worker exists;
- **Processing status**: parsed + LLM run history (model, schema version, date).
  Reprocessing after an LLM upgrade = `SELECT … WHERE llm_version < current` → queue.

Form scope: 10-K, 10-Q, 8-K + amendments (/A) + DEF 14A (proxy).
Earnings call transcripts are not published by the SEC — an experimental module from free
sources (isolated, marked `source=external`).

### 4.3. Series Builder — canonical time series (iteration 2)

Raw facts are unfit for math: one `end_date` carries values of different durations
(3/6/12 months), restatements, and deprecated concepts. Series Builder produces homogeneous series.

**Vintage modes** — critical for lookahead-bias elimination:
- `latest` — last known value (current "truth");
- `first` — as originally reported;
- `as_of(T)` — what was known at date T (for Stage 4–5 backtests): filter `filed ≤ T`.

**Duration homogenization** (Apple revenue example):
10-Q gives 3M and 6M-YTD, 10-K gives 12M. Everything is reduced to the canonical quarter:
- flow concepts (P&L, cash flow): direct 3M values; Q4 = FY(12M) − 9M YTD
  (no Q4 10-Q exists). The point is marked `derivation = reported | derived_q4`;
- stock concepts (balance sheet): instant values at quarter-end dates, as-is.

**Concept aliases** (two layers):
1. *Static map* — unambiguous global renames (ASC 606: `Revenues` →
   `RevenueFromContractWithCustomerExcludingAssessedTax` in 2018, etc.).
2. *Auto-alias per company* — the us-gaap taxonomy of 2018–2020 renamed many elements by
   adding/removing the `Current`/`Noncurrent` suffix (`AccountsPayableCurrent` ↔
   `AccountsPayable`), and each filer migrated at its own pace and in its own direction
   (Apple still reports under `AccountsPayableCurrent` in 2026). The merge direction
   is decided per company: the canonical name is the one actually used in late filings
   (max periodEnd). A merge requires hard evidence:
   - overlapping periods exist → merge only if values match in ALL overlapping cells
     (±0.5%): the same fact tagged with two names. Systematic mismatch = different
     aggregates sharing a root (`Assets` vs `AssetsCurrent`,
     `LongTermDebt` vs `LongTermDebtNoncurrent`) — never merged or flagged;
   - no overlapping periods → merge only with strict temporal sequencing of names
     AND agreement of boundary values (medians of ≤3 edge points, ratio ≤ 2).
   Contested pairs (partial mismatch, interleaved ranges, a jump at the seam)
   get a continuity flag `alias_candidate:<name>:<reason>` — queued for manual
   review in the Data Health tab; no merge happens.

The series is stitched under the canonical name; metadata keeps `aliased_from` (a footnote in the UI).

**Continuity flags** on the expected quarterly grid (from fiscal year end): missing periods,
window overlaps, unit changes, sharp revisions.

**Restatement metrics** (per company — both a data-quality indicator and an alpha feature;
the literature links restatement frequency to accounting risk):
- `revision_rate` — share of periods where first ≠ latest;
- `revision_magnitude` — mean |latest − first| / |first|;
- `revision_lag_days` — mean lag between first and latest;
- `restatement_events` — count of 10-K/A and 8-K with Item 4.02 (non-reliance).

### 4.4. Stage 2.1–2.2: sections and LLM scoring (iteration 3a)

**document_sections** — document slicing into semantic sections WITHOUT text
duplication: only offsets `[charStart, charEnd)` into the document plaintext are stored
(documentId + parserVersion). Catalog: 10-K items (1..16) and 10-Q (Part I/II with
collision separation), 8-K items (including decimal 2.02), DEF 14A blocks
(CD&A, exec comp, pay-vs-performance, audit, governance, ownership).
TOC filtering: dot leaders/page numbers + density clusters of headings in the first
10% of lines; two-line headings are glued; text is truncated at SIGNATURES.
Confidence flags: `toc_fallback`, `toc_ambiguous`, `short_section`,
`part_unknown`, `missing:item7_mda` (document level — into the job log).

**sentiment_scores** — versioned LLM section scores. Row:
(cik, accessionNo, sectionKey, aspect, score −1..+1, confidence 0..1,
evidence, evidenceOk, pairwise, llmVersion, promptVersion, usageTokens).
8 aspects: outlook, demand, margins, liquidity, capex, capital_return,
legal_reg, accounting; plus tone_delta in pairwise mode (MD&A of both
periods in one context). Idempotency key
(documentId, sectionKey, aspect, llmVersion, promptVersion) — checked BEFORE
the model call (billing discipline). Evidence is a verbatim quote ≤300 chars,
machine-verified as a substring of the source (whitespace normalization);
failure = the row is written with evidenceOk=false and hidden from the UI by default
(audit mode — a checkbox). The table never UPDATEs scores: a new run =
new rows with a new version pair.

**Rubric (api/services/sentiment/rubric.ts)** — scale anchors (−1/−0.5/0/+0.5/+1)
per aspect; v2: evidence strictly from the CURRENT text (quoting the prior
period in pairwise mode is forbidden), tone_delta mandatory in pairwise. Any prompt
change = PROMPT_VERSION bump.

**Model**: cloud (k3-agent via the platform gateway, temp=1 only) =
calibration prototype; production — local worker (Qwen2.5-14B GGUF Q5,
llama.cpp, GBNF JSON grammar, temp=0+seed). SCORE_JSON_SCHEMA in
contract.ts is the basis of the future GBNF.

### 4.5 Iteration 3b: GICS snapshot, sample expansion, admin section

**Static GICS snapshot (D14).** `api/services/gics-snapshot.ts` — the full
S&P 500 constituents table (502 entries: ticker, CIK, GICS Sector, Sub-Industry)
with the capture date `GICS_SNAPSHOT_AS_OF`. `enrichClassification()` no longer touches
the network: companies match by CIK (reliable) or ticker, UPDATE only actual
changes. `edgar.indexConstituents("sp500")` falls back to the snapshot when Wikipedia
is unreachable (NDX/Dow stay live; an error → honest n/a).

**Scoring sample expansion.** Harvest: PLD — 3×10-K + 3×10-Q (48 documents),
AAPL topped up to 3×10-K + 3×10-Q. Sections parsed for all 12 documents
(23 sections per 10-K, 11 per 10-Q). Scoring under rubric v2 (pairwise,
maxDocs=3, mda group): AAPL — 27 rows (evidence 21/27 verbatim, 39.5k tokens),
PLD — 27 rows (26/27, 65.9k tokens). tone_delta present in every v2 row.
Total coverage: 2 companies × 3 documents × 9 aspects (v2) + legacy v1 AAPL (8).

**Admin section (D15).** Page `/admin` (Manuals / Job Logs tabs) +
`api/routers/admin.ts` behind `adminQuery`. Manuals are read by the server from `docs/`
on every request (id whitelist, no arbitrary paths); the Dockerfile copies
`docs/` into the runtime image, with a bundled-content fallback for runtimes
whose working directory differs (see `api/services/manuals-content.ts`).
The Admin menu item is visible only when `user.role==="admin"`;
a non-admin hitting the URL directly gets a FORBIDDEN screen.

**Other fixes this iteration:**
- `harvestCompanyDocuments`: empty `reportDate` on DEF 14A/some 8-K is coerced
  to NULL — MySQL strict rejected `''` and killed a new company's whole harvest;
- the Enrich GICS button now surfaces mutation errors (previously silent).

### 4.6 Iteration 3c: UI declutter, per-user queues, notifications, English UI

**UI declutter (owner decision).** The user-facing navigation is reduced to
three working surfaces: Dashboard / Universe / Jobs. Database and Sentiment
Lab are owner instruments: removed from the menu, protected by an `AdminOnly`
route guard (App.tsx), reachable from `/admin → Tools`. The SEC EDGAR FEED
LED and the job counter in the sidebar footer are visible to admins only.
On the company page the Data Health tab is merged into Overview (rollup +
flagged series), and the Sentiment tab renders CONDITIONALLY — only when the
company actually has scores (counts.scores > 0).

**Per-user job queue (D17).** `jobs.startedBy → users.id` (DDL 004);
jobs.list returns all jobs with the launcher's name to an admin (join users),
and only their own jobs to a user. Rows with startedBy NULL (pre-3c) are
admin-only ("legacy"). Every queue row carries a human-readable description —
`describeJob(type, params)` unfolds the params JSON into a line like
"scope sp500 (−2 excluded) · forms 10-K/10-Q/8-K · facts"
(src/lib/job-describe.ts).

**Notifications (sonner).** Job acceptance toasts immediately (fades on its
own); completion/failure/cancellation toasts come from the global watcher in
AppLayout (polls jobs.list every 5s, diffs statuses in a ref; React Query v5
has no useQuery onSuccess — a useEffect on data is used). A launch rejection
toasts the API error text.

**Add Ticker with autocomplete (D18).** `universe.directorySearch` searches
the full SEC directory (company_tickers.json, ~12k filers, cached
in-process): ticker prefix first, then name substring, ≤12 rows. Free-text
entry still works (Enter → the typed ticker as-is).

**Automatic GICS enrichment (D16).** enrichClassification runs automatically
at the end of every bootstrap job from the static snapshot; the Enrich GICS
button is removed from the UI. An enrichment failure does not fail the job
(a warn line in the log).

**UI and code language.** All UI strings, code comments and test names are
English only (owner directive, 3c). Russian survives in exactly one artifact —
the Russian manual (docs/ALPHA_ENGINE_MANUAL.md); this English version is the
canonical one. Chinese LLM-gateway error strings (AiTransient "无法连接网关…")
are translated into human-readable English in runner.humanizeError BEFORE
they are written to jobs.message.

**Manuals without ENOENT (D19).** The production runtime executes with
cwd=/code, not /app — reading docs/*.md from disk failed there.
admin.manualContent now tries a candidate list ([cwd]/docs, /code/docs,
/app/docs) and falls back to a bundled snapshot in the generated module
`api/services/manuals-content.ts` (scripts/gen-manuals-content.mts; esbuild
inlines it into dist/boot.js — manuals exist in every runtime). After editing
a manual: regenerate the bundle. The UI shows the source (disk/bundled).

### 4.7 Iteration 3d: 8s ring toasts, targeted refresh, honest GICS logging

**Toasts with a countdown ring.** Every notification lives 8 seconds
(TOAST_DURATION_MS, src/lib/job-toast.tsx) and carries a Mac-style circular
ring that visually depletes: toast.custom + an SVG circle whose
stroke-dashoffset is drained by a pure CSS animation. Sonner pauses its
dismiss timer while the toast is hovered — the ring pauses in sync
(`[data-sonner-toast]:hover` in index.css). Every call site (global watcher,
job launchers, manual GICS trigger) goes through jobToast(kind, title, desc).

**Targeted refresh after a job (D20).** The watcher in AppLayout now
invalidates exactly the caches a finished job writes to: bootstrap →
universe.list / sp500Preview / scope.groups / dashboard.latestFilings;
filings → browse.filingsList / latestFilings; harvest+stream →
documents.list/stats + company.overview; series → series.*; sections →
sections.list; score → sentiment.*; dashboard.stats always. React Query
invalidate() refetches only MOUNTED queries — the table the user is looking
at refreshes itself in place; nothing else is reloaded.

**Honest GICS logging + manual trigger.** enrichClassification returns the
full breakdown — matched[] and unmatched[{ticker, reason}] — and the runner
logs one warn per skipped company ("RIVN skipped — not an S&P 500 member —
no GICS entry in the snapshot; SEC SIC shown in the UI instead") instead of
an opaque "0 updated". The manual trigger is kept for the owner: Universe →
GICS button (admin only) → scope.enrichClassification (now admin-only too);
the result toast names who matched and who was skipped. In the Universe table
the Industry column falls back to the SEC SIC description (italic, dimmed,
"(SIC)" suffix) for companies outside the index, with a legend line under
the table — the two taxonomies are never visually mixed (D8).

### 4.8 Iteration 3e: Statements viewer with vintage control

**Curated statements on the company page (D21).** The Fundamentals tab now
opens with a statements viewer (src/components/Statements.tsx ←
series.statements ← api/services/statements.ts): four collapsible sections —
income statement, balance sheet, cash flow, ratios & derivatives — over a
fiscal-quarter grid (12 quarters or 6 fiscal years). Column labels respect
the company's fiscalYearEnd: "FQ3 FY26 · 2026-06-27" for Apple (September
year end), "FQ1 FY27" for NVIDIA (January). Annual mode sums flows over the
fiscal year (fewer than 4 quarters → partial marker *); stocks take the
FY-end quarter. The raw single-series explorer stays below as the
full-concept fallback.

**Vintage control rides on D2.** Three modes in the header: Latest
(post-restatement), As reported (first disclosure), As of [date] — the
latest revision is only used when its sourceFiled <= T, otherwise the first
vintage answers (no lookahead; the viewer shows the note explicitly). This
is the Tiingo "RESTATED / AS-REPORTED" idea, extended with an arbitrary
as-of date — the exact semantics Stage 5 backtests will need.

**Derivatives are computed, not fetched.** FCF = CFO − capex, gross-profit
fallback (revenue − cost when the tag is absent), margins, ROE/ROA (TTM),
net debt, current ratio — all derived from the resolved base rows and marked
with ∂ + italics. Capex/dividends/buybacks display with a negative sign.
Rows whose underlying series carries health flags get an amber triangle.
YoY rides as a sub-line in every cell (pp for ratio rows). Row-level unit
auto-scaling ($B/$M/$K) with a manual override; per-share values and shares
are formatted separately.

**Fiscal year end, human-readable.** fiscalYearEnd (SEC MMDD) renders as
"Dec 31" in Universe and on the company page (src/lib/format.ts); the DB
keeps the machine format.

### 4.9 Iteration 3f: historical daily prices (Stage 1.7)

**Free-source provider abstraction (D22).** New `prices` table (DDL 005):
daily OHLCV bars + adjClose, keyed (cik, date, source) — `source` IS part of
a bar's identity: Stooq and Yahoo legitimately disagree (adjustment policy,
halts), so bars from different providers coexist instead of overwriting each
other. cik=0 is reserved for the SPY benchmark (no SEC company row).
api/services/prices.ts: two fetchers behind one interface — Stooq (free CSV,
no key, daily bars pre-adjusted) primary, Yahoo v8 chart JSON (browser UA,
conservative backoff, 429 → long cooldown) as fallback. Selenium is
deliberately NOT used: both providers are plain HTTP; a browser-driven
fallback can be added as a third provider without touching the sync/read
logic.

**Accumulation model: load and accrue.** Sync is incremental by construction —
each company resumes from MAX(date)+1 in the DB; a company with no bars gets
a full backfill. The `prices` job (incremental / backfill modes) processes
companies stalest-first (never-synced before oldest), so re-running the same
job automatically picks up the unfinished tail; already-current companies are
skipped with a cheap DB-only check. A 1.2 s pause between companies
(fair-access pacing for free endpoints), inserts in ≤500-row chunks. The
stream job tops up prices for its scope after the final cycle (withPrices=true
by default) — a daily scheduled stream doubles as the price-accumulation
driver.

**Overview: price block on top, our statistics below (user directive).** New
src/components/PriceOverview.tsx: quote header (price, daily change, "as of
… · source · end-of-day"), a chart with range chips 1M/3M/6M/YTD/1Y/5Y/ALL
(recharts Area), and a stats grid — everything computed FROM OUR OWN DATA:
prev close, open, day range, 52-week range, volume, avg volume (3M), market
cap = price × diluted shares (our series), EPS TTM and P/E TTM (Σ of the last
4 quarterly diluted EPS points from series), beta = 5-year monthly-return
regression against our SPY series. Bid/ask and analyst targets are not
available from free sources — deliberately absent, and the UI says so
explicitly. A line under the chart warns "FREE EOD DATA — NOT FOR REAL-TIME
EXECUTION". The empty state honestly points at the `prices` job. Intraday
ranges (1D/5D) are not in v1 — TODO.

### 4.10 Iteration 3g: bulk archive import (TEMPORARY CRUTCH)

**Why.** The cloud runtime cannot reach stooq.com / Yahoo at all
(UND_ERR_CONNECT_TIMEOUT on every request — the first production `prices` job
proved it). In the target Variant C design the home worker downloads Stooq's
daily bulk zip itself; until then the operator uploads the archive by hand.

**Chunked upload (D23).** Two hard limits shape the design: platform object
storage caps one file at 100 MB, and the Hono edge caps one request body at
50 MB — while d_us_txt.zip is ~516 MB. So the browser slices the zip into
32 MB parts and POSTs them sequentially to `POST /api/prices-import/chunk`
(raw Hono route, admin-only — storage is billed to the owner). Each part is
stored as `prices-import/<batch>/part-NNNN.bin`; the batch id is a
client-generated UUID. Parts are kept in storage afterwards as the sample
archive (user directive).

**Streaming import.** The `prices` job with `mode:"import"`
(api/services/price-import.ts) lists the batch's parts, streams them in order
through ONE `unzipper.Parse({forceStream:true})` pipeline (concatenated parts
reconstitute the original zip — no part ever lands on disk or in memory
whole), maps each entry path to a ticker (`…/aapl.us.txt` → AAPL, dash↔dot
class-share spelling), and imports ONLY the universe tickers + the SPY
benchmark (cik=0). Every other entry is autodrained. Metastock CSV quirks
handled: header row skipped, halted days with empty close dropped (the unit
tests caught `Number("") === 0` silently becoming a zero-price bar — empty
fields are now parsed as null), adjClose = close (Stooq daily is
pre-adjusted). Bars upsert under source='stooq', so the import idempotently
merges with API-synced data. Missing universe tickers are logged as warnings
(delisting/spelling review).

**TODO (explicit crutch markers):** when storage is no longer constrained,
re-upload a fresh archive and import the FULL US history — the pipeline
already supports it, the wanted-set is just a membership check; the home
worker will eventually replace the manual upload entirely.

**UI.** Admin → Tools → "Bulk price archive import" card: pick the zip,
sequential chunked upload with part/MB progress, then "Start import" launches
the job (watch it on the Jobs page). QA: unit tests for the Metastock parser
and ticker mapping; E2E — a synthetic zip split into two raw halves uploaded
through the real endpoint, imported via tRPC, verified in DB and via
prices.history, then cleaned up; browser QA of the card itself.

### 4.11 Iteration 3h: full code-review fixes

An overnight review pass over the whole codebase. Found and fixed immediately:

1. **Overview stat windows anchor to the last bar, not wall-clock now**
   (prices.ts avgVolume/week52). Archive-imported history ages between syncs;
   a today-anchored "52-week" window would silently shrink and eventually
   return null despite a full history. The window now ends at the last
   stored bar's date.
2. **Streaming-import deadlock** (price-import.ts): if a part fetch failed,
   the zip consumer waited for the next entry forever. The feeder now
   destroys the combined stream on error (+ unhandled-rejection guard for
   the opposite failure order).
3. **Statements YoY matches periods by calendar, not index offset**
   (statements.ts). A quarter that falls out of the grid (density threshold
   ≥8 points) shifted "i+4" two years back. Periods now match by quarter
   index / fiscal year; a regression test with a grid hole is included.
4. **Price-sync pacing only on real network hits** (runner.ts): already
   current companies are skipped with a DB-only check and no longer burn the
   1.2 s fair-access pause — a full run over a current universe stops wasting
   ~10 minutes.
5. **The job watcher catches fast jobs** (AppLayout.tsx): a job that started
   and finished inside one 5 s poll used to complete silently (no toast, no
   cache refresh). A terminal status on first appearance is now reported too
   (the mount snapshot still suppresses history).
6. **Smaller items**: upsertBars refreshes fetchedAt on conflict (lineage
   honesty); the import job now reports a real total (matched/total progress
   bar).

Tests: 63/63 (+4 regression).

### 4.12 Iteration 3h-2: job queue and review follow-ups (D24)

The full "found but untouched" block, implemented per the owner's decision:

1. **Global FIFO job queue (D24).** Exactly one job executes at a time: the
   row is created in status queued and appended to the drainChain, which
   drains in creation order. Rationale: concurrent runs raced on the same
   tables and double-hit SEC against fair-access discipline; and
   one-at-a-time is exactly the future home worker's semantics. Queued jobs
   are cancellable: requestCancel flips a queued row straight to cancelled
   and the drain skips it; the UI offers cancel for queued jobs too.
2. **Per-source incremental cursor for prices.** Each provider resumes from
   ITS OWN MAX(date): fresher Yahoo bars no longer mask a Stooq gap. The
   fetchDailyBars facade is removed — fallback lives directly in
   syncCompanyPrices, where the cursor and the fallback decision are
   inseparable.
3. **getBars merges sources per date** (stooq wins conflicts, yahoo fills
   missing dates) — one stale stooq bar no longer hides a fresh yahoo
   series. The pure mergeBars is extracted and unit-tested.
4. **Pairwise tone_delta is like-with-like** (score.ts pickPriorSameForm):
   the prior MD&A must share the same base form (10-K↔10-K, 10-Q↔10-Q,
   /A amendments count as the base form); no pair → honest non-pairwise
   scoring. Annual framing is never compared against quarterly again.
5. **FCF = null when capex is missing** (statements.ts): it used to degrade
   silently to bare CFO — optimistic. Honesty over coverage.
6. **Smaller items:** price-chart X-axis format follows the range (1M/3M —
   MM-DD, ALL — year); LogConsole keeps afterId in state (the query key is
   honestly incremental — the server returns only new rows instead of the
   first 500 every 2 s); cancel button for queued jobs.

QA: 72/72 tests (+9), tsc clean; live queue QA (t_3h_queue.mts): three real
jobs — serialization confirmed by status polling, a queued cancel never
starts the job (startedAt NULL), test rows cleaned up.

### 4.13 Iteration 3i: orphaned jobs and honest cancel (D25)

Production symptom: jobs left in status running after a process restart
(redeploy) hung forever, and the cancel button "silently did nothing" —
requestCancel only touched live in-memory flags of the current process and
never modified orphaned rows.

1. **requestCancel returns an honest result** (CancelAction): "flagged" (a
   live job OF THIS PROCESS — stops at its next checkpoint),
   "force-cancelled" (queued or orphan with no live executor — the row is
   flipped to cancelled immediately, message "no live executor (orphan of a
   restarted worker)"), "not-cancellable" (already terminal / unknown). The
   jobs.cancel router returns the action; the UI toasts it.
2. **Orphan sweep at worker start** (boot.ts): every running/queued row
   belongs to a dead process (executors are in-process and never survive a
   restart; the deployment is single-instance by design) — marked error with
   an honest message instead of an eternal "RUNNING". The QA run
   (t_3i_cancel.mts, 9/9) also cleaned the user's two real stuck production
   rows — the database is shared.

Tests: 72/72 + live QA 9/9.

### 4.14 Iteration 3k: adaptive multi-file archive upload (D26)

The production attempt proved it: the platform edge rejects a 32 MB body
with HTTP 413 before our code runs — the iPad was never the problem. The
upload design was reworked (owner's directive: "I'll split by 32 MB, make
batch zip loading"):

1. **Multi-file selection**: pick all pre-split parts at once
   (`split -b 32m` / 7-Zip volumes .001/.002) or the whole zip — files are
   name-numerically sorted and treated as one byte stream.
2. **Adaptive slicing**: each file is cut into pieces starting at 8 MB; on a
   413 the piece size halves GLOBALLY (8→4→2→1 MB) and the batch restarts
   under a new id (indices are positional — the size must be uniform).
   5xx and network failures get 3 backoff retries.
3. **Resume**: batch id + piece size + file list persist in localStorage;
   after a crash/reload the owner re-selects the same files and stored parts
   are skipped via the server-side listing `GET /api/prices-import/parts`
   (admin-only, the single source of truth — storage keys carry a random
   suffix, parsed via partIndexFromKey).
4. Reset does NOT delete parts from storage (sample-archive directive).

QA: 74/74 tests (+2 for partIndexFromKey); browser QA (t_3k_ui.mts, 8/8):
two-zip-half multi-select, upload, part listing, resume banner after reload,
instant completion (231 ms — all parts skipped), cleanup.

### 4.15 Iteration 3l: direct file load + DB cache for external data (D27)

**Direct price-file load (owner's directive — maximum simplification).**
Instead of the zip archive: five `*.us.txt` files loaded directly through
the same Metastock parser and upsert (source='stooq'): AAPL 10 604 bars
(since 1984), NVDA 6 971, PLD 7 829, T 10 639 — all through 2026-10-09. The
zip machinery (3g/3k) stays untouched for the future full import.

**Universe removal = display only (owner's decision).** The inUniverse
switch remains the only mechanism: a company's data (facts, series,
documents, scores, prices) stays in the DB forever, so any user may toggle
it. The UI label says so honestly.

**DB cache for external data (D27).** The "fetch once → store in DB →
nobody waits for a refetch" principle: the Universe page used to hit
Wikipedia (index constituents) and SEC (the 12k-row company directory) on
every cold process — after each deploy the first user paid seconds. New
`external_cache` table (DDL 006) + services/ext-cache.ts with
stale-while-revalidate semantics: fresh rows serve from the DB; stale rows
serve instantly while a background refresh runs; a miss is the only path
paying live latency; a failed refresh never breaks reads (stale keeps
serving). Wired into the SEC directory (24 h TTL) and index constituents
(72 h TTL). QA: 77/77 + live cache run 6/6.

### 4.16 Iteration 4a: Screener + earnings events from 8-K Item 2.02 (D28)

**Screener (/screener page, in the nav).** The universe-wide metrics table —
the daily working surface: price, daily change, market cap, P/E TTM, EPS TTM,
FCF margin TTM ((CFO−capex)/revenue over the last 4 quarterly series
points), 5Y beta vs our SPY, 52-week-range position, avg volume 3M, revision
rate (our reporting-quality factor), sentiment (latest llm-pair average,
prototype). Everything is computed from our own tables (D22); the payload is
cached in external_cache (D27, 20 h TTL, stale-while-revalidate) and rebuilt
in the background after any job that changes its inputs (bootstrap / filings
/ stream / series / score / prices — screenerRefreshInBackground in the
runner). Sortable by any column, filter, ticker click-through to the company
page; an admin Rebuild button forces recomputation. TODO at S&P scale:
SQL-aggregate precompute instead of per-company loops.

**Earnings events (D28).** filings gained an items column (DDL 007) — the
item list from the SEC submissions API; the stream fills items for caught
8-Ks immediately (one submissions call per company per new 8-K). New
`events` table + services/events.ts: an 8-K carrying Item 2.02 (token match
— "12.02" does NOT false-positive) is an earnings event; eventDate =
reportDate ?? filingDate; filingDate is the public timestamp (no-lookahead
out of the box). Rebuild is a cheap DB-only scan, automatic at the end of
bootstrap/filings/stream; idempotent via explicit existence checks (mysql2
CLIENT_FOUND_ROWS counted no-op duplicates as new — caught by QA). UI: amber
dashed markers on the company price chart + events.byCompany / events.recent
in the API. On prod, run a filings index refresh over the universe to fill
items — events build themselves.

QA: 88/88 (+11), live run 8/8 (synthetic 8-Ks → events → cleanup), UI QA
5/5 with screenshots (screener with live metrics, markers on the AAPL
chart).

### 4.17 Iteration 4b: universe removal (view-level) + action audit (D29)

**Task (owner's brief, verbatim intent).** Inactive companies in the Universe
table get a trash can: remove them from the selection entirely; the DB is
shared, company data is never touched; the action is logged with meta
(who/what/when); the table refreshes without a page reload; a jobToast-style
toast confirms the operation. Plus a full project code review (findings
handed to the owner as a list).

**Implementation (D29).** `companies += removedAt, removedBy` (DDL 008):
removal is GLOBAL view-level state (NOT a per-user table and NOT
localStorage — owner: "just remove from the universe, the DB is shared, the
companies' state stays untouched"; a per-user layer is deliberately deferred
until real non-owner users exist). `universe.remove` requires
`inUniverse=false` (CONFLICT otherwise — the trash can exists only on
inactive rows; the two semantics never mix) and is idempotent (repeat →
already:true). `universe.list` hides removed rows by default; a non-empty
search surfaces them (dimmed, REMOVED badge, removedByName via a users join)
— restore lives only there (owner's pick) and returns the company as
INACTIVE (inUniverse untouched — the exact pre-removal state). Re-ingesting
the ticker auto-clears the removal (upsert nulls removedAt/removedBy): an
explicit ingest is an unambiguous "I want this company".

**Audit.** Every action is a terminal MICRO-JOB: `jobs.type` extended
('universe-remove'/'universe-restore', DDL 008), startedBy = the actor, plus
a job_logs line with full meta (ticker, name, CIK, who, when, "data
untouched"). Written NOT via drainChain (recordUniverseAction in runner.ts):
a click must not queue behind a running bootstrap — this is a log record,
not pipeline work. The AppLayout watcher skips these types: the mutation
toasts and invalidates universe.list itself — otherwise the actor gets a
double toast and admins (who see all queues) get spam. jobs.list scoping as
usual: users see their own actions, admins see all; full text in Admin →
Logs.

**UI.** Trash2 next to the switch on inactive rows only; a removed row =
REMOVED badge + RotateCcw; jobToast (8s ring) on remove and restore with the
micro-job number; React Query invalidation — the table refreshes in place;
the table search gained a 300 ms debounce (review fix); the legend under the
table documents 🗑; describeJob knows both types.

QA: t_4b_removal.mts — live round-trip on prod (GOOGL: hide → micro-job
#6270001 → search-surface → restore → micro-job #6270002), the company left
in its original state, audit rows kept in jobs/job_logs; 88/88 unit tests.
Review noted: `npm run check` (tsc) is not part of the build — 5 files carry
pre-existing type errors (screener/sections/score/statements +
Statements.tsx); fixes deferred by owner decision.

> ⚠️ D29 SUPERSEDED in 4c (D30): the global view-level flag was replaced by
> per-user universes — see §4.18. Kept from 4b: the micro-job audit pattern,
> the watcher skip, the debounced search.

### 4.18 Iteration 4c: per-user universes, permission split, chat (D30–D32)

**Model (owner's framing).** An informational trading terminal in the spirit
of Ameritrade/Robinhood but on a quarterly horizon: **each user builds their
own world and company selection**, while the data lives in the shared DB.
Users are read-only over shared data (Yahoo-Finance-like personal watchlist);
only the admin mutates/deletes shared data, and only from hidden surfaces
(Admin in the sidebar).

**Per-user universe (D30).** New table `user_universe(userId, cik, ticker,
name, active, createdAt, updatedAt)`, UQ(userId, cik) — ticker/name are
denormalized so a row displays before its auto-ingest finishes. The Universe
table lists only the viewer's memberships (LEFT JOIN companies). The switch
= active (my view only); the trash can = deletion of MY row; re-adding via
the Add box creates a fresh ACTIVE row — exactly like a brand-new company
(upsert; the 4b REMOVED state and restore flow no longer exist). The columns
`companies.inUniverse/removedAt/removedBy` left the code but stay untouched
in the DB (never-delete rule). Migration: all 8 existing users were seeded
from the legacy global state (5 active + 3 inactive each — they were sharing
it); new users start EMPTY.

**Permission split (D31).** A user can: read data, manage their own universe
(add/hide/remove), chat with the admin. Adding a ticker absent from the
shared registry automatically queues a light ingest (single-ticker
bootstrap, startedBy = the user, server-side inside universe.add — the one
sanctioned user-triggered write). All job launchers are adminQuery
(bootstrap / filings / stream / harvest / series / sections / score /
prices); jobs.cancel for non-admins is restricted to their own jobs (the
"cancel anyone by id" hole is closed). UI: the Jobs launcher, Dashboard
buttons, Scope Builder, Bootstrap S&P 500 and GICS are admin-only.

**Per-user scope and surfaces.** resolveScope("universe", …, userId) → the
launcher's active memberships (the runner threads jobs.startedBy; legacy
NULL → the admin's universe). Presets are per-user (`scope_preset:u<id>:`).
The screener shows the viewer's universe: external_cache key
`screener:u<userId>`; the post-job background refresh loops
usersWithUniverse(); membership mutations delete the caller's key (the next
read recomputes). dashboard.stats.universe = my active count (+ queuedJobs
added — review fix: the IDLE led no longer lies with a pending queue);
latestFilings and events.recent filter to my active selection; the
price-import wanted set = the union of ALL users' active memberships (shared
accumulation serves everyone). A company whose ingest is pending shows an
INGESTING badge.

**Admin ↔ user chat (D32).** Table `messages(threadUserId, authorId,
isAdminMsg, body ≤2000, createdAt, readAt)` — one private thread per user
with the admin (support-chat, messenger-style). Page /messages: the user
gets their conversation; the admin gets a thread list (preview, unread
counts) + conversation pane. 8 s polling (the app's style, no websockets),
markRead on view, sidebar unread badge + a toast when the count grows while
elsewhere. The motivating flow: "company not covered yet — request an
update".

**Audit.** The 4b micro-job logging is kept: universe-add / universe-remove
with who/what/when meta; jobs.type extended by DDL 009 ('universe-restore'
deprecated). describeJob knows all types.

QA: t_4c_qa.mts — synthetic user 999999: add/hide/remove/re-add, isolation
vs the admin, legacy fallback to the admin's universe, per-user screener over
shared prices, chat unread/markRead, audit lines; synthetic rows cleaned,
logs kept. 88/88 unit tests; tsc clean (except the 4 known pre-existing
sites; the screener.ts error was fixed along the way — name ?? ticker).

### 4.19 Iteration 4d: local username/password auth (D33)

**Background.** The owner deleted the alphadelta.kimi.pro domain; the
platform refuses to re-issue it, and the site moved to
**alphadelta-2.kimi.pro**. The "Alpha Engine" OAuth app is still registered
with the OLD domain's callback (proven by probing the token endpoint: old
URI → invalid_grant, new URI → invalid_request "Invalid redirect_uri") — so
Kimi login is dead on the new domain. Owner's order: "replace the auth
method with login and password… Kimi auth won't be needed after release".

**Implementation (D33).** `users += username (unique), passwordHash`
(DDL 010). Hashing: scrypt (N=16384, r=8, p=1) via node:crypto — no new
dependencies; PHC string `scrypt$N$r$p$salt$key`, timingSafeEqual verify
(services/passwords.ts). Sessions reuse the Kimi machinery (the same HS256
JWT cookie; signSessionToken is imported from read-only api/kimi —
authedQuery/adminQuery/useAuth/AuthLayout are unchanged; QA proved the
cookie → authenticateRequest chain for local accounts). Local accounts get
unionId = `local:<username>`.

**Hardening.** Generic error texts (no user-existence oracle);
login-guard.ts: captcha after 3 failures, a 10-minute lock after 5
(10-minute window, ip+username key), signup throttle 5/hour/IP; a
self-contained SVG math captcha (one-shot, 5-minute TTL, answers stored as
SHA-256 — services/captcha.ts; no external provider, no keys); signup
policy: username 3–32 [a-z0-9_], password min 8 + letter + digit, the role
is always "user" (no escalation path by construction). Admin-chosen
passwords skip the policy (owner's prerogative). Counters live in process
memory (single-instance deployment, D25): a restart resets them — documented
honestly.

**Accounts (owner's directives).** admin/9999 is attached to the owner's
existing row (id=1; universe and job history preserved); user/1111 is a demo
role=user with an empty universe (4c); the other 8 Kimi-era accounts were
deleted together with their memberships and message threads (shared data
untouched; their past jobs remain as audit rows with a dangling startedBy →
the UI renders "user <id>").

**UI.** /login — username/password form, the captcha appears when the server
escalates; /signup — a new public page (always captcha'd, password policy in
the UI, links both ways). Admin → Users tab: list with universe sizes,
account creation, deletion (not yourself; cascade covers only per-user
artifacts), password reset, role change (not yourself).

QA: t_4d_auth.mts (admin/user password verification, the session chain
through the production guard, a CRUD round-trip create→reset→promote→
delete); unit tests 97/97 (+9 auth: scrypt, policies, one-shot captcha,
guard escalation).

**Incident + hotfix (same night).** The first login on the new domain failed
with "Failed query: select … from users" — the platform had provisioned a
NEW EMPTY database for the alphadelta-2 deployment (the database name is a
per-site UUID: the old `1a11d1cf-…` holds the data, the new `1a141806-…`
was empty; both are reachable from the sandbox with the same cluster
credentials). t_4d_migrate_db.mts cloned structure + data old → new (18
tables, counts verified, AUTO_INCREMENT set explicitly); admin/9999 and
user/1111 then logged in on prod and dashboard.stats returned real numbers.
In 4e the owner confirmed the NEW DB as canonical (.env repointed, old
tables dropped — "no old copies").

### 4.20 Iteration 4e: messenger contacts, activity tracking, view-as (D34–D36)

**Contacts and DMs between any users (D34).** The chat model generalizes:
messages gained convKey (`<minId>_<maxId>` of the pair) and recipientId
(DDL 011; threadUserId/isAdminMsg deprecated, 0 rows at rework). /messages
is a classic messenger: contacts on the left (all users, admins first;
name/username search; unread badge; "seen …"), conversation on the right.
Users can write the admin AND each other; the admin can initiate with anyone
and read any thread (oversight — honestly disclosed in the UI).

**Activity collection (D35).** Table activity_events(userId, type
login|signup|page, path, ip, createdAt): logins/signups are written in the
auth router, page views by a client tracker in AppLayout (60 s per-path
dedupe). The admin's per-user info summary (admin.userSummary): universe
size, messages, jobs, logins (7d), pages (24h), last login/seen + the latest
100 events log (admin.userActivity). In the messenger the admin gets an info
button per contact with this summary.

**View-as lens (D36) — the "backdoor" full view of what a user sees.**
Admin → Users → Eye button: localStorage alpha.viewAs + the x-view-as header
on every call (providers/trpc.tsx); context.ts honors it only from an admin;
read endpoints resolve per-user data via effectiveUserId (universe,
dashboard, screener, events, scope preview, the user's job queue). Writes
REFUSE in lens mode (PRECONDITION_FAILED — the lens never writes as the
user). Amber "Viewing as … read-only" banner + Exit in AppLayout.

QA: t_4e.mts (DM round-trip, unread/markRead, contacts, activity summary,
effectiveUserId, cascade cleanup), 97/97 unit tests.

### 4.21 Iteration 4f: data integrity + Statements/price UI (D37, D38)

From the owner's review (AAPL Fundamentals/Overview screenshots). Forensics
exposed two systemic defects:

**1. The AAPL facts wipe (2026-10-12 incident).** A cancelled bootstrap
deleted every raw AAPL fact: the runner did DELETE by cik, then chunked
inserts with cancel checks BETWEEN them — the cancel landed in the gap. Now
(`replaceCompanyFacts`): an empty SEC payload = anomaly → keep existing rows
+ warn; wipe+refill is ONE transaction; cancel is checked BEFORE the wipe,
never inside. AAPL re-ingested (25,135 rows, t_4f_repair.mts).

**2. Dead Q4 derivation.** The FY−9M pairing matched rows by END date — FY
and 9M rows never share one; prod carried 0 derived rows. Rewritten as a
generalized YTD-pair derivation `deriveQuarterFromYtd` (shared fiscal-year
start, ~one-quarter span guard, reported wins; pure + tested) + adjacency by
OBSERVED quarter ends instead of calendar arithmetic (calendar quarterIndex
collapses month-crossing fiscal quarters: AAPL FY23 Q3 ends 2023-07-01 and
Q4 ends 2023-09-30 — both calendar Q3). Full rebuild: 1.2–5.7k derived_ytd
points per company; reality check: AAPL revenue Q4 FY23 $89.5B / FY24
$94.93B / FY25 $102.47B — exact. DDL 012: derivation += 'derived_ytd'.

**Statements (D37, "enrich, don't scatter" directive).** Per-cell merge of
candidate concepts (alternate tags of one line feed one series; lineage via
usedConcepts); interest-expense fallbacks (InterestExpenseNonoperating
et al.); the honest `staleSince` marker ("tag ended 2023-07" — AAPL truly
stopped tagging interest expense in 2023, not a data hole); revision counter
→ honest vintage notes ("no revisions in this window" when first = latest);
grid windows 20 quarters / 10 years (data reaches 2008); health triangles
and partial asterisks moved behind a DEBUG toggle (owner: "перебор").
Pre-existing statements.ts ("x" unit) and Statements.tsx errors fixed along
the way.

**Price block (D38).** Header: "day change · last close vs prev close · as
of <date> · EOD". The chart card shows the selected window's Δabs/Δ% + hi/lo
(computed in the browser from the shipped bars — the answer to the owner's
1b: on the fly, no tables). A recharts Brush selects an arbitrary sub-range
→ the stats strip switches to SELECTION mode (1c).

QA: t_4f_repair.mts + a prod probe via the admin session (FQ4 cells populate
on live data before the code publish), 102/102 unit tests (+5 derivation).

### 4.22 Iteration 4g: mobile layout (D39)

Owner's directive: "completely unusable on the phone". No new dependencies:
- **Navigation**: the fixed sidebar lives only at ≥md; below — a hamburger in
  the header and a slide-over drawer with a backdrop (closes on navigation);
  one shared nav renderer for both.
- **min-w-0 on the main column** — the classic flexbox trap: a flex item
  refuses to shrink below its content width, so the Universe table pushed the
  whole page 456px sideways; now wide tables (Universe/Database/Admin Users)
  scroll INSIDE their panels (overflow-x-auto + min-w).
- **Messages** — single-pane on phones: contacts ⇄ thread with a back
  button; the admin info panel goes full-width.
- Details: the Universe toolbar button group wraps; the company series
  select is full-width on xs; body overflow-x:hidden + tap highlight off;
  the UTC clock hides on xs.

**P0 QA find (along the way):** auth.me returned the full users row incl.
passwordHash — now sanitized to profile fields only.

QA: t_4g_mobile.mts — the production build booted locally, iPhone 390×844
via playwright: zero page overflow, drawer opens, tables scroll inside
panels, Messages single-pane (screenshots /tmp/4g-*). Recorded traps: React
#310 — hooks after the isLoading early-return crash the whole tree; with
React Query pollers playwright must wait on commit/selectors — networkidle
never fires.

### 4.23 Iteration 4h: deferred leftovers + documentation actuality (D40)

On the owner's "finish the leftovers, re-check the docs":

- **tsc fully clean** (first time): score.ts was a real bug, not a type —
  the pairwise prior read prior.doc instead of prior.row.doc → priorText
  silently null → pairwise quietly degraded to non-pairwise; sections.ts —
  unused fallbackLabels (the signal is already covered by toc_fallback).
- Job watcher window 20 → 30 (parity with the Jobs page — transitions beyond
  the window were silently skipped).
- Screener sentiment "latest pair": the lexicographic max(CONCAT) would
  break at v10 — now MAX(id) (insertion = chronology).
- Universe: toast on the hide switch (in Active-only mode a row used to
  vanish silently); Jobs: the cancel control is a real <button> (a11y).
- package.json "my-app" → "alpha-engine"; --ok/--crit token normalization.
- **The 4a PROD TODO closed:** filings.items backfill across all companies
  (t_4h_events_backfill.mts) + events rebuild — 528 itemized 8-Ks, 163 new
  earnings events (178 total); the chart markers are now complete.
- **Documentation actualized:** §5 "Cloud panel" rewritten to today's state
  (local auth, per-user universe, Messages, Admin→Users, view-as, mobile
  drawer, debug toggle, Brush); §8 limitations refreshed (domain, DB fork
  closed, in-memory rate limits); LLM_CONTEXT pages line.

### 4.24 Iteration 4i: factor library + intrinsic value (D41)

Per the owner's plan: design → schemas → code → tests. The design memo
`docs/DESIGN_VALUE_SIGNALS.md` (EN) pins D41–D43 and the worker debt list;
it reads in Admin → Manuals (the registry grew to 4 documents).

**Factors (api/services/factors.ts)** — all from our own tables (series +
prices + events), pure functions + tests: Sloan accruals, Novy-Marx gross
profitability, Cooper asset growth, buyback yield, momentum 12-2, 52w-high
proximity, time-series SUE, Piotroski F-score (9 signals with checklist),
Altman Z, Beneish M (pairs with our revision metrics, D7). Honest nulls over
invented numbers.

**Intrinsic value (api/services/valuation.ts)** — no point "fair prices":
reverse-DCF implied growth (bisection; the market's expectation read vs our
historical FCF CAGR), residual income (EBO/Ohlson) bear/base/bull range,
Greenwald EPV floor, V/P (Frankel–Lee), P/E z-score vs own history.
WACC = rf 4% + β·ERP 5% (constants until FRED).

**UI:** company page → new VALUE tab (between Fundamentals and Documents).
Endpoints company.factors / company.value with a 20h external_cache per cik.
Processing scoped to 2–3 companies (owner's credit discipline); batch
materialization is worker-deferred.

**Schemas for the worker (empty, DDL 013/014):** `signals` (feature store
with eventTs + ingestedAt — backtests read ingestedAt ≤ T; backfills marked
src='backfill') and `insider_trades` (Form 4: P/S/A/M/F/G codes, 10b5-1
flag, filingDate as the point-in-time anchor).

QA on the live DB (t_4i_value.mts): AAPL — accruals −5%, GP/A 0.59, F 6/9,
Z 13.3, Beneish −2.57 (clean), implied growth 23% vs FCF CAGR 10% ("the
market asks more than history delivers"), RIM base $1.91T vs market cap
$4.95T (V/P 0.39); PLD — honest nulls (a REIT without the GrossProfit tag).
119/119 unit tests (+17), tsc zero.

### 4.25 Iteration 4j: readable factors + the three-company full cycle (D44)

From the owner's Value-tab review:

**Explainability.** api/services/factor-meta.ts — the factor registry: a
short hint in a touch-friendly popover (radix Popover — tap opens, works on
iPad/iPhone), a long wiki entry on the new **/wiki** page (logic, formula,
academic anchor with link, Wikipedia, our data lineage), the reference read
(a literature threshold OR the company's own robust history — median + IQR
band, gap/extreme-proof; sector medians are a finals-phase TODO at full
registry), and the up/down/neutral signal rule. factors.ts now returns
per-factor histories + robustBand; ValuePanel rebuilt on FactorCard
(FAVORABLE/ADVERSE/NEUTRAL chips).

**The AAPL/NVDA/PLD full cycle — now, from the sandbox** (the owner evaluates
the complete picture): NVDA brought to parity (document harvest + sections +
scoring: 44,487 tokens — its Sentiment tab appeared); Form 4 insiders loaded
for all three (AAPL 74, NVDA 61, PLD 11 trades; NVDA shows 15 10b5-1 flags;
the filename-varies-by-agent bug — Workiva files `wk-form4a_…`, not
`form4.xml` — found and fixed via -index.htm resolution); the company
Overview gained the **Insider activity** panel (recent Form 4s + the NET 90d
open-market line; grants/exercises/tax excluded from the net per
Cohen–Malloy–Pomorski discipline).

**Signals — the honest network note:** the signals store + company.signals
endpoint + the conditional Signals tab ship; the collectors
(api/services/signals.ts, insiders.ts — the worker's code path) — but
datacenter egress hard-429s GDELT, Stocktwits 403s, GNews/Reddit unreachable
⇒ collectors live on the home worker (residential IP); parsers are covered
by fixture tests.

**Honest token bill (DISTINCT per section):** AAPL 46.9k (4 sections), NVDA
44.5k (3), PLD 65.9k (3) → ~12–22k tokens per pairwise MD&A section,
~45–66k per company per scoring pass.

123/123 unit tests (+4 collector fixtures), tsc zero.

### 4.26 Iteration 4k: the home worker's ingest endpoint (D45)

After the network-blockade review, the owner's call: signal collectors live
on the home machine (residential IP), and they write NOT into the DB directly
(our DB sits behind a privatelink host — a home machine can never route to
it) but into the app over HTTP — exactly what D6 envisioned.

**Server side.** `POST /api/worker/ingest` (a raw Hono route in boot.ts —
worker payloads are not superjson). Auth: `Authorization: Bearer <key>` →
the key's SHA-256 is looked up in `worker_keys` (the table iteration 2
announced but never created — found absent in prod, honestly created by DDL
015; we store the hash only, track lastUsedAt, revokedAt kills). Body:
`{kind:"signals", rows:[…]}` ≤500 rows (the packet rule), row-by-row zod
validation with an honest per-index report. **ingestedAt is stamped by the
SERVER at receipt** — the no-lookahead anchor never comes from the client
(D43). INSERT IGNORE on the UQ key — redeliveries are free; the response
reports {accepted, skippedDupes}.

**Client side.** `alpha_engine/worker/` — the Python worker template
(worker.py: a GDELT collector driven by a company config;
config.example.json; README with cron/launchd; requests as the only
dependency). Its parsing mirrors api/services/signals.ts — the contract
owner (comments reference it). Idempotency, GDELT pacing 5.5 s, ≤500-row
batches.

QA: t_4k_worker.mts on the live DB — key minting, garbage/missing-key
rejection, validation (bad date, >500 rows), redelivery idempotency,
server-stamped ingestedAt, key revocation; full cleanup. 123/123 unit tests,
tsc zero.

### 4.27 Iteration 4l: Value-tab hotfix (the cache-version lesson)

Prod symptom: clicking Value crashed the whole page (empty tree, background
only). Root cause: 4j changed the cached `factors:<cik>` payload shape (added
`detail`) WITHOUT invalidating the 20h external_cache — the new frontend read
`fac.detail[k]` on yesterday's payload → TypeError → React unmounted the
tree. Fixed at both layers: the server detects the stale shape (no `detail`)
and rebuilds the key synchronously on read; the UI reads `fac.detail?.[k]`
defensively; stale rows purged (t_4l_purge_cache.mts). **Durable rule:**
changing a cached payload's shape requires a key bump or a shape check — the
cache outlives the code that wrote it. QA: t_4l_value_tab.mts (prod build,
playwright clicks VALUE → renders, zero page errors).

### 4.28 Iteration 4m: short interest + insider clusters + FRED (D46)

The owner took items 1+2+3 at once (close track 2, the Stage 4 entry, worker
extension; leftovers tracked carefully in the debt lists):

**Short interest (track 2 closed).** The `short_interest` table (DDL 016,
settlement-dated rows); the honest source rank: yahoo_gw (Yahoo via the agent
gateway — works from the sandbox; carries the settlement date + prior month
— one pull = two honest points) now, FINRA biweekly as the official primary
for the worker later. AAPL: 0.83% of float, DTC 2.82. The company Overview
gained the Short interest panel (% float, days-to-cover, Δ vs prior). Bug
found and fixed: a naive comma split broke on quoted CSV fields
(longBusinessSummary) — splitCsvRow (quote-aware) with a test.

**Insider clusters (events.ts).** detectInsiderClusters — pure and tested:
≥3 DISTINCT insiders, open-market purchases only (P), 10b5-1 excluded, 30d
sliding window, filingDate = max filed = the point-in-time anchor; a
synthetic key cluster:<cik>:<endDate> for idempotency. Zero fired for the
current trio (honest: mega-caps see no open-market purchases for years; the
detector is proven by tests and fires as coverage grows); rebuildAllEvents
covers insider companies too. Markers ride the existing events pipeline onto
the charts.

**FRED — the Stage 4 seed.** The `macro_points` table (DDL 017; realtimeStart/
End windows ride every row — D2 discipline for macro) + macro.ts + the
"Macro — Stage 4 seed (FRED)" dashboard card. 8 series (DGS10/DGS2/T10Y2Y/
FEDFUNDS/CPIAUCSL/UNRATE/BAMLH0A0HYM2/VIXCLS), windows 2021→now + the deep
early windows from the first pass; the 2000-2021 middle pages in on the
worker (honest TODO). Via the igo plugin (agent-gw) — free and available now.

**Worker template** += GDELT `--backfill` mode (src='backfill', monthly
windows) + the README roadmap (Stocktwits/Reddit/YouTube-CC/SI-at-home).

130/130 unit tests (+7: clusters, SI/macro parsers), tsc zero.

### 4.29 Iteration 4n: quote-grid metric history charts (D47)

Owner's directive: "all continuous data marked — chart like prices on tile
click; maybe pre-calculate and store as a static table so display is
immediate". Exactly that:

- **metric_history** (DDL 018): cik, metric, month-end, value — pre-computed,
  read instantly. Metrics: volume (month mean), avgVolume3m (63 trading
  days), marketCap (close × shares as-of), epsTtm (trailing 4Q as-of),
  peTtm, beta5y (rolling 60-month OLS vs SPY, ≥24m).
- **Builder** api/services/metric-history.ts (pure helpers + tests) + a
  runner hook (rebuild after prices/series jobs) + the initial fill
  t_4n_metrics.mts across all 5 priced companies.
- **The split lesson (caught on the AAPL chart):** XBRL counts shares
  nominally at the time, our prices are split-adjusted — mixing them breaks
  market cap across every split. Fix = EXACT split maps (Yahoo stock actions
  via the gateway, cached as `splits:<cik>`) + applySplitMap with the
  sourceFiled guard (points FILED after the split are already restated —
  scaling them again double-counts; the AAPL FY19 artifact); EPS scales the
  opposite way (÷). normalizeShareSplits remains the no-map fallback.
- UI: stat tiles on the Overview are chart-icon buttons → a dialog charting
  the stored history (recharts), the method noted below. QA:
  t_4n_metric_chart.mts (playwright: Market cap click → dialog, 218 points,
  zero page errors).

Honest caveat: one 2014-05 point reads ~0 — pre-2005 basis artifacts at the
edge of 40-year history; documented, not fabricated away.

142/142 unit tests, tsc zero.

### 4.30 Iteration 4o: home worker pack #1 — GDELT + Stocktwits (D48)

**Context.** 4j/4k proved GDELT/Stocktwits/Reddit unreachable from datacenter IPs. Variant C: cloud = control plane + prod, home machine = collector worker + coding with Kimi Code. Data flows home→cloud only via `POST /api/worker/ingest` (Bearer key, zod validation, server-stamped ingestedAt, INSERT IGNORE).

**Built.**
- `worker/` — DB-free package: `gdelt.mts` (hourly ArtList volume + ToneChart weighted tone, 6s pacing), `stocktwits.mts` (30-message stream → buzz + bullish/bearish label; payloadKey = newest message id + count → natural dedupe), `lib/http.ts` (timeout + backoff, 4xx fatal), `lib/ingest.ts` (≤500-row chunks), `universe.json` (committed universe snapshot; regenerate via `scripts/export-worker-universe.mts`).
- Home dev environment from scratch: Node 24, MySQL 8 (local DB = read-only prod snapshot via mariadb-dump; users/worker_keys/logs excluded), local admin/user via `scripts/seed-local-users.mts`, Kimi Code CLI + VS Code extension.
- Bridge: GitHub repo sasgrom/alpha-engine, write deploy key for the cloud agent. Code flows home→cloud via git; data flows prod→home as snapshots only.
- Dev-server fix: the @hono/vite-dev-server exclude must list REAL file extensions — tRPC paths contain dots (`auth.login`), a generic `/\.\w+$/` misroutes them to Vite → empty response.
- 155/155 tests (13 new), tsc zero. Scheduling: Windows Task Scheduler (commands in worker/README.md).

### 4.31 Iteration 4p: Workers Console — local UI and intake monitor (D49)

**Problem.** Home workers were terminal-blind: no scheduler visibility, no logs, no intake stats, no GDELT throttling diagnostics.

**Solution — two halves.**
- Local `/workers` (admin-only, server-gated by LOCAL_WORKER_UI=1 — FORBIDDEN on prod; one worker at a time): run/kill gdelt / gdelt-backfill / stocktwits with from/to/only args, run registry (worker/.runs/registry.json), live log tail, Windows Task Scheduler status, GDELT probe (raw status+body — see 429 with eyes).
- Cloud `workersMonitor.intake` on `/admin` (prod and home alike): per-source rows (live/backfill, last event/receipt), worker_keys liveness, latest 10 rows — terminal-free delivery verification.
- Transport hardening: forced IPv4-first DNS (broken IPv6 egress hung fetch), 429 retryable with Retry-After, UA, 12s pacing, single-term GDELT queries (OR needs parens and gets throttled), --only diagnostic flag. 161/161 tests.

### 4.36 Iteration 5f: 13F — smart-money positions

A curated universe of 30 managers (worker/funds-13f.json; CIKs verified against the SEC cik-lookup file — the first full-text attempt returned Berkshire Energy instead of Berkshire Hathaway, hence mandatory verification), tiered activist/quant/fundamental/passive. Pipeline `scripts/13f-refresh.mts` (home, local-first): latest 13F-HR(/A) per quarter (amendments supersede originals) → XML information table → `fund_holdings` (DDL 022; only securities mapping to our companies) → CUSIP→company crosswalk via OpenFIGI cached in `cusip_map` → quarter-over-quarter deltas: new position / exit / ±30% (quant churn floor) as `source=13f, signalType=position` signals with DETERMINISTIC notes ("Citadel: +40% to 1.4M sh ($1.4B)") — no LLM anywhere. Honest 13F limits: 45-day post-quarter lag, US long positions only, passive giants are background, not signal. Same-day addition: **option positions** (titleOfClass PUT/CALL — hedges are visible right in the information table; UQ widened by class; score convention: PUT reads bearish, CALL bullish, but at HALF weight — a hedge is not a bet; deltas per cik:class so a put never blends with the stock) + cusip_map enriched with exchCode/secType for free from the same OpenFIGI response (anonymous limit 25/request, 100 with a key — OPENFIGI_API_KEY in .env).

### 4.35 Iteration 5e: Morning brief — the daily digest

Local script `scripts/daily-digest.mts` (home, scheduled): reads the last 36h of signals from the LOCAL database (edgar notes, crowd reads, labels, buzz), the local model writes a ≤250-word brief — one line per company with actual news + a closing "Tape:" mood line; SEC facts and crowd chatter must never blend into one claim (prompt rule). Input-heavy profile — exactly what makes the home GPU cheap (owner's 5c arithmetic). Delivery via the same ingest contract: new kind `digests`, `digests` table (DDL 020, upsert by (kind, forDate) — a redigest honestly refreshes), "Morning brief" card on the Dashboard. Local-first probation: with INGEST_URL set the brief lands locally for review; without it, straight to prod. Second digest kind (same day, from the owner's remark "the morning window is empty but the history is parsed"): **company-quarter briefs** — `--ticker NVDA --quarter 2026Q1` gathers all of the company's quarter signals and writes a quarter brief (tone, key figures, what to watch); DDL 021 added `scope` (ticker) to digests; shown as a collapsible "Quarterly briefs" card on the company's Signals tab.

### 4.37 Iteration 5f/5g: 13F — smart money, top-300 and context-rich events

Two layers: curated 30 funds (CIKs verified against the SEC cik-lookup) + an auto-built top-300 by AUM (EDGAR full-text search, ~8,200 filers). Tables `fund_holdings` (DDL 022/023: COM/PUT/CALL classes) and `fund_quarters` (FULL book total — % of fund must use it, else it inflates). Value scale autocalibration: median implied price >$5,000 ⇒ the filing reported dollars, not thousands (proven on Point72; other books violate the spec the same way). OpenFIGI with optional `OPENFIGI_API_KEY` (25/100 per request) + `cusip_map` with per-run ticker re-resolution (an empty local companies registry once cost a rebuild). `scripts/13f-refresh.mts` v2: batched inserts, disk-cached XML, idempotent seen-quarter guard; `--totals-only` (book-total backfill) and `--rebuild-events` (DB-only event regeneration). Events only for activist/quant/fundamental: new/exit/±30% per cik:class; deterministic notes with $, % of fund, % of company, held by N funds. Transport `ingest kind=holdings` + `push-local-signals --table fund_holdings` (own watermark). Prod after the full repair and synchronization: 875,860 positions, 300 funds, 371 companies, 3,372 fund_quarters with filingDate, and 16,422 events (all with notes). UI: Institutional card on the company page and "13F sector flows" on the Dashboard.

### 4.74 Iteration 5an: v1 EDGAR tone IC confirms a medium-term narrative signal

**Method.** `scripts/tone-ic.mts` uses production v1 signals (`source='edgar'`, `signalType='tone'`, non-null score), each filing's actual eventTs, per-company quarter means, 63/126-session excess forward returns versus SPY and 2,000 circular 4-quarter block bootstraps. Optional `--only AIG` limits the analysis to one company. This is backfill research mode and does not rely on ingestedAt.

**Result.** 63d weighted Spearman **+0.018 [-0.013,+0.048]** — not statistically robust. 126d **+0.077 [+0.050,+0.105]**, with 61.5% positive quarters, shows a modest positive signal with CI above zero. 2026 YTD at 126d is +0.162, but only 4 quarters, so no regime claim is made.

**Decision.** Keep v1 in production and do not create v5 merely for another iteration. Use tone as a slow narrative factor, not a short-term timing signal. Full suite: **309 tests**.

### 4.73 Iteration 5am: prompt v4 net investor effect and coverage discipline

**V4.** `tonePromptV4` requires evaluating the NET investor effect over the full section rather than isolated negative paragraphs. It adds turnaround/restructuring/asset-sale semantics: durable improvement/risk reduction is separated from remaining legacy exposure. Acquisition consideration and strategic control/earnings/fit cannot be erased by procedural presentation. Buybacks/dividends count only with sustainable cash generation. Historical events cannot dominate current results without an ongoing liability.

**Coverage discipline.** Score only on concrete investment-relevant substance: operations, guidance, cash flow, balance-sheet changes, direct economic risks or transaction terms. Definitions, glossary-only content, generic risk-factor boilerplate and procedural text return score 0 with `no substantive content`. This addresses the rise to 77 scored documents and over-scoring risk.

**Protocol.** Production keeps v1. Run `--prompt-version v4 --run-id aig-100-ollama-prompt-v4`, then `--report-only --compare-prompts --base-version v1 --candidate-version v4`. Any v1/v2/v3/v4 pair is supported. A unit test covers net effect, turnaround, acquisition and anti-over-scoring. Full suite: **309 tests**.

### 4.72 Iteration 5al: prompt v3 anti-pessimism calibration

**Rationale.** Raw v2 results on the 20 most divergent filings produced 50% direction agreement, 16/20 shifts more negative and mean score +0.136 → -0.133. Anti-optimism had overshot: v2 sometimes ignored acquisition benefits, turned one-off charges into long-term bearish signals and overwhelmed operating improvements.

**V3.** `tonePromptV3` keeps v2 evidence discipline and adds: one-off charges/impairments/litigation/reserve remeasurements are not recurring trends; a negative sign requires dominant deterioration in core operations, liquidity, balance sheet or guidance; risk factors and conservative language alone do not make a filing bearish; acquisition consideration is a direct benefit for target shareholders; buybacks/dividends count only with sustainable cash generation; historical events cannot dominate current results without a clear ongoing liability.

**Protocol.** Production keeps v1. `WindowResult.promptVersion` supports v1/v2/v3. `--base-version` and `--candidate-version` allow arbitrary pairs. Run `--prompt-version v3 --run-id aig-100-ollama-prompt-v3`, then `--report-only --compare-prompts --base-version v1 --candidate-version v3`. A unit test covers anti-pessimism rules and acquisition benefit. Full suite: **308 tests**.

### 4.71 Iteration 5ak: prompt v2 for EDGAR tone and an honest v1/v2 comparison

**Changes.** `tonePromptV2` adds ticker and form, a materiality rubric from -1 to +1 without forcing discrete outputs, an evidence hierarchy (operations/guidance → cash/liquidity/debt/reserves → capital allocation → procedural), a ban on automatic positivity from dividends/buybacks when fundamentals deteriorate, bans on invented fines/fraud/governance failures/future distress, invented dates/periods/companies and causal clichés. Procedural/reference-only content remains score 0 with `no substantive content`.

**Isolation.** Production keeps v1. `worker/edgar-tone-ab.mts --prompt-version v2` writes promptVersion into every result. `--compare-prompts` evaluates Ollama v1 vs Ollama v2 on identical prepared windows and adjusts report labels, without confusing this with Strata. Speed, parse/error/scored/skip metrics and the 20 largest divergences use the same format.

**Verification.** A unit test covers ticker/form context, the capital-return guard and anti-hallucination rules. Full suite: **307 tests**. Home protocol: run full v2 on 100 AIG documents, then `--report-only --compare-prompts` against the old baseline. If v2 degrades MAE, direction or coverage, v1 remains production.

### 4.70 Iteration 5aj: report-only regeneration without model calls

Added `--report-only` to `worker/edgar-tone-ab.mts`. It reads saved plan/results/sessions and rebuilds the summary/Markdown with no Ollama/Strata preflight, no warmup and zero inference requests. Useful for recovering a deleted report or changing its presentation. It works with both Ollama and Strata stopped.

Command: `npx tsx worker/edgar-tone-ab.mts --only AIG --limit 100 --report-only --run-id aig-100-qwen36-q4-v1`. A smoke test with both mock servers stopped confirms both engine metrics and matched scores persist with an unchanged manifest. Full suite remains **306 tests**.

### 4.69 Iteration 5ai: A/B report continuation preserves both engine summaries

**Defect.** The first real `aig-100-qwen36-q4-v1.report.md` contained 37 matched documents but zero Strata metrics/model/wall time/tokens. The summary only included engines from the current process. A later `--engines ollama` run therefore replaced valid historical Strata metrics with zeros.

**Fix.** Summary now always includes `REPORT_ENGINES = ["ollama","strata"]`, regardless of the engine currently running. Model ID falls back from the latest session to the latest result and then preflight. If a session file is missing, wall time is reconstructed from per-request `wallMs`. Documents, windows, tokens, prefill/decode/effective rates, parse/error/scored/skip counts are computed from the entire saved history, not just the current process.

**Verification.** A unit test pins both engine summaries. End-to-end smoke covers 2 documents × Ollama + Strata followed by a separate `--engines ollama` continuation: the second summary retains Strata model/documents/windows and matched scores, with an unchanged manifest. Full suite: **306 tests**. Repeating the continuation command regenerates a correct report without re-scoring completed windows.

### 4.68 Iteration 5ah: independent universe and macro-regime validation

**Independent universe.** The deterministic odd/even CIK split and leave-one-sector-out checks do not confirm that AssetGrowth is universal: full history is mostly negative or near zero. Final-holdout vol-target is +0.2% in the odd universe and -1.5% in even; Consumer Discretionary +2.5%, Health Care -3.1%, Information Technology -1.3%, Financials -0.5%. The signal is concentrated in particular names/sectors rather than being a general property of the panel.

**Macro regimes.** Thresholds are pre-registered: VIX <20 / 20–28 / >28; T10Y2Y inversion <0; HY OAS <4 / 4–6 / >6; SPY above/below 200DMA. Vol-target mean return is positive with CI in risk-on regimes: VIX low **+3.45% [+1.96%,+4.85%]**, normal curve **+2.90% [+1.51%,+4.27%]**, tight HY **+4.24% [+1.29%,+7.64%]**, SPY above200dma **+3.35% [+1.90%,+4.75%]**. VIX mid/high, curve inversion and SPY below200dma include zero. HY mid has only one observation and is not interpreted.

**Conclusion.** AssetGrowth is potentially regime-dependent, not universal. Volatility targeting reduces drawdown but does not rescue stress periods or independent sectors. Adding a regime gate on the same sample would be data snooping: an independent universe or period is required first. Full suite: **305 tests**.

### 4.67 Iteration 5ag: pre-registered volatility targeting and chronological holdout

**No fitted rule.** `applyVolTarget` uses only the trailing 4 quarterly strategy returns, a 5% quarterly volatility target and leverage clamped to 0.25–1.00 (gross <=100% across both legs). Leverage changes are included in turnover costs. The split is strictly chronological: 60% development, 20% validation, 20% final holdout, with no parameter selection on holdout.

**126 sessions.** Development maxDD falls from 74.4% to 25.4%. Validation remains negative for both variants (baseline -84.7%, vol-target -38.3%), so regime dependence persists. On final holdout, baseline loses 51.2% with 98.9% maxDD, while vol-target gains **200.8% with 31.7% maxDD and +5.40% mean return [+0.62%,+9.76%]**. Risk control survives holdout, but future return stability is not proven.

**63 sessions.** Validation improves from -40.6% to +25.1%; final-holdout return falls from +84.5% to +39.7%, while maxDD falls from 60.7% to 24.9%. This is the intended tradeoff: expected return may fall, but risk adaptation matters more than maximizing historical return.

**Conclusion.** AssetGrowth's risk profile improves, but returns remain synthetic sector-relative, validation is periodically negative and live deployment is still not authorized. Next: independent-universe and macro-regime validation. Full suite: **301 tests**.

### 4.66 Iteration 5af: sector-neutral residuals and the AssetGrowth economic test

**Sector-neutral method.** `neutralizeBySector` subtracts both the sector-median factor and sector-median forward return on the same date/horizon. A sector needs at least 4 companies, otherwise the global median is used. This tests selection within an industry rather than sector beta. `sectorNeutralDataset` preserves residual points for IC and portfolio evaluation.

**IC.** AssetGrowth remains positive: **+0.038 [+0.001,+0.073] / +0.089 [+0.036,+0.142]**. Book-to-Market loses significance: +0.037/+0.023 with CI through zero, so most of the earlier value effect was sector-driven. BuybackYield, EV/EBIT and netDebtToEbitda remain adverse; OCF Yield, SUE, high52 and momentum122 show no robust signal. Accruals weakens after neutralization.

**Economics.** `sector-portfolio.ts` builds top/bottom 20% quintile spreads with turnover and 15 bps per unit turnover. High-asset-growth long/short: 63d mean +3.58% [+0.82%,+6.60%], 126d +11.15% [+5.13%,+17.26%], with CI above zero. But max drawdown is **74.9% and 99.2%**, Sharpe only 0.20/0.30, and the opposite direction loses all capital. Large compounded returns are not considered investable: **there is a signal, but no viable portfolio yet**. Next gate: volatility/capacity controls and nested holdout, not production promotion. Full suite: **300 tests**.

### 4.65 Iteration 5ae: fundamentals relative to market cap and enterprise value

**New layer.** Added 9 factors: `earningsYield`, `bookToMarket`, `fcfYield`, `salesYield`, `ocfYield`, `evEbitda`, `evEbit`, `netDebtToEbitda` and `peRatio`. These are data derivatives, not derivative instruments: TTM concepts plus period-end market cap. Market cap uses close ≤ periodEnd × shares, with a WeightedAverageNumberOfDilutedSharesOutstanding fallback. EV = marketCap + financial debt − cash; total liabilities never substitutes for debt. EBITDA = OperatingIncomeLoss + D&A. Negative yields remain meaningful; P/E and EV multiples require positive denominators or return honest null.

**Reliability.** Histories are built per periodEnd with firstFiled availability. All 9 factors have registry metadata. Concept queries are capped at 8 concurrent per company, transient DB failures use a bounded retry, and NVDA's diluted-share fallback increased history from 5 to 20 points. Final registry: **16 factors, 21,894 factor_points, 672 pairs, 53 CIKs**.

**IC versus SPY.** `bookToMarket`: +0.035 [-0.031,+0.107] at 63d and **+0.080 [+0.012,+0.144]** at 126d — the only new candidate with a positive CI. `ocfYield`: +0.032 [-0.030,+0.095] / +0.060 [-0.003,+0.121] — borderline only. `earningsYield`, `fcfYield`, `salesYield`, `peRatio`, `evEbit`, `evEbitda` and `netDebtToEbitda` show no robust signal. AssetGrowth remains strongest at +0.137/+0.188. Sector-neutral residual evaluation is therefore mandatory before using valuation factors. Full suite: **296 tests**.

### 4.64 Iteration 5ad: baseline cross-sectional IC for 50 S&P names versus SPY

**Method.** `companyFactorIc` and `crossSectionFactorIc` now target 63/126-session **excess forward returns over SPY**, with availability anchors and unfinished exit windows excluded. `crossSectionFactorIc(requestedCiks?)` supports an explicit `research-universe-50` filter so XOM_PRE/RIVN/ENLT cannot silently contaminate the S&P panel; evidence CIKs remain separate.

**Results.** The run produced 1,929 quarterly factor-horizon rows. Each factor reports n-weighted Spearman, median, positive-quarter share and a 95% CI from 2,000 circular block-bootstrap iterations over 4-quarter blocks (seed 42), rather than treating overlapping windows as independent observations:

- `assetGrowth`: **+0.132 [+0.074,+0.191] / +0.182 [+0.115,+0.243]** — the strongest candidate, with 69%/68% positive quarters. It remains regime-dependent: 63-day IC was -0.180 in 2022 and -0.083 in 2026 YTD.
- `accruals`: -0.057 [-0.097,-0.016] / -0.047 [-0.094,-0.001] — expected negative sign, with the 126-day CI nearly touching zero.
- `buybackYield`: -0.076 [-0.145,-0.009] / -0.168 [-0.240,-0.091] — significantly adverse; do not promote.
- `grossProfitability`: -0.088 [-0.152,-0.025] / +0.058 [-0.020,+0.137] — sign unstable.
- `high52`: -0.059 [-0.152,+0.040] / -0.033 [-0.162,+0.105]; `momentum122`: -0.013 [-0.084,+0.052] / -0.005 [-0.096,+0.079] — no robust signal.
- `sue`: -0.001 [-0.041,+0.037] / +0.043 [+0.002,+0.082] — only a weak 126-day candidate.

**Conclusion.** This is a factor-research baseline, not evidence of live alpha. The next gate is sector-neutral residuals and nested holdout with costs, capacity and current-regime checks; no probability-model promotion. Full suite: **295 tests**.

### 4.63 Iteration 5ac: full price backfill for 53 CIKs + SPY completed

**Archives verified before import.** The user's main ZIP contained 51 files; only `cop.us.txt` and `spy.us.txt` were missing. The supplemental ZIP contained exactly those two files. Filenames matched internal CSV tickers, no empty or malformed rows were found, and every file reached 2026-10-26. No separate `xom_pre.us.txt` was needed: the XOM → XOM_PRE alias worked in the importer.

**Import.** The main batch imported 51 archive tickers (including XOM and XOM_PRE separately), while the supplemental batch imported only COP + SPY via `--tickers COP`, avoiding a second 51-ticker pass. Final state: **447,282 bars in `prices`; all 53 CIKs + SPY have history through 2026-10-26, with zero missing tickers**. Existing bars were upserted, not duplicated.

**Factors.** Rematerialization produced **15,312 factor_points**, 53 CIKs, 7 factors and 316 pairs. `high52` and `momentum122` now each have 2,529 points and cover **all 53 CIKs** (previously 5). Current XOM received 98 points, XOM_PRE 310, RIVN 199 and ENLT 67. Missing points in other factors still reflect concept coverage, not price backfill. Full suite: **295 tests**.

### 4.62 Iteration 5ab: price backfill for research-universe-53

**Method retained.** Stage 1.7's Stooq bulk daily `d_us_txt.zip` from `https://stooq.com/db/h/` is reused: whole or chunked upload through Admin → Prices Import with resume, streaming unzipper, Metastock daily bars, `source='stooq'` and idempotent upsert. The cloud runtime still must not fetch Stooq/Yahoo directly.

**Research variant.** `importPricesFromStorage` now accepts optional wanted/aliases overrides while preserving default behavior. `scripts/import-research-prices.mts --batch <uuid>` uses `research-universe-53.json` instead of active user memberships, adds SPY and maps `xom.us.txt` to both current XOM (2115436) and XOM_PRE (34088). This is intentional evidence duplication for continuity, not an error. RIVN and ENLT use the same path; any ticker missing from the archive is reported rather than hidden.

**Verification.** Unit tests cover alias mapping and ordinary targets; the full suite is **295 tests**. After the actual import, factor_points and coverage must be rebuilt: until then `high52/momentum122` remain limited to 5 companies.

### 4.61 Iteration 5aa: canonical series and factor_points for all 53 CIKs

**Dependencies fixed.** After syncing 1,348,866 facts, it became clear that `computeCompanyFactors` requires canonical `series_points` rather than raw facts alone. `build-research-series.mts` builds all 53 CIKs, with `--skip-built` resuming only missing companies. Per-CIK series replacement is now atomic: delete and inserts share one transaction, so a failure cannot leave empty series.

**Factors.** `materializeFactorPoints` no longer runs two SQL queries per point. It performs one grouped `MIN(filed) GROUP BY endDate` per company, builds availability rows through a pure function and writes them via an atomic per-CIK replacement. The first pass produced 10,734 points, while verification found 384 stale points from earlier runs; full replacement removed them. Final state: **1,093,785 series_points / 4,452 concepts and 10,734 factor_points / 53 CIKs / 7 factors / 220 pairs**.

**Limitations.** Current XOM has only 2 factor points because it is a new holding; predecessor XOM_PRE has 214. ENLT has 1 point because its underlying series is sparse. `high52` and `momentum122` exist for only 5 companies because price history remains a separate unfinished backfill; `grossProfitability` exists for 23 due to concept coverage, which is not the same as zero. No local action is required for derived calculations. Full suite: **293 tests**.

### 4.60 Iteration 5z: 50 current S&P names plus predecessor and off-index legacy

**Composition.** The original 35 are joined by 12 existing index names (`AAPL, IBM, LMT, T, GOOGL, JNJ, PG, WMT, CVX, MA, V, COST`) and three additions: **AIG** (the current A/B benchmark), **COP** (upstream energy) and **LIN** (industrial gases/defensive materials). `research-universe-50.json` therefore contains exactly 50 current S&P tickers, approximately 10% of the index by count.

**No orphans.** `research-universe-53.json` contains those 50 plus `XOM_PRE` (34088, predecessor evidence) and off-index legacy RIVN and ENLT, for which the owner requested complete data. Separate files keep predecessor/off-index evidence out of S&P metrics while allowing the same ingestion path. `facts-universe-expansion-3.json` fetches only AIG/COP/LIN without another 50 SEC requests. Full local review and prod push use `research-universe-53.json`; factor/evaluation panels use `research-universe-50.json`.

**Verification.** A unit test checks the 50/53 sizes, unique CIKs, AIG/COP/LIN presence and exclusion of RIVN/ENLT/XOM_PRE from the current-S&P file. Full suite: **292 tests**.

### 4.59 Iteration 5y: XOM string CIK and Exxon entity continuity

**Root causes.** The current SEC ticker map does associate XOM with `2115436` (`ExxonMobil Holdings Corp`), so the universe entry is not a typo. It is a new holding CIK with few filings and 280 companyfacts. Historical `EXXON MOBIL CORP` is `34088`, with 1,002 recent filings and 20,629 facts. The new holding's companyfacts also returns `cik` as the string `"0002115436"`, which zod correctly rejected.

**Fix.** Server/worker `factsToRows` normalize CIK with Number and fail closed when it is missing or invalid. `facts-universe-xom.json` contains current XOM plus the predecessor for a targeted repair. `facts-universe-35-plus-predecessor.json` contains 35 current tickers plus `XOM_PRE` (`34088`) = 36 CIKs and is the full fundamentals dry/push universe. Entities are not merged silently: the predecessor is separate evidence, while entity continuity for the factor engine remains an explicit follow-up rule.

**Verification.** Server/worker string-CIK tests were added; the full suite is **291 tests**. The backend containing this fix must be published before prod push, not merely the earlier `factsSnapshot` version.

### 4.58 Iteration 5x: target-35 companyfacts fundamentals, local-first

**Detected gap.** Checking the target `edgar-universe-35.json` against the live DB found only 11 covered companies, 24 entirely missing and XOM with an anomalous 280 facts. `push-local-signals` cannot fix this: tone and XBRL are separate pipelines.

**Data path.** `worker/facts-fetch.mts` retrieves SEC companyfacts, atomically caches raw JSON under `worker/cache/companyfacts` on D: and sends one complete per-CIK snapshot to LOCAL `/api/worker/ingest`. The initial repair universe `facts-universe-25.json` contains the 24 missing companies plus XOM. `scripts/push-local-facts.mts --dry` reports local coverage and row counts without prod writes; the actual command sends reviewed local snapshots to prod.

**Integrity.** The new `factsSnapshot` validates taxonomy/concept/unit/period/value/fy/fp/form/filed/accn. Because `facts` has no suitable unique key for INSERT IGNORE, transport is one complete CIK snapshot: the server replaces only that company in one transaction with inserts capped at 500. Any failure rolls back the delete and all inserts; other companies are untouched. Repeating a snapshot is idempotent. No table drops and no local-first bypass. Contract and normalization tests were added; the full suite is **289 tests**. The backend route must be published before prod push, and the local dev server must be restarted before local fetch.

### 4.57 Iteration 5w: Strata 125B isolated 100-document A/B benchmark

**Goal.** Compare the current Ollama `qwen3.5:9b` with Strata/Qwen3.8-Flash-Next on one company and exactly 100 identical documents without changing the production model. Strata's current release path is the Terminal `strata launch`, not the old source-only `START-HERE.bat`; inspect `--plan` first and launch only when the pack fits actual RAM/VRAM/disk/backend. The OpenAI `/v1/chat/completions` endpoint, `response_format=json_object`, `reasoning_effort=none`, temperature 0 and 256 output tokens follow the existing tone contract.

**Protocol.** `worker/edgar-tone-ab.mts --only AIG --limit 100 --engines ollama,strata --run-id aig-100-strata-v1`. Documents are evenly distributed across company history; prepared windows are stored in the plan and are byte-identical across engines. Engines run sequentially at concurrency 1, with warmups excluded. Repeating the command resumes JSONL by engine/accession/window; a new run-id is required for an independent repetition. Production signals, manifests and outboxes are untouched.

**Metrics and quality.** Reports preserve input/cached/fresh-read/generated tokens, engine timings, prefill/decode/effective tok/s, wall time, cache ratio, JSON parse rate and scored/boilerplate/unparseable/error documents. Matched filings include mean scores, mean delta, MAE, RMSE, Pearson, direction agreement with a ±0.1 neutral band and within-0.1/0.2 rates. The 20 largest divergences include both score/why rationales and SEC links for manual review; model agreement is not proof of absolute correctness. Verification covers adapter/sampling/comparison unit tests and an end-to-end 2-document × 2-engine smoke test with an unchanged manifest. Full suite: **286 tests**.

### 4.56 Iteration 5v: aggregate EDGAR tone token statistics

The final `edgar-tone` line now reports total prompt tokens and generated tokens for the whole process. Rates are intentionally separate: `prefill tok/s` = prompt tokens / cumulative Ollama prompt-eval time; `decode tok/s` = generated tokens / cumulative Ollama eval time; `effective decode tok/s` = generated tokens / full process wall time, including document preparation, gaps and delivery. This prevents misleading throughput conclusions based only on the model's internal rate. A unit test covers the rate calculation and zero duration; the full suite is **283 tests**.

### 4.55 Iteration 5u: EDGAR tone throughput, fail-fast behavior and skip audit

**Context was not reduced.** `OLLAMA_NUM_CTX=32768`, the JSON schema and `numPredict=256` remain unchanged. Windows stay at the conservative 16,000-character guard, but overlap is capped at 1,000 characters: large duplicate regions are no longer scored twice, and a tiny overflow no longer triggers a second almost-identical request. Documents beyond the coverage cap retain evenly spaced samples with both endpoints.

**Throughput and stopping rules.** `edgar-tone` now defaults to two bounded lanes (`--concurrency 2`, maximum 2): while one waits for Ollama, the other prepares a document and keeps the next request queued. Ollama may serialize or batch them. There are no hidden LLM retries: one transport error ends the current filing, and two consecutive errors checkpoint and abort with an explicit failure. The former worst case of 8 windows × 120 seconds is gone. `keep_alive=30m` prevents model unloads between companies; `--concurrency 1` remains available for memory diagnosis.

**Skips and durability.** `8-K/A` now uses EX-99 just like `8-K` instead of scoring the cover. For the transition, `edgar-fetch --exhibits-only` reads existing manifests and downloads only EX-99, with no submissions crawl or primary documents; fetch/tone manifests are atomic. The TOC gate distinguishes real contents pages from financial rows ending in numbers. A boilerplate rationale no longer drops a window merely for the word `procedural` when investment substance is present. `thin content`, `boilerplate-only content`, `no parseable score`, `cache file unreadable` and retryable `LLM request failed` are separate outcomes. Manifest/outbox checkpoints are atomic every 20 completed filings and at company end, including all-skip companies, so crash recovery does not lose skip reasons or counters.

**Audit before a long run.** `worker/edgar-tone-audit.mts` is read-only: `--manifest-only` gives an instant manifest report, while the full scan uses the exact production preparation path to count deterministic skips, ready filings, windows and prompt characters without Ollama, ingest or writes. The real scorer also writes `worker/.runs/edgar-tone-audit.jsonl` per filing and reports forms scored/skipped, request errors, prefill/decode/load, decode tok/s and wall/request-covered/gaps. Full suite: **282 tests**, clean typecheck. A home canary is still required to measure actual GPU throughput before starting the remaining ~470 companies.

### 4.54 Iteration 5t: weekly English visual analytics report

**What was added.** `/analytics` is an owner-only English dashboard for weekly project-strength review. It includes a verdict banner, live registry metrics, an `actual` network of the current state and a `target` network for genuine alpha, status/search/critical-path filters, node detail cards, weekly history, and links to the full English review and metrics JSON. Publishing is strictly in English.

**Data.** `scripts/build-analytics-snapshot.mts` reads the live DB and `worker/cache/options/manifest.json`, then writes `src/data/analytics-snapshot.ts` and `public/reports/weekly-metrics.json`. Up to 12 weekly snapshots are retained, with no fabricated trends: the first week is marked as the baseline. Real `fund_holdings`, `fund_quarters`, `factor_points`, `signals`, `macro_points`, `prices`, `facts` and options manifest drive the report. No schema changes.

**Verification.** Actual/target switching, search, statuses, critical path, node details and weekly history were checked in real Chromium. Mobile at 390px has no page-level horizontal overflow; only the graph panel scrolls. Added `public/favicon.svg` to eliminate favicon 404s. Two new unit tests cover node rendering/clicking and snapshot freshness. Total: 274 tests.

**Weekly protocol.** Run `npx tsx scripts/build-analytics-snapshot.mts`, review the diff, then `npm test`, `npm run build`, commit and publish. Full English text is at `/reports/project-strength-review.md`; raw metrics are at `/reports/weekly-metrics.json`.

### 4.53 Iteration 5s: disk guard follows the junction

**Problem.** After moving `worker\cache` to D:, the fetcher stopped with `free disk space below 15 GiB` on C:. The actual files were fine; the guard called `statfsSync` on the script directory instead of the real cache target.

**Fix.** `realCacheRoot()` now calls `realpathSync` before `statfsSync`, so the disk guard checks the volume to which the junction actually points. The old `worker\cache` path remains valid, but the guard no longer treats C: as its volume. This is not another migration: junction, backups, and manifest/outbox are unchanged. Without a junction, `realpathSync` returns the original path, preserving compatibility. Full typecheck and 272 tests pass.

### 4.52 Iteration 5r: EDGAR tone — JSON schema and model-compatible windows

**Diagnosis from llm-failures.jsonl:** most `no parseable score` rows had `promptChars=100000`. The model ignored the JSON instruction and produced a long markdown analysis; `evalCount=512` truncated the reply before valid JSON. This was not a retry problem but a combination of oversized prompts and unbounded output.

**Fix.** `generate` now supports `jsonMode`: Ollama receives the official JSON schema `{type:"object", properties:{score:number, why:string}, required:["score","why"]}`. The `why` is capped at two short factual sentences/60 words, and tone uses `numPredict=256` so JSON is not cut mid-structure. `mdaWindows` defaults to 16,000 characters and at most 8 overlapping windows: the section is processed as a map-reduce series instead of one 100k prompt. Text is not discarded — the final window always reaches the end of the document. This is not random MD&A truncation but chunked scoring with verdict aggregation.

**Verification.** A unit test proves the request contains `format.type="object"`, `required=["score","why"]`, and `options.num_predict=256`; another proves ≤16k windows and end-of-document coverage. The 2-attempt cap and llm-failures.jsonl remain: it is now possible to see whether failures persist after JSON schema. If they remain, the next step is comparing replies on the same accessions rather than adding more retries.

### 4.51 Iteration 5q: EDGAR tone — bounded LLM retries and response diagnostics

**Problem.** After the skipped-filter fix, `no parseable score` remained: the model answers but `extractVerdict` cannot parse valid JSON. Those documents could be retried forever, repeatedly burning roughly 30 seconds of GPU per old file.

**Fix.** `llmErrorCount` and `llmErrorModel` in the manifest cap retries at **2 attempts per model per document**. A new model gets an independent chance, explicit `--rescore` resets the counter/model, and `--include-skipped` remains a manual override. `no parseable score` stays distinct from `boilerplate-only`: the former is a technical reply failure, the latter has no investment content. Successful delivery clears both fields.

**Diagnostics.** `worker/.runs/llm-failures.jsonl` now records accession, model, promptChars/responseChars, totalMs, evalCount, reason, and the first 1,000 response characters. This distinguishes empty replies, reasoning instead of JSON, markdown, truncated JSON, or schema mismatches. The next fix must use those samples rather than GPU wattage. `NUM_CTX=32768`, whole-section scoring, and outbox are unchanged. Tests cover cap=2, includeSkipped, and a fresh chance for a different model.

### 4.50 Iteration 5p: options data foundation — accumulation, not on-demand calls

**Status: the first dataset is downloaded, normalized, and verified.** This is the start of an accumulating store, not an API to call during future calculations. Raw payloads are immutable, normalized chains are versioned by `snapshotId`, and all future features are computed offline. Full ORATS backfill and WRDS are not blockers.

**Sources and actual coverage:**

| Source | Result | Limits |
|---|---|---|
| Cboe delayed quotes | 36 snapshots across 35 tickers, **95,330 contracts**, 0 invalid, 0 crossed | Current/future daily chains, not long history |
| ORATS near-EOD sample 2024-01-03 | Full market 716,822 rows; our 35 have 30,064 underlying-strike rows = **60,128 call/put contracts**, 0 invalid, 0 crossed | One day, not the full archive; backfill is ~500 GB and belongs on D: |
| ORATS intraday sample | 5 one-minute AAPL snapshots, **9,200 contracts** | Five minutes, not five days; separate `orats_intraday` provider |
| Alpha Vantage `HISTORICAL_OPTIONS` | IBM 2017-11-15: **998 contracts, 14 expirations** | Demo sample; premium is required for a full backfill |
| EODHD demo | **62 daily chains, 11,000 rows / 9,515 unique contracts** | Demo stopped at page 12 (HTTP 422), warning retained; repeated rows remain visible |

Raw data is 190.6 MB, normalized data 72.6 MB. EODHD repeated rows (1,485) remain in quality as-is: this is a time series, not duplicate files. Zero-bid is never silently nulled or dropped.

**Files:** `worker/lib/options.ts` (OSI + adapters + quality), `worker/options-fetch.mts` (Cboe/EODHD/Alpha Vantage), `worker/options-orats.mts` (streaming 223 MB CSV without loading it into memory), `worker/options-orats-intraday.mts` (minute snapshots). Raw and normalized caches are separate; the manifest stores `snapshotId`, `availableAt`, `ingestedAt`, rows/contracts/calls/puts/expirations/duplicates/invalid/zeroBid/crossed, and warnings. Atomic `.tmp → rename` prevents half-written JSON.

**Next stages, strictly in order:**
1. Scheduled snapshots: `npx tsx worker/options-fetch.mts --source cboe`. Each run creates a new snapshotId; a retry with the same ID resumes without duplicates. Example Task Scheduler: `schtasks /Create /TN "AlphaEngine-Options-CBOE" /SC HOURLY /MO 1 /TR "cmd /c cd /d C:\dev\alpha-engine && if not exist worker\.runs mkdir worker\.runs && npx tsx worker\options-fetch.mts --source cboe >> worker\.runs\options-cboe.log 2>&1"`.
2. Offline `option_features` by DTE bucket: ATM IV + delta, term slope, 25-delta skew/risk reversal, put/call volume and OI, volume/OI, relative spread, earnings IV crush. No invented GEX or dealer direction.
3. QA: compare IV/Greeks across ORATS, Cboe, EODHD, and Alpha Vantage; timestamp/OI availability; corporate actions/delistings; locked/crossed/zero-bid reports without hidden filtering.
4. Paid ORATS near-EOD backfill only after schema validation and a large drive. No professor/WRDS dependency. Tick/OPRA (Databento/ThetaData) is a separate stage only if EOD proves value.
5. Prod receives aggregated features only. Raw ZIP/JSON is never mirrored, which is the storage safeguard.

Seven new unit tests cover OSI, Cboe, EODHD per-day grouping, Alpha mark, ORATS near-EOD/intraday, generated contract IDs, and quality metrics.

### 4.49 Iteration 5o: EDGAR EX-99 idempotency and separate counters

**Owner's question:** why is `new = 0` while `downloaded` is large — are we duplicating? In code, `new` means new accessions in the manifest, while downloads may be previously failed primary documents or EX-99 exhibits for known 8-Ks. `fetched=true` primary documents are not downloaded again; `new=0` does not prove that EX-99 exists.

**Edge case found:** if EX-99 was downloaded but `exChecked` was not saved due to a restart, the next run could download it again. New `shouldDownloadExhibit` skips the network when `.ex.htm` already exists and restores `exChecked` in the manifest. Missing exhibits retain the previous behavior: largest textual exhibit, 404/410 fast-fail, and `exChecked=true` when absence is confirmed.

**New log:** the combined `downloaded` counter is now split into `primary` and `EX-99`, so the actual network work is visible. Two new tests: an existing exhibit is not downloaded again, a missing one is fetched, and 10-K is untouched. After updating, manifests and cache resume normally; `--retry-failed` is still only for deliberately resurrecting dead entries.

### 4.48 Iteration 5n: EDGAR tone — honest skips, progress, and LLM timings

**Two real bugs were found.** (1) `pending` with the `includeSkipped` filter was computed but never used: all `fetched && !scored` rows were taken instead, so old thin/boilerplate documents repeatedly went back to the LLM and were skipped again. (2) Progress and ETA counted only successful scores, not processed documents: `180/728 (157 skipped)` actually meant 337 processed, understating throughput and overstating ETA.

**Fix.** `shouldScoreManifestEntry` is now the single rerun filter: thin/boilerplate does not re-burn GPU by default, `no parseable score` and cache errors remain retryable, and `--include-skipped` / `--from` work as intended. `processed` increments per document, `done` means scored, and `skipped` is separate. Progress and outbox update every 20 processed rows; each company ends with `processed = scored + skipped = stillPending`.

**Diagnostics.** Every company now reports skip reasons with counts and Ollama metrics: calls, chars, prompt tokens, load, prefill, and decode. This distinguishes repeated work, long whole-MD&A prefill, and model-placement problems. `NUM_CTX=32768` and whole-section scoring remain unchanged; concurrency and text truncation were not enabled blindly. GPU power around 68 W alone does not prove a CPU fallback: inference is bursty and 300 W is not a mandatory steady state. If load/prefill is suspicious, inspect `ollama ps` for CPU/GPU split. Outbox still supports stop/resume without repeating work. Two new rerun-filter tests; 61 worker tests.

### 4.47 Iteration 5m: EDGAR universe expanded to 35 without duplicates

The first capped 20-company crawl finished in 48 minutes. For the future >30 panel, `worker/edgar-universe-35.json` contains the original 20 plus 15 new names: MSFT, AVGO, ANET, MU, SMCI, FSLR, MRNA, LLY, DAL, DASH, HD, CAT, AMT, JPM, KMI. The additions cover memory/semiconductors, networking, First Solar, biotech, airlines, gig economy, housing, REITs, financials, and midstream. KMI is included explicitly per the owner. ENPH is absent from the current index universe and was replaced by FSLR; LIN was left out to avoid over-weighting the commodity block. AAPL remains excluded; all 35 tickers are unique and CIKs are verified.

Run: `npx tsx worker/edgar-fetch.mts --universe edgar-universe-35.json`, then `npx tsx worker/edgar-tone.mts --universe edgar-universe-35.json`. The 20-file remains for history; the 35-file includes it entirely, so the next fetch mainly processes the new 15 through existing per-CIK manifests and cache. Tests cover 35 unique tickers, AAPL exclusion, and KMI/FSLR/SMCI CIKs. The full S&P 500 universe stays untouched, and the raw corpus is never mirrored to prod.

### 4.46 Iteration 5l: EDGAR under disk limits — 20 distinct regimes

**Owner's decision:** stop the full S&P 500 crawl and exclude AAPL from the research universe. Instead of smooth mega-caps, the selected names cover high beta, cycles, turnarounds, commodities, credit, and rate regimes. `worker/edgar-universe-20.json`: NVDA, AMD, INTC, PLTR, META, NFLX, AMZN, TSLA, NKE, LULU, RCL, GS, COF, UNH, PFE, XOM, FCX, BA, PLD, NEE. All 20 were verified in the main universe with correct CIKs; AAPL is absent. The full `edgar-universe.json` remains unchanged for future expansion.

**Run without cache duplication:** `npx tsx worker/edgar-fetch.mts --universe edgar-universe-20.json`, then `npx tsx worker/edgar-tone.mts --universe edgar-universe-20.json`. Both scripts accept the flag, and fetch progress shows the selected file. Stop the current full crawl after the current company with Ctrl+C; manifests preserve state, existing documents are not deleted or downloaded again. Tests cover the 20 entries, AAPL exclusion, and PLTR/RCL/NEE CIKs.

**Storage policy.** Raw HTML/XML, index files, and the full EDGAR cache are NOT sent to prod: only signals, notes, digests, factors, and metadata, so Kimi's 50 GB limit is no reason to mirror the corpus. At home, move `worker/cache` to D: first (usually the bulk). Migrate MySQL only after a separate check of its actual size, D: filesystem, `@@datadir`, MySQL service account, and backup. Never move `ibdata`/datadir while MySQL is running. Start with diagnostics and a cache junction; database migration is a separate operation, not background routine.

### 4.45 Iteration 5k: EDGAR — permanent 404s skip immediately, 7 requests/sec

**Problem.** The comment promised “other 4xx fatal”, but `secGet` actually retried every HTTP status five times with exponential waits. Nonexistent old Archive links consumed time on every run, and the manifest declared a document dead only after three runs.

**Fix.** `SecHttpError` carries status and URL: 404/410 immediately classify as permanently missing (`isPermanentSecMissing`); other 4xx except 429 are not retried either. 429/5xx/network failures retain up to five attempts with backoff and `Retry-After`. `fetchFilingDocument` still rescues through index.json; if the index is also absent, the manifest marks `dead` immediately instead of after three nights. Missing EX-99 sets `exChecked` so it is not retried forever. `--retry-failed` remains the explicit resurrection path.

**Rate and timeouts.** Owner-requested default `SEC_RPS=7` (cap 8; SEC fair access is up to 10/sec per IP). Parallel SEC clients must share the budget manually via `SEC_RPS`, not run two 7/sec processes. `SEC_TIMEOUT_MS` defaults to 30,000 ms with a 5–120 second allowed range. Real throttling still backs off; this is not a block bypass.

**Verification.** The real legacy `primary_doc.xml` that previously caused long retries returned one 404 in **764 ms**, with `permanentMissing=true` and no second request. New tests cover 404/410 classification and exactly one secGet call on 404. `edgar-fetch` also passes a standalone bundle check.

### 4.44 Iteration 5j: 13F filingDate and safe delivery of repaired history

**Status: complete — backfill, events, and prod synchronization are verified.** The owner's full repair finished with 0 open quarters and 0 FIGI/amendment errors; 875,860 is the number of processed upsert rows, not newly inserted rows or the final table size. Vanguard control: 4,062 full-book and 367 mapped positions in Q1.

**Point-in-time availability.** DDL 027 adds nullable `fund_quarters.filingDate`: the latest original/amendment date when the merged book became available. `--totals-only` now processes missing rows AND rows with `filingDate=NULL`, so dates backfill without another hour-long repair or CUSIP mapping. Date backfill does not depend on mapped-position count: existing fund-quarters with zero mapped positions are included, while new empty books are not created. `--rebuild-events` reads accession and filingDate from `fund_quarters`; normal refresh passes them directly. A missing date produces an explicit quarter-end fallback warning, but the required workflow backfills first. Vanguard Q1 must carry accession `0002100119-26-001313` and `2026-05-15`, not `2026-03-31`.

**Two snapshot modes.** `fundQuarters` sends a full small-table snapshot with upserted total/positions/accession/filingDate; no id watermark exists because repaired old rows must arrive. `holdingsSnapshot` is a separate full upsert for repaired positions: fundName/heldCik/issuer/shares/valueUsd/accession/tier update without deleting prod rows. The ordinary `holdings` incremental path with INSERT IGNORE and id watermark is unchanged. This fixes the old failure where new rows arrived but corrected old rows did not. Full holdings snapshots are large (hundreds of thousands of rows, >1,700 batches of 500) and run only after local QA; fund_quarters is small and goes first. Snapshots log progress every 25 batches and checkpoint every successful batch; after an interrupted snapshot run, resume with `--full --resume` (not for the initial run). DDL 027 is mandatory on prod before `kind=fundQuarters`. `fund_jobs` remains a local processing marker and is not required on prod.

**Order:** `git pull` → local `apply-ddl-027` → `--totals-only` → verify zero null dates, Vanguard 4,062/2026-05-15, and book-count anomalies → delete only local `signals source='13f'` → `--rebuild-events` → verify eventTs and notes → separate prod DDL → fund_quarters push → full holdingsSnapshot after QA → separate cleanup of old prod 13F events only → events push. Three new contract tests cover fundQuarters, nullable filingDate, and holdingsSnapshot.

### 4.43 Iteration 6d: magnitude kernel and 13F read-side guard

**Status: research kernel and presentation safety, not a new trading model and not evidence of alpha.** The full contract lives in `docs/DESIGN_MAGNITUDE.md` (registered under Admin → Manuals): availability invariants, mathematics, allowed/forbidden conclusions, acceptance gates, and later stages were fixed BEFORE implementation.

**13F guard.** `api/services/institutional-guard.ts` separates 45-day legal eligibility, fund-count coverage, and cross-quarter comparability. Flow quarters must reach ≥80% of expected fund coverage; <95%, a skipped latest quarter, and exclusions are explicit metadata. QoQ uses only funds present in both quarters. For books of ≥50 mapped rows, a smaller/larger count ratio below 0.25 is a coverage anomaly (for example 6 versus 371), not a trade. Fewer than two stable funds disables flows with a warning. Current holders/top and QoQ no longer mix: levels use the selected quarter, deltas use the stable panel. Dashboard gained `sectorFlowsDetailed` with pair/coverage metadata; the legacy endpoint retains its shape but uses the same safe rows. Institutional and 3D show the pair, stable/excluded/partial state. Live evidence after repair and the full snapshot: Q2 vs Q1, Q3 skipped, 294 stable / 5 missing / 0 suspect; graph signs are 274 positive / 126 negative, sectors are 8 positive / 3 negative. The pre-repair artifact was 0/400 positive.

**Magnitude.** `api/services/magnitude.ts` provides conditional `muPlus/muMinus`, q10/q50/q90, `expectedExcess = p·muPlus + (1−p)·muMinus`, a historical baseline with independent up/down shrinkage to the panel (τ=8), MAE/medianAE/RMSE/bias, pinball loss, per-anchor Spearman rank IC, bucket spread, and return-calibration bins. A missing return class yields null, never zero. Cross-sections deduplicate a company per anchor and require ≥5 names for rank IC and ≥8 for spread; otherwise they return structured `insufficient`.

**Smoke without tuning.** `scripts/_magnitude-smoke.mts` reuses 6c anchors and fit-known labels, reports evaluation-only diagnostics, and never reads holdout. AAPL/MSFT/NVDA/PLD correctly produced `insufficient` for both cross-sectional metrics; no model was selected and no effectiveness was claimed. Sixteen new unit tests were added; the full suite is 252/252, with clean typecheck and production build. Real Chromium QA on Dashboard, Company Institutional, and 3D confirmed the quarter pair and stable funds 285 with zero failed requests or page errors. Later work is deliberately deferred: full 13F repair and filingDate, ≥30 companies for a technical panel, ≥300 for deciles, Huber/quantile feature models, return calibration, and only then the portfolio layer.

### 4.42 Iteration 5i: 13F amendments — a partial amendment is not a book

**Status: code complete and verified against real SEC filings; the local repair must be rerun.** The first repair did not grow Vanguard Q1, and diagnosis moved the root cause to source selection. For Vanguard Capital Management 2026Q1: original `0002100119-26-001306` has 3,982 rows; amendment `…001311` is a `RESTATEMENT` with the complete 3,982-row book; amendment `…001313` is `NEW HOLDINGS` with only 80 additional rows. Its `additionalInformation` explicitly says it contains only the omitted securities. The old `latestPerQuarter` selected the last accession and discarded the full book, so `fund_quarters` received 80 rows and only 6 mapped into our universe.

**Fix.** `worker/lib/thirteenf.ts` reads `amendmentType` from `primary_doc.xml` and merges the quarter chronologically: the original forms the book, `RESTATEMENT` replaces it, and `NEW HOLDINGS` adds rows. Duplicate `cusip:secClass` keys resolve to the later filing without double counting. Unknown amendment types fail closed and leave the quarter open. Every holding retains its `sourceAccessionNo`; `fund_quarters` stores the latest amendment's accession; normal-refresh events use the latest amendment date as the conservative availability of the merged book. The same semantic merge now protects `build-13f-top300.mts` from understating AUM on a partial amendment.

**Live hotfix after the first run:** 2007-era filings have no `primary_doc.xml`, so the loader now checks for an XML information table first and skips legacy quarters without long 404 retries. A missing primary document is allowed for an original 13F-HR because ORIGINAL follows from the form; amendment metadata remains mandatory for 13F-HR/A.

**Proof without DB writes:** the three real SEC documents produced 3,982 + 80 = **4,062 positions**, latest = `0002100119-26-001313`; 3,982 rows come from the full restatement and 80 from the addition. Tests cover replacement, addition, deduplication, unknown-type failure, and amendment-type parsing. At home, run `git pull` and the same `--only Vanguard --repair`: no deletion of `fund_jobs`, holdings, or XML is needed — upsert updates the summary and fills missing rows. Afterward, `fund_quarters.positions` for 2100119 Q1 must be 4,062 and `fund_holdings` must contain hundreds of mapped positions instead of 6. The full top-300 and event rebuild still wait for this control check.

### 4.41 Iteration 5h: 13F repair — healing the negative CUSIP cache

**Status: code complete; the local repair run is still pending.** The owner's Workbench check proved that local and prod match: five Vanguard entities have only 6 mapped positions in Q1-2026 versus 370–371 in Q2. This is not a delivery failure but incomplete local history. Sector flows, the 3D graph, and `smartMoneyFlow` remain unreliable until that history is healed.

**Three locks caused the problem.** (1) A failed CUSIP stayed in `cusip_map` with `ticker=NULL` and was never sent to OpenFIGI again, even after a new API key was installed. (2) `INSERT IGNORE` could not update that row after a successful response. (3) `fund_jobs` marked the processed quarter complete, so every subsequent refresh skipped it permanently.

**The fix is `--repair` on `scripts/13f-refresh.mts`:** negative cache entries are retried once per run; ticker-only rows still resolve through the local companies registry without another FIGI call; completed quarters reopen without manually deleting `fund_jobs`; corrected CUSIPs and holdings are upserted. If FIGI or DB mapping actually fails, the quarter stays OPEN and the next run must process it again. Repair mode generates NO events: they must be rebuilt separately after the repaired history is reviewed. It does not delete holdings — it fills gaps and updates existing rows, but it is not a full reconciliation against spurious rows.

**Safe home sequence:** first run `npx tsx scripts/13f-refresh.mts --universe funds-13f-top300.json --quarters 12 --only Vanguard --repair`, then repeat the Q1/Q2 SQL check. Only if Q1 grows from 6 to the expected hundreds of mapped positions, run the full `--universe funds-13f-top300.json --quarters 12 --repair`. After the full local review, delete old local `signals source='13f'` and run `--rebuild-events`; prod deletion and pushing remain a separate reviewed step, never an automatic side effect. Two new unit tests cover the retry policy, and the repair script passes a standalone bundle check.

### 4.40 Iteration 6c: nested probability evaluation and leak repair

**Data availability was repaired before comparing models.** The combined point list is no longer indexed as if it were one factor's series: every stream sits on one availability calendar, with as-of values and robust-z scores. A past training label is allowed only when its 63-session window ended BEFORE the prediction date (`exitDate`, not merely an earlier filing date). Market factors are available on their own date, not +45 days; fundamentals use the first filing containing the period rather than a later comparative filing. Old rows are repaired on read, while new materialization writes the corrected anchors directly. Future anchors are rejected, and the macro prior takes the latest row independently per FRED series. The 13F stream still uses the conservative quarter+45d proxy; until each accession's actual filingDate is persisted, amendment timing remains an explicit limitation.

**Protocol.** `scripts/_nested.mts` compares Bayes and ridge-logistic on identical anchors. Development data is chronological: 50% fit → 25% calibration → 25% evaluation; the final four anchors are a holdout excluded from fitting, calibration, thresholding, and model selection. Even fit/calibration labels must have been observable at their segment cutoff. Calibration is real pool-adjacent-violators isotonic regression (identity below eight points), with the decision threshold fixed at 0.5. Logistic learns pooled slopes across AAPL/NVDA/MSFT and shrinks the target-company intercept toward the panel intercept with τ=8 — genuine partial pooling, not shrinking a one-company intercept toward itself. Reports include the confusion matrix, class precision/recall, balanced accuracy, always-up and majority baselines, realized-SPY bull/bear splits, and block-bootstrap 5–95% CIs.

**Classification is separated from money.** Accuracy uses all anchors, but overlapping 63-session returns cannot be summed as trades. Net return, turnover, Sharpe, and max drawdown use only non-overlapping windows: long/cash versus SPY, compounded equity, initial entry from cash, and 5 bps commission + 10 bps slippage per unit of turnover. Sharpe is per anchor and unannualized. Returns are excess versus SPY, not absolute portfolio returns.

| Company | Model | Eval n | Accuracy | Majority | Balanced | 5–95% CI | Holdout, n=4 | Net / always-up |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| AAPL | Bayes | 51 | 47.1% | 54.9% | 47.9% | 31.4–62.7% | 25.0% | −15.4% / −12.7% |
| AAPL | Logistic | 51 | 41.2% | 54.9% | 43.3% | 25.5–54.9% | 25.0% | −13.9% / −12.7% |
| NVDA | Bayes | 54 | 64.8% | 64.8% | 50.0% | 50.0–79.6% | 50.0% | +180.3% / +180.3% |
| NVDA | Logistic | 54 | 64.8% | 64.8% | 50.0% | 50.0–79.6% | 50.0% | +180.3% / +180.3% |
| MSFT | Bayes | 26 | 57.7% | 65.4% | 44.1% | 26.9–92.3% | 0.0% | 0.0% / −29.0% |
| MSFT | Logistic | 26 | 42.3% | 65.4% | 48.0% | 23.1–61.5% | 100.0% | −24.0% / −29.0% |

**Conclusion: no robust alpha has been demonstrated.** Both NVDA models make 54 up calls out of 54 and merely replicate always-up; their +180.3% is not model alpha. MSFT logistic scores 100% on four holdout anchors but loses on evaluation (42.3% versus the 65.4% majority baseline), so the holdout is not used to crown it. Bear subsets contain only 4–8 points, and the holdout contains one non-overlapping return window; neither supports statistical confidence. Full project: 231/231 tests and a clean full-project typecheck.

### 4.39 Iteration 6b: probability engine — next-quarter up/down

`api/services/probability.ts`: sign-aware `bayesPosterior` from the owner's PDF (x=±1 changes both likelihood sides; k=2 tempers dependence), Beta(1,1)-smoothed `reliabilityFromCalls`, median/IQR robust-z, `linearIdentityGroups` only for true linear derivatives (R²≥0.85 plus a stable slope; correlation alone never merges factors), a FRED macro prior bounded at 0.35–0.65, and calibration bins. `probability-engine.ts`: rolling |Spearman|≥0.05 selection over the trailing 16 observable examples, returning {currentP, factorsUsed, backtest, calibration, points}. The VALUE card shows the probability, macro prior, factors, and calibration. Earlier AAPL/NVDA/MSFT headline percentages are superseded: 6c exposed calendar and availability defects; the valid comparison is §4.40, not a recalibration toward the old numbers.

### 4.38 Iteration 6a: factor IC monitor (Stage 5-alpha)

`factor_points` (DDL 025): factor values per period with availability anchors. Since 6c, fundamentals use the first filing containing the period (fallback +45d), while market factors use their own date; the former MAX(filed) incorrectly moved old observations to later comparative filings. Statistics in `api/services/ic.ts` (Pearson, Spearman, tie-averaged ranks) plus `entryCloseAfter/forwardReturnInfo`: entry strictly AFTER the filing date, a median exit window, and the label's availability date. `companyFactorIc` evaluates 63/126-session forward returns; `crossSectionFactorIc` is quarterly cross-sectional IC. The VALUE card shows r and ρ with n and the label "evaluation layer, not a trading signal". Early NVDA momentum and AAPL assetGrowth readings were diagnostic only; the nested test is §4.40.

### 4.34 Iteration 5d: LLM crowd read for Stocktwits

Alongside the deterministic rows (label from self-tagged bullish/bearish, buzz) comes an LLM row: the model reads the 30 latest messages per ticker and returns crowd mood + 3-4 sentences of "what they're discussing" — including the unlabeled majority the deterministic label never sees. Provenance stays separate: `llm:<model>:stocktwits:…` keys (blending with human labels is a digest-time concern, not a store concern). The GPU is no failure point: daemon down → deterministic rows only. Routing by content maturity (owner's call): deterministic rows (buzz/label, proven in 4o) go STRAIGHT to prod even in dev mode; LLM rows (llm: keys) follow the INGEST_URL switch — a local-first probation, the same path EDGAR passed in two days: local → eyeball → push → direct feed. Post-push prod QA (checking the negative tail against SEC sources from the sandbox) caught an error class: routine procedural filings (2002 SOX sworn statements, certifications, covers) were read as "investigation/admission" and scored negative — the vacuum filled with negativity; treatment: prompt rule "procedural ≠ negative, write no substantive content" + a no-inference clause ("fraud" for a restatement was overreach), a widened BOILER list, and a 149-row purge on prod and local via the markers. 5c gates: thin threshold 1200→700 + material-Item whitelist (5.02, 2.02, 4.01…) on non-TOC lines; tone gained `--from` (rescore the last N years) and `--include-skipped` (by default known boilerplate no longer re-burns GPU on every incremental run — a bug the owner caught via the error aggregate).

### 4.33 Iteration 5c: scoring quality and the S&P 500

From the first NVDA runs (owner eyeballing via why): (1) MD&A extraction verified against REAL NVDA documents — three TOC shapes fixed (bare label line, nbsp page-number line) plus the duplicate Item 2 in a 10-Q (Part I vs Part II); SIGNATURES truncates at the LAST occurrence (the TOC lists "Signatures" too); (2) 8-Ks pull the largest textual exhibit EX-99.x — where press releases live; (3) a deterministic isThinContent gate before the LLM + boilerplate-window drops via why markers — a score exists only when there is content (models fill a vacuum with negativity: −1.0 for "only a table of contents" is not analysis); (4) why = 3–4 factual sentences, template openings stripped in code, full text via a dialog from the intake card with an SEC link. Forms expanded (5e, owner's pick): + amendments 10-K/A, 10-Q/A, 8-K/A (restatement content lives there; base-form anchors) and activist schedules SC/SCHEDULE 13D, 13G (+/A) — visible in the SUBJECT company's submissions feed (verified on AAPL/JPM), read like 8-Ks (Item 4 "Purpose" is the meat). Deliberately skipped: DEF 14A (neutral boilerplate), S-1/424B (no index IPOs), Form 4 (the cloud insiders pipeline 4j), 13F — its own iteration (filed by funds, not companies; needs a manager universe + CUSIP map). **The EDGAR universe grew to the full S&P 500** (scripts/export-edgar-universe.mts from the D14 GICS snapshot, 502 companies, our 6 lead the list — an interrupted run covers them first); full history per company; overnight runs resume via manifest, with a free-disk guard (stops below 15 GiB). The first night (~7,900 docs, ~2,600 rows) exposed: one bad company killed the whole crawl (the GICS snapshot carried AIG as CIK 5271 instead of 5272 — SEC 404; fixed against the submissions API) — company-level errors are now logged and skipped, the crawl continues.

### 4.32 Iterations 5a/5b: local LLM (Ollama) and the EDGAR local-first pipeline (D50)

**Problem.** News signals are frozen (GDELT rate-limits even manual browser visits — owner-declared moratorium 2026-10-22); the next signal source is SEC EDGAR, and filing tone must be scored by a LOCAL model on the home GPU (free; the cloud LLM bills the owner — billing honesty).

**Solution.**
- **Ollama at home** (RTX 4070 Ti SUPER 16GB): worker/lib/ollama.ts (temperature 0, `think:false` — Qwen3.x reasoning mode would break strict JSON), defensive score extraction (no JSON → the row is SKIPPED, never guessed). Default model **qwen3.5:9b** (owner's find; newer generation, ~6.6 GB, 256K context); bench worker/llm-test.mts: 5 canonical sign cases + tok/s — models are compared by numbers, not marketing (switch via OLLAMA_MODEL).
- **EDGAR pipeline, two decoupled stages:** `edgar-fetch.mts` (network only: full 10-K/10-Q/8-K history since the 1990s via the submissions API, fair access ~3 req/s, disk cache + manifest.json — reruns are free) → `edgar-tone.mts` (GPU only: MD&A cut from 10-K/10-Q and 8-K bodies via a simplified port of the server section parser; 5c: the section is fed WHOLE — num_ctx raised explicitly to 32768 (Ollama silently defaults to 4096!), input cap 80% of context ≈ 104k chars, windows remain a rare guard for >100k texts).
- **Provenance in the key:** payloadKey = `llm:<model>:edgar:<cik>:<accn>` — LLM scores NEVER mix with human Stocktwits labels or GDELT tone; the signals unique index gained payloadKey so re-scoring with a new model lands alongside instead of being eaten by dedupe.
- **Local-first:** rows land in the LOCAL database first (INGEST_URL → 127.0.0.1:3000; seed scripts/seed-local-edgar.mts: new companies META/IBM/LMT + the worker key into local worker_keys) — visual check via local /admin or MySQL Workbench; pushing to prod is NOT a second GPU run — `scripts/push-local-signals.mts` copies new rows (per-source max-id watermark, --dry preview) from the local DB to prod without touching EDGAR again. The /workers console gained edgar-fetch and edgar-tone cards.
- **5c — model rationale:** the prompt asks for `{"score":…,"why":"…"}` — one sentence naming the key fact behind the score; stored in `signals.note` (DDL: db:push), shown in the /admin intake card (why column) and the company Signal stream. Dual purpose: eyeball validation (what the model concluded) + UI content. The parser survives broken JSON (raw newlines inside strings are collapsed before JSON.parse). A truncated WHY cell opens a dialog with the full note, the row's context and a link to the SEC filing itself (parsed from payloadKey). The root cause of zero 8-K scores was fixed the same day: the cover page and the TOC block (including dot-leader entry lines) are skipped, scoring starts at the first Item heading — the model itself reported the problem via notes like "text contains only table of contents entries", proving why-as-validation works. Same day: 8-Ks pull their largest textual exhibit (EX-99.x carries the press release — an earnings 8-K primary doc is cover + one sentence), why grew to 3–4 factual sentences with boilerplate openings ("The text…", "The filing…") banned, and filings without substance are skipped as rows — a table of contents is noise, not a signal. The gate is deterministic, BEFORE the model: isThinContent (too short or >50% TOC-style lines) spends no tokens at all; if the model still scores boilerplate (−1.0 for "only a table of contents" — a vacuum fills with negativity, that's not analysis), the window is dropped via why markers; "The text is/contains…" template openers are stripped in code (sanitizeWhy) since the prompt ban didn't hold.

## 5. Cloud panel (UI)

> Current as of 2026-10-19 (iteration 4h). Auth is local (username/password,
> 4d); every user sees THEIR OWN universe (4c); the admin has the view-as
> lens (4e) and user management (4d); on phones — drawer navigation and
> in-panel table scroll (4g).

- **Login / Signup** (4d) — username/password form (captcha escalates after
  3 failures), public signup with an SVG math captcha and a password policy
  (role is always user). Kimi OAuth removed from the UI (domain change, see
  §4.19);
- **Dashboard** — counters (universe = my active watchlist; jobs =
  running+queued), latest filings of MY selection, jobs; launcher buttons
  are admin-only (D31);
- **Universe** — MY selection (4c): the membership table (switch active =
  hide/show for me; trash = remove from my list, logged as a micro-job,
  re-add = like new); adding a ticker uses SEC-directory autocomplete (ticker
  OR name); companies not yet in the DB get an INGESTING badge (auto-ingest);
  admin extras: Scope Builder (index chips, GICS selectors, per-user
  presets), Bootstrap S&P 500, the GICS button;
- **Screener** (4a/4c) — MY selection's metrics table: price/change, market
  cap, P/E TTM, EPS TTM, FCF margin TTM, 5Y beta, 52w position, avg volume,
  revision rate, sentiment; sort/filter; per-user external_cache payload +
  admin Rebuild;
- **Company /:ticker** — tabs: Overview (price block 4f: honest day-change
  label with freshness date, Δ%/Δ$ of the selected range, arbitrary-period
  Brush, 8-K earnings markers; below: company card, corpus counters,
  data-health rollup + flagged series) · Fundamentals (the unified statements
  grid 4f: 20 quarters / 10 years, quarterly/annual as densities of one grid,
  vintage latest/first/as-of, "tag ended …" markers, health/partial behind
  the debug toggle; the series explorer below) · Documents · **Sentiment** —
  CONDITIONAL, shown when scores exist;
- **Company Overview additions (5f/6b):** Institutional ownership card (13F:
  holders, $held, % of shares outstanding, QoQ delta, top holders) and the
  Next-quarter up-probability card (walk-forward Bayes with macro prior,
  hit rates, factors used with |IC|, calibration bins). VALUE tab also carries
  the Factor IC card (6a). Signals tab: 7d aggregates, signal stream,
  quarterly briefs;
- **Fund flows** (5g-3D, owner-only) — 3D fund×company graph: outer ring of
  funds by tier, inner ring of companies by GICS sector, QoQ position edges
  (green inflow/red outflow), hover details, click-to-focus;
- **Jobs & Logs** — a user sees their own queue (auto-ingests); the admin
  gets the launcher and everyone's jobs with launcher names; live console;
  cancel: own jobs (user) / any (admin); acceptance/completion/error toasts;
- **Messages** (4e) — messenger: contacts (all users, name/username search,
  unread badges, "seen"), DMs between any pair; the admin gets a per-user
  info panel (activity: logins 7d, pages 24h, last seen + event log, D35);
  unread badge in the nav; single-pane on phones (4g);
- **Database** (owner-only, /admin → Tools) — filings and raw-fact browser;
- **Sentiment Lab** (owner-only, /admin → Tools) — scoring coverage by
  version, billed-token counter, pre-registered validation protocol with the
  sample-readiness traffic light, quality gates, academic grounding;
- **Admin** (owner-only) — Manuals (EN/RU + LLM context, disk/bundled source
  of truth), Job Logs (full log up to 2000 lines), **Users** (4d: list with
  summaries, create/delete/reset password/role, view-as button, D36), Tools
  (Database, Lab, Bulk price archive import), **Factor IC monitor (6a)** next
  to the workers intake card;
  shown), Job Logs (full log up to 2000 lines), **Users** (4d: list with
  summaries, create/delete/reset-password/role, view-as button, D36), Tools
  (Database, Lab, Bulk price archive import).

## 6. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | DuckDB local → MySQL cloud; parquet export retained | platform requirement; quant stages unaffected |
| D2 | Store ALL fact revisions, first/latest/as_of modes | lookahead-bias elimination in backtests |
| D3 | Q4 derived as FY − 9M YTD | no Q4 10-Q exists |
| D4 | Documents: immutable raw HTML + derivable plaintext with parser_version | re-derivation without re-downloading from SEC |
| D5 | Canonical document key = path shared by cloud and local mirror | transparent storage migration |
| D6 | Task queue in DB, interchangeable executor (cloud/local worker) | Variant C hybrid without UI rewrites |
| D7 | Restatement frequency is a Stage 4 feature, not only a QC metric | accounting risk → future underperformance |
| D8 | GICS (sector/industry) only from the S&P 500 table; NASDAQ-100 ICB is NOT mixed in | one classification for the sector:/industry: scope grammar |
| D9 | Single scope grammar (universe\|sp500\|ndx\|dow\|sector:…\|industry:…\|preset:…\|list) + exclude; one resolveScope for all jobs | the "click-to-exclude" requirement; presets in settings |
| D10 | Sections = offsets into plaintext, no text duplication; TOC disambiguation; SIGNATURES truncation | storage economy; reproducibility via parser_version |
| D11 | Scores are versioned, never overwritten; idempotency checked BEFORE the LLM call; evidence machine-verified | billing discipline + anti-hallucination filter |
| D12 | Cloud scoring = calibration prototype (temp=1); production = local worker (temp=0+seed, GBNF) | the k3-agent gateway rejects temp≠1; reproducibility lives on the worker |
| D13 | Pre-registered validation: Spearman ρ 0.15–0.25 aggregate-only, n≥30 filings, gates verbatim≥90% / tone_delta 100% | data-snooping protection; ρ is not computed on small samples |
| D14 | GICS classification — static S&P 500 snapshot (as-of 2026-10-11) in api/services/gics-snapshot.ts, manual quarterly refresh; live Wikipedia fetch only as an optional refresh with snapshot fallback | index membership changes 2–5 times/year; fragile runtime Wikipedia parsing is unreachable from the sandbox and irrelevant for new companies (no 2–5 years of history → they would not qualify anyway) |
| D15 | Service information (manuals, full job logs) lives in /admin, adminQuery guard + menu item hidden for role!="admin" | the owner reads manuals/logs in the browser; user-level accounts see the section neither in the UI nor via the API (FORBIDDEN) |
| D16 | GICS enrichment runs automatically at the end of every bootstrap job; the Enrich button is removed | the manual step was forgotten; the snapshot is static, enrichment is cheap and idempotent |
| D17 | jobs.startedBy: an admin sees all jobs with the launcher, a user only their own; legacy NULL rows are admin-only | the requirement "an overview of all jobs with who launched them" for admins, and queue privacy for users |
| D18 | Add Ticker — autocomplete over the SEC directory (company_tickers.json, in-process cache): ticker prefix + name substring | NVDA was findable only by ticker — name search is mandatory; the directory is free and complete |
| D19 | Manuals: disk-first over cwd candidates + a bundled snapshot inside dist/boot.js | production runtime cwd=/code ≠ /app; fs reads of docs/ failed with ENOENT — the bundle guarantees availability |
| D20 | After a terminal job transition the watcher invalidates only the caches that job writes to; a manual admin GICS trigger is kept next to the automatic pass | "nothing displays until you reload" — invalidate() refetches only mounted queries, so exactly the visible table refreshes; enrichment logging names skipped companies with the reason instead of an opaque "0 updated" |
| D21 | Statements viewer = curated line-item map over the canonical series layer (never raw XBRL per page load); derivatives computed in-house; fiscal-quarter labels per company FY end; vintage modes latest/first/as-of | readability of a Tiingo-style statement table without copying design or data; as-of is the exact no-lookahead semantics backtests need; computed derivatives keep provenance inside the engine |
| D22 | Prices: provider abstraction Stooq (primary, keyless CSV) → Yahoo v8 chart (fallback, browser UA + backoff); `source` is part of a bar's key — providers never overwrite each other; accumulation is incremental and resumable (cursor = MAX(date), stalest-first ordering); all Overview stats computed in-house; bid/ask and analyst targets deliberately absent | free EOD sources are unreliable individually but interchangeable; the "load and accrue, no real-time needed" directive — a resumable backfill survives rate limits and cancellations; UI honesty: only numbers we can stand behind |
| D23 | Bulk price archive import = browser-side 32 MB chunked upload (100 MB storage / 50 MB Hono limits) into `prices-import/<batch>/part-NNNN.bin`, then one streaming unzipper pipeline that imports ONLY universe tickers + SPY; parts kept as the sample archive; explicit TEMPORARY CRUTCH with TODO for full-history import and home-worker automation | the cloud runtime cannot reach Stooq/Yahoo (proven by the failed production job), and a 516 MB zip fits neither the storage file cap nor the request body cap; universe-only import keeps DB growth bounded while the accumulation model stays intact; keeping the parts makes the import reproducible and auditable |
| D24 | Jobs execute strictly one at a time: global FIFO queue (drainChain) in the runner; queued rows are cancellable (requestCancel flips them to cancelled immediately); prices: per-source incremental cursors + per-date source merge; pairwise tone_delta like-with-like only (same base form); FCF=null without capex | concurrent runs raced on the same tables and double-hit SEC; one-at-a-time = the future home worker's semantics; mixed sources must not mask each other's gaps; an annual MD&A must not be compared against a quarterly one; an honest null beats pretty coverage |
| D25 | Job cancel returns an honest CancelAction (flagged / force-cancelled / not-cancellable); orphans without a live executor flip to cancelled immediately; a worker-start sweep marks all running/queued rows as error "worker restarted" | in-memory flags don't survive a redeploy but DB rows do — the cancel button was "silent" precisely on orphans; a silently hanging RUNNING is worse than an honest ERROR |
| D26 | Archive upload: multi-file selection (pre-split or the whole zip), ADAPTIVE slicing (8 MB start, 413 → global halving + batch restart under a new id), 3× retries, resume via localStorage + server-side part listing; Reset never deletes parts | the platform edge rejected a 32 MB body (413) before our code ran — the exact limit is unknown, so the size self-adjusts; part indices are positional, hence a size change means a new batch; the server listing is the only honest resume base (storage keys carry random suffixes) |
| D27 | Slow external data (SEC 12k directory, Wikipedia index constituents) is cached in the DB (`external_cache`, 24h/72h TTL) with stale-while-revalidate; universe removal is display-only (flag) — data stays forever | "fetch once → DB → nobody waits": a cold process after a deploy no longer makes the first user pay external latency; a non-critical action (hiding a company) should require no admin and must not destroy paid-for/accumulated data |
| D28 | Screener = universe table of in-house metrics, payload in external_cache (20h TTL), background rebuild after every relevant job; earnings events materialize from our own 8-Ks (Item 2.02, token match) into the `events` table (eventDate=reportDate??filingDate), markers on the price chart; the stream fills items for fresh 8-Ks | "our own" data is faster and more honest than external calendars; a cached payload is the "compute once → everyone reads" principle; 8-K events are point-in-time out of the box (filed date), an external earnings calendar is neither needed nor more accurate |
| D29 | Universe removal = a global view-level removedAt/removedBy flag on companies (no per-user table, no localStorage); inactive-only (CONFLICT otherwise); restore via the table search; re-ingest clears the removal; the action is logged as a terminal micro-job (jobs.type extended, startedBy = actor) + a job_logs who/what/when line; the watcher skips these types | the owner's verbatim call: "just remove from the universe, the DB is shared, the companies' state stays untouched, the fact goes to the logs with meta"; per-user exclusions deferred until non-owner users exist; a micro-job instead of drainChain — a click must not join the FIFO queue. ⚠️ SUPERSEDED by D30 in 4c |
| D30 | Universes are PER-USER: user_universe(userId, cik, ticker, name, active); switch = active, trash = my row deleted, re-add = fresh active row (like new); scope "universe", presets, screener (key screener:u<id>), dashboard feed and counters — all per-user; the price-import wanted set = the union across users; not-yet-ingested companies show INGESTING; inUniverse/removedAt/removedBy deprecated in code, untouched in DB | "each user creates their own world and selection of companies; the DB stores the data" — an Ameritrade/Robinhood-style terminal on a quarterly horizon; shared accumulation serves everyone |
| D31 | Users are read-only over the shared DB: all job launchers are adminQuery; jobs.cancel covers own jobs only; the single sanctioned user write = adding a ticker (membership + light single-ticker auto-ingest server-side, startedBy = user) | "everyone pulls information from the DB but cannot modify or delete it there (except the admin)"; SEC traffic and billing are the owner's responsibility |
| D32 | Admin ↔ user chat: messages table, one private thread per user (support-chat), /messages page, 8 s polling, readAt unread tracking, sidebar badge + toast | "let the user be able to message the admin… a messenger-style chat between the admin and users" — the channel for coverage-update requests |
| D33 | Local username/password auth replaces Kimi OAuth: users += username/passwordHash (scrypt PHC, timing-safe); the session reuses the Kimi JWT signer (api/kimi untouched); login-guard (captcha after 3 failures, 5/10-min lock, signup 5/h/IP) + a self-contained SVG math captcha; public signup with a password policy, role always user; admin/9999 on the owner's row id=1, demo user/1111, other Kimi-era accounts deleted; user management in Admin → Users | the alphadelta.kimi.pro domain was deleted and is unreclaimable, and the OAuth app is bound to its callback — Kimi login is dead; the owner's verbatim directive: "replace the auth method with login and password… this ships to prod" |
| D34 | Chat = messenger: contacts (all users, name/username search, unread, "seen"), DMs between any pair (messages.convKey/recipientId); the admin can initiate and read any thread (oversight, disclosed in the UI) | "add the user list as contacts in messages… users get the admin plus the ability to write other users" — owner's directive; pairwise model over user↔admin threads |
| D35 | Activity collection: activity_events (login/signup server-side, page views via the 60 s-dedupe client tracker); admin per-user summary (universe/messages/jobs/logins 7d/pages 24h/last seen + event log) | "an info summary — who what when — and an activity log; collect it at login and during site work" — owner's directive |
| D36 | Admin view-as lens: x-view-as header + effectiveUserId on read endpoints; writes refuse (PRECONDITION_FAILED); amber banner + Exit | "a backdoor for a full overview of what a specific user sees, from the admin account" — read-only by construction; writing as the user is impossible |
| D37 | Fundamentals integrity: the facts replace is transactional (empty payload = keep + warn; cancel before the wipe, never inside); quarter derivation generalized over same-FY-start YTD pairs with observed-end adjacency (the old FY−9M matched end dates and never fired); statements merge alternate tags per cell; a discontinued tag gets a staleSince marker, not a hole; health/partial indicators behind a debug toggle | the owner's AAPL review: empty FQ4 columns, half-empty interest expense, an unreadable asterisk; "the goal is to enrich and hold one integral concept database" |
| D38 | Price block: honest day-change label with the freshness date; the selected range's Δ%/Δabs + hi/lo computed in the browser from shipped bars; arbitrary period via recharts Brush → SELECTION stats | "ours is not a live feed, show the freshness date" + "% by chart scale" + "pick two points on the chart" — owner's directives; answer: on the fly in the browser, no tables needed |
| D39 | Mobile layout: sidebar → drawer below md, min-w-0 on the main flex column, tables scroll inside their panels, single-pane Messages, wrapping toolbars; auth.me sanitized (was a passwordHash leak) | "completely unusable on the phone" — owner's directive; tested on the real build via playwright at 390×844 |
| D40 | Documentation is a living artifact with an as-of date (§5/§8 rewritten on divergence); NOW PROD TODOs get closed in code (the items backfill); tsc stays at zero — it caught a real pairwise bug | "looks like not everything is marked as of today" — the owner on documentation; zero-tsc paid off immediately |
| D41 | Factor library + intrinsic value — all from our own tables, pure functions + tests; the design memo precedes the code; processing scoped to 2–3 companies; heavy pulls and LLM nuance are the local worker's debt (listed in LLM_CONTEXT) | "take everything that's free, no point burning agent credits, the local machine will grind later — we code the loading and processing schema" — the owner's verbatim directive |
| D44 | Factor readability = the factor-meta.ts registry (touch-friendly popover hint, /wiki entry with academic anchors, reference = literature threshold or the company's own robust median+IQR band, ▲/▼/— signal rule); signal collectors run on the home worker (datacenter egress is blocked/throttled) | "the icons must explain, complex factors get a wiki page, reference values tolerant of gaps and extremes" — owner's directive; the 2026-10-19 network probes are on record in the memo |
| D45 | The home worker writes into the app over HTTP (POST /api/worker/ingest, Bearer key hashed in worker_keys via SHA-256, server-stamped ingestedAt, INSERT IGNORE ≤500 rows); the DB is unreachable from outside (privatelink) — no direct writes by construction; the worker template is alpha_engine/worker (Python) | the privatelink DB is unreachable externally; D6 (DB-row queue, interchangeable executor) gets an honest transport; no client keys — hashes only |
| D46 | Short interest settlement-dated (yahoo_gw now, FINRA primary for the worker); insider_cluster = ≥3 distinct insiders, P only, no 10b5-1, 30d window, filingDate = max filed; FRED macro_points carry realtimeStart/End per row | SI is an overlay, never standalone (Boehmer et al. 2010); clusters follow Cohen–Malloy–Pomorski discipline; macro vintages get the same D2 discipline as XBRL |
| D47 | Quote-grid metric history is pre-computed (metric_history, month-ends), tiles click through to a chart dialog; splits normalize EXACTLY (Yahoo stock actions) with the sourceFiled guard against restatement double-counting; EPS scales the other way (÷) | "pre-calculate and store as a static table so display is immediate" — owner's directive; lesson: nominal share counts × adjusted prices are incompatible by construction |
| D48 | Datacenter-blocked collectors live in worker/ on the home machine; transport is the ingest endpoint only; prod→home data as read-only snapshots, code home→cloud via git + deploy key | network reality proven in 4j (hard-429/403); honesty: ingestedAt is server-stamped only, payloadKey dedupe makes redeliveries free |
| D49 | Home workers are operated from the local /workers page (LOCAL_WORKER_UI=1 gate), delivery is verified via workersMonitor on /admin; machine-changing actions live on the home console only, never in prod | owner's terminal blindness; billing honesty: a spawn surface has no right to exist in the cloud |
| D50 | Filing tone is scored by a local model (Ollama, qwen3.5:9b default) on the home GPU; the pipeline is local-first: local DB + visual check, then the same worker pushes to prod; model provenance rides in payloadKey, the signals UQ gained the key | cloud LLM bills the owner, local is free; dev mode demands verifiability before prod; re-scoring with a different model must not be eaten by dedupe |

## 7. Glossary

- **CIK** — Central Index Key, the SEC issuer identifier;
- **Accession number** — filing identifier (format 0000000000-00-000000);
- **XBRL / facts** — machine-readable statement facts (concept, period, value, unit);
- **MD&A** — Management's Discussion & Analysis, 10-K/10-Q section (Item 7);
- **Vintage / as_of** — the state of data known on a specific date;
- **Restatement** — revision of previously reported figures;
- **8-K Item 4.02** — formal non-reliance announcement (prior statements unreliable);
- **EX-99.x** — 8-K exhibit, usually a press release.
- **GICS** — Global Industry Classification Standard (sector/industry), source — S&P 500 constituents table;
- **Scope / exclude** — ticker selection grammar with member click-exclusion;
- **Verbatim evidence** — a literal quote from the source; machine substring check;
- **tone_delta** — pairwise MD&A tone-change score vs the prior period (−1..+1);
- **Pairwise mode** — scoring with both periods' MD&A in one context;
- **Pre-registered protocol** — metrics and thresholds fixed before data collection;
- **adminQuery** — tRPC procedure guarded by role="admin"; the platform /admin section.

## 8. Current limitations (honestly)

> Current as of 2026-10-19 (iteration 4h).

- Prod lives on **alphadelta-2.kimi.pro**; alphadelta.kimi.pro was deleted by the owner and is unreclaimable on the platform. Kimi OAuth is dormant (its callback is bound to the dead domain) — production auth is local (4d). The prod DB is `1a141806-…` (4d fork, canonized in 4e; the old DB was dropped);
- In the cloud phase, full-text storage covers a test scope (AAPL, MSFT, PLD); storage quota 10 GB;
- Stream = scheduled cycles, not a perpetual daemon (daemon = local worker);
- Earnings call transcripts — experimental, free sources are unstable;
- Stage 5 conformal intervals need accumulated prediction history (warm-up);
- The cloud LLM gateway accepts only temperature=1 (k3-agent) → cloud scores are not bit-reproducible; this is calibration, not production;
- LLM calls and storage are billed to the site owner — token counter in Sentiment Lab;
- NDX/Dow membership resolution needs Wikipedia (honest n/a when unreachable); S&P 500 and GICS enrichment work offline from the static snapshot (D14);
- The Add Ticker autocomplete refreshes on process restart (in-process SEC directory cache);
- Login rate-limits and captcha live in process memory (a restart resets them; single-instance deployment, D25);
- The view-as lens (4e) is read-only by construction; writes under it are rejected server-side;
- Scoring coverage as of iteration 3b: 2 companies × 3 documents × 9 aspects (rubric v2) = 54 rows; validation ρ not yet computed — sample < 30 filings and < 20 companies.
