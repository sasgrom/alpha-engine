export const NDA_VERSION = "2026-11-04";

export const NDA_TITLE = "Confidential research preview";
export const NDA_TEXT = `For academic review and discussion with Dr. Larry Souza only.

Alpha Engine is research software, not investment advice. Results are provisional and are not guarantees of future performance.

Please do not redistribute, copy, capture, download, scrape or automatically extract this preview or its data. Do not share your login. By selecting “I agree”, you accept these conditions.`;

export type ReviewerTourTrack = "geography" | "technical";
export type ReviewerTourStatus = "not_started" | "in_progress" | "completed" | "dismissed_forever";

export interface ReviewerTourStep {
  title: string;
  body: string;
}

export const REVIEWER_TOURS: Record<ReviewerTourTrack, { title: string; subtitle: string; steps: ReviewerTourStep[] }> = {
  geography: {
    title: "Alpha Engine — guided overview",
    subtitle: "The working map of the platform",
    steps: [
      { title: "Mission Control", body: "Start here for the shared operating picture: companies, filings, facts, current jobs and the morning brief. Read the evidence before interpreting any result." },
      { title: "Your review universe", body: "Universe contains a curated set of 50 companies for this presentation. It is a review collection, not an automatic expansion into research or production." },
      { title: "Company evidence", body: "A company page brings together price context, SEC fundamentals, filings and narrative evidence. Availability dates tell you when each fact could first be used." },
      { title: "Market Data and Scenario Lab", body: "Schwab options and macro scenarios describe exposure and liquidity constraints. They are not price targets, orders or promises of return." },
      { title: "Research surfaces", body: "Analytics, factor IC, event studies and the Macro Transmission Atlas compare historical relationships. Discovery and out-of-sample evidence remain separate." },
      { title: "Project State and Operations", body: "Project State distinguishes code, collection, research and delivery. Operations shows the home scheduler and actual capture evidence rather than assuming a job succeeded." },
      { title: "Reviewed-only delivery", body: "Home collection stays local. Only reviewed evidence can move to production, and no collector authorizes sync, deployment or model promotion by itself." },
    ],
  },
  technical: {
    title: "Alpha Engine — technical briefing",
    subtitle: "Availability, evidence and bounded statistical research",
    steps: [
      { title: "Availability before alpha", body: "Every research input is anchored to when it became available: filing date, realtime vintage, ingestion or event eligibility. This prevents a later revision from quietly entering an earlier decision." },
      { title: "First-release versus latest evidence", body: "Factor research uses first-vintage SEC facts with MAX first-filed availability across required concepts. Scenario calibration may instead select the latest eligible vintage for its specific protocol." },
      { title: "FRED / ALFRED windows", body: "Macro series retain realtimeStart and realtimeEnd. A value is eligible only inside its real-time window; unknown starts fail closed rather than creating a vintage." },
      { title: "Cross-sectional factors and IC", body: "Factor points are materialized locally and compared with forward excess returns. Spearman IC is descriptive evidence, not a trading signal or proof of investable alpha." },
      { title: "Event studies and transmission", body: "Macro event studies use first-release observations and chronological discovery/OOS splits. Atlas tests shock, exposure and shock×exposure with sector effects frozen from discovery." },
      { title: "Options as execution context", body: "Schwab chains supply IV, expected move, skew and turnover where available. Missing values stay null. These fields describe constraints, not a directional forecast." },
      { title: "Hypotheses under test", body: "The working approach is a pooled statistical law across companies, evaluated on held-out companies, sectors and time windows. A limited complete-evidence universe can support that test without claiming a universal law." },
      { title: "Evidence boundaries", body: "Current macro vintages, 13F availability and corrected SEC mappings are verified independently. Partial coverage, neutral macro priors and negative OOS results remain visible rather than being tuned away." },
      { title: "Local-first, reviewed production", body: "Collection and scoring run on the home worker with local MySQL and Ollama. Production is a separate reviewed decision, never a default destination for unreviewed data or model output." },
    ],
  },
};
