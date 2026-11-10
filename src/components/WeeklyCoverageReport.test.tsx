// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeeklyCoverageReportView from "./WeeklyCoverageReport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = {
  schemaVersion: 1,
  generatedAt: "2026-11-10T04:57:28.597Z",
  baselineGeneratedAt: "2026-11-03T03:00:00.000Z",
  status: "ready",
  summary: { tables: 2, tablesPresent: 2, tablesMissing: 0, tablesWithRowIncrease: 1, tablesWithRowDecrease: 1, tablesWithHashDrift: 1, rows: 159, baselineRows: 150, deltaRows: 9 },
  tables: [
    { table: "prices", present: true, rows: 110, baselineRows: 100, deltaRows: 10, hashChanged: false, maxDate: "2026-11-06" },
    { table: "macro_points", present: true, rows: 49, baselineRows: 50, deltaRows: -1, hashChanged: true, maxDate: "2026-11-03" },
  ],
};

describe("weekly coverage report", () => {
  let host: HTMLDivElement | null;
  let root: ReturnType<typeof createRoot> | null;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = null;
  });
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    host?.remove();
    vi.restoreAllMocks();
  });

  it("shows row deltas, hash drift and baseline timestamps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
    await act(async () => { root = createRoot(host!); root.render(<WeeklyCoverageReportView />); });
    expect(host!.textContent).toContain("Coverage and content drift");
    expect(host!.textContent).toContain("159");
    expect(host!.textContent).toContain("Hash drift");
    expect(host!.textContent).toContain("macro_points");
    expect(host!.textContent).toContain("changed");
    expect(host!.querySelector('a[href="/reports/weekly-coverage.md"]')).not.toBeNull();
  });

  it("fails closed with a build command when no report exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => { root = createRoot(host!); root.render(<WeeklyCoverageReportView />); });
    expect(host!.textContent).toContain("No weekly coverage report");
    expect(host!.textContent).toContain("npx tsx scripts/build-weekly-coverage.mts");
  });
});
