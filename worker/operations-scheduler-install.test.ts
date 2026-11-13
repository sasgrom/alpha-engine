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

  it("makes the same task a 15-minute watchdog and removes the interim second task", () => {
    expect(script).toContain("New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)");
    expect(script).toContain('$Watch.Repetition.Duration = ""');
    expect(script).toContain("$Task.Triggers = @($Task.Triggers) + $Watch");
    expect(script).toContain('Unregister-ScheduledTask -TaskName "AlphaEngine-Operations-Watchdog" -Confirm:$false');
    expect(script).not.toContain("Register-ScheduledTask");
  });

  it("starts the scheduler through the hidden launcher", () => {
    expect(script).toContain("operations-scheduler-hidden.vbs");
    expect(script).not.toContain("$Action = \"cmd /c");
    const hidden = readFileSync("worker/operations-scheduler-hidden.vbs", "utf8");
    expect(hidden).toContain("operations-scheduler.mts");
    expect(hidden).toContain(", 0, False");
  });
});
