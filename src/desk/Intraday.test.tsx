// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function click(desk: MountedDesk, label: string) {
  const button = [...desk.host.querySelectorAll("button")].find(row => row.textContent === label);
  if (!button) throw new Error(`no button ${label}`);
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return button;
}

describe("desk intraday prices", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
  });

  it("draws 1D and 5D inside the company's Price chart, with no separate intraday card", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Key statistics");
    expect(desk.host.textContent).not.toContain("Today / 5 days");
    expect(desk.calls).not.toContain("desk.intraday");
    const oneDay = click(desk, "1D");
    await waitUntil(() => desk!.host.textContent?.includes("5-minute prices as of") ?? false);
    expect(oneDay.getAttribute("aria-pressed")).toBe("true");
    expect(desk.calls).toContain("desk.intraday");
    const text = desk.host.textContent ?? "";
    expect(text).toContain("Last session Nov 13");
    expect(text).toContain("delayed quotes");
    expect(text).toContain("Prices as CSV");
    expect(text).not.toContain("No 5-minute prices are stored");
    const fiveDays = click(desk, "5D");
    await waitUntil(() => fiveDays.getAttribute("aria-pressed") === "true");
    expect(desk.host.textContent).toContain("5-minute prices as of");
  });

  it("keeps the market map page free of an extra intraday panel", async () => {
    desk = await mountDesk("admin", "/desk/markets", "Market map");
    expect(desk.host.textContent).not.toContain("Through the day");
    expect(desk.calls).not.toContain("desk.intradayMarket");
  });

  it("shows today's line and its as-of time on Watchlist", async () => {
    desk = await mountDesk("admin", "/desk/watchlist", "1 followed");
    await waitUntil(() => desk!.host.textContent?.includes("Today's line: 5-minute prices") ?? false);
    expect(desk.host.textContent).toContain("Today's line: 5-minute prices · last session Nov 13 · as of");
    expect(desk.host.querySelector("svg[aria-label='AAPL today · 5-minute snapshots']")).not.toBeNull();
  });

  it("shows the same line in the Today watchlist", async () => {
    desk = await mountDesk("admin");
    await waitUntil(() => desk!.host.querySelector("svg[aria-label='AAPL today · 5-minute snapshots']") !== null);
    expect(desk.host.textContent).toContain("Companies you follow · today's line as of");
  });

  it("shows an honest empty state on 1D instead of daily closes", async () => {
    DESK_DATA.empty = true;
    desk = await mountDesk("admin", "/desk/company/MSFT", "Key statistics");
    click(desk, "1D");
    await waitUntil(() => desk!.host.textContent?.includes("No 5-minute prices are stored for this company yet.") ?? false);
    expect(desk.host.textContent).toContain("No 5-minute prices are stored for this company yet.");
  });
});
