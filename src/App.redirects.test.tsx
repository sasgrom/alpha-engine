// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "./desk/desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("classic route redirects", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("redirects /messages to the desk conversation view", async () => {
    desk = await mountDesk("user", "/messages", "Could we review the filing?", true);
    expect(desk.host.querySelector(".desk-contact-card")).not.toBeNull();
    expect(desk.host.textContent).not.toContain("admins can read threads");
  });

  it("keeps a member out of the classic /admin URL", async () => {
    desk = await mountDesk("user", "/admin", "OWNER-ONLY INSTRUMENT", true);
    expect(desk.host.textContent).toContain("insufficient role");
    expect(desk.calls).not.toContain("admin.usersList");
  });
});
