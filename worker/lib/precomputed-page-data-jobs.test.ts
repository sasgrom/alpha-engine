import { describe, expect, it } from "vitest";
import { OPERATION_JOB_MAP } from "../../contracts/operations";
import { validateOperationRegistry } from "./operations-scheduler";

describe("precomputed page-data jobs", () => {
  it("registers local builders after each input family without weekly parents blocking daily refreshes", () => {
    expect(validateOperationRegistry()).toEqual([]);
    const expected = {
      "page-data-dashboard": { parents: ["facts-fetch-daily", "sp500-facts-daily", "edgar-fetch-daily"], group: "stats" },
      "page-data-13f": { parents: ["13f-refresh"], group: "institutional" },
      "page-data-fundamentals": { parents: ["research-factors"], group: "probability" },
      "page-data-prices": { parents: ["schwab-daily-bars"], group: "probability" },
      "page-data-macro": { parents: ["macro-fred-weekly"], group: "probability" },
      "page-data-tone": { parents: ["edgar-tone-nightly"], group: "probability" },
    };
    for (const [id, expectedJob] of Object.entries(expected)) {
      const job = OPERATION_JOB_MAP[id];
      expect(job.dependsOn, id).toEqual(expectedJob.parents);
      expect(job.args.slice(-2), id).toEqual(["--group", expectedJob.group]);
      expect(job.destination, id).toContain("Local");
      expect(job.cron, id).toBeNull();
      expect(job.defaultEnabled, id).toBe(true);
    }
    expect(OPERATION_JOB_MAP["schwab-snapshot"].dependsOn).toEqual(["schwab-fetch-daily"]);
    expect(OPERATION_JOB_MAP["page-data-market-report"]).toBeUndefined();
  });
});
