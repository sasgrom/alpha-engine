// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "./desk/desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("classic owner route redirect", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("redirects the owner's /admin route to desk owner tools", async () => {
    desk = await mountDesk("admin", "/admin", "Create account", true);
    expect(desk.host.querySelector(".desk-tabs")).not.toBeNull();
    expect(desk.host.textContent).toContain("Monitors");
    expect(desk.host.textContent).not.toContain("price-archive upload");
  });
});
