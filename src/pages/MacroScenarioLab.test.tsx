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
      const file = url === "/reports/macro-scenarios.json" ? "src/test-fixtures/macro-scenarios.json" : `public${url}`;
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
    expect(before).toContain("6.38M USD/year");
    const input = host!.querySelector('input[aria-label="Shock value"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "0.02");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host!.textContent).toContain("12.76M USD/year");
    const rcl = [...host!.querySelectorAll(".scenario-impact-row")].find((row) => row.textContent?.includes("RCL")) as HTMLButtonElement;
    await act(async () => { rcl.click(); });
    expect(host!.textContent).toContain("assumes immediate full repricing of exposed debt");
    expect(host!.textContent).toContain("hedge_share_unknown_upper_bound");
  });

  it("separates current gross fuel exposure from historical and missing channels", async () => {
    const oil = [...host!.querySelectorAll("button")].find((button) => button.textContent === "OIL+20%") as HTMLButtonElement;
    await act(async () => { oil.click(); });
    expect(host!.textContent).toContain("fuel_cost_gross");
    expect(host!.textContent).toContain("2.24B USD");
    expect(host!.textContent).toContain("historical_only");
    const usd = [...host!.querySelectorAll("button")].find((button) => button.textContent === "USD+5%") as HTMLButtonElement;
    await act(async () => { usd.click(); });
    expect(host!.textContent).toContain("foreign_revenue_share_missing_or_invalid");
    const credit = [...host!.querySelectorAll("button")].find((button) => button.textContent === "CREDIT+100 bp") as HTMLButtonElement;
    await act(async () => { credit.click(); });
    expect(host!.textContent).toContain("new_issuance_spread_maturity_and_rating_missing");
  });
});
