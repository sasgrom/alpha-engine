// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "../desk-test-harness";
import { deflatorSince, hallSectorOrder, moneySince, quarterSentence, spreadRecord, standingOf } from "./data";
import { FLOWS_OVERVIEW } from "./flows-fixtures";
import { webglAvailable } from "./hall/webgl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: MountedDesk | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const click = async (element: Element | null | undefined) => {
  if (!element) throw new Error("Nothing to click");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((element) => (element.textContent ?? "").includes(text));

describe("the fund-flow page, reading view", () => {
  it("has no WebGL in the test browser, so the page opens as the reading view", () => {
    expect(webglAvailable()).toBe(false);
  });

  it("tells the latest quarter and follows the money from a fund to a company and back", async () => {
    mounted = await mountDesk("admin", "/desk/flows", "Fund flows");
    const { host, calls } = mounted;
    await waitUntil(() => (host.textContent ?? "").includes("Most bought"));
    expect(calls).toContain("desk.flowsOverview");
    const text = () => host.textContent ?? "";
    // the sentence of the quarter, from the figures
    expect(text()).toContain("In Q2 2026, 3 funds bought $90.00B and sold $70.00B of the covered stocks.");
    expect(text()).toContain("Net, money went into Information Technology (+$40.00B) and came out of Energy (−$20.00B).");
    // what is left out is said, not hidden
    expect(text()).toContain("Left out as reporting changes (1): Example Trust Bank.");
    expect(text()).toContain("Left out as new in the books: GEV.");
    expect(text()).toContain("Q3 2026 is still being filed (51 reports so far) and is not shown.");
    // the largest seller is a way into its record
    await click(button(host, "Berkshire Hathaway"));
    await waitUntil(() => text().includes("From its own filings"));
    expect(calls).toContain("desk.flowsFund");
    expect(text()).toContain("Hedge funds and activists");
    expect(text()).toContain("Trades of Q2 2026");
    expect(text()).toContain("Options in its latest report");
    // from the fund to a company it sold, and to the funds on the other side
    await click(button(host, "AAPL"));
    await waitUntil(() => text().includes("Who bought, Q2 2026"));
    expect(calls).toContain("desk.flowsCompany");
    expect(text()).toContain("Largest holders");
    // the catalogue finds players by name and marks a filer whose reports ended
    await click(button(host, "Find a player"));
    await waitUntil(() => text().includes("Index giants"));
    expect(text()).toContain("last report Q4 2025");
    // the same figures as a table
    expect(host.querySelector("table.desk-table")?.textContent).toContain("Information Technology");
  });

  it("is in the main navigation for the research audience", async () => {
    mounted = await mountDesk("admin", "/desk", "S&P 500 companies closed higher");
    const link = [...mounted.host.querySelectorAll("nav.desk-nav a")].find((element) => element.textContent === "Flows");
    expect(link?.getAttribute("href")).toBe("/desk/flows");
  });
});

describe("figures of the flow view", () => {
  const row = FLOWS_OVERVIEW.quarters[0];

  it("restates what the money earned after inflation", () => {
    const nominal = moneySince(row);
    expect(nominal.bought).toBeCloseTo(row.bought * 0.5, 3);
    expect(nominal.sold).toBeCloseTo(row.sold * 0.25, 3);
    // prices rose from 320 to 330 between the quarter and the latest one
    const deflator = deflatorSince(FLOWS_OVERVIEW, row);
    expect(deflator).toBeCloseTo(330 / 320, 12);
    const real = moneySince(row, deflator);
    expect(real.boughtReturn).toBeCloseTo(1.5 / (330 / 320) - 1, 12);
    expect(real.bought!).toBeLessThan(nominal.bought!);
    expect(deflatorSince(FLOWS_OVERVIEW, FLOWS_OVERVIEW.quarters[1])).toBe(1);
  });

  it("tells a quarter's winners from its losers against all tracked funds", () => {
    // all funds made 4%: Citadel's book 9% (a winner), Berkshire's 1% (a loser), BlackRock exactly 4% (neither)
    const all = standingOf(row, "all");
    expect(all).toEqual({ keep: null, winners: 1, losers: 1, bar: 0.04 });
    expect([...standingOf(row, "winners").keep!]).toEqual([1423053]);
    expect([...standingOf(row, "losers").keep!]).toEqual([1067983]);
    // a falling quarter still has winners: the bar moves with the market
    const falling = { allFundsReturn: -0.2, fundReturns: [[1, -0.1], [2, -0.3]] as [number, number][] };
    expect([...standingOf(falling, "winners").keep!]).toEqual([1]);
    // without the bar (or a file built before the returns) the hall keeps everybody
    expect(standingOf({ allFundsReturn: null, fundReturns: [[1, 0.1]] }, "winners").keep).toBeNull();
    expect(standingOf({ allFundsReturn: 0.02, fundReturns: undefined as unknown as [number, number][] }, "losers").keep).toBeNull();
  });

  it("orders the hall's bookcases as the build does, and by the value held for a file without that order", () => {
    expect(hallSectorOrder(FLOWS_OVERVIEW)).toEqual(["Information Technology", "Energy"]);
    const older = { ...FLOWS_OVERVIEW, sectorNames: [], companies: [...FLOWS_OVERVIEW.companies, { ...FLOWS_OVERVIEW.companies[0], cik: 1, sector: "Other", held: 9e12 }] };
    expect(hallSectorOrder(older)).toEqual(["Information Technology", "Energy"]);
    const energyFirst = { ...older, companies: older.companies.map((company) => (company.sector === "Energy" ? { ...company, held: company.held * 10 } : company)) };
    expect(hallSectorOrder(energyFirst)).toEqual(["Energy", "Information Technology"]);
  });

  it("counts how often the money went the right way, and writes the sentence of a quarter", () => {
    expect(spreadRecord(FLOWS_OVERVIEW.quarters, (quarter) => quarter.next1.spread)).toEqual({ measured: 2, positive: 2, mean: 0.06 - 0.04 });
    expect(spreadRecord(FLOWS_OVERVIEW.quarters, (quarter) => quarter.followed.spread).positive).toBe(0);
    const sentence = quarterSentence(row).map((part) => (typeof part === "string" ? part : part.strong)).join("");
    expect(sentence).toBe("In Q1 2026, 3 funds bought $72.00B and sold $56.00B of the covered stocks. Net, money went into Information Technology (+$32.00B) and came out of Energy (−$16.00B).");
  });
});
