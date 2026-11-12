export interface ReportFilePolicy {
  contentType: "application/json" | "text/markdown";
  automatic: boolean;
}

export const REPORT_FILE_POLICY: Record<string, ReportFilePolicy> = {
  "daily-operations.json": { contentType: "application/json", automatic: true },
  "daily-operations.md": { contentType: "text/markdown", automatic: true },
  "weekly-coverage.json": { contentType: "application/json", automatic: true },
  "weekly-coverage.md": { contentType: "text/markdown", automatic: true },
  "schwab-context.json": { contentType: "application/json", automatic: true },
  "schwab-market-data.json": { contentType: "application/json", automatic: true },
  "daily-prices-schwab.json": { contentType: "application/json", automatic: true },
  "universe-coverage-50.json": { contentType: "application/json", automatic: true },
  "insider-form4.json": { contentType: "application/json", automatic: true },
  "company-exposures.json": { contentType: "application/json", automatic: false },
  "data-health.json": { contentType: "application/json", automatic: false },
  "data-health.md": { contentType: "text/markdown", automatic: false },
  "macro-scenarios.json": { contentType: "application/json", automatic: false },
  "expectations-report.json": { contentType: "application/json", automatic: false },
  // Read by pages (Scenario Lab, Feature Lab, Analytics); served locally, not part of the automatic push.
  "pilot-exposure-evidence.json": { contentType: "application/json", automatic: false },
  "shock-calibration.json": { contentType: "application/json", automatic: false },
  "schwab-features.json": { contentType: "application/json", automatic: false },
  "weekly-metrics.json": { contentType: "application/json", automatic: false },
  "project-strength-review.md": { contentType: "text/markdown", automatic: false },
};

export function reportFilePolicy(name: string): ReportFilePolicy {
  const policy = REPORT_FILE_POLICY[name];
  if (!policy) throw new Error("Report file name is not whitelisted");
  return policy;
}
