// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MacroScenarioLab from "./MacroScenarioLab";

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Macro Scenario Lab", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      const file = url === "/reports/macro-scenarios.json" || url === "/reports/shock-calibration.json" || url === "/reports/exposure-latest.json" || url === "/reports/macro-transmission-atlas.json" ? `src/test-fixtures${url.slice("/reports".length)}` : `public${url}`;
      return new Response(readFileSync(file, "utf8"), { status: 200 });
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><MacroScenarioLab /></MemoryRouter>); });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  it("recomputes the rate upper bound when the shock changes and exposes evidence", async () => {
    expect(host!.textContent).toContain("Shock the inputs. Inspect the evidence.");
    expect(host!.textContent).toContain("Fixture baseline");
    expect(host!.textContent).toContain("interest_upper_bound");
    const before = host!.textContent;
    const beforeValue = Number(before.match(/(\d+\.\d+)M USD\/year/)![1]);
    expect(beforeValue).toBeGreaterThan(0);
    const input = host!.querySelector('input[aria-label="Shock value"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "0.02");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const afterValue = Number(host!.textContent.match(/(\d+\.\d+)M USD\/year/)![1]);
    expect(afterValue).toBeCloseTo(beforeValue * 2, 1);
    const rcl = [...host!.querySelectorAll(".scenario-impact-row")].find((row) => row.textContent?.includes("RCL")) as HTMLButtonElement;
    await act(async () => { rcl.click(); });
    expect(host!.textContent).toContain("assumes immediate full repricing of exposed debt");
    expect(host!.textContent).toContain("hedge_share_unknown_upper_bound");
    expect(host!.textContent).toContain("Measured market response");
    expect(host!.textContent).toContain("empirical event/horizon distribution, not a confidence interval or forecast");
  });

  it("uses calibrated FRED presets and confidence intervals", () => {
    expect(host!.textContent).toContain("Mild p50");
    expect(host!.textContent).toContain("Severe p90");
    expect(host!.textContent).toContain("Extreme p99");
    expect(host!.textContent).toContain("p50 CI95");
  });

  it("separates current gross fuel exposure from historical and missing channels", async () => {
    const oil = [...host!.querySelectorAll("button")].find((button) => button.textContent === "OIL+20%") as HTMLButtonElement;
    await act(async () => { oil.click(); });
    expect(host!.textContent).toContain("fuel_cost_gross");
    expect(host!.textContent).toContain("gross_exposure");
    expect(host!.textContent).toContain("historical_only");
    const usd = [...host!.querySelectorAll("button")].find((button) => button.textContent === "USD+5%") as HTMLButtonElement;
    await act(async () => { usd.click(); });
    expect(host!.textContent).toContain("foreign_revenue_share_missing_or_invalid");
    const credit = [...host!.querySelectorAll("button")].find((button) => button.textContent === "CREDIT+100 bp") as HTMLButtonElement;
    await act(async () => { credit.click(); });
    expect(host!.textContent).toContain("credit_refinancing_upper_bound");
    expect(host!.textContent).toContain("next_twelve_month_debt_maturities_missing");
  });
});
