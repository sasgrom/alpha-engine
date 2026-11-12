// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "../desk-test-harness";
import { deflatorSince, moneySince, quarterSentence, spreadRecord } from "./data";
import { FLOWS_OVERVIEW } from "./flows-fixtures";
import { HALL, libraryLayout } from "./library-layout";
import { webglAvailable } from "./library-stage";

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

  it("counts how often the money went the right way, and writes the sentence of a quarter", () => {
    expect(spreadRecord(FLOWS_OVERVIEW.quarters, (quarter) => quarter.next1.spread)).toEqual({ measured: 2, positive: 2, mean: 0.06 - 0.04 });
    expect(spreadRecord(FLOWS_OVERVIEW.quarters, (quarter) => quarter.followed.spread).positive).toBe(0);
    const sentence = quarterSentence(row).map((part) => (typeof part === "string" ? part : part.strong)).join("");
    expect(sentence).toBe("In Q1 2026, 3 funds bought $72.00B and sold $56.00B of the covered stocks. Net, money went into Information Technology (+$32.00B) and came out of Energy (−$16.00B).");
  });
});

describe("the layout of the hall", () => {
  const companies = [
    ...Array.from({ length: 60 }, (_, index) => ({ cik: 1000 + index, ticker: `T${index}`, sector: "Information Technology", held: 2e12 / (index + 1) })),
    ...Array.from({ length: 25 }, (_, index) => ({ cik: 2000 + index, ticker: `E${index}`, sector: "Energy", held: 3e11 / (index + 1) })),
    ...Array.from({ length: 30 }, (_, index) => ({ cik: 3000 + index, ticker: `F${index}`, sector: "Financials", held: 5e11 / (index + 1) })),
    { cik: 9, ticker: "NONE", sector: "Energy", held: 0 },
  ];
  const funds = [
    ...Array.from({ length: 14 }, (_, index) => ({ cik: 10 + index, category: "index" as const, tracked: 5e12 / (index + 1) })),
    ...Array.from({ length: 9 }, (_, index) => ({ cik: 100 + index, category: "hedge" as const, tracked: 2e11 / (index + 1) })),
  ];
  const layout = libraryLayout(companies, funds);

  it("gives every held company one book inside its sector's bookcase, on a shelf, without overlap", () => {
    expect(layout.books).toHaveLength(115);
    expect(layout.bays.map((bay) => bay.sector)).toEqual(["Information Technology", "Financials", "Energy"]);
    for (const book of layout.books) {
      const bay = layout.bays.find((item) => item.sector === book.sector)!;
      expect(book.side).toBe(bay.side);
      expect(-book.z - book.thickness / 2).toBeGreaterThanOrEqual(bay.from - 1e-9);
      expect(-book.z + book.thickness / 2).toBeLessThanOrEqual(bay.to + 1e-9);
      expect(book.y - book.height / 2).toBeGreaterThanOrEqual(HALL.shelfBase - 1e-9);
      expect(book.y + book.height / 2).toBeLessThanOrEqual(layout.top);
    }
    // on one shelf of one bookcase the books stand side by side
    const shelves = new Map<string, { from: number; to: number }[]>();
    for (const book of layout.books) {
      const shelf = `${book.sector}|${Math.round((book.y - book.height / 2 - HALL.shelfBase) / HALL.shelfHeight)}`;
      (shelves.get(shelf) ?? shelves.set(shelf, []).get(shelf)!).push({ from: -book.z - book.thickness / 2, to: -book.z + book.thickness / 2 });
    }
    for (const spans of shelves.values()) {
      spans.sort((a, b) => a.from - b.from);
      for (let index = 1; index < spans.length; index++) expect(spans[index].from).toBeGreaterThanOrEqual(spans[index - 1].to - 1e-9);
    }
    // a larger holding is never a thinner book, and the smallest is far thinner than the largest
    const technology = layout.books.filter((book) => book.sector === "Information Technology");
    for (let index = 1; index < technology.length; index++) expect(technology[index].thickness).toBeLessThanOrEqual(technology[index - 1].thickness + 1e-12);
    expect(technology.at(-1)!.thickness).toBeLessThan(technology[0].thickness / 3);
  });

  it("keeps the two walls about equally long and seats every fund at a desk under its shelf mark", () => {
    const reach = (side: number) => Math.max(...layout.bays.filter((bay) => bay.side === side).map((bay) => bay.to));
    expect(Math.abs(reach(-1) - reach(1))).toBeLessThan(Math.max(reach(-1), reach(1)) * 0.6);
    expect(layout.desks).toHaveLength(23);
    expect(layout.marks.map((mark) => mark.label)).toEqual(["Index giants", "Hedge funds and activists"]);
    const places = new Set(layout.desks.map((desk) => `${desk.x}|${desk.z.toFixed(3)}`));
    expect(places.size).toBe(23);
    for (const desk of layout.desks) expect(Math.abs(desk.x)).toBeLessThan(HALL.aisle - 1);
    expect(layout.length).toBeGreaterThan(reach(1) - 0.01);
  });
});
