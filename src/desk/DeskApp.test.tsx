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
    expect(nav).toEqual(["Today", "Markets", "Screener", "Research", "Flows", "Watchlist", "Engine", "Operations"]);
    const text = desk.host.textContent ?? "";
    expect(text).toContain("Nvidia");
    expect(text).toContain("Your watchlist");
    expect(text).toContain("10-year Treasury");
    for (const leftover of ["Legacy", "ALPHA-BAYES", "Stage 1", "D27", "Mission Control"]) expect(text).not.toContain(leftover);
    expect(desk.host.querySelector(".desk-root")?.getAttribute("data-theme")).toMatch(/^(light|dark)$/);
    // the slow dashboard counters are never requested by the desk
    expect(desk.calls).not.toContain("dashboard.stats");
    // the owner sees the build notes of the page, collapsed
    expect(desk.host.querySelector(".desk-devnotes summary")?.textContent).toContain("Build notes");
  });

  it("shows the signal ledger with its evidence status and today's readings", async () => {
    desk = await mountDesk("admin", "/desk/research", "First reaction to an earnings release");
    const text = desk.host.textContent ?? "";
    expect([...desk.host.querySelectorAll(".desk-subnav a")].map((link) => link.textContent)).toEqual(["Signals", "Earnings", "Volatility", "Macro", "Ownership", "Library"]);
    expect(text).toContain("Candidate, not yet confirmed");
    expect(text).toContain("Measured: nothing beyond noise");
    expect(text).toContain("Highest 12-month return skipping the last month");
    expect(desk.host.querySelectorAll(".desk-signal").length).toBeGreaterThanOrEqual(12);
  });

  it("lists reports with the reaction and the move since", async () => {
    desk = await mountDesk("admin", "/desk/research/earnings", "Rose on the report");
    const text = desk.host.textContent ?? "";
    expect(text).toContain("Reported in 14 days3");
    expect(text).toContain("continued");
    expect(text).toContain("Coming up · 30 days");
  });
});
