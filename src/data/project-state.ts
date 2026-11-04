/**
 * Reviewed project-state snapshot. Live scheduler and Daily Operations evidence
 * are layered on top in ProjectState.tsx; this file records only durable facts.
 */
export const PROJECT_STATE_REVIEW = {
  reviewedOn: "2026-11-04",
  implementation: {
    sp500CodeCommit: "f196acf1e38888c9ae145f8f1fc4a5bd0cfba9fc",
    sp500CodeReady: true,
    sp500SmokeAndReloadConfirmed: true,
    sp500FinalEvidenceCommit: "b951f5c7c6b677e052f5679b9770a5df0b8c1394",
    sp500CikMappingsVerifiedOn: "2026-11-04",
    sp500InitialBackfill: { processed: 499, refreshed: 490, unchanged: 3, failed: 6 },
    sp500CorrectedCiks: { status: "collected_valid", count: 6, verifiedOn: "2026-11-04" },
  },
  correctness: [
    { id: "F-01/F-02", title: "First-vintage factors and required-concept availability", status: "done" as const },
    { id: "F-03", title: "13F event and aggregate-flow publication availability", status: "done" as const },
    { id: "F-04", title: "Realtime-window-aware macro vintages", status: "done" as const },
    { id: "F-05", title: "Composite exposure availability and period alignment", status: "done" as const },
    { id: "F-10", title: "Missing debt and cash remain unknown, not zero", status: "done" as const },
    { id: "F-11", title: "TTM requires four consecutive quarters", status: "done" as const },
  ],
  research: {
    universe: "research-universe-51.json",
    companies: 51,
    factorPoints: 21_489,
    factorCoverage: "51/51 companies",
    eventStudy: "Ready · 47/47 eligible events with outcomes",
    atlas: "Partial · 904 records · 24 studies · 2 OOS evaluations",
    ic: "Changed after fresh facts; descriptive evidence only, no factor/model/regime promotion",
    schwab: "Awaiting scheduled capture · 0/51 today · next run 2026-11-04T12:00:00Z",
    macroPriorEvaluation: "Complete · 3 company / 6 nested reports · 485 anchors · no eligible current macro vintage",
  },
  nextQueue: [
    "Reviewed 13F event/flow/probability rebuild",
    "Macro vintage-data remediation before relying on macro prior",
    "Reviewed Statements netDebt/ROE/ROA historical rebuild or evaluation",
    "F-15 / F-16 numeric correctness",
    "Atlas coverage from new documented exposure evidence, not repeated runs",
    "Production/security findings and remaining audit queue",
  ],
} as const;

export type ProjectPhaseStatus = "done" | "current" | "attention" | "pending" | "unknown";
