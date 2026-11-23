// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const click = (desk: MountedDesk, label: string) => {
  const button = [...desk.host.querySelectorAll("button")].find(row => row.textContent === label);
  if (!button) throw new Error(`no button ${label}`);
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return button;
};
const tableWith = (desk: MountedDesk, text: string) => [...desk.host.querySelectorAll("table")].find(node => node.textContent?.includes(text))!;
const rowOf = (table: Element, start: string) => [...table.querySelectorAll("tbody tr")].find(row => row.textContent?.startsWith(start))!;

describe("desk company guidance, splits and dividends", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
    DESK_DATA.noStatements = false;
  });

  it("sets what the company guided beside what it reported", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Guidance and what was reported");
    await waitUntil(() => desk!.host.textContent?.includes("guidance standard g1.2.20261122") ?? false);
    expect(desk.calls).toContain("desk.companyGuidance");
    const table = tableWith(desk, "First given");
    // a reported quarter: the range, the figure as first filed, and where it fell
    const reported = rowOf(table, "Q4 FY26");
    expect([...reported.querySelectorAll("td")].map(td => td.textContent)).toEqual(["$108.0B to $112.0B", "Jul 31, 2026", "$114.5B", "+4.1% · above the range"]);
    // a quarter still to come is named by its end date and says so
    const coming = rowOf(table, "Quarter to Dec 26, 2026");
    expect(coming.textContent).toContain("$120.0B to $126.0B");
    expect(coming.textContent).toContain("Not reported yet");
    // a full year: the last guidance counts, its changes are on hover, the figure is the four quarters
    const year = rowOf(table, "FY 2025");
    const cells = [...year.querySelectorAll("td")];
    expect(cells[0].textContent).toBe("about $410.0B · changed once");
    expect(cells[0].getAttribute("title")).toBe("Jan 30, 2025: about $400.0B · Jul 31, 2025: about $410.0B · Repeated unchanged in 1 later release");
    expect(cells[2].getAttribute("title")).toContain("the sum of the year's four quarters");
    expect(cells[3].textContent).toBe("−1.2% · below");
  });

  it("says that adjusted earnings have nothing filed to compare with", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Guidance and what was reported");
    await waitUntil(() => desk!.host.textContent?.includes("guidance standard g1.2.20261122") ?? false);
    click(desk, "Earnings per share");
    await waitUntil(() => desk!.host.textContent?.includes("adjusted") ?? false);
    const row = rowOf(tableWith(desk, "First given"), "Q4 FY26");
    expect(row.textContent).toContain("Q4 FY26 · adjusted");
    expect(row.textContent).toContain("$1.70 to $1.80");
    expect(row.textContent).toContain("Guided on an adjusted basis; no adjusted figure could be verified in the release");
    // an adjusted figure read from the release is shown, and the hover says where it is from
    const read = [...rowOf(tableWith(desk, "First given"), "Q3 FY26").querySelectorAll("td")];
    expect(read[2].textContent).toBe("$1.62");
    expect(read[2].getAttribute("title")).toBe("The adjusted figure as the earnings release printed it, Jul 31, 2026; it is not in the filed statements");
    expect(read[3].textContent).toBe("+8.0% · above the range");
  });

  it("shows splits and dividends from the standard prices", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Splits and dividends");
    await waitUntil(() => desk!.host.textContent?.includes("Dividends, last 12 months") ?? false);
    const text = desk.host.textContent ?? "";
    expect(text).toContain("$1.07 a share · +0.31% of the last close");
    expect(text).toContain("$0.27 · ex-date Nov 12, 2026");
    expect(text).toContain("4-for-1 (Aug 31, 2020) · 7-for-1 (Jun 9, 2014)");
    expect(text).toContain("Standard prices to Nov 20, 2026");
  });
});
