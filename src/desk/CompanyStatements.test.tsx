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
