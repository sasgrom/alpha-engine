// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk view for the owner", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("opens on Today with the brief, the owner's navigation and no development leftovers", async () => {
    desk = await mountDesk("admin");
    const nav = [...desk.host.querySelectorAll(".desk-nav a")].map((link) => link.textContent);
    expect(nav).toEqual(["Today", "Markets", "Screener", "Research", "Operations"]);
    const text = desk.host.textContent ?? "";
    expect(text).toContain("Nvidia");
    expect(text).toContain("Your watchlist");
    expect(text).toContain("10-year Treasury");
    for (const leftover of ["Legacy", "ALPHA-BAYES", "Stage 1", "D27", "Mission Control"]) expect(text).not.toContain(leftover);
    expect(desk.host.querySelector(".desk-root")?.getAttribute("data-theme")).toMatch(/^(light|dark)$/);
    // the slow dashboard counters are never requested by the desk
    expect(desk.calls).not.toContain("dashboard.stats");
  });
});
