// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mountDesk, REPORTS, waitUntil, type MountedDesk } from "../../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The scenario engine runs on real report shapes: the fixtures of the engine's own tests, and the two evidence reports
// the builders write (as the classic page's test read them).
beforeAll(() => {
  const fixture = (name: string) => JSON.parse(readFileSync(`src/test-fixtures/${name}`, "utf8")) as unknown;
  const built = (name: string) => JSON.parse(readFileSync(`public/reports/${name}`, "utf8")) as unknown;
  REPORTS["macro-scenarios.json"] = fixture("macro-scenarios.json");
  REPORTS["shock-calibration.json"] = fixture("shock-calibration.json");
  REPORTS["exposure-latest.json"] = fixture("exposure-latest.json");
  REPORTS["macro-transmission-atlas.json"] = fixture("macro-transmission-atlas.json");
  REPORTS["pilot-exposure-evidence.json"] = built("pilot-exposure-evidence.json");
  REPORTS["company-exposures.json"] = built("company-exposures.json");
});

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
});

const text = () => desk!.host.textContent ?? "";
const rowOf = (ticker: string) => [...desk!.host.querySelectorAll("[data-scenario-impacts] tbody tr")].find((row) => row.querySelector("td")?.textContent === ticker) as HTMLTableRowElement;
const cell = (ticker: string, index: number) => rowOf(ticker).querySelectorAll("td")[index].textContent ?? "";
/** "+$12.34M a year" → 12.34e6 */
const dollars = (value: string) => { const match = value.match(/([−+])?\$([\d.]+)([KMBT])/)!; return (match[1] === "−" ? -1 : 1) * Number(match[2]) * { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[3] as "K" | "M" | "B" | "T"]; };
const press = async (label: string) => {
  const button = [...desk!.host.querySelectorAll("button")].find((item) => item.textContent?.trim().startsWith(label));
  expect(button, label).toBeTruthy();
  await act(async () => { (button as HTMLElement).click(); });
};
const open = () => mountDesk("admin", "/desk/research/macro?view=scenarios", "By company");

describe("the scenario view of the desk Macro page", () => {
  it("recomputes every company when the size of the move changes", async () => {
    desk = await open();
    await waitUntil(() => !!rowOf("RCL"));
    expect(desk.host.querySelector(".desk-seg [aria-pressed=true]")?.textContent).toBe("Scenarios");
    expect(cell("RCL", 2)).toBe("Interest cost a year, at most");
    const before = dollars(cell("RCL", 3));
    expect(before).toBeGreaterThan(0);
    const input = desk.host.querySelector('input[aria-label="Size of the move in basis points"]') as HTMLInputElement;
    expect(input.value).toBe("100");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "200");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dollars(cell("RCL", 3)) / before).toBeCloseTo(2, 1);
    expect(text()).toContain("Rates +200 bp");
  });

  it("offers round sizes and the sizes of the series' own days, and shows the baseline before and after", async () => {
    desk = await open();
    await waitUntil(() => !!rowOf("RCL"));
    const presets = [...desk.host.querySelectorAll(".desk-scenario-presets button")].map((button) => button.textContent ?? "");
    expect(presets.slice(0, 3)).toEqual(["+50 bp", "+100 bp", "+200 bp"]);
    expect(presets.slice(3).map((label) => label.replace(/ [+−][\d.]+ bp$/, ""))).toEqual(["Typical day", "1 day in 10", "1 day in 100"]);
    expect(text()).toContain("10-year Treasury yield:");
    expect(text()).toContain("after the move.");
    await press("+50 bp");
    expect(text()).toContain("Rates +50 bp");
  });

  it("opens the evidence of a company: the formula, the reasons, the filings and how the share has reacted", async () => {
    desk = await open();
    await waitUntil(() => !!rowOf("RCL"));
    await act(async () => { rowOf("RCL").click(); });
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.getAttribute("aria-label")).toBe("RCL: rates +100 bp");
    expect(dialog.textContent).toContain("An upper bound, not a forecast.");
    expect(dialog.textContent).toContain("assumes immediate full repricing of exposed debt");
    expect(dialog.textContent).toContain("Hedge share unknown upper bound");
    expect(dialog.textContent).toContain("How the share has reacted to such moves");
    expect(dialog.textContent).toContain("empirical event/horizon distribution, not a confidence interval or forecast");
  });

  it("keeps gross exposures, old evidence and missing figures apart in the other channels", async () => {
    desk = await open();
    await waitUntil(() => !!rowOf("RCL"));
    await press("Oil");
    expect(text()).toContain("Fuel cost, before hedges");
    expect(text()).toContain("Old evidence only");
    await press("Dollar");
    expect(text()).toContain("Foreign revenue share missing or invalid");
    await press("Credit spreads");
    expect(text()).toContain("Refinancing cost a year, at most");
    expect(text()).toContain("Next twelve month debt maturities missing");
    // the status filter narrows the list to what it names
    const select = desk.host.querySelector('select[aria-label="Evidence status"]') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "not_computable");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const statuses = new Set([...desk.host.querySelectorAll("[data-scenario-impacts] tbody tr")].map((row) => row.querySelectorAll("td")[1].textContent));
    expect([...statuses]).toEqual(["No figure"]);
  });
});

describe("the classic scenario lab", () => {
  it("opens the scenario view of the desk Macro page", async () => {
    desk = await mountDesk("admin", "/scenario-lab", "By company", true);
    expect(desk.host.querySelector(".desk-seg [aria-pressed=true]")?.textContent).toBe("Scenarios");
  });
});
