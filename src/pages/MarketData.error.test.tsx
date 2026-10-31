// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarketData from "./MarketData";

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Schwab Market Data error state", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><MarketData /></MemoryRouter>); });
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; vi.unstubAllGlobals(); });

  it("shows an explicit unavailable state instead of pretending the snapshot is empty", async () => {
    expect(host!.textContent).toContain("Snapshot could not be loaded");
    expect(host!.textContent).not.toContain("No Schwab snapshots yet");
    const options = [...host!.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Options")!;
    await act(async () => { options.click(); });
    expect(host!.textContent).toContain("Contracts unavailable");
  });
});
