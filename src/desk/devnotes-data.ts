/**
 * Build notes shown to the owner at the foot of every desk page: what the page does not have yet, and what could
 * be better together with what we are short of to do it (data, a finished task, compute, or just time). Kept
 * beside the pages so a change to a page and a change to its note travel together.
 */
export interface PageNotes {
  missing: string[];
  /** [what could be better, what we are short of] */
  better: [string, string][];
}

export const DEV_NOTES = {
  today: {
    missing: [
      "Same-day closes: the 464 names outside the research list are captured at 04:30 the next morning, so the page shows the previous session until then.",
      "Confirmed report dates. “Coming up” is projected from each company's own calendar (same quarter last year + 52 weeks, else + 13 weeks).",
      "Guidance changes and the engine's reading for companies that just reported.",
      "“Latest filings” covers watchlist companies with stored filings only (the 50 research companies).",
    ],
    better: [
      ["Intraday prices and a live map", "a streaming quote source (Schwab streaming is specified, not built)"],
      ["An implied move on every upcoming report", "option features for the whole index: the chains are captured daily since 11 November, the feature build still runs on the research 50"],
      ["Macro tiles with change and trend", "a history endpoint over the stored FRED vintages"],
    ],
  },
  markets: {
    missing: [
      "Index weights: tiles are sized by market value, not by float-adjusted S&P weight.",
      "Sector funds as benchmarks beside the sector rows.",
      "Replay of past sessions: the map shows the latest snapshot only.",
    ],
    better: [
      ["Colouring the map by a signal (reaction, guidance, implied against realized volatility) instead of return", "those readings for the whole index"],
      ["A live intraday map", "live quotes"],
    ],
  },
  screener: {
    missing: [
      "Columns from our own filings data (growth, margins, free cash flow): the snapshot carries Schwab's ratios only.",
      "Saved screens and column choice.",
      "Valuation that is right on past dates (task K08).",
    ],
    better: [
      ["Sorting by measured signals", "signal readings beyond the 50 research companies"],
      ["Ranks within the sector", "time only: every input is already in the snapshot"],
    ],
  },
  company: {
    missing: [
      "Financial statements, filings, valuation and sentiment: still in the classic company page.",
      "Guidance history and the engine's reading for this company.",
      "Report time of day (before the open or after the close): the K06 calendar has it for 496 companies, it is not loaded into the app database.",
      "Analyst consensus: no estimates feed is collected.",
    ],
    better: [
      ["Option panels for every company", "features built on the S&P 500 chains"],
      ["Ownership appearing with the page instead of 13 s later", "K07's precomputed per-company 13F summary (in progress)"],
      ["Implied-volatility history and rank", "a per-company IV series in the snapshot (the option history 2019–2026 is on D:)"],
    ],
  },
  signals: {
    missing: [
      "The engine's probabilities: held back until the 446-company test.",
      "Whole-index readings for most families: guidance, insiders and options exist for the 50 research companies.",
      "An evidence history: the ledger is written by hand from the research record, it is not generated from test runs.",
    ],
    better: [
      ["A hit-rate per family that updates nightly", "the engine running inside this repository (it lives in the research repository)"],
      ["Momentum, 13F and short-interest tests", "time only for momentum (closes since 2005 are stored); history for short interest"],
    ],
  },
  earnings: {
    missing: [
      "Guidance per company (raised, lowered, kept): the classic Expectations report is 26 MB; a slim per-company summary is not built.",
      "Reaction measured against the move the options had priced.",
      "Report time of day, so the reaction window is exact instead of two sessions.",
      "Surprise against consensus: there is no estimates feed.",
    ],
    better: [
      ["Each company's history of reactions and drifts, and season statistics by sector", "the K06 calendar loaded into the database (36,900 releases with their exhibits are on D:)"],
      ["Reading every release on the day (figures, guidance)", "the local-model pass on new releases as a scheduled job"],
    ],
  },
  volatility: {
    missing: [
      "Implied-volatility rank and history charts.",
      "Earnings moves against the implied move, per company (does it usually move more than priced?).",
      "Coverage beyond the 50 research companies.",
    ],
    better: [
      ["Skew and term-structure readings with their own evidence", "a direction test of option readings outside releases"],
      ["Sizing for a whole portfolio with sector and liquidity caps", "stored positions: the platform has no portfolio object"],
    ],
  },
  macro: {
    missing: [
      "Oil, dollar and foreign-revenue exposure: computable for one or two companies only, because dimensional XBRL is not read yet (task K10).",
      "Exposure as known on past dates (needed for any test).",
      "Fixed against floating debt and hedges: every figure here is an upper bound.",
    ],
    better: [
      ["Market sensitivity of each company to rates, oil and the dollar from returns", "task K10"],
      ["Macro tiles with trend and release calendar", "a history endpoint and the release dates of each series"],
    ],
  },
  ownership: {
    missing: [
      "Insider filings beyond the 50 research companies.",
      "A controlled test of insider buying: the benchmark shown is a dry run without intervals.",
      "Ranking companies by institutional accumulation.",
      "Short-interest history and readings for the whole index.",
      "Correct 13F positions: the stored table keeps one filed row per security and misses 119 of the 496 companies, so every 13F figure on this page is too low for managers that file many rows (BlackRock, Fidelity, the banks). The Flows page reads the filed reports directly and does not have this defect.",
    ],
    better: [
      ["The 13F panel built on the rebuilt books", "a decision on re-loading the stored table from the cached filings (it changes about two million rows)"],
      ["The 13F panel appearing at once", "K07's precomputed sector flows (in progress)"],
    ],
  },
  flows: {
    missing: [
      "Successor links between filers: when a manager starts reporting under a new entity (BlackRock in 2024, Vanguard in 2026) the old and the new are two funds here, and the quarter of the change has no flows for them.",
      "Stock-funded mergers where the acquirer's holder list changes (many holders of the target become new holders of the acquirer) still read as purchases. Exchanges that leave the holder list unchanged are recognised and left out.",
      "Options: puts and calls are read from the reports and shown per fund, but not drawn in the hall or counted in any flow.",
      "Securities outside the 496 covered companies (funds, bonds, foreign shares) are the entrance, marked Outside; the reports hold them, the hall does not show them.",
      "Filing dates: outcomes “once the filings were public” start at the 45-day deadline, not at each report's own date.",
      "Confidential holdings: 92 later additions to reports have no table in the cache, and Norges Bank's reports become public a year late.",
      "A phone layout for the hall; on a narrow screen the reading view is the usable one.",
      "The hall's next round: the map table as a map of the United States with flags where the money went (company headquarters), a few props in each bookcase's alcove, laptops for the technology holders, people visiting the other bookcases where they hold sizable stakes, covers and logos on the books, and the switch from funds to famous traders.",
      "Leaders: 92 of the largest filers have a leader from public sources (men and women as the sources name them); the other funds stand as wooden mannequins.",
    ],
    better: [
      ["A test of whether following the money pays, with intervals and a hold-out period", "time: the figures shown are a description of 22 quarters, not a test"],
      ["Books that open: a company's page inside the hall with price, reports and the funds around it", "time only"],
      ["Walking the hall by keyboard alone, with every book and person reachable in order", "time; the reading view is the accessible twin until then"],
      ["Talking, typing and sitting people", "animation clips the free figures do not have (Mixamo or hand-made loops)"],
      ["History before the third quarter of 2020", "the older 13F reports, which were never downloaded"],
      ["Daily rebuild after new reports arrive", "a scheduler entry for the two build scripts (they take about two minutes together)"],
    ],
  },
  library: {
    missing: [
      "Scenario evidence drill-down, the full Expectations report, the risk replay and the weekly evidence review are not rebuilt in the desk; they open in the classic view.",
      "The factor wiki as searchable desk content.",
    ],
    better: [["One search across definitions, methods and evidence", "the manuals and the wiki moved into structured content"]],
  },
  watchlist: {
    missing: [
      "More than one list, notes per company, and alerts.",
      "Companies outside the index can be followed only from the classic manager: adding one starts a data job, and it has no desk page until the snapshot covers it.",
    ],
    better: [["Alerts on reports, insider purchases and large moves", "a notification channel: none exists"]],
  },
  operations: {
    missing: [
      "Run and stop controls: kept in the classic operations console.",
      "History of job durations and failures.",
      "The registry check lives in the snapshot build, not in the daily report.",
    ],
    better: [["One health view per data source with freshness and coverage", "task K09 (data health), waiting for approval"]],
  },
} satisfies Record<string, PageNotes>;

export type DevNotesPage = keyof typeof DEV_NOTES;
