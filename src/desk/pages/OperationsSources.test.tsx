// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
});

describe("desk operations sources", () => {
  it("lists each source with its newest data, age and state, and the reason a refresh failed", async () => {
    desk = await mountDesk("admin", "/desk/operations", "Insider forms (3, 4, 5)");
    expect(desk.calls).toContain("desk.sourceFreshness");
    const rows = [...desk.host.querySelectorAll("table.desk-table tbody tr")].map((row) => row.textContent ?? "");
    const insiders = rows.find((row) => row.includes("Insider forms"))!;
    expect(insiders).toContain("i1.1.20261116");
    expect(insiders).toContain("11 d");
    expect(insiders).toContain("Refresh failed");
    expect(insiders).toContain("Regression check refused the load");
    const short = rows.find((row) => row.includes("Short interest"))!;
    expect(short).toContain("40 d");
    expect(short).toContain("Late");
    expect(short).toContain("no job");
    const filings = rows.find((row) => row.includes("SEC filings"))!;
    expect(filings).toContain("Current");
    expect(filings).toContain("1 d");
    // a current source does not print an error line
    expect(filings).not.toContain("Regression");
  });
});
