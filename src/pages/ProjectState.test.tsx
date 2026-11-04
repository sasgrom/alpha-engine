// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectState from "./ProjectState";
import type { DailyOperationsReport } from "../../worker/lib/daily-operations-report";

const mocks = vi.hoisted(() => ({ local: true, current: "sp500-facts-daily" as string | null, lastStatus: "running" }));
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "admin" } }) }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    workersLocal: {
      enabled: { useQuery: () => ({ data: { enabled: mocks.local } }) },
      operations: { useQuery: () => ({ data: mocks.local ? {
        state: {
          heartbeatAt: "2026-11-04T03:00:00.000Z",
          current: mocks.current ? { jobId: mocks.current, status: "running", startedAt: "2026-11-04T02:55:00.000Z" } : null,
          queue: [],
          lastRuns: {
            "sp500-facts-daily": { status: mocks.lastStatus, startedAt: "2026-11-04T02:55:00.000Z", endedAt: mocks.lastStatus === "done" ? "2026-11-04T03:10:00.000Z" : null, trigger: "manual", error: null },
            "facts-fetch-daily": { status: "done", startedAt: "2026-11-03T23:13:57.000Z", endedAt: "2026-11-03T23:32:19.000Z", trigger: "manual", error: null },
          },
        },
      } : undefined }) },
    },
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dailyReport = {
  schemaVersion: 1,
  generatedAt: "2026-11-04T03:01:00.000Z",
  date: "2026-11-04",
  dateBasis: "UTC",
  status: "critical",
  scheduler: { currentJobId: "sp500-facts-daily", queuedJobs: 0 },
  schwab: { tickersCapturedToday: 51, tickersExpected: 51, contracts: 122218, latestCapture: "2026-11-03T00:10:50.992Z" },
  macro: { qaStatus: "pass", fredGeneratedAt: "2026-11-03T22:40:27.034Z", ofacGeneratedAt: "2026-11-03T13:40:05.339Z", derivedCurrent: true },
  facts: { sp500: { uniqueCiks: 499, refreshed: 22, unchanged: 3, failed: 0, missing: 474, lastCheckedAt: "2026-11-04T03:00:00.000Z" } },
  summary: { checksError: 1, checksWarning: 1, checksPending: 2 },
  checks: [],
  jobs: [],
} as unknown as DailyOperationsReport;

describe("Project State workflow", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    mocks.local = true;
    mocks.current = "sp500-facts-daily";
    mocks.lastStatus = "running";
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(dailyReport), { status: 200, headers: { "content-type": "application/json" } })));
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><ProjectState /></MemoryRouter>); });
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; vi.unstubAllGlobals(); });

  it("separates committed code from a running backfill and manifest coverage", () => {
    expect(host!.textContent).toContain("One project. Four different kinds of progress.");
    expect(host!.textContent).toContain("Collection is running in the single home scheduler");
    expect(host!.textContent).toContain("499 unique CIKs");
    expect(host!.textContent).toContain("25 entries");
    expect(host!.textContent).toContain("0 failed · 474 missing");
    expect(host!.textContent).toContain("code commit does not mean the backfill is complete");
    expect(host!.textContent).toContain("Production remains a separate owner decision");
  });

  it("reports a completed registered run without turning coverage into automatic research promotion", async () => {
    mocks.current = null;
    mocks.lastStatus = "done";
    await act(async () => { root!.render(<MemoryRouter><ProjectState /></MemoryRouter>); });
    expect(host!.textContent).toContain("The latest registered collection run completed");
    expect(host!.textContent).toContain("Missing and failed CIKs remain separate coverage findings");
    expect(host!.textContent).toContain("not expanded automatically");
  });

  it("fails closed when live home state is unavailable", async () => {
    if (root) await act(async () => { root!.unmount(); });
    mocks.local = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><ProjectState /></MemoryRouter>); });
    expect(host!.textContent).toContain("cannot verify the live collection state");
    expect(host!.textContent).toContain("No completion is inferred");
    expect(host!.textContent).toContain("Live home scheduler state is unavailable here");
  });
});
