export interface ReviewerGuideContent {
  title: string;
  purpose: string;
  represents: string;
  collection: string;
  cadence: string;
  mechanics: string;
  hypothesis: string;
  decision: string;
}

const entry = (
  title: string,
  purpose: string,
  represents: string,
  collection: string,
  cadence: string,
  mechanics: string,
  hypothesis: string,
  decision: string,
): ReviewerGuideContent => ({ title, purpose, represents, collection, cadence, mechanics, hypothesis, decision });

export const REVIEWER_NAV_GUIDE: Record<string, ReviewerGuideContent> = {
  "/dashboard": entry(
    "Dashboard",
    "Open the operating summary before drilling into evidence.",
    "Registry counts, recent filing activity and the visible job queue rather than a trading signal.",
    "The control-plane API reads the existing database; underlying filings and factors still come from their own collectors.",
    "Summary counters refresh every 5 seconds; source-data freshness varies by collector.",
    "No cross-asset model is applied here. The page aggregates operational counts and links to detailed surfaces.",
    "A compact operational map helps distinguish missing collection from missing interpretation.",
    "Use it to choose the next evidence surface, not to rank securities.",
  ),
  "/universe": entry(
    "Universe",
    "Show which companies belong to the active research or presentation universe.",
    "Per-user company memberships and active/inactive scope, not a recommended portfolio.",
    "Company identities come from SEC mappings; this presentation account receives 50 reviewed memberships.",
    "Membership changes only through an owner action; reviewer access is read-only.",
    "Company CIK joins membership to filings, prices and factors. Membership itself has no return calculation.",
    "A fixed scope makes results comparable and prevents silent universe expansion.",
    "Use it to verify coverage and selection before interpreting any result.",
  ),
  "/screener": entry(
    "Screener",
    "Compare available company metrics on one aligned table.",
    "Latest eligible fundamentals, derived factors, sentiment and price context for the current universe.",
    "SEC facts feed canonical series; local pipelines derive factors and join price or narrative evidence.",
    "Rows refresh after their producing jobs; different columns can have different availability dates.",
    "Values are joined by company and eligibility anchor. Missing or stale evidence remains explicit rather than forward-filled indiscriminately.",
    "Cross-company comparison can find candidates for deeper reading, but ranking alone is not alpha.",
    "Use it for triage, then inspect availability and company-level lineage before a decision.",
  ),
  "/jobs": entry(
    "Jobs",
    "Explain the operational state of collection and computation tasks.",
    "Queued, running, completed and failed jobs visible to this account.",
    "The server reads job records written by the single executor and scheduler.",
    "The visible queue polls every 5 seconds.",
    "Status is an operational state machine; it does not measure research quality or investment return.",
    "Explicit failures and stale dependencies are safer than silent retries or duplicate collectors.",
    "Use it for diagnosis. A reviewer can inspect but cannot launch or mutate jobs.",
  ),
  "/messages": entry(
    "Messages",
    "Provide account-level support and owner communication.",
    "Private message threads and unread counts, not research evidence.",
    "Messages are stored per user by the application server.",
    "Unread state refreshes every 15 seconds while the shell is open.",
    "No financial calculation or model inference is attached to a message.",
    "Keeping caveats and owner guidance visible prevents them from being confused with model output.",
    "Use it for clarification only; never treat a message as validated evidence.",
  ),
  "/project-state": entry(
    "Project State",
    "Separate code readiness, collected data, research evidence and reviewed delivery.",
    "A reviewed project snapshot layered with live operational health where available.",
    "Maintainers record durable milestones; scheduler heartbeat and daily reports supply live status.",
    "Durable state changes on reviewed commits; live health follows scheduler/report updates.",
    "No score is inferred from a green milestone. Each phase has its own evidence and completion semantics.",
    "A commit or successful collector does not prove alpha, coverage or production readiness.",
    "Use it to understand what is actually ready and what remains a limitation.",
  ),
  "/analytics": entry(
    "Analytics",
    "Inspect factor behaviour and evaluation design rather than a single performance headline.",
    "Factor IC, historical evaluation, baselines, costs and coverage across available panels.",
    "Availability-anchored company series and forward returns feed the research pipelines.",
    "Metrics change after factor or evaluation rebuilds, not on every page load.",
    "Typical mechanics include Spearman rank IC, chronological splits, baselines and cost-aware comparisons; the active tile specifies the exact path.",
    "A factor may contain information, but incremental value must survive out-of-sample and implementation costs.",
    "Use results as descriptive evidence and hypothesis screening, never as guaranteed performance.",
  ),
  "/scenario-lab": entry(
    "Scenario Lab",
    "Translate macro shocks into bounded, explainable company sensitivity.",
    "Historical shock distributions, company exposure evidence and scenario statuses.",
    "FRED/ALFRED vintages supply shocks; SEC facts supply availability-anchored exposure inputs.",
    "Rebuilds follow reviewed macro or exposure updates; historical and current presets remain distinct.",
    "Rate/credit differences and oil/USD log returns form shock distributions. Exposure requires matched period/unit evidence; rate percentages are converted to decimals.",
    "Historical co-movement may identify vulnerability, but a scenario is conditional arithmetic, not a forecast.",
    "Use it for stress discussion and exposure comparison, with partial or upper-bound labels kept visible.",
  ),
  "/market-data": entry(
    "Market Data",
    "Inspect source coverage and normalized market snapshots.",
    "Per-ticker capture state, source lineage and option/equity context where available.",
    "Schwab snapshots and other declared providers are normalized locally with per-source hashes and capture dates.",
    "The full daily snapshot has a scheduled local slot; hourly context cannot substitute for a missing full capture.",
    "A ticker is healthy only for its own captured date and source evidence. Pending before the scheduled slot is not a false error.",
    "Lineage and timestamp discipline matter more than a deceptively fresh number.",
    "Use it to judge whether market evidence is usable for the intended research anchor.",
  ),
  "/expectations": entry(
    "Expectations",
    "Compare structured guidance with later evidence without look-ahead bias.",
    "Guidance ranges, revisions, assumptions and extraction coverage from company communications.",
    "SEC 8-K filings and EX-99 material are parsed into structured expectation records.",
    "Updates follow filing collection and extraction runs; unavailable guidance stays missing.",
    "Accession and publication anchors determine when guidance became knowable. Actuals and revisions must use compatible periods and definitions.",
    "Expectation gaps may explain later reaction, but extraction quality and benchmark accuracy remain open evidence questions.",
    "Use it for event review and hypothesis formation, not as a certainty about future earnings.",
  ),
};

const VOLATILITY_RISK_GUIDE = entry(
  "Volatility risk replay",
  "Translate a volatility forecast into bounded exposure and compare the scenario with the realized move.",
  "A reviewed AAPL replay with ATM IV/RV20 expected moves, target-volatility exposure, normalized return and empirical coverage.",
  "The stored research snapshot combines option-implied volatility, trailing realized volatility, spot, DTE and the subsequent realized price move.",
  "It changes only when a new reviewed replay is published; the visible replay is not a live quote or trading instruction.",
  "w = clamp(σ_target / σ_forecast, 0.25, 1.00); exposure = capital × w; z = R / (EM / S); scenario move = capital × w × EM / S; actual ratio = realized move / EM.",
  "Volatility targeting can bound scenario risk, but expected-move bands are not probability intervals and user-supplied return is not an Alpha Engine forecast.",
  "Use it to compare ATM IV with RV20, inspect calibration and stress exposure assumptions without treating the replay as a live recommendation.",
);

const PAGE_DEFAULTS: Array<[string, ReviewerGuideContent]> = [
  ["/analytics/risk-lab", VOLATILITY_RISK_GUIDE],
  ["/dashboard", REVIEWER_NAV_GUIDE["/dashboard"]],
  ["/company", REVIEWER_NAV_GUIDE["/screener"]],
  ["/scenario-lab", REVIEWER_NAV_GUIDE["/scenario-lab"]],
  ["/market-data", REVIEWER_NAV_GUIDE["/market-data"]],
  ["/expectations", REVIEWER_NAV_GUIDE["/expectations"]],
  ["/analytics", REVIEWER_NAV_GUIDE["/analytics"]],
  ["/project-state", REVIEWER_NAV_GUIDE["/project-state"]],
  ["/universe", REVIEWER_NAV_GUIDE["/universe"]],
  ["/screener", REVIEWER_NAV_GUIDE["/screener"]],
  ["/jobs", REVIEWER_NAV_GUIDE["/jobs"]],
  ["/messages", REVIEWER_NAV_GUIDE["/messages"]],
  ["/", REVIEWER_NAV_GUIDE["/universe"]],
];

function pageDefault(pathname: string): ReviewerGuideContent {
  return PAGE_DEFAULTS.find(([prefix]) => prefix === "/" ? pathname === "/" : pathname.startsWith(prefix))?.[1] ?? REVIEWER_NAV_GUIDE["/universe"];
}

export function reviewerTileGuide(pathname: string, heading: string, visibleText: string): ReviewerGuideContent {
  const base = pageDefault(pathname);
  const haystack = `${heading} ${visibleText.slice(0, 900)}`.toLowerCase();
  const titled = (content: ReviewerGuideContent): ReviewerGuideContent => ({ ...content, title: heading || content.title });

  if (pathname.startsWith("/analytics/risk-lab")) return titled({ ...VOLATILITY_RISK_GUIDE, title: heading || VOLATILITY_RISK_GUIDE.title });
  if (pathname.startsWith("/company/") && /exchange|fiscal year end|company identity/.test(haystack)) return titled(entry(
    heading || "Company identity",
    "Verify that every subsequent series belongs to the intended legal issuer.",
    "Ticker, company name, CIK, exchange, SIC industry, fiscal year end and universe membership.",
    "The company registry is reconciled with SEC identifiers and the reviewed universe mapping.",
    "Changes only when registry metadata or the universe mapping is reviewed; it is not a market tick.",
    "CIK is the join key to filings and facts. SIC and fiscal year end inform peer grouping and calendar alignment; no return is calculated here.",
    "Stable issuer identity prevents the more damaging error of analysing the wrong company or an outdated mapping.",
    "Use this tile as the identity and fiscal-calendar check before interpreting any company metric.",
  ));
  if (/filings indexed|documents registered|documents in cloud|canonical series/.test(haystack)) return titled(entry(
    heading || "Evidence coverage counters",
    "Show how much source and derived evidence is actually available for this company.",
    "Counts of indexed filings, registered or fetched documents and canonical series.",
    "The API counts existing company-linked records from collection and series-building pipelines.",
    "Counts change after the corresponding collector or builder completes, not continuously.",
    "Each number is a record count at a different pipeline stage; documents in cloud must not be confused with scored documents.",
    "A larger corpus enables research but does not establish extraction quality, completeness or predictive value.",
    "Use the counters to detect missing stages before trusting downstream analysis.",
  ));
  if (/data integrity|grid coverage|revision rate|revision magnitude|revision lag/.test(haystack)) return titled(entry(
    heading || "Data integrity and revisions",
    "Expose continuity and restatement risk before a series is used in a model.",
    "Grid coverage, revision frequency, revision magnitude, revision lag and amendment counts.",
    "Canonical SEC series compare available facts, first/latest vintages and amendment history.",
    "Recomputed when canonical series or vintage materialization reruns.",
    "Coverage is the eligible populated share of the expected grid; revision rate is the revised share of comparable points; revision lag measures availability distance between original and amendment.",
    "Restatements can change history and factor ranks, so a clean-looking backtest may otherwise hide vintage leakage.",
    "Use it to discount unstable evidence and inspect flagged series before model or valuation decisions.",
  ));
  if (/insider activity|form 4|open.market/.test(haystack)) return titled(entry(
    heading || "Insider activity",
    "Summarise reported insider transactions without turning them into automatic direction signals.",
    "Form 4 buys, sells, gifts and other reported transaction categories with event dates.",
    "SEC Form 4 filings are normalized and grouped by issuer and insider.",
    "Updates after new Form 4 collection; transaction and filing availability dates remain distinct.",
    "Net open-market flow sums eligible purchases and sales while excluding categories such as gifts from that subtotal.",
    "Insider transactions may provide context, but compensation, taxes and diversification can produce non-informational trades.",
    "Use it as an event and governance signal requiring context, not as a standalone buy/sell instruction.",
  ));
  if (/price|close|day range|volume|daily bars|stooq|52-week/.test(haystack)) return titled(entry(
    heading || "Price and volume context",
    "Anchor the company discussion in dated market observations.",
    "End-of-day price, volume and range statistics, not an executable real-time quote.",
    "Declared providers such as Stooq or Schwab are stored with per-bar source and date lineage.",
    "Price series update on their collector schedule; the tile always shows the actual latest available date.",
    "Day change = latest close − previous close. Selection return = end close / start close − 1; high/low are extrema over the visible interval.",
    "Price context can frame valuation and event response, but free EOD history does not establish execution quality.",
    "Use it for historical comparison and event alignment, not for real-time order placement.",
  ));
  if (/short interest|days.to.cover|settlement/.test(haystack)) return titled(entry(
    heading || "Short interest",
    "Show reported bearish positioning with its publication lag.",
    "Settlement-dated short interest and derived coverage ratios.",
    "The declared short-interest source is captured by settlement and publication dates.",
    "Usually twice monthly; values can remain unchanged between settlements without being treated as newly observed.",
    "Days to cover = reported short interest / comparable average daily volume. Float share = short interest / eligible float.",
    "Crowded positioning may affect risk, but direction and squeeze timing are not determined by this series alone.",
    "Use it as delayed risk context alongside price, liquidity and event evidence.",
  ));
  if (/sentiment|tone|document|md&a|narrative|score/.test(haystack)) return titled(entry(
    heading || "Documents and narrative evidence",
    "Expose filing text and model-derived narrative measurements separately.",
    "Source documents, extracted sections and bounded sentiment/tone scores.",
    "SEC filings are sectioned locally; eligible text is scored by the documented local LLM pipeline.",
    "Updates require a newly collected filing plus successful sectioning/scoring.",
    "Availability comes from the filing. Text → section → prompt version → score is preserved; no score is assigned to an unavailable document.",
    "Changes in narrative may contain incremental information, but extraction and scoring stability require independent validation.",
    "Use scores to locate passages and form hypotheses; read the source before making a decision.",
  ));
  if (/expectation|guidance|revision|eps forecast/.test(haystack)) return titled({ ...REVIEWER_NAV_GUIDE["/expectations"], title: heading || REVIEWER_NAV_GUIDE["/expectations"].title });
  if (/scenario|shock|exposure|oil|credit|rates|calibration/.test(haystack)) return titled({ ...REVIEWER_NAV_GUIDE["/scenario-lab"], title: heading || REVIEWER_NAV_GUIDE["/scenario-lab"].title });
  if (/atlas|transmission|abnormal return|event study|ofac/.test(haystack)) return titled(entry(
    heading || "Macro event transmission",
    "Measure how macro events and company exposure jointly relate to abnormal returns.",
    "Event-study observations, exposure interactions, discovery fits and frozen out-of-sample evaluation.",
    "OFAC publication events, first-release macro vintages, SEC exposure and market prices are aligned by availability.",
    "Rebuilds follow reviewed source updates; horizons are 1/5/21/63 observation days with chronological 70/30 discovery/OOS.",
    "Market-model abnormal returns are regressed on shock, exposure and shock × exposure with sector effects. Discovery coefficients are frozen for OOS.",
    "Transmission can differ across exposed companies, but limited coverage and negative OOS results must remain visible.",
    "Use it to evaluate a mechanism, not to extrapolate a directional trade from insufficient studies.",
  ));
  if (/factor|spearman|\bic\b|intrinsic|value|quality|momentum/.test(haystack)) return titled(entry(
    heading || "Factor and valuation evidence",
    "Explain how raw company evidence becomes a comparable research measurement.",
    "Derived factors, valuation ratios or rank-association statistics with explicit availability.",
    "First-filed SEC facts and eligible prices feed canonical series and factor materialization.",
    "Values update only after their source and derived pipelines rerun; every factor retains its own anchor.",
    "Typical path: concept availability → period-aligned series → factor formula → robust cross-sectional treatment → Spearman IC or evaluation. TTM requires four consecutive quarters; missing debt is not zero.",
    "A factor is a hypothesis about relative fundamentals or behaviour, not an intrinsic certainty.",
    "Use the measurement to compare and test; inspect IC stability, costs and coverage before relying on it.",
  ));
  if (/debt|cash|roe|roa|margin|revenue|earnings|fundamental|ttm|eps/.test(haystack)) return titled(entry(
    heading || "Fundamental evidence",
    "Present accounting evidence and derived ratios without hiding missing inputs.",
    "Reported SEC XBRL facts, consecutive-period series and clearly derived financial ratios.",
    "Companyfacts originals/amendments are normalized with sourceFiled and ingestion availability anchors.",
    "Refreshes follow SEC collection and series rebuilds; the displayed period and filing availability remain authoritative.",
    "TTM sums four existing consecutive quarters. ROE = net income / eligible average equity; ROA = net income / eligible average assets; net debt = eligible debt − cash, with missing components left unknown.",
    "Fundamental structure may support medium-term hypotheses, but mismatched periods or units invalidate a ratio.",
    "Use the tile after checking period, units and lineage; do not interpolate missing evidence into a decision.",
  ));
  if (/schwab|option|skew|volatility|snapshot/.test(haystack)) return titled({ ...REVIEWER_NAV_GUIDE["/market-data"], title: heading || REVIEWER_NAV_GUIDE["/market-data"].title });
  if (/coverage|health|scheduler|availability|freshness|reviewed|production/.test(haystack)) return titled({ ...REVIEWER_NAV_GUIDE["/project-state"], title: heading || REVIEWER_NAV_GUIDE["/project-state"].title });
  return titled(base);
}
