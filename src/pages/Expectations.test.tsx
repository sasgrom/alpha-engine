// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Expectations from "./Expectations";

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Expectations report", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><Expectations /></MemoryRouter>); });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("shows honest zero coverage instead of inventing a mass extraction", () => {
    expect(host!.textContent).toContain("Waiting for home extraction");
    expect(host!.textContent).toContain("0 / 53");
    expect(host!.textContent).toContain("No extracted statements yet");
    expect(host!.textContent).toContain("--universe research-universe-53.json --latest");
    expect(host!.textContent).toContain("Not run");
    expect(host!.querySelectorAll(".expectation-card")).toHaveLength(0);
  });

  it("offers real SEC reference examples in a separate, clearly labeled tab", async () => {
    const tab = [...host!.querySelectorAll("button")].find((button) => button.textContent?.includes("SEC reference examples"))!;
    await act(async () => { tab.click(); });
    expect(host!.querySelectorAll(".expectation-card")).toHaveLength(6);
    expect(host!.textContent).toContain("$240–247 billion");
    expect(host!.textContent).toContain("$108.0 billion ± 2%");
    expect(host!.textContent).toContain("Not an accuracy result");
    expect(host!.querySelector('a[href*="amzn-20260930xex991.htm"]')).not.toBeNull();
  });
});
