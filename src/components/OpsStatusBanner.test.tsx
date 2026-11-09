// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpsStatusBanner from "./OpsStatusBanner";

const baseReport = {
  schemaVersion: 1,
  generatedAt: "2026-11-09T21:19:00.000Z",
  date: "2026-11-09",
  dateBasis: "UTC",
  scheduler: { status: "online", heartbeatAt: "2026-11-09T21:10:00.000Z", startedAt: null, currentJobId: null, queuedJobs: 0, nextRunAt: null, enabledJobs: 28, configurationSource: "file" },
  summary: { checksOk: 16, checksWarning: 4, checksError: 13, checksPending: 5, jobsDoneToday: 11, jobsFailedToday: 7, jobsEnabled: 28 },
  checks: [], jobs: [], actions: [],
};

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("OpsStatusBanner", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });

  it("renders nothing when the report is ok", async () => {
    vi.stubGlobal("fetch", respond({ ...baseReport, status: "ok" }));
    await act(async () => { root!.render(<MemoryRouter><OpsStatusBanner /></MemoryRouter>); });
    expect(host!.textContent).toBe("");
  });

  it("shows a compact alert with counts and first error when critical", async () => {
    vi.stubGlobal("fetch", respond({
      ...baseReport,
      status: "critical",
      checks: [
        { id: "schwab", label: "Schwab capture 0/51", status: "error", observedAt: null, detail: "token", action: null },
        { id: "x", label: "Other", status: "warning", observedAt: null, detail: "", action: null },
      ],
    }));
    await act(async () => { root!.render(<MemoryRouter><OpsStatusBanner /></MemoryRouter>); });
    expect(host!.textContent).toContain("critical");
    expect(host!.textContent).toContain("13 errors");
    expect(host!.textContent).toContain("Schwab capture 0/51");
    expect(host!.querySelector("a")?.getAttribute("href")).toBe("/workers");
  });

  it("renders nothing when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await act(async () => { root!.render(<MemoryRouter><OpsStatusBanner /></MemoryRouter>); });
    expect(host!.textContent).toBe("");
  });

  it("never presents a fixture report as live trouble", async () => {
    vi.stubGlobal("fetch", respond({ ...baseReport, status: "critical", dataMode: "fixture" }));
    await act(async () => { root!.render(<MemoryRouter><OpsStatusBanner /></MemoryRouter>); });
    expect(host!.textContent).toBe("");
  });
});
