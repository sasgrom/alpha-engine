// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk company filings and the release reader", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
    DESK_DATA.noStatements = false;
  });
  const card = () => [...desk!.host.querySelectorAll("section.desk-card")].find(node => node.querySelector("h2")?.textContent === "Filings")!;
  const rows = () => [...card().querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td")].slice(0, 3).map(td => td.textContent));
  const click = (label: string) => {
    const button = [...desk!.host.querySelectorAll("button")].find(node => node.textContent === label);
    if (!button) throw new Error(`no button ${label}`);
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    return button;
  };

  it("lists the reports with what each is about, and links each to the SEC's copy", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Filings");
    await waitUntil(() => card().textContent?.includes("filings to Nov 5, 2026") ?? false);
    expect(desk.calls).toContain("desk.companyFilings");
    expect(rows()).toHaveLength(12);
    expect(rows().slice(0, 3)).toEqual([
      ["Nov 3, 2026", "10-K", "Year to Sep 26, 2026"],
      ["Oct 29, 2026", "8-K", "Results of operationsEarnings"],
      // an item without a name shows its number; the exhibits item is left out
      ["Sep 10, 2026", "8-K", "Officers and directors · Item 7.77"],
    ]);
    const links = [...card().querySelectorAll("tbody a")].map(link => link.getAttribute("href"));
    expect(links[0]).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/aapl-20260926.htm");
    // without a main document name the link goes to the filing's index page
    expect(links[2]).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000080/0000320193-26-000080-index.htm");
    expect([...card().querySelectorAll("tbody a")].every(link => link.getAttribute("target") === "_blank" && link.getAttribute("rel") === "noreferrer")).toBe(true);
    expect(card().querySelector("tbody td")!.getAttribute("title")).toBe("Accepted by the SEC 06:01 Eastern time");
    click("Show all 14");
    await waitUntil(() => rows().length === 14);
    const earnings = click("Earnings releases");
    await waitUntil(() => earnings.getAttribute("aria-pressed") === "true");
    expect(rows().map(row => row[0])).toEqual(["Oct 29, 2026"]);
    click("Annual and quarterly");
    await waitUntil(() => rows().length === 12);
    expect(rows().every(row => row[1].startsWith("10-"))).toBe(true);
  });

  it("opens a cached earnings release as text, and only a release has that button", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Filings");
    await waitUntil(() => card().textContent?.includes("filings to Nov 5, 2026") ?? false);
    expect([...card().querySelectorAll("button")].filter(button => button.textContent === "Read the release")).toHaveLength(1);
    click("Read the release");
    await waitUntil(() => desk!.host.querySelector(".desk-document") !== null);
    const dialog = desk.host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Earnings release filed Oct 29, 2026");
    expect([...dialog.querySelectorAll(".desk-document p")].map(node => node.textContent)).toEqual(["Apple reports fourth quarter results", "Revenue | $114.5 billion"]);
    // two cached exhibits: a switch between them, the first (the largest) shown
    expect([...dialog.querySelectorAll(".desk-seg button")].map(button => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([["Exhibit 1", "true"], ["Exhibit 2", "false"]]);
    expect(dialog.querySelector("a")!.getAttribute("href")).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000099/aapl-8k.htm");
    act(() => (dialog.querySelector('button[aria-label="Close dialog"]') as HTMLButtonElement).click());
    await waitUntil(() => desk!.host.querySelector('[role="dialog"]') === null);
  });

  it("says so when the calendar holds nothing for the company", async () => {
    DESK_DATA.noStatements = true;
    desk = await mountDesk("admin", "/desk/company/MSFT", "Filings");
    await waitUntil(() => desk!.host.textContent?.includes("The release calendar holds no filings for this company.") ?? false);
  });
});
