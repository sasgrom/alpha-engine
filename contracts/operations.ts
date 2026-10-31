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
    ...npx("worker/edgar-exhibits.mts", ["--universe", "research-universe-51.json"]), purpose: "Preserve every substantive earnings exhibit, including the main release and supplements.",
    input: "SEC exhibit-bearing filings for the current 51-name expectations universe.", output: "Hash-linked EX-99 cache with completeness metadata.",
    destination: "Local expectations cache only.", requirements: ["network", "driveD"], notes: "Independent from the legacy tone exhibit selection; never reduces documents to the largest exhibit.",
  }),
  job({
    id: "facts-fetch-daily", name: "Companyfacts local snapshot", group: "fundamentals", mode: "scheduled", cron: "0 3 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/facts-fetch.mts", ["--universe", "research-universe-51.json"]), purpose: "Refresh SEC XBRL companyfacts into local MySQL with first-filed availability intact.",
    input: "SEC companyfacts JSON and research-universe-51.json.", output: "One complete, validated facts snapshot per CIK; raw JSON remains cached on D:.",
    destination: "Local MySQL through the local factsSnapshot ingest route; no production write.", requirements: ["network", "server", "mysql", "driveD"], notes: "Requires exactly one reachable local web server on port 3000 and INGEST_URL pointing to it.",
  }),
  job({
    id: "research-series", name: "Canonical research series", group: "fundamentals", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["facts-fetch-daily"],
    ...npx("scripts/build-research-series.mts", ["--universe", "research-universe-51.json"]), purpose: "Convert current local facts into canonical vintage-aware series points.",
    input: "Local facts snapshots written by facts-fetch-daily.", output: "Atomically replaced series_points per CIK.",
    destination: "Local MySQL.", requirements: ["mysql"], notes: "Dependency-triggered after a successful facts refresh; no SEC request and no arbitrary delay guess.",
  }),
  job({
    id: "research-factors", name: "Research factor materialization", group: "fundamentals", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["research-series"],
    ...npx("scripts/materialize-research-factors.mts", ["--universe", "research-universe-51.json"]), purpose: "Materialize point-in-time factor points from the new canonical series and available prices.",
    input: "Local series_points and existing research price history.", output: "Idempotent factor_points per company.",
    destination: "Local MySQL.", requirements: ["mysql"], notes: "Does not claim new predictive evidence; evaluation remains a separate research job.",
  }),
  job({
    id: "schwab-fetch-daily", name: "Schwab REST daily snapshot", group: "options", mode: "scheduled", cron: "0 4 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-fetch.mts", ["--universe", "research-universe-51.json"]), purpose: "Capture chains, quotes, daily price history and instruments with hashes and availability timestamps.",
    input: "Schwab Market Data Production; local token file; research-universe-51.json.", output: "D:-only raw snapshots and a resumable manifest; User Preference status is recorded separately for streaming setup.",
    destination: "Local Schwab archive only; no orders, accounts or production sync.", requirements: ["network", "driveD"], notes: "Same-day complete tickers resume without redownloading. A User Preference 401 does not invalidate completed REST data.",
  }),
  job({
    id: "schwab-snapshot", name: "Schwab normalized UI snapshot", group: "options", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-fetch-daily"],
    ...npx("worker/build-schwab-market-data.mts"), purpose: "Normalize the latest valid chain per ticker and expose credential-free static data to /market-data.",
    input: "Latest Schwab manifest entries and raw chains.", output: "public/reports/schwab-market-data.json with OSI IDs, DTE and QA, fetched on demand by /market-data.",
    destination: "Reviewed local static snapshot only.", requirements: ["review"], notes: "Hash mismatches, truncated chains and provider failures remain visible. The builder also updates an existing dist/public/reports, so new Schwab data does not require an application rebuild.",
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
    input: "Current cohort extraction results, benchmark result when present, and research-universe-51.json.", output: "Credential-free expectations JSON and TypeScript with evidence, coverage and data-quality notes.",
    destination: "Local static UI artifacts; partial results remain explicitly unreviewed.", requirements: ["review"], notes: "Safe even while extraction is paused: it reports the actual partial state instead of fabricating completion.",
  }),
  job({
    id: "ui-production-build", name: "Production UI rebuild", group: "delivery", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["analytics-snapshot", "schwab-snapshot", "expectations-report"],
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
    ...npx("worker/edgar-cohorts.mts", ["--universe", "research-universe-51.json"]), purpose: "Build deterministic, period-aligned bounded containers from complete guidance and actual blocks.",
    input: "Complete EX-99 cache and filing period metadata.", output: "cohort-pack-v2.json with source hashes and explicit unpacked failures.",
    destination: "Local cache only.", requirements: ["driveD"], notes: "Paused with the active LLM lane so the operator does not accidentally start a second full-history run.",
  }),
  job({
    id: "expectations-extract", name: "Cohort LLM extraction", group: "expectations", mode: "paused", cron: null, defaultEnabled: false, dependsOn: ["expectations-cohorts"],
    ...npx("worker/edgar-cohort-extract.mts", ["--universe", "research-universe-51.json"]), purpose: "Extract guidance, comparable actuals and factual fallback notes with atomic source-level resume.",
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
    ...npx("worker/options-fetch.mts", ["--source", "cboe", "--universe", "research-universe-51.json"]), purpose: "Maintain the independent delayed-Cboe provider lane for cross-provider checks when explicitly enabled.",
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
    ...npx("scripts/push-local-facts.mts", ["--universe", "research-universe-51.json", "--dry"]), purpose: "Preview complete per-CIK facts snapshots before any production transfer.",
    input: "Local facts and the 51-name universe.", output: "Per-company row counts and missing coverage; no production write.",
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
    executable: null, args: [], command: "npx tsx scripts/push-local-facts.mts --universe research-universe-51.json", purpose: "Replace reviewed per-CIK production snapshots transactionally.",
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
    id: "mysql-backup-restore", name: "MySQL backup and restore gate", group: "maintenance", mode: "blocked", cron: null, defaultEnabled: false, dependsOn: [],
    executable: null, args: [], command: "Not automated until backup and restore verification is complete", purpose: "Protect the local DB before the signals.note migration or any storage move.",
    input: "A tested mysqldump backup on D: and a successful restore drill.", output: "Verified recovery evidence before schema changes.",
    destination: "Not implemented as a runnable job yet.", requirements: ["mysql", "driveD", "review"], notes: "No forced DDL, no table drops and no storage migration before this gate passes.",
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
  { id: "production", name: "Cloud control plane", lane: "delivery", purpose: "Receive reviewed data and present the cloud UI.", normalCommand: "Manual terminal apply after review only", when: "Never scheduled and never triggered by a collector. Cloud cannot spawn home jobs.", input: "Reviewed facts, signals or other explicitly approved artifacts.", output: "Production records with server receipt timestamps and dedupe protection.", jobId: "signals-production-push" },
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
