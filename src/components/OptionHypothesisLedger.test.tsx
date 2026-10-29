// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import OptionHypothesisLedger from "./OptionHypothesisLedger";
import { latestEvidence, optionHypotheses } from "@/data/option-hypotheses";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("OptionHypothesisLedger", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<OptionHypothesisLedger />);
    });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("keeps a complete, uniquely identified evidence registry", () => {
    expect(optionHypotheses).toHaveLength(12);
    expect(new Set(optionHypotheses.map((item) => item.id)).size).toBe(12);
    expect(optionHypotheses.find((item) => item.id === "atm-iv")?.evidence).toHaveLength(2);
    for (const hypothesis of optionHypotheses) {
      expect(hypothesis.formula.length).toBeGreaterThan(0);
      expect(hypothesis.hypothesis.length).toBeGreaterThan(20);
      expect(hypothesis.evidence.length).toBeGreaterThan(0);
      expect(latestEvidence(hypothesis).summary.length).toBeGreaterThan(20);
    }
  });

  it("filters by category and restores the full ledger", () => {
    expect(host!.querySelectorAll("tbody tr")).toHaveLength(12);
    const select = host!.querySelector<HTMLSelectElement>('select[aria-label="Filter hypotheses by category"]')!;
    act(() => {
      select.value = "Positioning";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host!.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(host!.querySelectorAll("article")).toHaveLength(4);
    const reset = [...host!.querySelectorAll("button")].find((button) => button.textContent === "Reset filters")!;
    act(() => { reset.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host!.querySelectorAll("tbody tr")).toHaveLength(12);
  });

  it("filters by evidence status, searches and handles an empty result", () => {
    const status = host!.querySelector<HTMLSelectElement>('select[aria-label="Filter hypotheses by evidence status"]')!;
    act(() => {
      status.value = "blocked";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host!.querySelectorAll("tbody tr")).toHaveLength(3);
    const search = host!.querySelector<HTMLInputElement>('input[aria-label="Search option hypotheses"]')!;
    act(() => { setInput(search, "earnings"); });
    expect(host!.querySelectorAll("tbody tr")).toHaveLength(1);
    act(() => { setInput(search, "no-such-hypothesis"); });
    expect(host!.querySelector("tbody")).toBeNull();
    expect(host!.textContent).toContain("No hypotheses match these filters");
    const clear = [...host!.querySelectorAll("button")].find((button) => button.textContent === "Clear filters")!;
    act(() => { clear.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host!.querySelectorAll("tbody tr")).toHaveLength(12);
  });
});
