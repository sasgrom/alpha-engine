// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";
import { timesNormal, weekLabel } from "./flows/data";
import { shortFlow } from "./flows/map/TradingParts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
});

describe("volume flows on the desk", () => {
  it("writes weeks and ratios plainly", () => {
    expect(weekLabel("2026-11-27")).toBe("week to 27 Nov");
    expect(timesNormal(1.364)).toBe("1.36× normal");
    expect(timesNormal(3.87)).toBe("3.9× normal");
    expect(timesNormal(null)).toBe("—");
  });

  it("the money map's trading layer: the week, each sector's share and its fund's money in or out", async () => {
    desk = await mountDesk("admin", "/desk/flows?show=trading", "Money map");
    const text = () => desk!.host.textContent ?? "";
    await waitUntil(() => text().includes("Fund flow"));
    expect(desk.calls).toContain("desk.flowsTrading");
    expect(text()).toContain("How it trades");
    expect(text()).toContain("week to 27 Nov");
    expect(text()).toContain("4 companies traded $342B");
    // sectors with their share of trading and the SPDR fund's real flow from its share count
    expect(text()).toContain("92.1%");
    expect(text()).toContain("+$1.0B");
    expect(text()).toContain("−$430M");
    expect(shortFlow(-55.9e6)).toBe("−$56M");
    // the market fund, and the honest note that trading itself has no direction
    expect(text()).toContain("SPY");
    expect(text()).toContain("+$7.26B");
    expect(text()).toContain("Trading has no direction");
    // the 13F quarter line is not shown in this layer
    expect(text()).not.toContain("bought $90.00B");
  });

  it("the company page: measured peers with their correlation and this week's trading", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Peers");
    const text = () => desk!.host.textContent ?? "";
    await waitUntil(() => text().includes("share an industry fund"));
    expect(desk.calls).toContain("desk.flowsTradingCompany");
    expect(text()).toContain("share an industry fund (SMH, SOXX)");
    expect(text()).toContain("0.41");
    expect(text()).toContain("1.36× normal");
    // a measured peer outside the index is named, not dropped
    expect(text()).toContain("CRDO");
    expect(text()).toContain("not in the index");
    // the trading strip under the price chart
    expect(text()).toContain("Trading, last 3 sessions");
  });
});
