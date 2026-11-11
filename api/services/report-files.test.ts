import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_FILE_POLICY } from "@contracts/report-files";
import { reportFileResponse } from "./report-files";

/** Every /reports/<name> the pages fetch or link to, read from the source so a new page cannot miss the whitelist. */
function reportsReferencedByPages(): string[] {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        for (const match of readFileSync(file, "utf8").matchAll(/["'`]\/reports\/([A-Za-z0-9._-]+)["'`]/g)) names.add(match[1]);
      }
    }
  };
  walk(path.resolve(import.meta.dirname, "../../src"));
  return [...names].sort();
}

describe("report files served at /reports/", () => {
  it("whitelists every report a page fetches or links to (a missing name made Scenario Lab fail with HTTP 500)", () => {
    const referenced = reportsReferencedByPages();
    expect(referenced).toContain("shock-calibration.json");
    expect(referenced.filter((name) => !REPORT_FILE_POLICY[name])).toEqual([]);
  });

  it("answers a name outside the whitelist with 404, not a server error", async () => {
    const response = await reportFileResponse("not-a-report.json", { db: null, staticRoot: "." });
    expect(response.status).toBe(404);
  });
});
