export interface ReportFilePolicy {
  contentType: "application/json" | "text/markdown";
  automatic: boolean;
  access: "owner" | "reviewer";
}

export const REPORT_FILE_POLICY: Record<string, ReportFilePolicy> = {
  "daily-operations.json": { contentType: "application/json", automatic: true, access: "owner" },
  "daily-operations.md": { contentType: "text/markdown", automatic: true, access: "owner" },
  "weekly-coverage.json": { contentType: "application/json", automatic: true, access: "owner" },
  "weekly-coverage.md": { contentType: "text/markdown", automatic: true, access: "owner" },
  "schwab-context.json": { contentType: "application/json", automatic: true, access: "reviewer" },
  "schwab-market-data.json": { contentType: "application/json", automatic: true, access: "reviewer" },
  "daily-prices-schwab.json": { contentType: "application/json", automatic: true, access: "owner" },
  "universe-coverage-50.json": { contentType: "application/json", automatic: true, access: "owner" },
  "insider-form4.json": { contentType: "application/json", automatic: true, access: "reviewer" },
  "prediction-markets.json": { contentType: "application/json", automatic: false, access: "reviewer" },
  "company-exposures.json": { contentType: "application/json", automatic: false, access: "reviewer" },
  "data-health.json": { contentType: "application/json", automatic: false, access: "owner" },
  "data-health.md": { contentType: "text/markdown", automatic: false, access: "owner" },
  "macro-scenarios.json": { contentType: "application/json", automatic: false, access: "reviewer" },
  "exposure-latest.json": { contentType: "application/json", automatic: false, access: "reviewer" },
  "macro-transmission-atlas.json": { contentType: "application/json", automatic: false, access: "reviewer" },
  // Read by pages (Scenario Lab, Feature Lab, Analytics); served locally, not part of the automatic push.
  "pilot-exposure-evidence.json": { contentType: "application/json", automatic: false, access: "reviewer" },
  "shock-calibration.json": { contentType: "application/json", automatic: false, access: "reviewer" },
  "schwab-features.json": { contentType: "application/json", automatic: false, access: "reviewer" },
};

export function reportFilePolicy(name: string): ReportFilePolicy {
  const policy = REPORT_FILE_POLICY[name];
  if (!policy) throw new Error("Report file name is not whitelisted");
  return policy;
}
