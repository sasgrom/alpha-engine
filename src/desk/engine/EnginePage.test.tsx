// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "../desk-test-harness";
import { ENGINE_COMPANY } from "./engine-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: MountedDesk | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const click = async (element: Element | null | undefined) => {
  if (!element) throw new Error("Nothing to click");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((element) => (element.textContent ?? "").trim() === text || element.getAttribute("aria-label") === text);
const percent = (p: number) => `${(100 * p).toFixed(2)}%`;
const engineP = (date: string) => ENGINE_COMPANY.decisions.find((d) => d.date === date && d.kind === "release")!.trace["10"].p.graded;

describe("the Engine page, for the owner", () => {
  it("walks the decisions through the seven steps, and every worked example agrees with the engine's own numbers", async () => {
    mounted = await mountDesk("admin", "/desk/engine?ticker=TEST", "Raw fundamentals and prices");
    const { host, calls } = mounted;
    const text = () => host.textContent ?? "";
    await waitUntil(() => text().includes("4 of 4"));
    expect(calls).toContain("desk.engineIndex");
    expect(calls).toContain("desk.engineCompany");
    for (const title of ["Raw fundamentals and prices", "Readings: the processed data", "The algorithm: from a reading to a forecast", "Track record: e+ and e−", "Probabilities: Bayes from the usual rate", "Decision tree: how a probability becomes a trade", "Test results and benchmarks"]) expect(text()).toContain(title);
    expect(text()).toContain("TEST: 4 release decisions and 1 10-Q/10-K decisions.");
    // the latest decision is past the sealed line: its forecast shows, its outcome does not
    expect(text()).toContain("Decisions from Jul 1, 2026 on are sealed");
    expect(text()).toContain("taken; its result is sealed");
    expect(text()).not.toContain("Had it traded long");
    await click(button(host, "Previous decision"));
    await waitUntil(() => text().includes("3 of 4"));
    // the latest scored release decision: the engine leans down far enough to sell the company against its fund
    expect(text()).toContain(`usual rate 50.00% → engine ${percent(engineP("2024-08-01"))}`);
    expect(text()).toContain("→ sell against the fund");
    expect(text()).toContain(`✓ the engine's ${percent(engineP("2024-08-01"))}`);
    // no worked example disagrees with what the engine computed
    expect(text()).not.toContain("≠");
    expect(text()).toContain("−0.12 per 1000 over all companies at 10 sessions");
    // moving through the decisions: one without a lean, one that buys
    await click(button(host, "First decision"));
    await waitUntil(() => text().includes("1 of 4"));
    expect(text()).toContain("lean 0.00 pts → no trade");
    await click(button(host, "Next decision"));
    await waitUntil(() => text().includes("2 of 4"));
    expect(text()).toContain("→ buy against the fund");
    expect(text()).not.toContain("≠");
    // the filing decision: the filed figures and the revenue example, checked against the engine's reading
    await click(button(host, "After the 10-Q/10-K"));
    await waitUntil(() => text().includes("1 of 1"));
    expect(text()).toContain("Revenue growth = $105.00bn / $100.00bn − 1 = +0.0500");
    expect(text()).toContain("✓ the engine's +0.0500");
  });

  it("opens a step's notes: hypothesis, process, why, expectations, formulas, improvements and ideas", async () => {
    mounted = await mountDesk("admin", "/desk/engine?ticker=TEST", "Raw fundamentals and prices");
    const { host } = mounted;
    const text = () => host.textContent ?? "";
    await waitUntil(() => text().includes("4 of 4"));
    const notes = [...host.querySelectorAll("button")].filter((element) => element.textContent === "Notes");
    expect(notes.length).toBe(7);
    await click(notes[4]);
    for (const heading of ["Hypothesis", "Process used", "Why this choice", "What to expect", "Formulas and principles", "Worked example", "What can be done better", "Other ideas, outside the box"]) expect(text()).toContain(heading);
    expect(text()).toContain("logit(p) = logit(usual rate) + Σ kept / k");
    // zooming into a step shows it alone
    await click(button(host, "Zoom into this step"));
    await waitUntil(() => text().includes("Show all steps"));
    expect(host.querySelectorAll(".eng-card").length).toBe(1);
  });
});
