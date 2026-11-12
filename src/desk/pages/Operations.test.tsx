// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "../desk-test-harness";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
});

describe("desk operations data health", () => {
  it("shows the health summary and links both report formats", async () => {
    desk = await mountDesk("admin", "/desk/operations", "Data health");
    const text = desk.host.textContent ?? "";
    expect(text).toContain(
      "10 checks · 23 findings · 11 quarantine · 4 review · 8 reviewed/info"
    );
    expect(
      desk.host.querySelector('a[href="/reports/data-health.md"]')
    ).not.toBeNull();
    expect(
      desk.host.querySelector('a[href="/reports/data-health.json"]')
    ).not.toBeNull();
  });
});
