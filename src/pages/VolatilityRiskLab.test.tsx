// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VolatilityRiskLab from "./VolatilityRiskLab";

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Volatility risk replay", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(<MemoryRouter><VolatilityRiskLab /></MemoryRouter>);
    });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("renders the reviewed AAPL replay with explicit assumptions and limits", () => {
    expect(host!.textContent).toContain("REPLAY · NOT LIVE");
    expect(host!.textContent).toContain("2024-01-02");
    expect(host!.textContent).toContain("66.67%");
    expect(host!.textContent).toContain("0.78×");
    expect(host!.textContent).toContain("64.85%");
    expect(host!.textContent).toContain("59.79%");
    expect(host!.textContent).toContain("Return and capital are your scenario assumptions");
    expect(host!.textContent).toContain("Directional alpha");
    expect(host!.textContent).toContain("Not claimed");
    expect(host!.querySelector('a[href="/company/AAPL"]')).not.toBeNull();
    expect(host!.querySelector('a[href="/analytics/methodology"]')).not.toBeNull();
  });

  it("recalculates exposure and normalized return against the RV20 baseline", async () => {
    const button = [...host!.querySelectorAll("button")].find((item) => item.textContent?.includes("RV20"))!;
    await act(async () => { button.click(); });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(host!.textContent).toContain("100.00%");
    expect(host!.textContent).toContain("1.21×");
    expect(host!.textContent).toContain("Actual outside 1× band");
    expect(host!.querySelector('svg[aria-label="AAPL rv20 expected move and historical risk bands"]')).not.toBeNull();
  });

  it("keeps the paired baseline and scenario export available", () => {
    const rows = host!.querySelectorAll(".risk-comparison tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("ATM IV");
    expect(rows[1].textContent).toContain("RV20");
    const download = [...host!.querySelectorAll("button")].find((item) => item.textContent?.includes("Download scenario JSON")) as HTMLButtonElement;
    expect(download.disabled).toBe(false);
  });
});
