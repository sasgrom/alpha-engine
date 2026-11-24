// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, OPS_CONSOLE, type MountedDesk } from "../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
  OPS_CONSOLE.enabled = true;
});

describe("the operations console where the server keeps the worker controls off", () => {
  it("shows every job with its controls switched off and says why, and asks the scheduler nothing", async () => {
    OPS_CONSOLE.enabled = false;
    desk = await mountDesk("admin", "/desk/operations?tab=jobs", "The controls are off on this server");
    const row = [...desk.host.querySelectorAll("tbody tr")].find((item) => item.querySelector("td .desk-ops-toggle span")?.textContent === "Schwab REST daily snapshot")!;
    const run = [...row.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Run") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect((row.querySelector("input[type=checkbox]") as HTMLInputElement).disabled).toBe(true);
    expect(desk.calls).not.toContain("workersLocal.operations");
  });
});
