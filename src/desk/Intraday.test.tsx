// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk intraday views", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
  });

  it("renders company price, VWAP, volume, comparisons, marker tooltips and the closed-session state", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Today / 5 days");
    await waitUntil(() => desk!.host.textContent?.includes("Last session · Nov 13") ?? false);
    const text = desk.host.textContent ?? "";
    expect(text).toContain("Built from 5-minute price snapshots; highs and lows are approximate");
    expect(text).toContain("Last session · Nov 13");
    expect(text).toContain("Delayed quotes");
    expect(text).toContain("opening gap");
    expect(text).toContain("8-K · filing date only · time not stored");
    const titles = [...desk.host.querySelectorAll("svg title")].map(row => row.textContent).join("\n");
    expect(titles).toContain("AAPL");
    expect(titles).toContain("VWAP");
    expect(titles).toContain("SPY");
    expect(titles).toContain("Previous close");
    expect(titles).toContain("Earnings release");
    expect(desk.host.querySelector("svg[aria-label='AAPL snapshot volume on 2026-11-13']")).not.toBeNull();
    const five = [...desk.host.querySelectorAll("button")].find(button => button.textContent === "5 days")!;
    act(() => five.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await waitUntil(() => five.getAttribute("aria-pressed") === "true");
    expect(desk.calls).toContain("desk.intraday");
  });

  it("renders market breadth, SPY against equal weight, all sector funds and movers with hover evidence", async () => {
    desk = await mountDesk("admin", "/desk/markets", "Through the day");
    await waitUntil(() => desk!.host.textContent?.includes("SPY against the equal-weighted 500") ?? false);
    const text = desk.host.textContent ?? "";
    expect(text).toContain("SPY against the equal-weighted 500");
    expect(text).toContain("Sector funds · return from previous close");
    expect(text).toContain("Top movers · day path");
    expect(text).toContain("Last session · Nov 13");
    expect(desk.host.querySelectorAll("svg[aria-label$='through the day']").length).toBeGreaterThanOrEqual(12);
    expect([...desk.host.querySelectorAll("svg title")].some(row => row.textContent?.includes("Above previous close"))).toBe(true);
    expect(desk.calls).toContain("desk.intradayMarket");
  });

  it("renders today's path and as-of time on Watchlist", async () => {
    desk = await mountDesk("admin", "/desk/watchlist", "1 followed");
    expect(desk.host.textContent).toContain("Today · 5 min");
    expect(desk.host.textContent).toContain("Last session · Nov 13");
    expect(desk.host.querySelector("svg[aria-label='AAPL today · 5-minute snapshots']")).not.toBeNull();
    expect(desk.host.textContent).toContain("Built from 5-minute price snapshots; highs and lows are approximate");
  });

  it("renders the same shared path in the Today watchlist", async () => {
    desk = await mountDesk("admin");
    expect(desk.host.querySelector("svg[aria-label='AAPL today · 5-minute snapshots']")).not.toBeNull();
    expect(desk.host.textContent).toContain("Companies you follow · Built from 5-minute price snapshots; highs and lows are approximate · as of");
  });

  it("shows an honest empty state without substituting a daily chart", async () => {
    DESK_DATA.empty = true;
    desk = await mountDesk("admin", "/desk/company/MSFT", "Today / 5 days");
    await waitUntil(() => desk!.host.textContent?.includes("No 5-minute session snapshots are stored for this company yet.") ?? false);
    expect(desk.host.textContent).toContain("No 5-minute session snapshots are stored for this company yet.");
    expect(desk.host.querySelector("svg[aria-label='MSFT price and VWAP on 2026-11-13']")).toBeNull();
  });
});
