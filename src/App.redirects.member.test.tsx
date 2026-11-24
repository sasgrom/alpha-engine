// @vitest-environment jsdom
// Its own file: the harness keeps the signed-in role between the tests of one file.
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "./desk/desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the old addresses of the classic view, for a member", () => {
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

  it("keeps a member out of the owner's pages behind the old /admin address", async () => {
    desk = await mountDesk("user", "/admin", "S&P 500 companies closed higher", true);
    // the desk's own guard sends a member back to Today
    expect(desk.host.querySelector("h1")?.textContent).not.toBe("Owner tools");
    expect(desk.calls).not.toContain("admin.usersList");
  });
});
