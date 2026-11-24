// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, SNAPSHOT, type MountedDesk } from "../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Its own file: the snapshot is changed here, and the harness keeps answers between the tests of one file.
describe("the desk Screener and figures of another share class", () => {
  let desk: MountedDesk | null = null;
  const microsoft = SNAPSHOT.companies[2];
  const before = { pe: microsoft.pe, epsTtm: microsoft.epsTtm };
  afterEach(() => {
    desk?.unmount();
    desk = null;
    Object.assign(microsoft, before);
  });

  it("shows neither of Schwab's per-share figures where its P/E is below 1", async () => {
    // the traded class's price over another class's earnings, as Schwab gives it for Berkshire's B share
    Object.assign(microsoft, { pe: 0.0107, epsTtm: 53_726.13 });
    desk = await mountDesk("user", "/desk/screener?view=fundamentals", "3 of 3 companies");
    const row = [...desk.host.querySelectorAll("tbody tr")].find((item) => item.querySelector(".desk-ticker")?.textContent?.startsWith("MSFT"))!;
    const headers = [...desk.host.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim());
    const cells = [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim());
    expect(cells[headers.indexOf("P/E")]).toBe("—");
    expect(cells[headers.indexOf("EPS")]).toBe("—");
    expect(row.querySelector("[title^='Schwab']")).toBeNull();
    // the report date belongs to the performance columns
    expect(headers).not.toContain("Next report");
  });
});
