export type OperationMode = "scheduled" | "paused" | "manual" | "frozen" | "blocked";
export type OperationGroup = "live" | "sec" | "fundamentals" | "options" | "expectations" | "research" | "delivery" | "maintenance";
export type OperationRequirement = "network" | "server" | "gpu" | "mysql" | "driveD" | "review" | "windows";

export interface OperationJob {
  id: string;
  name: string;
  group: OperationGroup;
  mode: OperationMode;
  cron: string | null;
  defaultEnabled: boolean;
  dependsOn: string[];
  executable: "npx" | "npm" | null;
  args: string[];
  command: string;
  purpose: string;
  input: string;
  output: string;
  destination: string;
  requirements: OperationRequirement[];
  notes: string;
}

const job = (value: OperationJob): OperationJob => value;
const npx = (script: string, args: string[] = []) => ({ executable: "npx" as const, args: ["tsx", script, ...args], command: `npx tsx ${script}${args.length ? ` ${args.join(" ")}` : ""}` });

export const OPERATION_JOBS: OperationJob[] = [
  job({
    id: "stocktwits-hourly", name: "Stocktwits hourly pulse", group: "live", mode: "scheduled", cron: "30 * * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/stocktwits.mts"), purpose: "Capture the latest public message window without disturbing EDGAR or the GPU.",
    input: "worker/universe.json; public 30-message stream per active ticker.", output: "Deterministic buzz and labeled-sentiment rows; optional local-LLM crowd rows when Ollama is available.",
    destination: "Reviewed deterministic rows use the existing direct ingest contract; probation LLM rows follow INGEST_URL.", requirements: ["network", "server"], notes: "Reruns dedupe by newest message payload key. The GPU is never a hard dependency for deterministic rows.",
  }),
  job({
    id: "edgar-fetch-daily", name: "EDGAR filing cache refresh", group: "sec", mode: "scheduled", cron: "0 2 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/edgar-fetch.mts", ["--universe", "edgar-universe.json"]), purpose: "Incrementally cache new 10-K, 10-Q, 8-K and amendments before any LLM work.",
    input: "SEC submissions and filing documents; edgar-universe.json; existing per-CIK manifests.", output: "Raw filings and atomic manifests under the EDGAR cache on the large archive drive.",
    destination: "Local raw cache only; no production write.", requirements: ["network", "driveD"], notes: "Network-only. Existing manifests make reruns incremental. This is the parent of the paused tone lane.",
  }),
  job({
    id: "edgar-exhibits-daily", name: "Complete EX-99 expectations cache", group: "expectations", mode: "scheduled", cron: "20 2 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/edgar-exhibits.mts", ["--universe", "research-universe-50.json"]), purpose: "Preserve every substantive earnings exhibit, including the main release and supplements.",
    input: "SEC exhibit-bearing filings for the current 50-name expectations universe.", output: "Hash-linked EX-99 cache with completeness metadata.",
    destination: "Local expectations cache only.", requirements: ["network", "driveD"], notes: "Independent from the legacy tone exhibit selection; never reduces documents to the largest exhibit.",
  }),
  job({
    id: "facts-fetch-daily", name: "Companyfacts local snapshot", group: "fundamentals", mode: "scheduled", cron: "0 3 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/facts-fetch.mts", ["--universe", "research-universe-50.json"]), purpose: "Refresh SEC XBRL companyfacts into local MySQL with first-filed availability intact.",
    input: "SEC companyfacts JSON and research-universe-50.json.", output: "One complete, validated facts snapshot per CIK; raw JSON remains cached on D:.",
    destination: "Local MySQL through the local factsSnapshot ingest route; no production write.", requirements: ["network", "server", "mysql", "driveD"], notes: "Requires exactly one reachable local web server on port 3000 and INGEST_URL pointing to it.",
  }),
  job({
    id: "sp500-facts-daily", name: "S&P 500 incremental companyfacts", group: "sec", mode: "scheduled", cron: "30 23 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/facts-fetch.mts", ["--universe", "edgar-universe.json"]), purpose: "Collect relevant new SEC companyfacts for the deduplicated S&P 500 snapshot without redundant full downloads.",
    input: "Deduplicated edgar-universe.json, recent financial/XBRL forms and amendments, shared per-CIK raw cache and atomic manifests.", output: "Resumable per-CIK raw snapshots and manifest transitions with a staggered seven-day full reconciliation baseline.",
    destination: "Local MySQL and the D:-only raw cache; no production write and no research-universe expansion.", requirements: ["network", "server", "mysql", "driveD"], notes: "Independent from research-50: failures never block its dependency chain, and this job has no research-series/factors downstream.",
  }),
  job({
    id: "research-series", name: "Canonical research series", group: "fundamentals", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["facts-fetch-daily"],
    ...npx("scripts/build-research-series.mts", ["--universe", "research-universe-50.json"]), purpose: "Convert current local facts into canonical vintage-aware series points.",
    input: "Local facts snapshots written by facts-fetch-daily.", output: "Atomically replaced series_points per CIK.",
    destination: "Local MySQL.", requirements: ["mysql"], notes: "Dependency-triggered after a successful facts refresh; no SEC request and no arbitrary delay guess.",
  }),
  job({
    id: "research-factors", name: "Research factor materialization", group: "fundamentals", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["research-series"],
    ...npx("scripts/materialize-research-factors.mts", ["--universe", "research-universe-50.json"]), purpose: "Materialize point-in-time factor points from the new canonical series and available prices.",
    input: "Local series_points and existing research price history.", output: "Idempotent factor_points per company.",
    destination: "Local MySQL.", requirements: ["mysql"], notes: "Does not claim new predictive evidence; evaluation remains a separate research job.",
  }),
  job({
    id: "schwab-fetch-daily", name: "Schwab REST daily snapshot", group: "options", mode: "scheduled", cron: "0 4 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-fetch.mts", ["--universe", "research-universe-50.json"]), purpose: "Capture chains, quotes, daily price history and instruments with hashes and availability timestamps.",
    input: "Schwab Market Data Production; local token file; research-universe-50.json.", output: "D:-only raw snapshots and a resumable manifest; User Preference status is recorded separately for streaming setup.",
    destination: "Raw chains remain local; successful scheduled runs automatically push QA-passed daily OHLCV and daily-prices-schwab.json through /api/worker/ingest.", requirements: ["network", "driveD"], notes: "Same-day complete tickers resume without redownloading. Automatic operational push is allowed only after exit-ok with one retry; a push failure marks the job error. No raw option chains, accounts or orders leave home. User Preference 401 does not invalidate REST data.",
  }),
  job({
    id: "schwab-snapshot", name: "Schwab normalized UI snapshot", group: "options", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-fetch-daily"],
    ...npx("worker/build-schwab-market-data.mts"), purpose: "Normalize the latest valid chain per ticker and expose credential-free static data to /market-data.",
    input: "Latest Schwab manifest entries and raw chains.", output: "public/reports/schwab-market-data.json with OSI IDs, DTE and QA, fetched on demand by /market-data.",
    destination: "Normalized snapshot automatically pushed as schwab-market-data.json after exit-ok; raw chains stay local.", requirements: ["review"], notes: "Hash mismatches, truncated chains and provider failures remain visible. Only the normalized report enters the automatic operational lane; no factor promotion.",
  }),
  job({
    id: "schwab-feature-lab", name: "Schwab Feature Lab materialization", group: "options", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-snapshot"],
    ...npx("worker/schwab-features.mts"), purpose: "Materialize small provider-specific ATM IV, expected-move, DTE, skew, put/call, turnover, spread and RV20 feature snapshots.",
    input: "Latest normalized Schwab snapshot, raw daily price history and manifest.", output: "public/reports/schwab-features.json and an updated production copy with source-snapshot lineage.",
    destination: "Local Feature Lab UI only; no production factor promotion.", requirements: ["review"], notes: "0DTE expected move and RV20 remain null when their inputs are insufficient. Skew and IV−RV20 are descriptive, not directional signals.",
  }),
  job({
    id: "schwab-context-hourly", name: "Schwab market context pack", group: "options", mode: "scheduled", cron: "10 * * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-context.mts"), purpose: "Refresh market hours, S&P/Nasdaq/Dow movers, instrument profiles and AAPL/SPY five-minute bars separately from option chains.",
    input: "Schwab Market Data Production, existing instrument files and the local token.", output: "schwab-context.json with sessions, movers, primitive fundamental fields, intraday VWAP/opening range and per-endpoint provenance.",
    destination: "schwab-context.json automatically pushed through reportFile after successful scheduled runs; no accounts, orders or full-universe streaming.", requirements: ["network", "driveD"], notes: "Hourly context is independent of daily option features. Missing endpoints remain visible; push failure marks the job error after one retry. No GPU is used.",
  }),
  job({
    id: "analytics-snapshot", name: "Analytics and weekly evidence snapshot", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["research-factors"],
    ...npx("scripts/build-analytics-snapshot.mts"), purpose: "Refresh Analytics metrics and weekly evidence from the current DB and option manifests.",
    input: "Local fundamentals, factors, tone, prices, 13F and option feature manifests.", output: "Generated analytics JSON/TypeScript and the English project-strength review.",
    destination: "Local static UI artifacts; no production write.", requirements: ["mysql", "review"], notes: "Preserves prior weekly snapshots and does not invent missing history.",
  }),
  job({
    id: "expectations-report", name: "Expectations static report", group: "expectations", mode: "scheduled", cron: "0 6 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/build-expectations-report.mts", ["--cohorts", "--scope", "full-history"]), purpose: "Publish the current local extraction and factual fallback notes to the owner-only UI without raw LLM responses.",
    input: "Current cohort extraction results, benchmark result when present, and research-universe-50.json.", output: "Credential-free expectations JSON and TypeScript with evidence, coverage and data-quality notes.",
    destination: "Local static UI artifacts; partial results remain explicitly unreviewed.", requirements: ["review"], notes: "Safe even while extraction is paused: it reports the actual partial state instead of fabricating completion.",
  }),
  job({
    id: "macro-fred-weekly", name: "FRED and ALFRED weekly vintage refresh", group: "research", mode: "scheduled", cron: "30 5 * * 0", defaultEnabled: true, dependsOn: [],
    ...npx("worker/macro-fred-fetch.mts", ["--group", "all"]), purpose: "Refresh all registered FRED series with raw yearly chunks, vintage availability and resumable manifests.",
    input: "FRED/ALFRED API, existing D:-only macro archive and the configured server-side API key.", output: "Raw hashes, normalized first-to-current vintage rows and manifest-fred.json from 2000 onward.",
    destination: "Normalized vintage rows automatically pushed through macroPoints after exit-ok; raw FRED chunks stay local.", requirements: ["network", "driveD"], notes: "Weekly full-vintage refresh preserves sourceHash and realtimeStart/End. Conflicting vintages are rejected with reasons rather than overwritten. Request spacing remains capped at 100 requests per minute.",
  }),
  job({
    id: "macro-events-daily", name: "OFAC daily event refresh", group: "research", mode: "scheduled", cron: "40 5 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/macro-events-fetch.mts", ["--pages", "1"]), purpose: "Merge the latest official OFAC Recent Actions page into forward-only event history.",
    input: "OFAC Recent Actions HTML and the existing normalized event archive.", output: "manifest-events.json and idempotent ofac-events.json with publication-day availability.",
    destination: "Local macro archive only; no production write.", requirements: ["network", "driveD"], notes: "Uses the current HTML endpoint, not the retired RSS feed. Zero new events is valid; an empty parsed page fails closed.",
  }),
  job({
    id: "macro-manifest-qa", name: "Macro manifest and availability QA", group: "research", mode: "scheduled", cron: "55 5 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/macro-manifest-qa.mts"), purpose: "Audit raw hashes, required series, normalized row counts, duplicates, availability inversions and the 2000+ research window every day.",
    input: "Current FRED and OFAC manifests and normalized artifacts on D:.", output: "worker/.runs/macro-manifest-qa.json with pass, warn or fail evidence.",
    destination: "Local fail-closed QA gate only.", requirements: ["driveD"], notes: "Independent of the weekly FRED parent so daily OFAC changes are audited daily and a failed collector cannot suppress QA.",
  }),
  job({
    id: "company-exposure-evidence", name: "Company macro exposure evidence", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["research-factors"],
    ...npx("scripts/build-company-exposure.mts", ["--universe", "research-universe-50.json"]), purpose: "Materialize debt, interest, fuel, oil and geography exposure only from aligned canonical SEC evidence.",
    input: "Local canonical series and the 50-name research universe.", output: "company-exposures.json and .md with availability, period alignment, missing and stale flags.",
    destination: "Local static evidence only; no production write.", requirements: ["mysql", "review"], notes: "Runs after current research factors so scenario inputs cannot silently use an older fundamental snapshot.",
  }),
  job({
    id: "pilot-exposure-evidence", name: "Pilot SEC exposure evidence refresh", group: "research", mode: "scheduled", cron: "5 6 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("scripts/build-pilot-exposure-evidence.mts"), purpose: "Refresh DAL, RCL, CVX, COP and PFE exposure evidence from fresh SEC companyfacts without sector inference.",
    input: "SEC companyfacts and exact exposure concepts for the five pilot companies.", output: "pilot-exposure-evidence.json and .md with concept, period, source hash and availability lineage.",
    destination: "Local static evidence only; no production write.", requirements: ["network", "driveD", "review"], notes: "Missing geography and hedge evidence stays missing. Fresh SEC facts are collected locally only.",
  }),
  job({
    id: "macro-scenarios", name: "Availability-anchored macro scenarios", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["macro-manifest-qa", "company-exposure-evidence", "pilot-exposure-evidence"],
    ...npx("scripts/build-macro-scenarios.mts"), purpose: "Recompute rate, oil, USD and credit scenarios after QA and current SEC exposure evidence.",
    input: "Normalized FRED baselines, pilot evidence and company exposures.", output: "macro-scenarios.json and .md with formulas, provenance and computability status.",
    destination: "Local Scenario Lab only; no production write.", requirements: ["driveD", "review"], notes: "Upper bounds and gross exposure are not profit forecasts. Missing or stale evidence remains historical-only or not computable.",
  }),
  job({
    id: "shock-calibration", name: "Historical macro shock calibration", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["macro-manifest-qa"],
    ...npx("scripts/build-shock-calibration.mts"), purpose: "Calibrate historical shock percentiles and moving-block confidence intervals after manifest QA.",
    input: "Normalized FRED history with availability and vintages.", output: "shock-calibration.json and .md with p50/p75/p90/p95/p99 and CI95.",
    destination: "Local Scenario Lab only; no production write.", requirements: ["driveD", "review"], notes: "Uses latest eligible vintages as of the report cutoff for calibration, explicitly separate from the event study's first-release policy.",
  }),
  job({
    id: "macro-event-study", name: "OFAC first-release macro event study", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["macro-manifest-qa"],
    ...npx("scripts/build-macro-event-study.mts"), purpose: "Measure first-release macro responses to eligible OFAC events with chronological discovery and out-of-sample evidence.",
    input: "Normalized OFAC events and DGS10, WTI, broad USD and high-yield OAS first-release observations.", output: "macro-event-study.json and .md with 1/5/21/63-observation changes and moving-block CI95.",
    destination: "Local research artifact only; no production write or probability promotion.", requirements: ["driveD", "review"], notes: "Baseline must be known at event eligibility and outcomes start on the next observation day. No directional forecast is inferred.",
  }),
  job({
    id: "macro-transmission-atlas", name: "Macro Transmission Atlas", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["macro-event-study", "research-factors"],
    ...npx("scripts/build-macro-transmission-atlas.mts"), purpose: "Estimate company-level macro transmission with point-in-time SEC exposure, market-model returns and frozen discovery-only OOS evaluation.",
    input: "First-release macro event observations, canonical series, daily company and SPY prices.", output: "macro-transmission-atlas.json and .md with sector FE interactions, event-bootstrap CI95 and OOS metrics.",
    destination: "Local research artifact only; no production write or probability promotion.", requirements: ["mysql", "driveD", "review"], notes: "Exposure must be available and non-stale at event eligibility. Debt burden is a proxy, not a floating-rate share. OOS coefficients are never refit.",
  }),
  job({
    id: "ui-production-build", name: "Production UI rebuild", group: "delivery", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["analytics-snapshot", "schwab-feature-lab", "expectations-report"],
    executable: "npm", args: ["run", "build"], command: "npm run build", purpose: "Compile newly generated static snapshots and the server into dist for normal production-mode operation.",
    input: "Current source and freshly generated report artifacts.", output: "dist/public and dist/boot.js.",
    destination: "Local production server files only; no cloud deployment.", requirements: ["review"], notes: "Required for application code or generated TypeScript changes, not for a Schwab-only JSON refresh. Not required for npm run dev; restart production only when server behavior changes.",
  }),
  job({
    id: "daily-digest", name: "Local morning brief", group: "live", mode: "scheduled", cron: "15 7 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("scripts/daily-digest.mts", ["--hours", "36"]), purpose: "Summarize the last 36 hours of actual local signals into a short owner brief.",
    input: "Local signals, local Ollama and the currently configured model.", output: "One morning digest with model and window metadata.",
    destination: "Local probation when INGEST_URL is set; no automatic reviewed production promotion is added by the scheduler.", requirements: ["server", "gpu", "mysql"], notes: "SEC facts and crowd comments stay separate. An empty signal window exits successfully without generating filler.",
  }),
  job({
    id: "daily-operations-report", name: "Daily operations health report", group: "maintenance", mode: "scheduled", cron: "20 7 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("scripts/build-daily-operations-report.mts"), purpose: "Record scheduler health, same-day Schwab evidence, job failures and pending automation in one owner-only static report.",
    input: "Persistent scheduler state, current registry configuration and credential-free Schwab report summaries.", output: "daily-operations.json and .md in public/reports and an existing dist/public/reports bundle.",
    destination: "daily-operations.json and .md automatically pushed through reportFile after exit-ok and served from the fresher of DB/static.", requirements: [], notes: "Runs independently after the morning jobs so failed parents cannot suppress the health report. A critical report is evidence, not a scheduler process failure; its push failure still marks the job error.",
  }),
  job({
    id: "weekly-coverage-report", name: "Weekly coverage and drift report", group: "maintenance", mode: "scheduled", cron: "45 7 * * 1", defaultEnabled: true, dependsOn: ["daily-operations-report"],
    ...npx("scripts/build-weekly-coverage.mts"), purpose: "Compare the latest two inventory snapshots per table with row deltas, content hashes and latest dates.",
    input: "The current reviewed inventory and the previous local inventory snapshot.", output: "weekly-coverage.json and .md with per-table counts, deltas and hash drift.",
    destination: "weekly-coverage.json and .md automatically pushed through reportFile after exit-ok and exposed in Workers → Weekly coverage.", requirements: [], notes: "Baseline-missing is explicit, never a zero-coverage claim. Decreases and hash drift remain visible. The report is operational evidence, not a model evaluation.",
  }),
  job({
    id: "alpha-bridge-agent", name: "Alpha Bridge captain executor", group: "maintenance", mode: "paused", cron: "*/2 * * * *", defaultEnabled: false, dependsOn: [],
    ...npx("worker/alpha-bridge-agent.mts"), purpose: "Execute at most one pending captain command and record its acknowledged terminal evidence.",
    input: "Pending bounded commands in docs/ALPHA_COMMANDS.jsonl and the existing owner authorization in AGENTS.md.", output: "Acknowledged commands with completed, failed or blocked status and bounded evidence.",
    destination: "Local command protocol only; no production transport.", requirements: ["review"], notes: "Paused by default. Enable only after static deny rules are configured for production apply, migrations, credentials, force operations and GDELT. One pending command per run, no automatic resume of interrupted acknowledged commands.",
  }),
  job({
    id: "13f-refresh", name: "13F holdings and full-book refresh", group: "fundamentals", mode: "scheduled", cron: "0 5 * * 1,4", defaultEnabled: true, dependsOn: [],
    ...npx("scripts/13f-refresh.mts", ["--quarters", "4"]), purpose: "Check recent 13F-HR filings and amendments without repeating the full historical build.",
    input: "worker/funds-13f.json, SEC XML, cached CUSIP mappings and OpenFIGI only for unknown securities.", output: "fund_quarters, fund_holdings and deterministic share/full-book-weight events for the latest four quarters.",
    destination: "Local MySQL; production transfer is a separate reviewed manual job.", requirements: ["network", "mysql", "driveD"], notes: "Monday and Thursday checks are sufficient for a quarterly disclosure source with a long filing lag. No LLM is used.",
  }),
  job({
    id: "edgar-tone-nightly", name: "EDGAR local tone scoring", group: "sec", mode: "paused", cron: null, defaultEnabled: false, dependsOn: ["edgar-fetch-daily"],
    ...npx("worker/edgar-tone.mts", ["--universe", "edgar-universe.json", "--concurrency", "2"]), purpose: "Score newly cached filings with local Ollama after the expectations lane is explicitly declared stable.",
    input: "Cached filings, qwen3.5:9b, 32K context and existing score manifests.", output: "Local tone rows, atomic checkpoints, skip taxonomy and token/rate telemetry.",
    destination: "Local MySQL/outbox only; production copy remains reviewed and manual.", requirements: ["server", "gpu", "mysql"], notes: "Paused by default. Enabling it shares the single scheduler lane, so it cannot overlap the expectations GPU run.",
  }),
  job({
    id: "expectations-cohorts", name: "Quarterly cohort pack builder", group: "expectations", mode: "paused", cron: null, defaultEnabled: false, dependsOn: ["edgar-exhibits-daily"],
    ...npx("worker/edgar-cohorts.mts", ["--universe", "research-universe-50.json"]), purpose: "Build deterministic, period-aligned bounded containers from complete guidance and actual blocks.",
    input: "Complete EX-99 cache and filing period metadata.", output: "cohort-pack-v2.json with source hashes and explicit unpacked failures.",
    destination: "Local cache only.", requirements: ["driveD"], notes: "Paused with the active LLM lane so the operator does not accidentally start a second full-history run.",
  }),
  job({
    id: "expectations-extract", name: "Cohort LLM extraction", group: "expectations", mode: "paused", cron: null, defaultEnabled: false, dependsOn: ["expectations-cohorts"],
    ...npx("worker/edgar-cohort-extract.mts", ["--universe", "research-universe-50.json"]), purpose: "Extract guidance, comparable actuals and factual fallback notes with atomic source-level resume.",
    input: "Bounded cohort packs and local Ollama; prompt/schema remain fixed by the research protocol.", output: "cohort-v2.json, structured statements, fallback notes and explicit failures.",
    destination: "Local research files only.", requirements: ["gpu", "driveD"], notes: "Paused by default. Never runs concurrently with tone because the scheduler has one execution lane.",
  }),
  job({
    id: "expectations-benchmark", name: "Independent extraction benchmark", group: "expectations", mode: "paused", cron: null, defaultEnabled: false, dependsOn: ["expectations-extract"],
    ...npx("worker/expectations-benchmark.mts", ["--cohorts"]), purpose: "Compare extraction with the independent gold benchmark before any reviewed status is allowed.",
    input: "Official gold statements and current cohort extraction results.", output: "Recall and exact-field issue report without treating extra review items as automatic errors.",
    destination: "Local benchmark artifact only.", requirements: ["review"], notes: "A report cannot become reviewed merely because extraction completed.",
  }),
  job({
    id: "options-cboe-fetch", name: "Legacy Cboe option snapshot", group: "options", mode: "paused", cron: "30 4 * * *", defaultEnabled: false, dependsOn: [],
    ...npx("worker/options-fetch.mts", ["--source", "cboe", "--universe", "research-universe-50.json"]), purpose: "Maintain the independent delayed-Cboe provider lane for cross-provider checks when explicitly enabled.",
    input: "Cboe delayed public chains for the current research universe.", output: "Immutable raw and normalized provider-specific snapshots.",
    destination: "Local option cache; never silently merged with Schwab or DoltHub.", requirements: ["network", "driveD"], notes: "Paused to avoid maintaining duplicate current-provider lanes without a research need.",
  }),
  job({
    id: "options-features", name: "Offline DTE option features", group: "options", mode: "paused", cron: null, defaultEnabled: false, dependsOn: ["options-cboe-fetch"],
    ...npx("worker/option-features.mts"), purpose: "Compute ATM IV, term slope, skew, put/call and liquidity features from the latest Cboe chain per ticker.",
    input: "Normalized Cboe snapshots.", output: "DTE-bucket feature sets and manifest with actual DTE and honest nulls.",
    destination: "Local option-features cache.", requirements: [], notes: "Dependency-triggered only when the legacy Cboe lane is enabled.",
  }),
  job({
    id: "options-qa", name: "Offline option provider QA", group: "options", mode: "paused", cron: null, defaultEnabled: false, dependsOn: ["options-features"],
    ...npx("worker/options-qa.mts"), purpose: "Audit provider coverage, duplicates, quote quality, IV/Greeks, timestamps and manifest completeness.",
    input: "All normalized option snapshots and provider manifest.", output: "options-qa.json and options-qa.md.",
    destination: "Local QA artifacts only.", requirements: ["review"], notes: "Data quality is not evidence of predictive value.",
  }),
  job({
    id: "schwab-refresh-manual", name: "Schwab token keepalive", group: "maintenance", mode: "scheduled", cron: "0 2 */2 * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-refresh.mts"), purpose: "Rotate the access and refresh tokens every two days so the seven-day refresh-token window does not expire during normal unattended operation.",
    input: "Local refresh token and Schwab client credentials available in the scheduler process environment.", output: "Updated local token file and an AAPL HTTP smoke result; no token values in the UI.",
    destination: "Local credential store only.", requirements: ["network"], notes: "Browser authorization is needed only after revocation, credential/app changes or an outage long enough to lose the refresh window. The daily collector also refreshes an expired access token when credentials are available.",
  }),
  job({
    id: "research-reconciliation", name: "Read-only research reconciliation", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/research-reconciliation.mts"), purpose: "Reconcile facts, series, factors, prices and per-CIK lineage without changing data.",
    input: "Current local DB and research-universe-53.json compatibility baseline.", output: "Coverage and lineage issues; strict failure remains a deliberate manual gate.",
    destination: "Console/log only.", requirements: ["mysql", "review"], notes: "Use --strict manually only after the known registry decision is resolved.",
  }),
  job({
    id: "fundamental-integrity-audit", name: "Fundamental integrity and continuity audit", group: "fundamentals", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/fundamental-integrity-audit.mts"), purpose: "Fail closed on duplicates, unit conflicts, missing periods, availability inversions, continuity gaps and factor-before-fact without modifying the database.",
    input: "Local facts, series_points, factor_points, company registry and research-universe-50.json.", output: "public/reports/fundamental-integrity.json and .md with CIK, concept, period and accession evidence plus explicit omitted-issue counts.",
    destination: "Read-only QA report; no repairs, deletions or silent interpolation.", requirements: ["mysql", "review"], notes: "Run with --strict to block the next research stage on any error. Warnings retain unit changes, irregular durations, revision outliers and concept coverage gaps for review.",
  }),
  job({
    id: "edgar-gap-analysis", name: "EDGAR coverage and continuity gap analysis", group: "fundamentals", mode: "manual", cron: null, defaultEnabled: false, dependsOn: ["fundamental-integrity-audit"],
    ...npx("scripts/edgar-gap-analysis.mts"), purpose: "Group integrity findings by era, concept and unique missing quarter rather than treating all history as equally repairable.",
    input: "public/reports/fundamental-integrity.json with periodEnd >= 2000-01-01.", output: "edgar-coverage-gaps.json and .md with era/type/CIK summaries, deduplicated missing quarters and remediation guidance.",
    destination: "Read-only EDGAR remediation manifest.", requirements: ["review"], notes: "Pre-2000 findings are excluded. Recent gaps trigger EDGAR refresh; historical gaps are not blindly backfilled with current-provider data.",
  }),
  job({
    id: "schwab-fundamental-gap-map", name: "Schwab fundamental gap mapping", group: "fundamentals", mode: "manual", cron: null, defaultEnabled: false, dependsOn: ["edgar-gap-analysis", "schwab-context-hourly"],
    ...npx("scripts/schwab-fundamental-gap-map.mts"), purpose: "Map EDGAR concept gaps to direct, derived and unsupported Schwab fundamental candidates without fabricating XBRL replacements.",
    input: "edgar-coverage-gaps.json, schwab-context.json and the 50-name ticker registry.", output: "schwab-fundamental-gap-map.json and .md with per-concept fields, formulas and vintage-equivalence warnings.",
    destination: "Read-only candidate map for a later reviewed repair plan.", requirements: ["review"], notes: "Direct fields are current metadata, not vintage replacements. Derived formulas are approximate; unsupported concepts stay missing.",
  }),
  job({
    id: "remediate-company", name: "Per-company EDGAR remediation and Schwab fallback", group: "fundamentals", mode: "manual", cron: null, defaultEnabled: false, dependsOn: ["schwab-context-hourly"],
    ...npx("scripts/remediate-company.mts"), purpose: "Run a bounded EDGAR refresh, uncapped per-company integrity audit and only then a defensible Schwab fallback candidate map.",
    input: "One --ticker, EDGAR cache, local facts/series/factors and Schwab instrument profile.", output: "public/reports/remediation/<ticker>.json with stages, errors, recent gaps, availability inversions, candidates and next action.",
    destination: "Local reviewed remediation plan; no automatic value insertion or production sync.", requirements: ["network", "server", "mysql", "driveD", "review"], notes: "Default dry-run. Use --apply for EDGAR network refresh and --strict to fail on remaining errors. One ticker per run; no hidden retries.",
  }),
  job({
    id: "tone-event-study", name: "Availability-anchored tone event study", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/tone-event-study.mts"), purpose: "Estimate abnormal returns and CAR after filings with conservative post-close availability.",
    input: "Local tone events, prices and SPY.", output: "Event-study JSON used by the Analytics CAR chart.",
    destination: "Local research artifact.", requirements: ["mysql", "review"], notes: "Measurement windows are not automatically tradable signals.",
  }),
  job({
    id: "tone-ic", name: "Tone IC and turnover evaluation", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/tone-ic.mts"), purpose: "Validate slow tone against 63/126-session excess returns with block-bootstrap uncertainty.",
    input: "Local tone, prices and the production v1 model provenance.", output: "IC, quantile spread, autocorrelation, turnover and confidence intervals.",
    destination: "Local research artifact.", requirements: ["mysql", "review"], notes: "A research evaluation, not a scheduled production factor rebuild.",
  }),
  job({
    id: "dolthub-export", name: "DoltHub historical option export", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("worker/dolthub-export.mts"), purpose: "Resume the free historical chain export without confusing Dolt with MySQL or SEC fundamentals.",
    input: "Local Dolt CLI and DoltHub option database.", output: "One CSV per ticker/year with hashes and resumable error manifests on D:.",
    destination: "D:-only historical research archive.", requirements: ["network", "driveD"], notes: "Long manual backfill; not a daily job because the historical source does not require nightly recollection.",
  }),
  job({
    id: "dolthub-validate", name: "DoltHub export validation", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: ["dolthub-export"],
    ...npx("worker/dolthub-export-validate.mts"), purpose: "Validate every exported batch, schema, date range, hash and duplicate contract key.",
    input: "DoltHub CSV batches and manifest.", output: "Fail-closed validation report.",
    destination: "Local QA artifact.", requirements: ["driveD", "review"], notes: "Run after export completion or resume; a partial export remains visible as partial.",
  }),
  job({
    id: "dolthub-features", name: "Historical option feature materialization", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: ["dolthub-validate"],
    ...npx("worker/dolthub-features.mts"), purpose: "Materialize schema-v2 per-date features using actual DTE and point-in-time spot lookups.",
    input: "Validated historical CSV and price history.", output: "JSONL option feature snapshots with resume-by-schema manifest.",
    destination: "Local historical feature archive.", requirements: ["driveD"], notes: "Old schemas fail instead of silently producing unusable expected-move data.",
  }),
  job({
    id: "dolthub-research", name: "Preregistered option hypothesis research", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: ["dolthub-features"],
    ...npx("worker/dolthub-research.mts"), purpose: "Run frozen ATM IV, term slope, skew and VRP tests with independent universes and FDR.",
    input: "Historical features, frozen protocol and price labels.", output: "Dated evidence, robustness and multiple-testing results.",
    destination: "Local research artifacts only.", requirements: ["driveD", "review"], notes: "The sealed holdout is not a tuning set.",
  }),
  job({
    id: "expected-move-calibration", name: "Expected-move calibration", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: ["dolthub-features"],
    ...npx("worker/dolthub-expected-move.mts"), purpose: "Compare ATM-IV expected move with RV20 using actual DTE and dollar-denominated realized moves.",
    input: "Schema-v2 option features and forward prices.", output: "Coverage, MAE, RMSE and actual/expected calibration ratios.",
    destination: "Local research artifact.", requirements: ["driveD", "review"], notes: "Supports volatility sizing, not directional accuracy claims.",
  }),
  job({
    id: "volatility-target-replay", name: "Volatility-target historical replay", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: ["dolthub-features"],
    ...npx("worker/dolthub-vol-target.mts"), purpose: "Replay the frozen risk-scalar policy with next-close entry, costs, independent universes and robustness checks.",
    input: "Historical options, prices and vol-target-protocol.json.", output: "Drawdown, volatility, Sharpe and paired net-return evidence.",
    destination: "Local research artifact.", requirements: ["driveD", "review"], notes: "Risk reduction is not automatically return alpha.",
  }),
  job({
    id: "price-archive-import", name: "Stooq price archive import", group: "maintenance", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    executable: null, args: [], command: "npx tsx scripts/import-research-prices-file.mts --file D:\\path\\to\\prices.zip", purpose: "Refresh daily adjusted prices from an explicitly chosen local archive when automated free delivery is unavailable.",
    input: "Operator-supplied Stooq-compatible ZIP on D:.", output: "Upserted daily bars with missing-ticker reporting.",
    destination: "Local MySQL; no browser storage credential required.", requirements: ["mysql", "driveD", "review"], notes: "Not UI-runnable because the operator must supply and review a real file path. Run research-factors afterward.",
  }),
  job({
    id: "signals-dry-review", name: "Signals production dry-run", group: "delivery", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/push-local-signals.mts", ["--source", "edgar", "--dry"]), purpose: "Preview exactly which new local EDGAR signal rows would leave the machine.",
    input: "Local signals and per-source watermark.", output: "Counts and coverage only; no network delivery.",
    destination: "Review console only.", requirements: ["mysql", "review"], notes: "This is the only signals-push action exposed as UI-runnable.",
  }),
  job({
    id: "facts-dry-review", name: "Facts production dry-run", group: "delivery", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/push-local-facts.mts", ["--universe", "research-universe-50.json", "--dry"]), purpose: "Preview complete per-CIK facts snapshots before any production transfer.",
    input: "Local facts and the 50-name universe.", output: "Per-company row counts and missing coverage; no production write.",
    destination: "Review console only.", requirements: ["mysql", "review"], notes: "A dry-run is never marked as a successful production synchronization.",
  }),
  job({
    id: "signals-production-push", name: "Reviewed signals production push", group: "delivery", mode: "blocked", cron: null, defaultEnabled: false, dependsOn: ["signals-dry-review"],
    executable: null, args: [], command: "npx tsx scripts/push-local-signals.mts --source edgar", purpose: "Deliver reviewed local EDGAR rows without refetching or rescoring.",
    input: "A reviewed dry-run, current local rows and the existing watermark.", output: "New production signal rows with server receipt timestamps and dedupe protection.",
    destination: "Production only after explicit terminal review.", requirements: ["network", "mysql", "review"], notes: "Deliberately not UI-runnable and never scheduled. Production receives reviewed data only.",
  }),
  job({
    id: "facts-production-push", name: "Reviewed facts production push", group: "delivery", mode: "blocked", cron: null, defaultEnabled: false, dependsOn: ["facts-dry-review"],
    executable: null, args: [], command: "npx tsx scripts/push-local-facts.mts --universe research-universe-50.json", purpose: "Replace reviewed per-CIK production snapshots transactionally.",
    input: "A reviewed dry-run and complete local snapshots.", output: "Production facts replaced per company in 500-row chunks.",
    destination: "Production only after explicit terminal review.", requirements: ["network", "mysql", "review"], notes: "Deliberately not UI-runnable and never scheduled; missing local coverage fails the apply run.",
  }),
  job({
    id: "edgar-tone-readiness-audit", name: "EDGAR tone readiness audit", group: "sec", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("worker/edgar-tone-audit.mts", ["--universe", "edgar-universe.json"]), purpose: "Inspect exact deterministic skips, pending work and prompt sizes before any long GPU run.",
    input: "Cached filings, manifests and the production tone preparation path.", output: "Read-only skip taxonomy, planned calls, windows and prompt-character totals.",
    destination: "Console/log only; no Ollama, ingest or manifest writes.", requirements: ["driveD", "review"], notes: "Use --manifest-only for the instant manifest report or the full CPU scan before enabling tone.",
  }),
  job({
    id: "macro-regime-validation", name: "Independent-universe and macro-regime validation", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/macro-validation.mts"), purpose: "Challenge AssetGrowth with odd/even CIK universes, sectors and macro regimes instead of relying on one full-sample IC.",
    input: "research-universe-50.json, sector-neutral factor data, macro_points and SPY.", output: "Independent universe, sector, final-holdout and macro-regime strategy evidence.",
    destination: "Console/log research evidence only.", requirements: ["mysql", "review"], notes: "No model or protocol parameters are tuned by this runner.",
  }),
  job({
    id: "sector-portfolio-evaluation", name: "Sector-neutral portfolio evaluation", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/sector-portfolio-eval.mts"), purpose: "Measure economic long/short performance of sector-neutral asset-growth quintiles at 63 and 126 sessions.",
    input: "research-universe-50.json and sector-neutral factor dataset.", output: "Directional strategy metrics and moving-block confidence intervals.",
    destination: "Console/log research evidence only.", requirements: ["mysql", "review"], notes: "Statistical IC and economic portfolio outcomes are separate gates.",
  }),
  job({
    id: "sector-vol-target-evaluation", name: "Sector volatility-target holdout evaluation", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/sector-vol-target-eval.mts"), purpose: "Compare the frozen volatility scalar with untreated sector-neutral spreads across development, validation and final holdout.",
    input: "research-universe-50.json and sector-neutral asset-growth data.", output: "Baseline and volatility-target metrics with chronological holdout and confidence intervals.",
    destination: "Console/log research evidence only.", requirements: ["mysql", "review"], notes: "A name-level scalar is not a guarantee of portfolio volatility or return alpha.",
  }),
  job({
    id: "research-protocol-check", name: "Frozen research protocol validation", group: "research", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/validate-research-protocol.mts"), purpose: "Verify the option hypothesis battery and its freeze hash before using research output.",
    input: "research/option-hypotheses-protocol.json and its SHA256 file.", output: "Schema, uniqueness, window, source-grade and freeze-hash validation.",
    destination: "Console/log only.", requirements: ["review"], notes: "CRLF/LF differences must be resolved as byte-level facts, never by silently changing protocol parameters.",
  }),
  job({
    id: "13f-top300-universe", name: "13F top-300 universe rebuild", group: "fundamentals", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/build-13f-top300.mts"), purpose: "Rebuild the expanded manager universe by recent full-book reported AUM when explicitly needed.",
    input: "Recent SEC 13F-HR filers, original and amendment information tables, and the curated manager tiers.", output: "worker/funds-13f-top300.json; institutional-only managers do not create position events.",
    destination: "Local tracked universe candidate for review; not a daily job.", requirements: ["network", "driveD", "review"], notes: "Long manual universe maintenance. Review the diff before committing or using it in 13f-refresh.",
  }),
  job({
    id: "coverage-expansion", name: "Research coverage expansion", group: "maintenance", mode: "blocked", cron: null, defaultEnabled: false, dependsOn: [],
    executable: null, args: [], command: "Not scheduled — design a 300+ point-in-time universe with departed/delisted names first", purpose: "Expand research breadth without contaminating results with survivorship or orphan entities.",
    input: "A reviewed universe plan, departed/delisted coverage and daily price freshness.", output: "A future reviewed expansion pipeline; the legacy bootstrap helper is not a nightly command.",
    destination: "Blocked pending universe design.", requirements: ["mysql", "review"], notes: "scripts/expand-coverage.mts remains a legacy curated bootstrap helper, not an acceptable substitute for the 300+ research universe gate.",
  }),
  job({
    id: "signals-note-migration", name: "signals.note migration gate", group: "maintenance", mode: "blocked", cron: null, defaultEnabled: false, dependsOn: ["mysql-backup-restore"],
    executable: null, args: [], command: "Manual reviewed DDL only after backup and restore evidence", purpose: "Apply the prepared VARCHAR(2000) signals.note change only after recovery is proven.",
    input: "Successful MySQL backup/restore, prepared DDL and code compatibility review.", output: "Local migration first; a later separate reviewed production migration.",
    destination: "Blocked by mysql-backup-restore.", requirements: ["mysql", "driveD", "review"], notes: "Never db:push --force and never drop tables.",
  }),
  job({
    id: "schwab-oauth-callback", name: "Schwab OAuth browser authorization", group: "maintenance", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    executable: null, args: [], command: "npx tsx worker/schwab-callback.mts", purpose: "Run the one-shot local HTTPS callback only when a new authorization code is required.",
    input: "Current-session Schwab client credentials, the local development certificate and an interactive browser.", output: "Local token file and AAPL smoke quote; no credentials in logs or browser UI.",
    destination: "Interactive terminal/browser flow, not scheduler-runnable.", requirements: ["network", "review"], notes: "The self-signed certificate is local development only; never disable certificate validation globally.",
  }),
  job({
    id: "options-orats-optional", name: "Optional ORATS option lane", group: "options", mode: "blocked", cron: null, defaultEnabled: false, dependsOn: [],
    executable: null, args: [], command: "Not active — optional worker/options-orats.mts lane requires separately reviewed credentials", purpose: "Keep the optional provider visible without silently enabling a paid or credentialed data path.",
    input: "Separately configured ORATS access and an explicit research need.", output: "Provider-specific snapshots only if manually activated later.",
    destination: "Blocked; no scheduled collection.", requirements: ["network", "driveD", "review"], notes: "Free Schwab, Cboe and DoltHub lanes remain independent; providers are never silently mixed.",
  }),
  job({
    id: "cloud-adhoc-jobs", name: "Legacy cloud ad-hoc job queue", group: "delivery", mode: "blocked", cron: null, defaultEnabled: false, dependsOn: [],
    executable: null, args: [], command: "No home cron — legacy /jobs actions require a separate deliberate review", purpose: "Keep legacy cloud bootstrap, harvest and other queue actions distinct from the home scheduler.",
    input: "A separate owner decision and the existing cloud job queue.", output: "Cloud-side work only; no new default direct-to-production collection is authorized by this registry.",
    destination: "Blocked from home cron.", requirements: ["review"], notes: "The cloud control plane cannot spawn home workers, and the home scheduler does not create legacy cloud jobs.",
  }),
  job({
    id: "mysql-backup-restore", name: "MySQL backup and restore gate", group: "maintenance", mode: "manual", cron: null, defaultEnabled: false, dependsOn: [],
    ...npx("scripts/prod-backup.mts", ["--full", "--source-env", "DATABASE_URL", "--restore-target", "SCRATCH_DATABASE_URL"]), purpose: "Protect the local DB before the signals.note migration or any storage move; the same SELECT-only tooling protects reviewed Expectations staging apply through direct or worker HTTP transport.",
    input: "Local gate: DATABASE_URL plus SCRATCH_DATABASE_URL. Current production: PROD_INGEST_URL, WORKER_KEY and SCRATCH_DATABASE_URL. Optional direct production mode: PROD_DATABASE_URL.", output: "External-root table JSON dumps, per-table hashes, row counts and passing restore-drill evidence.",
    destination: "Manual only; backups outside Git with the last ten retained and pruning only through --prune.", requirements: ["mysql", "driveD", "review"], notes: "Two modes: direct uses the DATABASE_URL command above and closes signals.note only after its own full scratch drill. Via-api is the current production channel: npx tsx scripts/prod-backup.mts --via-api --restore-target SCRATCH_DATABASE_URL, then apply-expectations-reviewed.mts --via-api --backup-id <id>. The server uses worker-key auth, gzip, a 64 MB decompressed guard and no DDL. Direct PROD_DATABASE_URL remains optional. Missing reviewed tables are a separate blocker; db/ddl/031_expectations_reviewed.sql is prepared but never auto-applied.",
  }),
  job({
    id: "schwab-selective-stream", name: "Selective AAPL/SPY streaming", group: "options", mode: "blocked", cron: null, defaultEnabled: false, dependsOn: [],
    executable: null, args: [], command: "Not implemented — M5 only after REST/UI review", purpose: "Add selective quote/trade streaming with heartbeat, lag and stale detection.",
    input: "User Preference authorization, AAPL/SPY only and the official streamer contract.", output: "Local JSONL stream captures and explicit connection state.",
    destination: "Future local streaming lane only.", requirements: ["network", "driveD", "review"], notes: "No full-universe streaming and no production sync. The current User Preference 401 must be resolved first.",
  }),
  job({
    id: "gdelt-frozen", name: "GDELT collector and backfill", group: "live", mode: "frozen", cron: null, defaultEnabled: false, dependsOn: [],
    executable: null, args: [], command: "Frozen — no automated or manual GDELT requests", purpose: "Keep the moratorium visible in the operational registry so nobody accidentally restarts it.",
    input: "None while frozen.", output: "No requests and no new rows.",
    destination: "None.", requirements: ["review"], notes: "The legacy Windows task, if still present, must remain disabled. The scheduler offers no Run control for this entry.",
  }),
];

export const OPERATION_JOB_MAP = Object.fromEntries(OPERATION_JOBS.map((item) => [item.id, item])) as Record<string, OperationJob>;

export interface OperationModule {
  id: string;
  name: string;
  lane: "service" | "collect" | "research" | "review" | "delivery";
  purpose: string;
  normalCommand: string;
  when: string;
  input: string;
  output: string;
  jobId?: string;
}

export const OPERATION_MODULES: OperationModule[] = [
  { id: "production-server", name: "Local production server", lane: "service", purpose: "Normal daily UI and local ingest API.", normalCommand: "$env:NODE_ENV = \"production\"\nnode dist/boot.js", when: "Use for ordinary operation after npm run build. Install the hidden ONLOGON task with worker/home-server-install.ps1; never run it together with the dev server.", input: "dist/public, dist/boot.js and the home .env.", output: "One local application at http://127.0.0.1:3000 and worker/.runs/home-server.log." },
  { id: "dev-server", name: "Development server", lane: "service", purpose: "Coding with hot module reload.", normalCommand: "npm run dev", when: "Use only while developing. Stop the production server first; both compete for port 3000 and can split localhost vs 127.0.0.1.", input: "Current TypeScript source.", output: "HMR development UI and the same local API on port 3000." },
  { id: "scheduler", name: "Operations scheduler", lane: "service", purpose: "The only cron engine for collectors, dependency chains and report builders.", normalCommand: "npx tsx worker/operations-scheduler.mts", when: "Run continuously on the home machine, preferably through the single ONLOGON Windows task from the installer.", input: "worker/.runs/operations-config.json and UI command queue.", output: "One job at a time, persistent next runs, logs and dependency-aware execution." },
  { id: "mysql", name: "Local MySQL", lane: "service", purpose: "Home system of record for collection, scoring and research.", normalCommand: "Windows service — starts with Windows", when: "Must be healthy before facts, factors, digests, research and reviewed push jobs.", input: "Local schema and home DATABASE_URL.", output: "Local facts, signals, prices, holdings and research points." },
  { id: "ollama", name: "Local Ollama", lane: "service", purpose: "GPU inference without cloud LLM charges.", normalCommand: "ollama serve\n# health: ollama ps", when: "Required only for tone, cohort extraction and daily digest. Collectors that do not use a model do not wait for it.", input: "qwen3.5:9b and the existing model configuration.", output: "Local model responses; no API key enters the browser." },
  { id: "collectors", name: "Home collectors", lane: "collect", purpose: "Fetch public/provider data with local provenance and availability timestamps.", normalCommand: "Scheduled from Jobs & schedules", when: "After network services are healthy; Schwab and EDGAR are independent, while the scheduler prevents accidental overlap.", input: "SEC, Schwab, Stocktwits and 13F sources.", output: "Raw cache plus local reviewed-ingest candidates.", jobId: "edgar-fetch-daily" },
  { id: "research", name: "Research and report builders", lane: "research", purpose: "Materialize series, factors, normalized options and owner-only static reports.", normalCommand: "Dependency-triggered after collectors", when: "Only after parent jobs succeed; research evaluations remain manual.", input: "Local DB and validated raw snapshots.", output: "factor_points, market-data snapshots, Analytics and Expectations artifacts.", jobId: "research-series" },
  { id: "review", name: "Owner review", lane: "review", purpose: "Check coverage, evidence, QA and dry-run payloads before anything leaves home.", normalCommand: "Open /workers → Delivery dry-runs", when: "After collection/research and before every production apply command.", input: "Local UI, benchmark, reconciliation and dry-run output.", output: "A human review decision; no automatic approval bit.", jobId: "signals-dry-review" },
  { id: "production-outbox", name: "Worker operational outbox", lane: "delivery", purpose: "Push only QA-passed operational outputs after successful scheduled jobs.", normalCommand: "npx tsx worker/prod-push.mts --kind pricesDaily --from 2026-11-07", when: "Automatically after exit-ok for Schwab prices/context, FRED vintages and daily operations. One retry with backoff; failure marks the job error. Manual triggers do not auto-push; use this explicit backfill command instead.", input: "INGEST_URL, WORKER_KEY and local Schwab/FRED/operations artifacts.", output: "pricesDaily, macroPoints and whitelisted reportFile payloads; raw option chains never leave home.", jobId: "schwab-fetch-daily" },
  { id: "production", name: "Cloud control plane", lane: "delivery", purpose: "Receive operational outbox data and separately reviewed derived artifacts.", normalCommand: "Manual reviewed apply for derived artifacts; automatic /api/worker/ingest only for the declared operational lane", when: "Automatic push is limited to the declared operational outputs. Expectations, canonical series, factors and other derived artifacts remain reviewed/pinned and are not auto-pushed.", input: "Operational QA-passed outputs or separately reviewed packages.", output: "Production records with exact-key dedupe, conflict refusal and fresher DB/static report selection.", jobId: "signals-production-push" },
];

export const OPERATION_GROUPS: { id: OperationGroup | "all"; name: string }[] = [
  { id: "all", name: "All jobs" },
  { id: "live", name: "Live pulse" },
  { id: "sec", name: "SEC & tone" },
  { id: "fundamentals", name: "Fundamentals & 13F" },
  { id: "options", name: "Options & Schwab" },
  { id: "expectations", name: "Expectations" },
  { id: "research", name: "Research" },
  { id: "delivery", name: "Review & delivery" },
  { id: "maintenance", name: "Maintenance" },
];
