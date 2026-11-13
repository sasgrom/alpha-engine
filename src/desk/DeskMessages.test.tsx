// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function setText(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("desk messages", () => {
  let desk: MountedDesk | null = null;
  beforeEach(() => { DESK_DATA.empty = false; DESK_DATA.unread = 0; });
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
    DESK_DATA.unread = 0;
  });

  it("renders a member's conversations and sends through the mock without exposing account intel", async () => {
    desk = await mountDesk("user", "/desk/messages", "Could we review the filing?");
    const host = desk.host;
    expect(host.querySelector(".desk-contact-name")?.textContent).toContain("2 new");
    expect(host.textContent).toContain("Admin Two");
    expect(host.textContent).not.toContain("Other Account");
    expect(host.textContent).not.toContain("active 11-13");
    expect(host.textContent).not.toContain("admins can read threads");
    expect(host.querySelector(".desk-intel")).toBeNull();
    expect(host.querySelector(".desk-devnotes")).toBeNull();
    await setText(host.querySelector<HTMLTextAreaElement>("textarea[aria-label=Message]")!, "Please review this filing");
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Send")!.click();
    });
    await waitUntil(() => desk!.calls.includes("messages.send"));
  });

  it("renders an honest empty state", async () => {
    DESK_DATA.empty = true;
    desk = await mountDesk("user", "/desk/messages", "No conversations or admins available.");
    expect(desk.host.textContent).toContain("No conversations or admins available.");
  });

  it("links the shell's unread dot and count to the desk messages page", async () => {
    DESK_DATA.unread = 2;
    desk = await mountDesk("user", "/desk/messages", "Could we review the filing?");
    expect(desk.host.querySelector(".desk-avatar span")).not.toBeNull();
    await act(async () => {
      desk!.host.querySelector<HTMLButtonElement>("button[aria-label='Account menu']")!.click();
    });
    const link = desk.host.querySelector<HTMLAnchorElement>("a[role=menuitem][href='/desk/messages']");
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("2 new");
  });
});
