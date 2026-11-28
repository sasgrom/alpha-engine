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
    input: "worker/universe.json; public 30-message stream per active ticker.", output: "Deterministic buzz and labeled-sentiment rows; optional local-LLM crowd rows (gemma4:12b since 2026-11-27, qwen3.5:9b before) when Ollama is available.",
    destination: "Reviewed deterministic rows use the existing direct ingest contract; probation LLM rows follow INGEST_URL.", requirements: ["network", "server"], notes: "Reruns dedupe by newest message payload key. The GPU is never a hard dependency for deterministic rows. The crowd model is in the payload key, so gemma and qwen rows never mix.",
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
    id: "edgar-fetch-r1000", name: "EDGAR Russell 1000 filing cache", group: "sec", mode: "scheduled", cron: "40 2 * * *", defaultEnabled: false, dependsOn: ["edgar-fetch-daily"],
    ...npx("worker/edgar-fetch.mts", ["--universe", "research-universe-r1000-current.json", "--from", "2019-01-01", "--forms", "10-K,10-K/A,10-Q,10-Q/A,8-K,8-K/A"]), purpose: "Incrementally cache panel-era Russell 1000 and still-listed former-company filings through the existing collector and shared SEC budget.",
    input: "SEC submissions and documents; research-universe-r1000-current.json; shared per-CIK manifests.", output: "The existing raw EDGAR cache and atomic manifests; no alternate cache or production write.",
    destination: "Local raw cache only.", requirements: ["network", "driveD"], notes: "Disabled until Claude accepts phase 1. The r1000 scope starts 2019-01-01 and includes the six forms the addendum reads; registry flags and behavior are unchanged. Addendum inputs are submission metadata, not EX-99 contents; two item retries then todo and continue.",
  }),
  job({
    id: "calendar-addendum-r1000", name: "Russell 1000 release-calendar addendum", group: "sec", mode: "scheduled", cron: "50 2 * * *", defaultEnabled: false, dependsOn: ["edgar-fetch-r1000"],
    ...npx("scripts/build-calendar-addendum.mts", ["--sets", "r1000", "--out", "D:/research/alpha-engine/engine/events/addendum-r1000"]), purpose: "Add new Russell 1000 filings and quarters to a separate addendum without touching the pinned calendar or registry addendum.",
    input: "Pinned r1000 release calendar and the shared SEC cache.", output: "D:/research/alpha-engine/engine/events/addendum-r1000 with its own filings, quarters and manifest.",
    destination: "Local D: addendum only; no pinned-file or production write.", requirements: ["driveD"], notes: "Disabled until Claude accepts phase 1. The registry --sets default remains 50,rest,six and its output path is unchanged.",
  }),
  job({
    id: "facts-fetch-r1000", name: "Russell 1000 incremental companyfacts", group: "fundamentals", mode: "scheduled", cron: "50 23 * * *", defaultEnabled: false, dependsOn: ["sp500-facts-daily"],
    ...npx("worker/facts-fetch.mts", ["--universe", "research-universe-r1000-current.json"]), purpose: "Collect relevant new SEC companyfacts for current Russell 1000 and still-listed former companies through the existing incremental collector.",
    input: "research-universe-r1000-current.json, recent financial/XBRL forms and amendments, shared per-CIK raw cache and manifests.", output: "Resumable raw snapshots and local factsSnapshot ingests with first-filed availability preserved.",
    destination: "Local MySQL and the existing D: raw cache; no production or research-database write.", requirements: ["network", "server", "mysql", "driveD"], notes: "Disabled until Claude accepts phase 1. Existing registry collection stays unchanged; two item attempts then todo and continue.",
  }),
  job({
    id: "research-series", name: "Canonical research series", group: "fundamentals", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["facts-fetch-daily"],
    ...npx("scripts/build-research-series.mts", ["--universe", "research-universe-50.json"]), purpose: "Convert current local facts into canonical vintage-aware series points.",
    input: "Local facts snapshots written by facts-fetch-daily.", output: "Atomically replaced series_points per CIK.",
    destination: "Local MySQL.", requirements: ["mysql"], notes: "Dependency-triggered after a successful facts refresh; no SEC request and no arbitrary delay guess.",
  }),
  job({
    // after each weekday close (the session counts as complete at 16:00 Pacific; the S&P 500 lane runs first, at 16:10),
    // and at 04:00 as a catch-up: a capture of the same UTC date resumes, so the morning run only completes what the
    // evening run missed
    id: "schwab-fetch-daily", name: "Schwab REST daily snapshot", group: "options", mode: "scheduled", cron: "45 16 * * 1-5; 0 4 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-fetch.mts", ["--universe", "research-universe-50.json"]), purpose: "Capture chains, quotes, daily price history and instruments with hashes and availability timestamps.",
    input: "Schwab Market Data Production; local token file; research-universe-50.json.", output: "D:-only raw snapshots and a resumable manifest; User Preference status is recorded separately for streaming setup.",
    destination: "Raw chains remain local; successful scheduled runs automatically push QA-passed daily OHLCV and daily-prices-schwab.json through /api/worker/ingest.", requirements: ["network", "driveD"], notes: "Same-day complete tickers resume without redownloading. Automatic operational push is allowed only after exit-ok with one retry; a push failure marks the job error. No raw option chains, accounts or orders leave home. User Preference 401 does not invalidate REST data.",
  }),
  job({
    id: "schwab-snapshot", name: "Schwab normalized UI snapshot", group: "options", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-fetch-daily"],
    ...npx("worker/build-schwab-market-data.mts"), purpose: "Normalize the latest valid chain per ticker and expose credential-free static data to /market-data.",
    input: "Latest Schwab manifest entries and raw chains.", output: "public/reports/schwab-market-data.json with OSI IDs, DTE and QA, plus a local hash-verified gzip artifact under worker/.runs/precomputed-page-data.",
    destination: "Normalized snapshot automatically pushed as schwab-market-data.json after exit-ok; raw chains and the local gzip stay local.", requirements: ["review"], notes: "Hash mismatches, truncated chains and provider failures remain visible. Only the normalized report enters the automatic operational lane; no factor promotion. The existing writer also produces local gzip after the public and bundled JSON writes, independent of the later push outcome.",
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
    // after each weekday close, so the day's closes, the desk and the price pages are ready the same evening (about 16:45),
    // and at 04:30 as a catch-up for anything the evening run missed (same UTC date: completed tickers resume)
    id: "schwab-fetch-sp500", name: "Schwab REST daily snapshot · S&P 500 and funds", group: "options", mode: "scheduled", cron: "10 16 * * 1-5; 30 4 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-fetch.mts", ["--price-series", "--exclude", "research-universe-50.json", "--skip-preferences", "--root", "D:/research/alpha-engine/schwab-sp500"]),
    purpose: "Capture chains, quotes, daily price history and instruments for every S&P 500 company outside the research 50 (both listings of dual-class companies), SPY and the eleven sector funds.",
    input: "Schwab Market Data Production; local token file; edgar-universe.json minus research-universe-50.json, plus the funds.", output: "D:-only raw snapshots under schwab-sp500 with their own resumable manifest.",
    destination: "Local only: no operational push, no normalized UI snapshot and no production write.", requirements: ["network", "driveD"], notes: "About 465 tickers in roughly 30 minutes, paced below the provider's limit of 120 requests a minute; the access token is renewed during the run. The research-50 lane, its UI snapshot and its production push are unchanged.",
  }),
  job({
    // after BOTH archives are fetched: the 50 research companies are only in the schwab archive (16:45), the others in
    // schwab-sp500 (16:10); after the S&P fetch alone, the 50 stayed a session behind on the desk (2026-11-12)
    id: "schwab-daily-bars", name: "Schwab daily bars into local prices", group: "options", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-fetch-sp500", "schwab-fetch-daily"],
    ...npx("worker/schwab-daily-bars.mts"), purpose: "Store every completed official daily candle of both Schwab archives in local prices, so a day one run misses is filled by the next.",
    input: "pricehistory files of the schwab and schwab-sp500 archives (about one month each).", output: "Local prices rows (source schwab after each series' last Stooq bar, schwab-hist on dates the Stooq history covers) and worker/.runs/local-generated/schwab-daily-bars.json with inserts, conflicts and holes against SPY's sessions.",
    destination: "Local MySQL only; no production push (off since 2026-11-13).", requirements: ["mysql", "driveD"], notes: "The app lets Schwab win on its dates, so raw Schwab bars never enter dates of the dividend-adjusted Stooq history (they are kept as schwab-hist). A stored close is never changed one by one: a different close is a conflict and marks the job error. One window is the exception: the newest five Schwab candles of a series are finalised by a later Schwab fetch (an evening fetch can still carry a provisional close and volume) when the close moved by at most 0.5% and no older close moved; each such correction is listed in the report. A split is the other exception: when Schwab re-bases a series' whole history by one factor, the stored history before the new basis is re-based in every source, the event goes to worker/.runs/price-adjustments.jsonl, and the run goes on.",
  }),
  job({
    id: "split-calendar", name: "Upcoming stock splits (Yahoo calendar)", group: "research", mode: "scheduled", cron: "15 6 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/split-calendar.mts"), purpose: "The daily split watch: the US stock splits Yahoo's split calendar lists for the next 60 days, with the companies of our price series flagged (owner's go, 2026-11-13).",
    input: "Yahoo's split calendar (one session cookie and crumb, at most eight requests two seconds apart) and the price-series list.", output: "D:\\research\\alpha-engine\\prices\\split-calendar\\<date>.json and latest.json.",
    destination: "Local D: only; no production write.", requirements: ["network", "driveD"], notes: "First run 2026-11-13: SNDK 8-for-1 on 2026-11-20. The daily bars job re-bases a series when Schwab re-bases its history; this calendar says which splits to expect. A failed fetch fails the job, so it shows on the desk's operations banner.",
  }),
  job({
    id: "schwab-fetch-r1000", name: "Schwab Russell 1000 daily prices", group: "options", mode: "scheduled", cron: "10 17 * * 1-5", defaultEnabled: false, dependsOn: ["schwab-fetch-sp500"],
    ...npx("worker/schwab-fetch.mts", ["--price-series", "--universe", "research-universe-r1000-current.json", "--skip-market-series", "--skip-preferences", "--root", "D:/research/alpha-engine/schwab-r1000"]),
    purpose: "Capture chains, quotes, daily price history and instruments for the current Russell 1000 and still-listed former companies in a separate archive.",
    input: "Schwab Market Data Production; research-universe-r1000-current.json; local token file.", output: "D:/research/alpha-engine/schwab-r1000 with atomic per-ticker checkpoints and resume evidence.",
    destination: "Local D: market-data archive only; no orders, accounts, production or existing archive write.", requirements: ["network", "driveD"], notes: "Weekdays after the S&P fetch, 1,000 ms spacing. Disabled until Claude accepts phase 2. Two item retries then todo and continue.",
  }),
  job({
    id: "yahoo-actions-r1000-weekly", name: "Yahoo Russell 1000 corporate actions", group: "research", mode: "scheduled", cron: "0 6 * * 0", defaultEnabled: false, dependsOn: [],
    ...npx("worker/yahoo-r1000-actions.mts"), purpose: "Refresh dividends and split events for the current Russell 1000 and still-listed former companies into a new dated archive with per-ticker resume checkpoints.",
    input: "Yahoo chart events only; research-universe-r1000-current.json.", output: "D:/research/alpha-engine/prices/yahoo/r1000-actions-<stamp>, manifest.json and todo.jsonl.",
    destination: "Local D: only; no prices for the app and no production write.", requirements: ["network", "driveD"], notes: "Generic client, 1.5 s spacing and at most two retries per ticker before todo. Disabled until Claude accepts phase 2.",
  }),
  job({
    id: "split-calendar-r1000", name: "Upcoming splits · Russell 1000", group: "research", mode: "scheduled", cron: "20 6 * * *", defaultEnabled: false, dependsOn: [],
    ...npx("worker/split-calendar.mts", ["--universe", "research-universe-r1000-current.json", "--out", "D:/research/alpha-engine/prices/split-calendar-r1000"]),
    purpose: "Flag upcoming splits for the Russell 1000 universe in a separate calendar without changing the registry calendar.",
    input: "Yahoo split calendar and the price-series universe including research-universe-r1000-current.json.", output: "D:/research/alpha-engine/prices/split-calendar-r1000/<date>.json and latest.json.",
    destination: "Local D: only; no production write or registry-calendar replacement.", requirements: ["network", "driveD"], notes: "Disabled until Claude accepts phase 2. Same polite request spacing and failure rules as the registry watch.",
  }),
  job({
    id: "r1000-panel-weekly", name: "Russell 1000 corrected panel", group: "research", mode: "scheduled", cron: "30 6 * * 0", defaultEnabled: false, dependsOn: ["r1000-universe-weekly", "yahoo-actions-r1000-weekly"],
    ...npx("scripts/build-r1000-current-panel.mts", ["--root", "D:/research/alpha-engine/schwab-r1000"]), purpose: "Build a new-stamp Russell 1000 panel with the corrected K31.5 rules and advance current.json only after all six gates plus the chain and common-equity gates pass.",
    input: "Accepted K31.5 builder/exclusions, current Schwab history, Yahoo actions, fable1 evidence, dated Schwab common-equity classifications and hash-linked historical listing/OTC-cutoff reviews.", output: "A new r1000-panel stamp and current.json only on success; the previous pointer survives failure.",
    destination: "Local D: only; no production, scheduler or research-database write.", requirements: ["driveD"], notes: "Disabled until Claude accepts phase 2. Stamps are never overwritten and retention is the owner's.",
  }),
  job({
    id: "desk-snapshot", name: "Desk market snapshot", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-daily-bars"],
    ...npx("scripts/build-desk-snapshot.mts"), purpose: "Rebuild the one precomputed file behind the desk view (market map, screener, earnings, research tools) once the day's closes are stored.",
    input: "Local companies, daily closes (Stooq history, Schwab bars after it), earnings events, short interest, Form 4 rows, the Schwab fundamentals and latest quotes of both archives on D:, and the option features report.", output: "public/reports/desk-snapshot.json and its dist copy: one row per index company with returns, range, fundamentals, earnings dates, option features, plus breadth, sectors and the registry check.",
    destination: "Local static UI artifact read by desk.snapshot; no production write and no push lane.", requirements: ["mysql", "driveD"], notes: "Stops without writing when a Schwab archive root is missing, so the previous snapshot stays in place. Option-derived fields reach only the owner and NDA reviewers. Reports registry rows that disagree with the GICS snapshot.",
  }),
  job({
    // every five minutes from 06:40 through 13:20 Pacific on weekdays; the 06:30-13:00 regular session and tail are unchanged (K21)
    id: "schwab-intraday", name: "Schwab live prices every 5 minutes", group: "options", mode: "scheduled", cron: "40,45,50,55 6 * * 1-5; */5 7-12 * * 1-5; 0,5,10,15,20 13 * * 1-5", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-intraday.mts"), purpose: "Current prices of every price series (S&P 500 with both listings of dual-class companies, the research companies, SPY, the sector funds) every five minutes of a trading session, so the desk shows live prices and approximate five-minute paths; each run also keeps the Schwab access token fresh.",
    input: "Schwab Market Data Production: market hours and batched quotes (about three requests); the local token file; the price-series universe.", output: "D:\\research\\alpha-engine\\schwab-intraday: <session>\\<HHMM>.json (compact quotes), .raw.json only at 00/20/40 past the hour, <session>\\bars.json (five-minute bars), live.json, manifest.jsonl.",
    destination: "Local only: no production push and no write to the daily price history.", requirements: ["network", "driveD"], notes: "A holiday or a time outside the regular session ends the run without a snapshot. Bars come from consecutive snapshots: open and close are snapshot prices, high and low the day's running extremes when set inside the interval (else the interval's end prices), volume the change in the day's volume. Highs and lows are approximate. Raw responses remain only at the 20-minute marks; compact snapshots are kept every five minutes. Sessions accumulate on D: and are never pruned; the desk reads at most five. If another job holds the single execution lane, each intraday job is pending at most once and missed slots advance instead of piling up; a late snapshot keeps its true capturedAt. The refresh token itself still expires seven days after the last browser authorization.",
  }),
  job({
    id: "desk-snapshot-live", name: "Desk snapshot with live prices", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-intraday"],
    ...npx("scripts/build-desk-snapshot.mts"), purpose: "Rebuild the desk snapshot after each live-price snapshot, with the session's current prices as provisional closes and the time they are as of; also rebuild the shared intraday market summary from the latest session bars.",
    input: "Everything desk-snapshot reads, plus D:\\research\\alpha-engine\\schwab-intraday\\live.json and the latest session's bars.json and compact snapshots.", output: "public/reports/desk-snapshot.json and desk-intraday-market.json with their dist copies, marked with the prices' as-of time and the last session.",
    destination: "Local static UI artifacts read by desk.snapshot and desk.intradayMarket; no production write.", requirements: ["mysql", "driveD"], notes: "Live prices count only for a session newer than the stored closes: once the evening run stores the session's official closes, desk-snapshot replaces the provisional ones. The market summary is still rebuilt from the latest session bars, so closed-market views retain the named last session. Nothing enters the daily price history.",
  }),
  job({
    id: "prediction-markets-daily", name: "Prediction-market expectations daily", group: "research", mode: "scheduled", cron: "15 16 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/prediction-markets-daily.mts", ["--scheduled-style"]), purpose: "Capture public Fed, CPI and recession probabilities and every mapped company KPI contract, with settlement histories and point-in-time daily expectations.",
    input: "The reviewed series/company mapping on D:, the local company registry and keyless public market-data endpoints.", output: "D:/research/alpha-engine/predmarkets/daily/<date> venue JSONL, per-run manifests, mapping.json, daily-state.jsonl and the local prediction-markets.json desk artifact.",
    destination: "Local D: archive and local UI artifact only; no production writes or automatic reportFile push.", requirements: ["network", "mysql", "driveD"], notes: "Runs alone after the initial lab history run. One process lock, at least 250 ms between public requests, at most two retries, and an immediate stop if a key is required. Reruns append only changed quotes and never rewrite settled history. Political, sports, entertainment and earnings-call wording markets stay off. The mapping's accepted and rejected series are part of the delivery review.",
  }),
  job({
    id: "std-prices-refresh", name: "Standard prices weekly gated refresh", group: "research", mode: "scheduled", cron: "0 2 * * 0", defaultEnabled: true, dependsOn: [],
    ...npx("../alpha-engine-lab/src/prices/std-prices-refresh.mts"), purpose: "Rebuild standard prices weekly from the complete current app registry, corporate actions and vendor history, then replace the loaded build only after gates, regression and staged read-back pass.",
    input: "Local Schwab histories including RIVN and ENLT, Yahoo corporate actions, Tiingo, options/SEC split evidence, the previous loaded standard-price build and the lab's reviewed build logic.", output: "One dated D: refresh folder per run, a regression report, staged read-back evidence, an atomic research-table swap and worker/.runs/local-generated/std-prices-refresh.json.",
    destination: "Local D: artifacts and alpha_research only; no production write and no alpha_engine production mutation.", requirements: ["network", "driveD"], notes: "Runs about 70 minutes. A failed step stops the chain with an honest error and no swap. Old run folders and the previous loaded build are preserved until the staged swap; no data is pruned. RIVN and ENLT receive a one-time 20-year Schwab backfill before export. The loader stages std_*_next, checks 2,000 rows, then swaps atomically; a failed read-back leaves the old tables in place. The orchestrator also refuses to start when any lab file it runs has uncommitted changes.",
  }),
  job({
    id: "finra-short-interest", name: "FINRA short interest", group: "research", mode: "scheduled", cron: "25 6 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/finra-short-interest.mts"), purpose: "Fetch FINRA's twice-monthly short interest files the archive lacks and write the desk's per-company history for every registry company.",
    input: "FINRA's public settlement files (the 15th and the last business day of a month, published about seven business days later), the archive and its manifest on D:, and the company registry.", output: "Raw files unchanged under D:/research/alpha-engine/shortint/finra/raw with manifest hashes, and worker/.runs/desk-short-interest.json (the newest 24 settlements).",
    destination: "Local D: archive and a local file read by company.shortInterest and the desk snapshot; no production write and no database write.", requirements: ["network", "mysql", "driveD"], notes: "The owner's go of 2026-11-24. Daily, because the publication day is not fixed: a settlement that is not out yet answers 403 or 404 and is asked again the next day (at most a few requests a day, one a second). A stored file is never fetched again or rewritten; each file read is checked against its manifest hash. A missing archive folder stops the run and creates nothing.",
  }),
  job({
    id: "finra-short-interest-r1000", name: "FINRA short interest · Russell 1000", group: "research", mode: "scheduled", cron: "25 6 * * *", defaultEnabled: false, dependsOn: [],
    ...npx("worker/finra-short-interest.mts", ["--universe", "research-universe-r1000-current.json", "--out", "worker/.runs/r1000-short-interest.json"]),
    purpose: "Keep the current Russell 1000 and former-listed tickers in a separate FINRA short-interest history without changing the registry file or loaded standards.",
    input: "The existing FINRA settlement archive, research-universe-r1000-current.json and optional new settlements.", output: "worker/.runs/r1000-short-interest.json with the newest 24 settlements and every common class.",
    destination: "Local D: archive and local r1000 file only; no production, standard-table or registry-file write.", requirements: ["network", "driveD"], notes: "Disabled until Claude accepts phase 3. Existing archive and registry collector behavior remain unchanged; missing settlements are not invented.",
  }),
  job({
    id: "news-feeds-fast", name: "News: wires, SEC current 8-Ks and market feeds", group: "research", mode: "scheduled", cron: "2-59/5 * * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/news-feeds.mts", ["--set", "fast"]), purpose: "Read the press wires, the SEC's current 8-K list and the market news feeds every five minutes and store every new item with our own first-seen time.",
    input: "Public RSS and Atom feeds (GlobeNewswire, PR Newswire, Seeking Alpha, MarketWatch, Benzinga, CNBC, Nasdaq earnings) and the SEC's current 8-K feed through secGet.", output: "D:/research/alpha-engine/news: raw answers gzipped, items/<UTC date>.jsonl (one row per new item: first-seen and published times, tags, story), state.",
    destination: "Local D: archive only; research input; no production write and no database write.", requirements: ["network", "driveD"], notes: "The owner's go of 2026-11-25 (\"lets get everything we can\"). The feeds hold only their latest 7 to 100 items (PR Newswire's 20 covered under an hour at night), so a run blocked behind a long job can miss items: each feed whose whole answer is new after an earlier fetch counts a gap in state/feeds.json. Copies of one story across outlets share a storyId (same address, same title, or the same words apart from filler words). A failed feed is counted and the run goes on; a missing archive stops it.",
  }),
  job({
    id: "gdelt-gkg-files", name: "News: GDELT knowledge-graph files (static, every 15 minutes)", group: "research", mode: "scheduled", cron: "6,21,36,51 * * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/gdelt-gkg.mts", ["--max-files", "8"]), purpose: "Store GDELT's 15-minute English GKG files and keep the articles that name a company of our index, with GDELT's tone, organizations and themes.",
    input: "data.gdeltproject.org/gdeltv2/lastupdate.txt and <stamp>.gkg.csv.zip (static files; never the DOC/query API).", output: "D:/research/alpha-engine/news/gdelt: raw/<UTC date>/<stamp>.gkg.csv.zip as received, records/<UTC date>.jsonl (articles naming an index company, with our first-seen time), state.json (last slot, slots not there).",
    destination: "Local D: archive only; research input, not yet read by the news reader or the desk; no production write and no database write.", requirements: ["network", "driveD"], notes: "Claude's GDELT attempt under the owner's permission of 2026-11-25 (AGENTS.md section 3); the old DOC-API collector stays frozen (gdelt-frozen). Two to nine requests a run, two seconds apart. Missed slots are caught up oldest first, eight a run; a slot answering 404 is asked twice more, then listed as gone. The newest file is checked against lastupdate.txt's size and MD5. About 4.4 MB a file, 425 MB a day of raw files: retention is the owner's decision.",
  }),
  job({
    id: "news-feeds-company", name: "News: per-company feeds and macro releases", group: "research", mode: "scheduled", cron: "10 */3 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/news-feeds.mts", ["--set", "company", "--batch", "70"]), purpose: "Ask Google News, Nasdaq, Seeking Alpha and Yahoo Finance for every followed company (the news briefs' list) and the 70 other registry companies asked longest ago (all 502 within a day), plus the Fed, BLS and BEA release feeds.",
    input: "Per-company RSS feeds and the official macro release feeds; the company registry; news/lookup/followed.json.", output: "The same archive: new items, and mentions/<UTC date>.jsonl when a company's feed returns an item already stored.",
    destination: "Local D: archive only; research input; no production write and no database write.", requirements: ["network", "mysql", "driveD"], notes: "The owner's go of 2026-11-25. Google News answers 429 when asked faster than about one request in 8 seconds, so it is paced that way and not asked again in a run after a 429 (Yahoo one in 3 seconds); with the 51 followed companies a run takes about 16 minutes. Google News and Seeking Alpha reach back weeks; Yahoo's 20 headlines cover about half a day for a large company, so a company whose whole answer is newer than our previous ask counts a gap (state/feeds.json gapTickers), which shows where to ask more often.",
  }),
  job({
    id: "news-extract", name: "News: the local model reads new items", group: "research", mode: "scheduled", cron: "4-59/10 * * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/news-extract.mts", ["--minutes", "3"]), purpose: "Let gemma4:12b read the news stored in the last two days, one item per story and newest first, for three minutes per run: subject, other companies, event type, direction, novelty and a one-line fact; code resolves the names to SEC identities.",
    input: "items/<UTC date>.jsonl of the news archive; the local Ollama model gemma4:12b; news/lookup/company-index.json.", output: "D:/research/alpha-engine/news/extract/<first-seen UTC date>.jsonl: one row per item read, with the model's digest, the prompt version and our extraction time.",
    destination: "Local D: archive only; research input; no production write and no database write.", requirements: ["gpu", "driveD"], notes: "The owner's go of 2026-11-25 (\"run gemma as scheduled job\"); the bake-off of 300 hand-labelled items chose gemma4:12b (subject 93.3%, event 79.3%, direction 79.7%, novelty 81.7%, about 0.9 s an item, so about 200 items a run and 30,000 a day). The three-minute budget keeps the scheduler's one lane free for live prices. The prompt is pinned by a test; changing it needs a new bake-off. An item without a valid answer is asked once more, then left with its rows as the record; three failed calls in a row (Ollama down) fail the run. Needs Ollama running on port 11434.",
  }),
  job({
    id: "r1000-universe-weekly", name: "Russell 1000 current universe", group: "research", mode: "scheduled", cron: "20 5 * * 0", defaultEnabled: false, dependsOn: [],
    ...npx("scripts/build-r1000-current-universe.mts"), purpose: "Rebuild the current Russell 1000 and still-listed former-company universe with exchange, N-PORT and Schwab common-equity evidence, joiner/leaver reports and count gates.",
    input: "K26 membership and companies; edgar-universe.json; SEC company_tickers_exchange.json through the shared client and D: cache; Schwab quotes fields=reference in a separate D: evidence archive.", output: "worker/research-universe-r1000-current.json and D:/research/alpha-engine/index-membership/russell1000/current-universe/<stamp>.json, including every excluded ticker and reason.",
    destination: "Local universe file and D: evidence only; no production, database or app-registry write.", requirements: ["network", "driveD"], notes: "Disabled until Claude accepts the universe. CIK uniqueness, exchange resolution, verified common equity and the same-quarter ±5% gate are mandatory; a failed gate keeps the previous file.",
  }),
  job({
    id: "etf-shares-hourly", name: "ETF share counts (money flows)", group: "research", mode: "scheduled", cron: "7 * * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/etf-shares.mts"), purpose: "Capture the shares outstanding of 51 market, sector and industry ETFs every hour: a fund creates or cancels shares when money comes in or goes out, so the change times the price is a real daily money flow (owner's volume-flows plan, 2026-11-28). Hourly captures around the clock also show when each fund's count changes, which settles the trading day a count belongs to.",
    input: "Schwab Market Data Production: one batched quotes request (fields quote, fundamental, reference, regular) for the funds in worker/lib/etf-flows.ts; the local token file.", output: "D:/research/alpha-engine/etf-shares: <UTC date>/<HHMM>Z.raw.json as received, shares.jsonl (one compact row per fund and capture, append only), manifest.jsonl (SHA-256 and funds without a count).",
    destination: "Local D: archive only; research input; no production or database write.", requirements: ["network", "driveD"], notes: "About two seconds and one request. A fund without a count is recorded in the manifest and the run continues; an empty answer fails the run. Nothing is deleted.",
  }),
  job({
    id: "schwab-minute-history-weekly", name: "Schwab 1- and 5-minute history save", group: "research", mode: "scheduled", cron: "0 8 * * 6", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-minute-history.mts"), purpose: "Save Schwab's rolling intraday history every Saturday before it rolls off: 1-minute bars reach back about 34 sessions and 5-minute bars about 180 (measured 2026-11-28), and the buy/sell split of volume needs bars of five minutes or less (daily bars only restate the day's move).",
    input: "Schwab Market Data Production pricehistory (frequencyType minute, regular session) for every daily price series plus the ETF funds, one request per symbol and bar size, 1 s apart; the local token file.", output: "D:/research/alpha-engine/schwab-minute/<date>/{1m,5m}/<TICKER>.json as received, manifest.jsonl (candles, first and last bar, SHA-256), todo.json.",
    destination: "Local D: archive only; research input; no production or database write.", requirements: ["network", "driveD"], notes: "About 1,110 requests and 18 minutes on Saturday morning, when no market-data job runs. A symbol that fails three attempts goes to todo.json and the run moves on; a rerun on the same date keeps the files already written. Weekly saves overlap by design. Nothing is deleted.",
  }),
  job({
    id: "news-company-index", name: "News: company index for name resolution", group: "research", mode: "scheduled", cron: "50 5 * * 0", defaultEnabled: true, dependsOn: [],
    ...npx("worker/news-company-index.mts"), purpose: "Rebuild the index the news reader resolves company names with: the SEC's company list with tickers, the Russell 1000 identities with former names, and the registry.",
    input: "https://www.sec.gov/files/company_tickers.json through secGet (kept as received, one file a day at most); index-membership/russell1000/companies.json (K26); alpha_engine.companies (read only).", output: "D:/research/alpha-engine/news/lookup/company-index.json (atomic).",
    destination: "Local D: only; no production write and no database write.", requirements: ["network", "mysql", "driveD"], notes: "Weekly, Sundays. A missing source or an index of fewer than 5,000 companies leaves the previous index in place.",
  }),
  job({
    id: "desk-news", name: "Desk news files", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["news-extract"],
    ...npx("scripts/build-desk-news.mts"), purpose: "Rebuild the stories behind the desk's News page and the company news cards after every reading run: copies joined, companies tied, the model's reading added.",
    input: "items/, extract/ and mentions/ of the news archive on D:; news/lookup/company-index.json; the desk snapshot's companies as the registry.", output: "worker/.runs/desk-news: days/<first-seen UTC date>.json (today and yesterday rebuilt each run) and company/<cik>.json for every registry company (the last 30 days).",
    destination: "Local static files read by desk.news and desk.companyNews; no production write and no database write.", requirements: ["driveD"], notes: "About a second a run. A copy seen two or more days after its story is not joined to it. The model's readings reach only the owner and NDA reviewers (the server strips them for members).",
  }),
  job({
    id: "news-briefs", name: "News briefs for followed companies", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["desk-news"],
    ...npx("worker/news-briefs.mts", ["--minutes", "4"]), purpose: "Write each followed company's morning brief of the news since the previous close (New York weekdays from 08:45) and add timed updates until 20:00 when new picked stories come in; the local model writes, code checks every number and name against the cited stories.",
    input: "The desk news day files (stories, ties, the reader's labels); the feed summaries in items/; news/lookup/company-index.json; the desk snapshot (names, the price line); the watchlists of the owner and of NDA reviewers (alpha_engine, read only; the last list when the database is unreachable); gemma4:12b in local Ollama.",
    output: "D:/research/alpha-engine/news/briefs/<New York date>/<cik>.jsonl (every version appended, complete); worker/.runs/desk-news/briefs/<cik>.json (the latest, read by desk.companyBrief and desk.briefs); news/lookup/followed.json (the list the reader and the company feeds take first).",
    destination: "Local D: archive and local static files; no production write and no database write.", requirements: ["gpu", "driveD"], notes: "The owner's go of 2026-11-25 (\"preprocessed news brief … with an hourly add on update … short lived, 2-3 days max\"); updates come when news does, checked every ten minutes, not on the hour. Picked: SEC filings, and stories about the company (subject, filer, or the wire's tag) that the reader calls new, or material follow-ups; old, commentary and noise are counted. The morning brief waits for the reader until 09:15 while followed stories are unread. A part that fails the check shows its headline, marked. Briefs show on the desk for 72 hours; the files stay. About 4 seconds a company. Needs Ollama on port 11434.",
  }),
  job({
    id: "alpha-vantage-earnings", name: "Alpha Vantage analysts' EPS estimates", group: "research", mode: "scheduled", cron: "40 6 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/alpha-vantage-earnings.mts"), purpose: "Fetch the analysts' consensus EPS per reported quarter (with the reported EPS, report date and time of day) for 25 registry companies a day: first every company without a stored answer, then the oldest copies again.",
    input: "Alpha Vantage's EARNINGS function with the owner's free key (ALPHAVANTAGE_API_KEY in .env, never printed), the company registry, and the archive's manifest on D:.", output: "Raw answers unchanged under D:/research/alpha-engine/estimates/alphavantage/earnings/raw/<TICKER>/<date>.json and manifest.json (symbol, SHA-256, bytes, quarters, quarters with an estimate, first and last quarter, and one line per run).",
    destination: "Local D: archive only; research input; no production write and no database write.", requirements: ["network", "mysql", "driveD"], notes: "The owner's go of 2026-11-25. The free key allows 25 requests a day (alphavantage.co/premium and /support); one request returns a company's whole history, so the first pass over the 502 registry tickers takes 21 days (the first 25 were fetched by hand on 2026-11-25). One request every 15 seconds. A rate-limit notice stops the run without marking anything; a premium-only notice stops it with an error. A ticker that is empty under both class separators is asked again after 30 days. A stored answer is never rewritten; a missing archive folder stops the run and creates nothing.",
  }),
  job({
    id: "std-guidance-refresh", name: "Guidance standard daily gated refresh", group: "expectations", mode: "scheduled", cron: "25 2 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("../alpha-engine-lab/src/research/guidance/std-guidance-refresh.mts"), purpose: "Add the earnings releases reported since the release calendar was built to the guidance standard: the local model reads the releases it has not read, the standard is rebuilt and published only after its gates and a regression against the published build pass.",
    input: "The pinned release calendar and the nightly SEC cache (through scripts/build-calendar-addendum.mts), the cached release exhibits, the original extractions on D:, the standard-price sessions and the app's completed SPY sessions since the weekly price refresh.", output: "The calendar addendum under D:/research/alpha-engine/engine/events/addendum, the new extraction in guidance-pass2-new, one build folder per changed day under D:/research/alpha-engine/guidance/std, the pointer current.json, rebuilt desk company files and worker/.runs/local-generated/std-guidance-refresh.json.",
    destination: "Local D: artifacts only; no production write and no database write.", requirements: ["network", "mysql", "driveD"], notes: "The owner's go of 2026-11-24. Uses the local model on the GPU, but does not list the gpu requirement, whose preflight needs Ollama already running: Ollama is started for the run when it is not running and stopped again when this run started it; an Ollama the owner left running is not stopped. At most 60 releases a night (--limit), the rest the next night. A night with no new release and no new session ends as unchanged before the model or the build runs. Releases the model could not read are tried again the next night. The research database is not loaded (its guidance tables are keyed by version). Runs after the nightly SEC fetch.",
  }),
  job({
    id: "std-fundamentals-refresh", name: "Standard fundamentals daily gated refresh", group: "fundamentals", mode: "scheduled", cron: "12 3 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("../alpha-engine-lab/src/fundamentals/std-fundamentals-refresh.mts"), purpose: "Rebuild the standard fundamentals from the night's SEC facts under the published build's rules and publish the new build only when its QA and checks pass and a comparison with the published build finds nothing removed or broken.",
    input: "The local SEC facts table, SEC's financial statement data-set extracts and the newest filings' own XBRL on D:, and the published build.", output: "One dated build folder per changed day under D:/research/alpha-engine/fundamentals/standard, the pointer current.json, rebuilt desk company files and worker/.runs/local-generated/std-fundamentals-refresh.json.",
    destination: "Local D: artifacts only; no production write, no database write (the research database keeps v3.1).", requirements: ["network", "mysql", "driveD"], notes: "The owner's go of 2026-11-24. A night with no new facts, filings or code ends as unchanged before building. A failed gate stops the chain and the pointer stays on the previous build. About 12 minutes and 64 MB a build; nothing is pruned. The orchestrator refuses to start when the lab's fundamentals code has uncommitted changes.",
  }),
  job({
    id: "std-insiders-refresh", name: "Insider standard daily gated refresh", group: "research", mode: "scheduled", cron: "35 3 * * 1-6", defaultEnabled: true, dependsOn: [],
    ...npx("../alpha-engine-lab/src/insiders/std-insiders-refresh.mts"), purpose: "Read the SEC's Form 3, 4 and 5 filings through the last completed trading session, rebuild the insider standard and publish the new build as files only after its acceptance checks and a regression against the published build pass.",
    input: "The SEC's daily form indexes and filing documents since the last quarterly bulk set, the bulk sets and the reviewed predecessor map on D:, the standard-price calendar and prices, and the app's completed daily bars of SPY for the sessions since the weekly price refresh.", output: "One build folder per run under D:/research/alpha-engine/insiders/std, the pointer current.json, rebuilt desk company files and worker/.runs/local-generated/std-insiders-refresh.json.",
    destination: "Local D: artifacts only; no production write, no database write (the research tables are loaded by std-insiders-db-load on Sundays).", requirements: ["network", "mysql", "driveD"], notes: "The owner's go of 2026-11-24. Forms are read through the completed session before the last one: the SEC publishes a filing's folder up to a day after its index lists it, so a form reaches the desk on the second morning after it is filed. Monday to Saturday: on Sundays std-insiders-db-load runs the same refresh with a full build. The build is incremental (companies without new filings are carried over as hard links) and replays the saved reading of the quarterly SEC sets in sec-345/reading/<key> instead of reading them again; measured 2026-11-24: 1.6 minutes for a build with every company carried over, 4 to 6 minutes when all are recomputed (after a code change or a standard-price change), about 10 minutes for the whole run with the form fetch and acceptance checks. A run with no new session and an unchanged price calendar ends as unchanged in seconds. A failed step stops the chain with an honest error; before the swap the stored build is untouched, and the pointer names the previous build until the new one is final. Every run keeps its own build folder and nothing is pruned, so D: grows with each build. The orchestrator refuses to start when the lab's insider code has uncommitted changes. Scheduled at 03:35 so its database load starts after the night's other loads.",
  }),
  job({
    id: "r1000-insiders-refresh", name: "Russell 1000 insider filings and price basis", group: "research", mode: "scheduled", cron: "0 4 * * *", defaultEnabled: false, dependsOn: ["edgar-fetch-r1000"],
    ...npx("../alpha-engine-lab/src/insiders/r1000-insiders-refresh.mts"), purpose: "Read the SEC's daily insider forms for the current Russell 1000 universe and write a separate build using the corrected panel and component-aware Yahoo split evidence.",
    input: "SEC daily form indexes and documents, research-universe-r1000-current.json, the K31.5 panel and Yahoo split events, shared raw insider archives.", output: "D:/research/alpha-engine/insiders/r1000/<stamp> and r1000-price-input/<stamp>; no std_insider_* or S&P standard replacement.",
    destination: "Local D: artifacts only; no production, research-database or standard-table write.", requirements: ["network", "driveD"], notes: "Disabled until Claude accepts phase 3. Uses the existing SEC parser/builder with a separate registry and roots; no fork of the standard refresh.",
  }),
  job({
    id: "std-insiders-db-load", name: "Insider standard weekly database load", group: "research", mode: "scheduled", cron: "10 4 * * 0", defaultEnabled: true, dependsOn: [],
    ...npx("../alpha-engine-lab/src/insiders/std-insiders-refresh.mts", ["--load"]), purpose: "Bring the research database's insider tables up to the published standard: the same gated refresh as every night, plus a staged load, an independent live check and the stored build's final status.",
    input: "As std-insiders-refresh, and the stored build's own folder for a second regression.", output: "A new build folder, an atomic swap of the std_insider_* research tables after a staged read-back, the pointer current.json and rebuilt desk company files.",
    destination: "Local D: artifacts and alpha_research only; no production write and no alpha_engine mutation.", requirements: ["network", "mysql", "driveD"], notes: "Sundays only: the load of 3.6 million rows in batches of 500 took about two and a half hours on 2026-11-24 and holds the scheduler's one lane, which on a weekday would delay live prices. A stored final build is replaced only against a passed regression that names it; before the swap the stored tables are untouched.",
  }),
  job({
    id: "macro-fred-weekly", name: "FRED and ALFRED vintage refresh", group: "research", mode: "scheduled", cron: "30 5 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/macro-fred-fetch.mts", ["--group", "all"]), purpose: "Refresh all registered FRED series with raw yearly chunks, vintage availability and resumable manifests.",
    input: "FRED/ALFRED API, existing D:-only macro archive and the configured server-side API key.", output: "Raw hashes, normalized first-to-current vintage rows and manifest-fred.json from 2000 onward.",
    destination: "Normalized vintage rows automatically pushed through macroPoints after exit-ok; raw FRED chunks stay local.", requirements: ["network", "driveD"], notes: "Daily since 2026-11-24 (it ran on Sundays only, so yields, VIX and credit spreads were up to a week old); the job keeps its old id. The full-vintage refresh preserves sourceHash and realtimeStart/End. Conflicting vintages are rejected with reasons rather than overwritten. Request spacing remains capped at 100 requests per minute.",
  }),
  job({
    id: "desk-macro", name: "Desk macro card", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["macro-fred-weekly"],
    ...npx("scripts/build-desk-macro.mts"), purpose: "Write the Today page's macro card from the macro archive: the newest published value of each of its eight FRED series.",
    input: "On D:, manifest-fred.json and the normalized vintage files of the card's series.", output: "worker/.runs/desk-macro.json.",
    destination: "Local file read by dashboard.macro; no production write and no database write.", requirements: ["driveD"], notes: "Runs after every FRED refresh. A series that is not complete in the manifest, or whose newest value in force is not for the manifest's last observation, stops the build and leaves the previous file in place. --dry-run measures without writing.",
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
    id: "company-exposure-evidence", name: "Company macro exposure evidence", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["research-series"],
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
    id: "macro-transmission-atlas", name: "Macro Transmission Atlas", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["macro-event-study", "research-series"],
    ...npx("scripts/build-macro-transmission-atlas.mts"), purpose: "Estimate company-level macro transmission with point-in-time SEC exposure, market-model returns and frozen discovery-only OOS evaluation.",
    input: "First-release macro event observations, canonical series, daily company and SPY prices.", output: "macro-transmission-atlas.json and .md with sector FE interactions, event-bootstrap CI95 and OOS metrics.",
    destination: "Local research artifact only; no production write or probability promotion.", requirements: ["mysql", "driveD", "review"], notes: "Exposure must be available and non-stale at event eligibility. Debt burden is a proxy, not a floating-rate share. OOS coefficients are never refit.",
  }),
  job({
    // after both evening chains (prices → analytics, chains → feature lab), so the app shows the day's close the same
    // evening; the 06:00 expectations report is compiled by the next build instead of holding every build until 06:00
    id: "ui-production-build", name: "Production UI rebuild", group: "delivery", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-daily-bars", "schwab-feature-lab"],
    executable: "npm", args: ["run", "build"], command: "npm run build", purpose: "Compile newly generated static snapshots and the server into dist for normal production-mode operation.",
    input: "Current source and freshly generated report artifacts.", output: "dist/public and dist/boot.js.",
    destination: "Local production server files only; no cloud deployment.", requirements: ["review"], notes: "Required for application code or generated TypeScript changes, not for a Schwab-only JSON refresh. Not required for npm run dev; restart production only when server behavior changes.",
  }),
  job({
    id: "daily-digest", name: "Local morning brief", group: "live", mode: "paused", cron: "15 7 * * *", defaultEnabled: false, dependsOn: [],
    ...npx("scripts/daily-digest.mts", ["--hours", "36"]), purpose: "Summarize the last 36 hours of actual local signals into a short owner brief.",
    input: "Local signals, local Ollama and the currently configured model.", output: "One morning digest with model and window metadata.",
    destination: "Local probation when INGEST_URL is set; no automatic reviewed production promotion is added by the scheduler.", requirements: ["server", "gpu", "mysql"], notes: "Paused on 2026-11-24: the owner paused the morning brief and the local model is stopped, so the job failed every morning; its only reader, the classic dashboard, is gone. SEC facts and crowd comments stay separate. An empty signal window exits successfully without generating filler.",
  }),
  job({
    id: "daily-operations-report", name: "Daily operations health report", group: "maintenance", mode: "scheduled", cron: "20 7 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("scripts/build-daily-operations-report.mts"), purpose: "Record scheduler health, same-day Schwab evidence, job failures and pending automation in one owner-only static report.",
    input: "Persistent scheduler state, current registry configuration and credential-free Schwab report summaries.", output: "daily-operations.json and .md in public/reports and an existing dist/public/reports bundle.",
    destination: "daily-operations.json and .md automatically pushed through reportFile after exit-ok and served from the fresher of DB/static.", requirements: [], notes: "Runs independently after the morning jobs so failed parents cannot suppress the health report. A critical report is evidence, not a scheduler process failure; its push failure still marks the job error.",
  }),
  job({
    id: "data-health", name: "Data health and quarantine", group: "maintenance", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["research-series", "schwab-daily-bars", "edgar-exhibits-daily", "schwab-feature-lab"],
    ...npx("scripts/build-data-health.mts"), purpose: "Check price, filing, extraction and option inputs and record point-in-time quarantine evidence without rewriting data.",
    input: "Local prices, facts, series_points, K06 calendar, extraction results and Dolt option features.", output: "public/reports/data-health.json and .md plus research/engine/quarantine.json with per-check evidence, and an existing dist/public/reports bundle.",
    destination: "Local read-only QA artifacts; no production write, schema change or retroactive data removal.", requirements: ["mysql", "driveD", "review"], notes: "All option snapshots receive spot/IV checks; parity strikes are checked on monthly first trading dates and the latest date through the Dolt clone.",
  }),
  job({
    id: "run-log-retention", name: "Run log retention", group: "maintenance", mode: "scheduled", cron: "20 3 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("scripts/prune-run-logs.mts", ["--days", "14"]), purpose: "Remove the scheduler's per-run log files older than 14 days.",
    input: "worker/.runs/<epoch ms>-<job id>.log files and their modification times.", output: "One line with the counts and megabytes removed and kept.",
    destination: "Local worker/.runs only.", requirements: [], notes: "Only files named like a run log are touched. The scheduler log, the server log, state files and run folders stay. --dry counts without deleting.",
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
    id: "schwab-refresh-manual", name: "Schwab token keepalive", group: "maintenance", mode: "scheduled", cron: "0 2 */2 * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/schwab-refresh.mts"), purpose: "Rotate the access and refresh tokens every two days so the seven-day refresh-token window does not expire during normal unattended operation.",
    input: "Local refresh token and Schwab client credentials available in the scheduler process environment.", output: "Updated local token file and an AAPL HTTP smoke result; no token values in the UI.",
    destination: "Local credential store only.", requirements: ["network"], notes: "Browser authorization is needed only after revocation, credential/app changes or an outage long enough to lose the refresh window. The daily collector also refreshes an expired access token when credentials are available.",
  }),
  job({
    id: "flow-insiders", name: "Money map: insiders", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["std-insiders-refresh"],
    ...npx("scripts/build-flow-insiders.mts"), purpose: "Rebuild the money map's Insiders group: per quarter, the largest open-market buyers and sellers of their own company's shares.",
    input: "The insider standard's published build as files (D:/research/alpha-engine/insiders/std/current.json), which the nightly gated refresh writes; the research database is not read.", output: "worker/.runs/desk-flows/insiders.json, read by desk.flowsInsiders.",
    destination: "Local file read by the desk; no production write and no database write.", requirements: ["driveD"], notes: "The owner's request of 2026-11-26. Runs after every insider refresh (Monday to Saturday), in about ten seconds. Consumer rules of the standard: open-market P and S lines, no flagged or duplicate lines, related owners' repeats counted once. A line that does not read is left out and named in the file and the log (damagedLines), never guessed at.",
  }),
  job({
    id: "congress-house-daily", name: "Congress: House transaction reports", group: "research", mode: "scheduled", cron: "45 3 * * *", defaultEnabled: true, dependsOn: [],
    ...npx("worker/congress-house.mts", ["--daily"]), purpose: "Collect the House members' new periodic transaction reports: this year's and last year's index read again, new PDFs downloaded.",
    input: "The House Clerk's public yearly index (YYYYFD.zip) and PTR PDFs, one request a second.", output: "D:/research/alpha-engine/people/congress/house: a changed index as a new dated ZIP beside the old one (never written over), new PDFs, the year manifests and summary-daily.json.",
    destination: "Local raw archive on D:; no production write and no database write.", requirements: ["network", "driveD"], notes: "The owner's request of 2026-11-26 (\"schedule the politicians builder nightly\"). A report that fails gets its retries, goes to house-todo.jsonl and is skipped; after five attempts it is not retried; it never fails the run (the collector skip rule). About 15 s when nothing is new.",
  }),
  job({
    id: "congress-senate-daily", name: "Congress: Senate transaction reports", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["congress-house-daily"],
    ...npx("worker/congress-senate.mts", ["--daily"]), purpose: "Collect the senators' new periodic transaction reports from the Senate's public eFD search.",
    input: "Senate eFD public search (the statutory agreement accepted in memory) and the report pages, one request every 3 s.", output: "D:/research/alpha-engine/people/congress/senate: the index pages of the run, new report HTML (or PDF and images for paper filings), the manifest and summary.json.",
    destination: "Local raw archive on D:; no production write and no database write.", requirements: ["network", "driveD"], notes: "Runs after the House job. About 4 minutes (the whole index is paged each night). A report that fails is retried on later nights up to five attempts and stays in senate-todo.jsonl; it never fails the run; 403/429 or three transport failures in a row still stop it.",
  }),
  job({
    id: "congress-parse-daily", name: "Congress: parse new reports", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["congress-senate-daily"],
    ...npx("worker/congress-parse.mts", ["--no-combined"]), purpose: "Parse the new House PDFs and Senate pages into their per-report checkpoints with the accepted parsers.",
    input: "The stored reports on D: and the company index (D:/research/alpha-engine/news/lookup/company-index.json); no network.", output: "One parsed JSON per new report under house/<year>/parsed and senate/parsed; no combined trades file (a reviewed run writes that).",
    destination: "Local files on D:; no production write and no database write.", requirements: ["driveD"], notes: "Reports already parsed by the same parser version are skipped, so a night without news takes about 10 s. Scanned paper filings are listed, not read.",
  }),
  job({
    id: "flow-politicians", name: "Money map: politicians", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["congress-parse-daily"],
    ...npx("scripts/build-flow-politicians.mts"), purpose: "Rebuild the money map's Politicians group: per quarter, the members of Congress with the largest stock trades in our companies.",
    input: "The accepted Congress trades (K34.1 resolution file, its SHA-256 checked) plus the reports parsed since, resolved the same way.", output: "worker/.runs/desk-flows/politicians.json, read by desk.flowsPoliticians (newerReports counts what is not in the accepted file).",
    destination: "Local file read by the desk; no production write and no database write.", requirements: ["driveD"], notes: "The owner's request of 2026-11-26. Listed stock only, amounts as the reported ranges, re-filed rows counted once, restricted-stock awards left out. About 5 s.",
  }),
  job({
    id: "flow-trading", name: "Money map: how it trades", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["schwab-daily-bars"],
    ...npx("scripts/build-flow-trading.mts"), purpose: "Rebuild the money map's trading layer and the company pages' trading strip and measured peers after the evening prices: dollar volume per company, sector and market, week by week against each company's usual day, and the ETF money flows from share counts (owner's request of 2026-11-28).",
    input: "Local MySQL prices (Schwab daily bars, read only); worker/.runs/desk-flows/overview.json; the newest lab volume-flows peers (D:/research/alpha-engine/flows/daily/<stamp>/peers.json); the daily quote archive and etf-shares.jsonl for ETF share counts.", output: "worker/.runs/desk-flows/trading.json and trading/<cik>.json, read by desk.flowsTrading and desk.flowsTradingCompany.",
    destination: "Local files read by the desk; no production write and no database write.", requirements: ["mysql", "driveD"], notes: "About 20 s. Trading has no direction (a daily bar cannot split buying from selling); the only real money in and out is the ETF share counts. Peers are measured quarterly in the lab (daily_flows.py), not by this job.",
  }),
  job({
    id: "flow-activists", name: "Money map: activists (Schedule 13D)", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["edgar-fetch-daily"],
    ...npx("scripts/build-flow-activists.mts"), purpose: "Rebuild the money map's Activists group: the Schedule 13D stakes of more than 5% in our companies, per quarter, new, raised, cut or below 5%.",
    input: "The 13D filings the nightly SEC fetch keeps under worker/cache/edgar (no download), the CUSIP map of index-membership and the flows overview's companies.", output: "worker/.runs/desk-flows/activists.json, read by desk.flowsActivists.",
    destination: "Local file read by the desk; no production write and no database write.", requirements: ["driveD"], notes: "The owner's request of 2026-11-26. Runs after the nightly SEC fetch, in about a minute. A filing's company is its cover's CUSIP, else the issuer's name against the folder it sits in; each accession is counted once.",
  }),
  job({
    id: "desk-company-statements", name: "Desk company files", group: "research", mode: "scheduled", cron: null, defaultEnabled: true, dependsOn: ["edgar-fetch-daily"],
    ...npx("scripts/build-desk-company.mts"), purpose: "Rebuild the per-company files behind the desk from the research standards and the nightly SEC cache: statements, guidance history, splits and dividends, holders, insiders, and the filings list with the Today page's feed.",
    input: "On D:, the standards' own files (fundamentals, guidance, daily prices, 13F holders, insiders, adjusted earnings), the release calendar, and the manifests the nightly SEC fetch keeps beside the cached documents. The research database is not read.", output: "worker/.runs/desk-company: one file per company and kind, the cross-company files (insiders-market, guidance-market, screen, filings-latest) and index.json with the versions used and a content hash.",
    destination: "Local files read by the desk procedures; no production write.", requirements: ["driveD"], notes: "Runs after the nightly SEC fetch so the filings list and the Today feed carry yesterday's filings; the standards themselves change only when a new build is accepted. A missing or incomplete source stops the build and leaves the previous files in place. --dry-run measures without writing.",
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
