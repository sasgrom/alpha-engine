// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Workers from "./Workers";
import { OPERATION_JOBS } from "@contracts/operations";

const mocks = vi.hoisted(() => ({ local: false, run: vi.fn(), set: vi.fn(), kill: vi.fn() }));
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({ workersLocal: { operations: { invalidate: vi.fn() } } }),
    workersLocal: {
      enabled: { useQuery: () => ({ data: { enabled: mocks.local } }) },
      operations: { useQuery: () => ({ data: mocks.local ? { config: null, state: { heartbeatAt: new Date().toISOString(), current: null, queue: [], nextRuns: {}, lastRuns: {} } } : undefined, refetch: vi.fn() }) },
      setOperation: { useMutation: () => ({ mutate: mocks.set, isPending: false }) },
      runOperation: { useMutation: () => ({ mutate: mocks.run, isPending: false }) },
      killOperation: { useMutation: () => ({ mutate: mocks.kill, isPending: false }) },
      operationLog: { useQuery: () => ({ data: { lines: ["scheduler log"] } }) },
    },
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click(); }); };
const button = (host: HTMLDivElement, text: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text));

describe("Operations center", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    mocks.local = false;
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><Workers /></MemoryRouter>); });
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; mocks.local = false; });

  it("shows the complete registry and clickable server stack in documentation mode", async () => {
    expect(host!.textContent).toContain("One operating picture");
    expect(host!.textContent).toContain(`Registered jobs${OPERATION_JOBS.length}`);
    expect(host!.textContent).toContain("Use one web server, not both.");
    expect(host!.textContent).toContain("Read-only outside the home console");
    await click(button(host!, "Development server")!);
    expect(host!.textContent).toContain("Use only while developing");
    expect(host!.textContent).toContain("npm run dev");
  });

  it("offers the full runbook and keeps frozen and production apply jobs non-runnable", async () => {
    await click(button(host!, "Runbook")!);
    expect(host!.textContent).toContain("operations-scheduler-install.ps1");
    expect(host!.textContent).toContain("Production cron");
    expect(host!.textContent).toContain("Reviewed signals production push");
    expect(host!.textContent).toContain("Frozen — no automated or manual GDELT requests");
    expect(host!.textContent).not.toContain("Run chain (2 steps)");
  });

  it("submits only registered job IDs and validated cron edits on the home console", async () => {
    mocks.local = true;
    await act(async () => { root!.render(<MemoryRouter><Workers /></MemoryRouter>); });
    await click(button(host!, "Jobs & schedules")!);
    await click(button(host!, "Schwab REST daily snapshot")!);
    const run = button(host!, "Run chain now")!;
    await click(run);
    expect(mocks.run).toHaveBeenCalledWith({ jobId: "schwab-fetch-daily" });
    const input = host!.querySelector('input[aria-label="Cron for Schwab REST daily snapshot"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "15 4 * * *");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(button(host!, "Save cron")!);
    expect(mocks.set).toHaveBeenCalledWith({ jobId: "schwab-fetch-daily", enabled: true, cron: "15 4 * * *" });
  });
});
