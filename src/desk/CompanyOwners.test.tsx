// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = (desk: MountedDesk, title: string) => [...desk.host.querySelectorAll("section.desk-card")].find(node => node.querySelector("h2, h3")?.textContent === title || node.textContent?.startsWith(title))!;
const stat = (scope: Element, label: string) => [...scope.querySelectorAll(".desk-stat")].find(node => node.querySelector("span")?.textContent?.startsWith(label))?.querySelector("strong")?.textContent;

describe("desk company holders and insiders, from the standards", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
    DESK_DATA.noStatements = false;
  });

  it("shows the newest quarter of fund holdings with the funds read, and the largest holders", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Ownership");
    await waitUntil(() => desk!.host.textContent?.includes("13F standard k16.5") ?? false);
    expect(desk.calls).toContain("desk.companyHolders");
    // the classic slow 13F summary and Form 4 table are no longer read
    expect(desk.calls).not.toContain("company.institutional");
    expect(desk.calls).not.toContain("company.insiderTrades");
    const ownership = card(desk, "Ownership");
    expect(stat(ownership, "Funds holding (Jun 30, 2026)")).toBe("270 of 307");
    expect(stat(ownership, "Share of the stock they hold")).toBe("57.5%");
    expect(stat(ownership, "Value held")).toBe("$2.42T");
    expect(stat(ownership, "New holders / full exits in the quarter")).toBe("6 / 5");
    expect(stat(ownership, "Shares bought less sold in the quarter")).toBe("+184.9M");
    expect(stat(ownership, "Held by the ten largest of them")).toBe("55.5%");
    await waitUntil(() => stat(card(desk!, "Ownership"), "BlackRock") !== undefined);
    expect(stat(ownership, "BlackRock")).toBe("$420B");
    expect(ownership.textContent).toContain("13F standard k16.5, as known on Aug 31, 2026.");
  });

  it("sums the insiders' open-market trades of the year, charts them by quarter and lists the lines", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Insider transactions");
    await waitUntil(() => desk!.host.textContent?.includes("insider standard i1.1.20261116") ?? false);
    const insiders = card(desk, "Insider transactions");
    expect(insiders.textContent).toContain("filings to Nov 13, 2026");
    expect(insiders.textContent).toContain("In the 12 months to Nov 13, 2026: 1 insider bought $460.0K on the open market; 2 insiders sold $34.0M, 74% of it under 10b5-1 plans.");
    // a bar for each quarter with a trade: sales hang below the zero line
    expect([...insiders.querySelectorAll("[data-insider-chart] rect[data-bar]")].map(bar => bar.getAttribute("data-bar"))).toEqual(["2026-06-30", "2026-09-30", "2026-12-31"]);
    const rows = () => [...insiders.querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td")].map(td => td.textContent));
    expect(rows()).toHaveLength(10);
    expect(rows()[0]).toEqual(["Oct 1, 2026", "Timothy D Cook · Chief Executive Officer", "SalePlan", "100.0K", "$25.00M"]);
    expect(rows()[1][2]).toBe("Tax withholding");
    expect(rows()[2]).toEqual(["Aug 10, 2026", "Arthur D Levinson and 1 reporting with them · Director", "Purchase", "2.0K", "$460K"]);
    // a line whose filed price the standard flags keeps its shares and shows no value
    expect(rows()[3].slice(2)).toEqual(["Sale", "10.0K", "—"]);
    const more = [...insiders.querySelectorAll("button")].find(button => button.textContent === "Show all 13")!;
    act(() => more.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await waitUntil(() => rows().length === 13);
  });

  it("says so when the standards hold nothing for the company", async () => {
    DESK_DATA.noStatements = true;
    desk = await mountDesk("admin", "/desk/company/MSFT", "Insider transactions");
    await waitUntil(() => desk!.host.textContent?.includes("No insider filings are in the standard for this company.") ?? false);
    expect(desk.host.textContent).toContain("The funds we read report no holding of this company.");
  });
});
