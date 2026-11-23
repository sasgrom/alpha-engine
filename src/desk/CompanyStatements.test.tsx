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

describe("desk company statements", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
    DESK_DATA.noStatements = false;
  });

  it("shows the quarters as first reported, with the filing and tag behind each figure", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Financial statements");
    await waitUntil(() => desk!.host.textContent?.includes("standard fundamentals v3.1") ?? false);
    expect(desk.calls).toContain("desk.companyStatements");
    const table = [...desk.host.querySelectorAll("table")].find(node => node.textContent?.includes("Revenue"))!;
    expect([...table.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Line", "Q3 26", "Q4 26"]);
    const revenue = [...table.querySelectorAll("tbody tr")].find(row => row.textContent?.startsWith("Revenue"))!;
    const cells = [...revenue.querySelectorAll("td")];
    expect(cells[1].textContent).toBe("114.5B");
    expect(cells[1].getAttribute("title")).toBe("First reported in the filing of Nov 3, 2026 · XBRL tag Revenues");
    // a figure a later filing changed: the first report is shown, marked, and the hover names the later figure
    expect(cells[0].textContent).toBe("94.0B r");
    expect(cells[0].getAttribute("title")).toContain("later filed as 94.1B on Nov 3, 2026");
    const eps = [...table.querySelectorAll("tbody tr")].find(row => row.textContent?.startsWith("Diluted"))!;
    expect([...eps.querySelectorAll("td")].map(td => td.textContent)).toEqual(["–", "1.85"]);
    expect(eps.querySelectorAll("td")[1].getAttribute("title")).toContain("computed from other reported lines");
  });

  it("shows fiscal years and trailing years built from the quarters, and says how each figure was formed", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Financial statements");
    await waitUntil(() => desk!.host.textContent?.includes("standard fundamentals v3.1") ?? false);
    const table = () => [...desk!.host.querySelectorAll("table")].find(node => node.textContent?.includes("Revenue"))!;
    const cells = (start: string) => [...[...table().querySelectorAll("tbody tr")].find(row => row.textContent?.startsWith(start))!.querySelectorAll("td")];
    const annual = click(desk, "Annual");
    await waitUntil(() => annual.getAttribute("aria-pressed") === "true");
    expect(desk.host.textContent).toContain("Fiscal years, from the four quarters as known at each annual report");
    expect([...table().querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Line", "FY 2026"]);
    expect(table().querySelector("thead th.num")!.getAttribute("title")).toBe("Fiscal year ended Sep 26, 2026 · annual report filed Nov 3, 2026");
    expect(cells("Revenue")[0].textContent).toBe("478.8B r");
    expect(cells("Revenue")[0].getAttribute("title")).toBe("Sum of the four quarters · figures as known at the report of Nov 3, 2026 · from the latest filings: 479.0B");
    expect(cells("Diluted")[0].textContent).toBe("8.31");
    expect(cells("Diluted")[0].getAttribute("title")).toContain("Net income to common stockholders of the four quarters ÷ their average share count");
    // a line without a yearly figure says why
    expect(cells("Weighted")[0].textContent).toBe("–");
    expect(cells("Weighted")[0].getAttribute("title")).toContain("one of the four quarters is missing or out of scale");
    // the span control belongs to the quarter views
    expect([...desk.host.querySelectorAll("button")].some(button => button.textContent === "10 years")).toBe(false);
    const trailing = click(desk, "Trailing year");
    await waitUntil(() => trailing.getAttribute("aria-pressed") === "true");
    expect([...table().querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Line", "Q3 26", "Q4 26"]);
    expect(cells("Revenue").map(td => td.textContent)).toEqual(["466.8B", "478.8B r"]);
    expect(cells("Diluted").map(td => td.textContent)).toEqual(["–", "8.31"]);
    // the balance sheet under a yearly view is the year-end amount
    click(desk, "Balance sheet");
    click(desk, "Annual");
    await waitUntil(() => desk!.host.textContent?.includes("Total assets") ?? false);
    const assets = [...[...desk.host.querySelectorAll("tbody tr")].find(row => row.textContent?.startsWith("Total assets"))!.querySelectorAll("td")];
    expect(assets.map(td => td.textContent)).toEqual(["359.2B"]);
    expect(assets[0].getAttribute("title")).toBe("First reported in the filing of Nov 3, 2026 · XBRL tag Assets");
  });

  it("charts the statement's first line and any line that is clicked, and names an out-of-scale figure instead of showing it", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Financial statements");
    await waitUntil(() => desk!.host.textContent?.includes("standard fundamentals v3.1") ?? false);
    const chart = () => desk!.host.querySelector("[data-chart-line]")!;
    expect(chart().getAttribute("data-chart-line")).toBe("revenue");
    expect(chart().textContent).toContain("Revenue · by quarter");
    expect(chart().querySelector("svg")!.getAttribute("aria-label")).toBe("Revenue, by quarter, 2 periods");
    expect([...chart().querySelectorAll("rect[data-bar]")].map(bar => bar.getAttribute("data-bar"))).toEqual(["2026-06-27", "2026-09-26"]);
    const line = click(desk, "Weighted average diluted shares");
    await waitUntil(() => line.getAttribute("aria-pressed") === "true");
    expect(chart().getAttribute("data-chart-line")).toBe("shareswaDil");
    // the out-of-scale quarter has no bar, and its table cell says what was filed
    expect([...chart().querySelectorAll("rect[data-bar]")].map(bar => bar.getAttribute("data-bar"))).toEqual(["2026-09-26"]);
    const table = [...desk.host.querySelectorAll("table")].find(node => node.textContent?.includes("Revenue"))!;
    const shares = [...[...table.querySelectorAll("tbody tr")].find(row => row.textContent?.startsWith("Weighted"))!.querySelectorAll("td")];
    expect(shares.map(td => td.textContent)).toEqual(["n/a", "14.8B"]);
    expect(shares[0].getAttribute("title")).toContain("The filed figure, 14.8K, is out of scale against the company's other share figures");
    // a per-share figure filed before a later split is shown on today's share basis, and the hover gives it as filed
    const basic = [...[...table.querySelectorAll("tbody tr")].find(row => row.textContent?.startsWith("Earnings per basic share"))!.querySelectorAll("td")];
    expect(basic.map(td => td.textContent)).toEqual(["1.90", "1.86"]);
    expect(basic[0].getAttribute("title")).toBe("On today's share basis; as filed 7.60, before a later share split · First reported in the filing of Jul 31, 2026 · XBRL tag EarningsPerShareBasic");
  });

  it("switches statements and says so when a statement has no lines", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Financial statements");
    await waitUntil(() => desk!.host.textContent?.includes("standard fundamentals v3.1") ?? false);
    const balance = click(desk, "Balance sheet");
    await waitUntil(() => balance.getAttribute("aria-pressed") === "true");
    expect(desk.host.textContent).toContain("Total assets");
    expect(desk.host.textContent).toContain("359.2B");
    click(desk, "Cash flow");
    await waitUntil(() => desk!.host.textContent?.includes("The company reported no lines for this statement") ?? false);
  });

  it("says plainly when no statements are built for the company", async () => {
    // another company than the tests above: the page's query cache outlives one mounted desk
    DESK_DATA.noStatements = true;
    desk = await mountDesk("admin", "/desk/company/MSFT", "Financial statements");
    await waitUntil(() => desk!.host.textContent?.includes("No standard statements are built for this company.") ?? false);
    expect(desk.host.textContent).not.toContain("standard fundamentals v3.1");
  });
});
