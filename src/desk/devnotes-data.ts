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
      "Official daily closes still arrive after the session; intraday prices and paths are provisional five-minute snapshots.",
      "Confirmed report dates. “Coming up” is projected from each company's own calendar (same quarter last year + 52 weeks, else + 13 weeks).",
      "Guidance changes and the engine's reading for companies that just reported.",
      "“Latest filings” covers watchlist companies with stored filings only (the 50 research companies).",
    ],
    better: [
      ["True interval highs and lows and streaming quotes", "tick or streaming data; the current highs and lows are approximations from snapshots"],
      ["An implied move on every upcoming report", "option features for the whole index: the chains are captured daily since 11 November, the feature build still runs on the research 50"],
      ["Macro tiles with change and trend", "a history endpoint over the stored FRED vintages"],
    ],
  },
  markets: {
    missing: [
      "Index weights: tiles are sized by market value, not by float-adjusted S&P weight.",
      "Full raw responses at every five-minute slot: compact snapshots are kept each time, raw responses only at the 20-minute marks.",
      "Replay of past sessions: the map shows the latest snapshot only.",
    ],
    better: [
      ["Colouring the map by a signal (reaction, guidance, implied against realized volatility) instead of return", "those readings for the whole index"],
      ["True interval extremes and a streaming live map", "tick or streaming data; the current map and day paths are built from snapshots"],
    ],
  },
  screener: {
    missing: [
      "Market value, yield and beta from our own data: they are Schwab's. Share counts of companies with several share classes and the dividends after April 2024 have gaps in the standards.",
      "Per-share figures for about twenty companies (several share classes, a changed registrant): Schwab's stand in, shown grey.",
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
      "Valuation and sentiment: left in the classic company page on purpose (the old factor engine never passed an out-of-sample test).",
      "Filings: 10-K, 10-Q and 8-K only, to the release calendar's last run (November 12, 2026); the calendar is rebuilt by hand, not on a schedule. Proxy statements, prospectuses and insider forms are not listed.",
      "The reader shows earnings releases only, as plain text (tables as rows of cells). Annual and quarterly reports open at the SEC.",
      "Statements: 197 filed share counts and per-share figures of the last ten years are out of scale (a filing gave millions or thousands) and are named, not shown; their years have no per-share figure (McDonald's since 2023). The standard fundamentals could repair them.",
      "Guidance: the reported adjusted figure is read from the releases' reconciliation tables for about half of the adjusted quarterly guidance (890 of 1,672 periods, 149 companies) and a quarter of the yearly guidance. Not read yet: Nvidia, Broadcom, Procter & Gamble, Oracle, Medtronic, Clorox, Equifax and others with table layouts the reader does not know.",
      "Guidance: some adjusted rows are GAAP figures the extraction labelled adjusted (Analog Devices' 0.97 for a quarter that came in at 1.85); they show as another measure.",
      "Fund holdings end at the June 2026 quarter: the September quarter's 13F reports (due November 16) are not in the fund books and the 13F standard yet.",
      "The engine's reading for this company.",
      "Exact times for 8-Ks absent from the release calendar: those markers are explicitly filing-date only; calendar releases carry their exact ET publication time.",
      "Analyst consensus: no estimates feed is collected.",
    ],
    better: [
      ["Option panels for every company", "features built on the S&P 500 chains"],
      ["Fund holdings over time (holders, share of the stock, entries and exits by quarter)", "time only: twenty quarters are already in the company file"],
      ["An insider's own record: every company, role and trade of one person", "a per-person file from the insider standard's persons table"],
      ["Option chains of earlier days and for all 500 companies", "the daily collector keeps the chains of the 50 research companies; the page reads the latest only"],
      ["Implied-volatility history and rank", "a per-company IV series in the snapshot (the option history 2019–2026 is on D:)"],
    ],
  },
  signals: {
    missing: [
      "A view of the later engines (per-company, pooled, the ceilings, the miss forecaster): the Engine page shows version 1 only.",
      "Analysts' consensus, the one input not yet tested: no data.",
      "An evidence history: the ledger is written by hand from the research record, it is not generated from test runs.",
    ],
    better: [
      ["A hit-rate per family that updates nightly", "the engine running inside this repository (it lives in the research repository)"],
      ["The less-shorted tilt followed forward as a paper portfolio", "a scheduled build of the FINRA short-sale files"],
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
  guidance: {
    missing: [
      "Measures other than revenue and earnings per share (margins, cash flow, capital spending): the standard holds them, the page does not show them.",
      "A link from a change to the release itself.",
      "Releases after the guidance standard's last build: it is built by hand, and the page says to which day it reads.",
    ],
    better: [
      ["Fewer misread figures among the large changes", "a guidance standard that checks a figure against the company's own scale before accepting it"],
      ["The record split by quarters and fiscal years", "time only: the periods carry their kind"],
    ],
  },
  ownership: {
    missing: [
      "Insider filings after the insider standard's last build: the page says to which day it reads.",
      "Ranking companies by institutional accumulation.",
      "Short-interest history and readings for the whole index.",
    ],
    better: [
      ["Insider filings of this week", "a scheduled rebuild of the insider standard (it is built by hand)"],
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
      "People: age comes from the firm's first SEC filing (EDGAR's records begin in 1993-1996, so the oldest firms all look the same age), not from its founding or its leader.",
      "The People audience misses six well-known investors whose 13F reports are not in the books yet (Burry, Druckenmiller, Tepper, Icahn, Einhorn, Li Lu; task K11), and politicians' trades are not collected (a legal question for the owner).",
      "The map table places a company at today's headquarters (its SEC record keeps no history), so a company that moved, such as Tesla or Oracle to Texas, counts there in earlier quarters too; 23 companies headquartered abroad share one flag.",
      "Leaders: 92 of the largest filers have a leader from public sources (men and women as the sources name them); the other funds stand as wooden mannequins.",
    ],
    better: [
      ["A test of whether following the money pays, with intervals and a hold-out period", "time: the figures shown are a description of 22 quarters, not a test"],
      ["Books that open: a company's page inside the hall with price, reports and the funds around it", "time only"],
      ["Walking the hall by keyboard alone, with every book and person reachable in order", "time; the reading view is the accessible twin until then"],
      ["The walk through the quarter with more stops: each sector in turn, the largest buyers and sellers, a fund's own story", "time; the six stops shown are computed from the quarter's figures"],
      ["Names on every ribbon and on the threads of a selected book or fund", "label room: the five or six widest ribbons are named, the rest only on hover"],
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
    better: [
      ["Alerts on reports, insider purchases and large moves", "a notification channel: none exists"],
      ["A longer custom intraday window", "research five-minute history; snapshot sessions accumulate on D:, while the desk reads at most five"],
    ],
  },
  operations: {
    missing: [
      "History of runs: the scheduler keeps only the last run of each job, so durations and failures over time are not shown.",
      "Owner-only reports: the daily operations, coverage and data-health reports still open for any reviewer who accepted the NDA (task K24).",
      "A weekly coverage report that is current: the job last wrote one on 10 November.",
      "The registry check lives in the snapshot build, not in the daily report.",
    ],
    better: [
      ["One health view per data source with freshness and coverage", "task K09 (data health), waiting for approval"],
      ["A status that is not CRITICAL most of the day", "the macro lineage check compares run times, not content (task K24)"],
    ],
  },
  messages: {
    missing: [
      "Search inside a long thread, attachments and a delivery state beyond the read marker.",
      "Notifications outside the desk: this page polls only while it is visible.",
    ],
    better: [
      ["Pagination for very long conversations", "a cursor contract on the message list; the current endpoint returns the first 200"],
      ["Typing and presence indicators", "a real-time channel; the current transport is deliberately modest polling"],
    ],
  },
  admin: {
    missing: [
      "The reviewer's literal IP address is not displayed: only its HMAC binding is stored, so the honest state is Bound or Not bound.",
      "Invitations and a self-service password reset flow.",
      "Bulk account actions and log search.",
    ],
    better: [
      ["Filtering and saved views for long logs", "a bounded server-side log query rather than loading the first 2,000 lines"],
    ],
  },
} satisfies Record<string, PageNotes>;

export type DevNotesPage = keyof typeof DEV_NOTES;
