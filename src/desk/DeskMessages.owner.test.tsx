// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk messages for the owner", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("shows owner roles, activity and the user-intel panel", async () => {
    desk = await mountDesk("admin", "/desk/messages", "Could we review the filing?");
    const host = desk.host;
    expect(host.textContent).toContain("Other Account");
    expect(host.textContent).toContain("active 11-13");
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Inspect Member One")!.click();
    });
    await waitUntil(() => (host.textContent ?? "").includes("Messages sent") && (host.textContent ?? "").includes("/desk"));
    expect(desk.calls).toContain("admin.userSummary");
    expect(desk.calls).toContain("admin.userActivity");
    expect(host.textContent).toContain("Messages sent");
    expect(host.textContent).toContain("120");
    expect(host.querySelector(".desk-devnotes")).not.toBeNull();
  });
});
