/**
 * Reviewed project-state snapshot. Live scheduler and Daily Operations evidence
 * are layered on top in ProjectState.tsx; this file records only durable facts.
 */
export const PROJECT_STATE_REVIEW = {
  reviewedOn: "2026-11-06",
  implementation: {
    sp500CodeCommit: "f196acf1e38888c9ae145f8f1fc4a5bd0cfba9fc",
    sp500CodeReady: true,
    sp500SmokeAndReloadConfirmed: true,
    sp500FinalEvidenceCommit: "b951f5c7c6b677e052f5679b9770a5df0b8c1394",
    sp500CikMappingsVerifiedOn: "2026-11-04",
    sp500InitialBackfill: { processed: 499, refreshed: 490, unchanged: 3, failed: 6 },
    sp500CorrectedCiks: { status: "collected_valid", count: 6, verifiedOn: "2026-11-04" },
    thirteenFCodeCommits: ["938105969950956e08f36cb99949ca2c3f56323b", "29acca94d978aca8cc559739afc2a199d5f3dc22"],
  },
  correctness: [
    { id: "F-01/F-02", title: "First-vintage factors and required-concept availability", status: "done" as const },
    { id: "F-03", title: "13F event and aggregate-flow publication availability", status: "done" as const },
    { id: "F-04", title: "Realtime-window-aware macro vintages", status: "done" as const },
    { id: "F-05", title: "Composite exposure availability and period alignment", status: "done" as const },
    { id: "F-10", title: "Missing debt and cash remain unknown, not zero", status: "done" as const },
    { id: "F-11", title: "TTM requires four consecutive quarters", status: "done" as const },
    { id: "TICKERS", title: "Six preferred/common ticker mismatches repaired and guarded", status: "done" as const },
    { id: "FISCAL", title: "Registration/proxy/offering facts excluded from canonical fiscal periods", status: "done" as const },
    { id: "PRICES", title: "Official Schwab OHLCV and same-source previous close/day change for all 50", status: "done" as const },
    { id: "CSCO", title: "CSCO facts, canonical series and factor points materialized", status: "done" as const },
    { id: "DOCUMENTS", title: "Metadata-only EDGAR corpus for 50 companies with SEC external links", status: "done" as const },
    { id: "UI", title: "Latest-first Expectations and ProjectState rendering without macro", status: "done" as const },
  ],
  research: {
    universe: "research-universe-50.json",
    companies: 50,
    factorPoints: 21_297,
    factorCoverage: "50/50 companies with factor points",
    eventStudy: "Stale historical artifact · do not treat as rebuilt after current macro QA",
    atlas: "Stale · 904 records · 24 studies · 2 OOS evaluations · no fresh rebuild",
    ic: "Historical only · no factor/model/regime promotion",
    schwab: "Verified · 50/50 official closes with OHLCV and same-source previous close/day change · latest 2026-11-05",
    macroPriorEvaluation: "Historical only · 794/1,455 eligible checks · not recomputed after current sync",
    macroVintageRemediation: "Complete · 408,862 rows · 8/8 current eligible · 0 selected-after-anchor",
    thirteenF: "Complete · fund_quarters 6,517 upserted / 14 batches · fund_holdings 1,617,277 upserted / 3,235 batches · production post-check pass",
    thirteenFEvaluation: "Not run after the 24-quarter sync; latest-quarter flow remains unevaluated",
  },
  reviewerExperience: {
    status: "active" as const,
    presentationCompanies: 50,
    ndaVersion: "2026-11-04",
    firstIpBinding: true,
    guidedTourTracks: ["geography", "technical"],
    terminalDefault: true,
    terminalLegacyToggle: true,
    terminalDayNightThemes: true,
    migrationRequired: false,
    accountSeedRequired: false,
  },
  nextQueue: [
    "Evaluate the existing fundamental factor library and IC, then share weights after the comparable-fund guard",
    "Add CSCO and the other missing companies to EX-99/cohort extraction; independent benchmark before reviewed coverage",
    "Expand Scenario Lab evidence, not only the pilot selector: fixed rates, fuel/oil, foreign revenue and issuance terms",
    "Complete EDGAR tone for the remaining 47 companies after the current GPU run",
    "Fix the blank Fund Flows 3D view, then re-enable it for reviewers (temporarily admin-only)",
    "Audit Legacy Dashboard redundancy after the new retail Terminal experience",
  ],
} as const;

export type ProjectPhaseStatus = "done" | "current" | "attention" | "pending" | "unknown";
