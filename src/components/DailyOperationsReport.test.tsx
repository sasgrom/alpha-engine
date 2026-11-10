// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DailyOperationsReportView from "./DailyOperationsReport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Daily operations report", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  it("shows stale Schwab evidence, remediation and a working job inspection action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(readFileSync("src/test-fixtures/daily-operations.json", "utf8"), { status: 200 })));
    const onOpenJob = vi.fn();
    await act(async () => { root = createRoot(host!); root.render(<DailyOperationsReportView onOpenJob={onOpenJob} />); });
    expect(host!.textContent).toContain("Daily pipeline is not healthy");
    expect(host!.textContent).toContain("Schwab captured today0/2");
    expect(host!.textContent).toContain("schwab-fetch.mts --universe research-universe-50.json");
    expect(host!.querySelector('a[href="/reports/daily-operations.md"]')).not.toBeNull();
    const inspect = [...host!.querySelectorAll("button")].find((button) => button.textContent === "Inspect job")!;
    await act(async () => { inspect.click(); });
    expect(onOpenJob).toHaveBeenCalledWith("schwab-fetch-daily");
  });

  it("fails closed with a build command when no report exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => { root = createRoot(host!); root.render(<DailyOperationsReportView />); });
    expect(host!.textContent).toContain("No daily operations report");
    expect(host!.textContent).toContain("npx tsx scripts/build-daily-operations-report.mts");
  });
});
