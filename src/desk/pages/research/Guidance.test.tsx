// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "../../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
});

const text = () => desk!.host.textContent ?? "";
const changes = () => [...desk!.host.querySelectorAll("[data-guidance-changes] tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim()));
const records = () => [...desk!.host.querySelectorAll("[data-guidance-records] tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim()));
const press = async (label: string) => {
  const button = [...desk!.host.querySelectorAll(".desk-seg button")].find((item) => item.textContent?.trim() === label);
  expect(button).toBeTruthy();
  await act(async () => { (button as HTMLElement).click(); });
};

describe("the desk Guidance page, for the owner", () => {
  it("counts the raises and cuts of the last 90 days and shows each with what stood before and the release's words", async () => {
    desk = await mountDesk("admin", "/desk/research/guidance", "Changes of guidance");
    await waitUntil(() => changes().length > 0);
    expect(text()).toContain("Releases to Nov 10, 2026, 349 companies with guidance.");
    // one raise and one cut; the change of 26,544% is marked and stays out of the counts
    expect(text()).toContain("Raised, last 90 days1");
    expect(text()).toContain("Cut, last 90 days1");
    expect(text()).toContain("1 larger than 25% are marked and not counted");
    expect(text()).toContain("Revenue reported above the midpoint85%");
    expect(text()).toContain("903 of 1,064 periods of three years · median +1.5% against the midpoint");
    expect(changes()).toEqual([
      ["Nov 5, 2026", "AAPL", "Revenue", "FY 2026", "Raised", "$400.0B to $410.0B", "$410.0B to $420.0B", "+2.5%", "We now expect revenue of $410 billion to $420 billion"],
      ["Nov 4, 2026", "NVDA", "EPS, adjusted", "FY 2026", "Cut", "$4.90 to $5.10", "$4.40 to $4.60", "−10.0%", "Adjusted EPS is now expected between $4.40 and $4.60"],
      ["Oct 28, 2026", "MSFT", "Revenue", "FY 2026", "Raisedcheck", "about $25.0M", "about $6.7B", "+26544%", "reducing our full year revenue guidance at the midpoint to $6.661 billion"],
    ]);
  });

  it("filters the changes by kind, measure, period and ticker", async () => {
    desk = await mountDesk("admin", "/desk/research/guidance", "Changes of guidance");
    await waitUntil(() => changes().length > 0);
    await press("First figures");
    expect(changes().map((row) => [row[1], row[2], row[3], row[4], row[5]])).toEqual([["MSFT", "EPS, GAAP", "Q2 FY26", "First figures", "—"]]);
    await press("All");
    await press("A year");
    expect(changes()).toHaveLength(5);
    await press("EPS");
    expect(changes().map((row) => row[1])).toEqual(["NVDA", "MSFT"]);
  });

  it("ranks the companies by how often they report above their own guidance", async () => {
    desk = await mountDesk("admin", "/desk/research/guidance", "Record against their own guidance");
    await waitUntil(() => records().length > 0);
    expect(records()).toEqual([["NVDA", "12", "12", "100%", "+3.4%"], ["AAPL", "16", "14", "88%", "+2.1%"], ["MSFT", "8", "3", "38%", "−0.4%"]]);
    await press("Least often above");
    expect(records().map((row) => row[0])).toEqual(["MSFT", "AAPL", "NVDA"]);
    // the record's own measure switch, not the changes' filter of the same name
    const eps = [...desk.host.querySelectorAll("[aria-label='Measure of the record'] button")].find((item) => item.textContent === "EPS");
    await act(async () => { (eps as HTMLElement).click(); });
    expect(records()).toEqual([["AAPL", "6", "5", "83%", "+5.0%"]]);
  });
});
