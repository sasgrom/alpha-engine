import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("worker/operations-scheduler-install.ps1", "utf8");

describe("operations scheduler installer", () => {
  it("uses non-throwing ScheduledTasks lookups for optional legacy tasks", () => {
    expect(script).toContain("Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue");
    expect(script).toContain("Disable-ScheduledTask -InputObject $LegacyTask");
    expect(script).not.toContain("schtasks /Query /TN $Name");
    expect(script).toContain("Legacy task not present, skipping: $Name");
  });

  it("creates only the central scheduler task and checks creation failure", () => {
    expect(script).toContain('schtasks /Create /TN "AlphaEngine-Operations-Scheduler"');
    expect(script).toContain("Failed to create AlphaEngine-Operations-Scheduler");
    expect(script).not.toContain('schtasks /Create /TN "AlphaEngine-Stocktwits"');
    expect(script).not.toContain('schtasks /Create /TN "AlphaEngine-GDELT"');
  });

  it("starts the scheduler through the hidden launcher", () => {
    expect(script).toContain("operations-scheduler-hidden.vbs");
    expect(script).not.toContain("$Action = \"cmd /c");
    const hidden = readFileSync("worker/operations-scheduler-hidden.vbs", "utf8");
    expect(hidden).toContain("operations-scheduler.mts");
    expect(hidden).toContain(", 0, False");
  });
});
