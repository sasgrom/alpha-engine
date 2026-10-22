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

### 4.34 Iteration 5d: LLM crowd read for Stocktwits

Alongside the deterministic rows (label from self-tagged bullish/bearish, buzz) comes an LLM row: the model reads the 30 latest messages per ticker and returns crowd mood + 3-4 sentences of "what they're discussing" — including the unlabeled majority the deterministic label never sees. Provenance stays separate: `llm:<model>:stocktwits:…` keys (blending with human labels is a digest-time concern, not a store concern). The GPU is no failure point: daemon down → deterministic rows only. 5c gates: thin threshold 1200→700 + material-Item whitelist (5.02, 2.02, 4.01…) on non-TOC lines; tone gained `--from` (rescore the last N years) and `--include-skipped` (by default known boilerplate no longer re-burns GPU on every incremental run — a bug the owner caught via the error aggregate).

### 4.33 Iteration 5c: scoring quality and the S&P 500

From the first NVDA runs (owner eyeballing via why): (1) MD&A extraction verified against REAL NVDA documents — three TOC shapes fixed (bare label line, nbsp page-number line) plus the duplicate Item 2 in a 10-Q (Part I vs Part II); SIGNATURES truncates at the LAST occurrence (the TOC lists "Signatures" too); (2) 8-Ks pull the largest textual exhibit EX-99.x — where press releases live; (3) a deterministic isThinContent gate before the LLM + boilerplate-window drops via why markers — a score exists only when there is content (models fill a vacuum with negativity: −1.0 for "only a table of contents" is not analysis); (4) why = 3–4 factual sentences, template openings stripped in code, full text via a dialog from the intake card with an SEC link. **The EDGAR universe grew to the full S&P 500** (scripts/export-edgar-universe.mts from the D14 GICS snapshot, 502 companies, our 6 lead the list — an interrupted run covers them first); full history per company; overnight runs resume via manifest, with a free-disk guard (stops below 15 GiB). The first night (~7,900 docs, ~2,600 rows) exposed: one bad company killed the whole crawl (the GICS snapshot carried AIG as CIK 5271 instead of 5272 — SEC 404; fixed against the submissions API) — company-level errors are now logged and skipped, the crawl continues.

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
