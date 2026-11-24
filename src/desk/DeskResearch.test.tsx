// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

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

  it("shows insider trading across all companies from the insider standard, the funds' sectors and short interest", async () => {
    desk = await mountDesk("admin", "/desk/research/ownership", "Bought less sold");
    await waitUntil(() => (desk!.host.textContent ?? "").includes("Lip Bu Tan"));
    const text = desk.host.textContent ?? "";
    // the headline figures of the 90 days, with the share sold under trading plans
    expect(text).toContain("Insiders bought, 90 days$12.40M14 insiders at 9 companies");
    expect(text).toContain("Insiders sold, 90 days$2.10B610 insiders at 302 companies · 70% under trading plans");
    expect(text).toContain("Insider filings to Nov 13, 2026, 500 companies.");
    // purchases with who bought, joint reporters counted, and the SEC's copy of the filing
    expect(text).toContain("Lip Bu Tan · Chief Executive Officer");
    expect(text).toContain("Arthur D Levinson +1 · Director");
    expect(desk.host.querySelector('a[href="https://www.sec.gov/Archives/edgar/data/1045810/000005086326000195/"]')).not.toBeNull();
    // several insiders buying together, and the largest net sellers first
    expect(text).toContain("Chief Executive Officer, Director");
    expect(text).toContain("Where insiders sold most");
    expect(text).toContain("AAPL$126M11100%$250K1−$126M");
    expect(text).not.toContain("Dry-run excess");
    expect(text).toContain("+$40.00B");
    expect(text).toContain("131.6M");
  });

  it("opens the watchlist where the classic universe page was, with no way to add a company outside the list", async () => {
    desk = await mountDesk("admin", "/universe", "1 followed", true);
    const text = desk.host.textContent ?? "";
    expect(text).toContain("The watchlist takes the companies the desk covers");
    expect(text).not.toContain("classic manager");
    expect(desk.host.querySelector('a[href="/universe"], a[href="/jobs"]')).toBeNull();
  });

  it("lists the watchlist with the follow box", async () => {
    desk = await mountDesk("admin", "/desk/watchlist", "1 followed");
    const text = desk.host.textContent ?? "";
    expect(text).toContain("Apple Inc.");
    expect(desk.host.querySelector('input[aria-label="Follow a company"]')).not.toBeNull();
    expect(desk.host.querySelector('button[aria-label="Unfollow AAPL"]')).not.toBeNull();
  });
});
