// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk research tools and the watchlist, for the owner", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("compares implied with realized volatility and sizes a position", async () => {
    desk = await mountDesk("admin", "/desk/research/volatility", "All companies with option data");
    const text = desk.host.textContent ?? "";
    // one-month implied 24.0% against 26.7% realized: the options are cheaper than the stock has moved
    expect(text).toContain("24.0%");
    expect(text).toContain("26.7%");
    expect(text).toContain("−2.7%");
    expect(text).toContain("Options richer than realized0 of 1");
    // target 20% over a 24% forecast: 83% of the full position
    expect(text).toContain("Share of the full position83%");
    expect(text).toContain("Measured: risk, not direction");
  });

  it("ranks balance sheets by what a rate move would cost at most", async () => {
    desk = await mountDesk("admin", "/desk/research/macro", "$78.11B");
    const text = desk.host.textContent ?? "";
    // 78.1bn × 1 point = $781M a year; 0.494 × 1 point = 0.5% of operating income
    expect(text).toContain("$781M");
    expect(text).toContain("0.5%");
    expect(text).toContain("Rates1 of 2");
    expect(desk.calls).toContain("report:company-exposures.json");
  });

  it("shows insider purchases, multi-insider windows, 13F flows and short interest", async () => {
    desk = await mountDesk("admin", "/desk/research/ownership", "Held now");
    const text = desk.host.textContent ?? "";
    expect(text).toContain("Lip Bu Tan");
    expect(text).not.toContain("SELLER SAM");
    expect(text).toContain("$9.71M");
    expect(text).toContain("CEO, director");
    expect(text).toContain("+0.38%");
    expect(text).toContain("131.6M");
  });

  it("lists the watchlist with the follow box", async () => {
    desk = await mountDesk("admin", "/desk/watchlist", "1 followed");
    const text = desk.host.textContent ?? "";
    expect(text).toContain("Apple Inc.");
    expect(desk.host.querySelector('input[aria-label="Follow a company"]')).not.toBeNull();
    expect(desk.host.querySelector('button[aria-label="Unfollow AAPL"]')).not.toBeNull();
  });
});
