// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk view for a member", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("hides the owner's pages and finds companies from Ctrl+K", async () => {
    desk = await mountDesk("user");
    const host = desk.host;
    // a member has no research section and never sees build notes
    expect([...host.querySelectorAll(".desk-nav a")].map((link) => link.textContent)).toEqual(["Today", "Markets", "Screener", "Watchlist"]);
    expect(host.querySelector(".desk-devnotes")).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });
    const input = host.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(input, "micro");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitUntil(() => (host.querySelector("[cmdk-item]")?.textContent ?? "").includes("MSFT"), 3000);
    expect([...host.querySelectorAll("[cmdk-group-heading]")].map((heading) => heading.textContent)).toContain("Companies");
    // owner instruments are not offered to members
    act(() => {
      setValue.call(input, "database");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("Database browser");
  });
});
