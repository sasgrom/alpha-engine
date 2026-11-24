// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FACTOR_META } from "../../../../api/services/factor-meta";
import { mountDesk, waitUntil, type MountedDesk } from "../../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk Library documents", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("renders the complete handbook with typeset formulas and no raw TeX delimiters", async () => {
    desk = await mountDesk("admin", "/desk/research/library/volatility-handbook", "Volatility before direction.");
    expect(desk.host.querySelectorAll(".desk-handbook-section")).toHaveLength(8);
    expect(desk.host.querySelectorAll('[role="math"]').length).toBeGreaterThan(5);
    expect(desk.host.querySelector(".desk-formula sub")).not.toBeNull();
    expect(desk.host.textContent).not.toContain("\\(");
    expect(desk.host.textContent).toContain("62.32%");
    expect(desk.host.textContent).toContain("−4.46 bps / month");
    expect(desk.host.querySelector('a[href="#expected-move"]')).not.toBeNull();
    expect(desk.host.querySelector(".desk-devnotes")).not.toBeNull();
  });

  it("searches the factor registry and links each entry to its anchor and the evidence ledger", async () => {
    desk = await mountDesk("admin", "/desk/research/library/factors", "Factor wiki");
    expect(desk.host.querySelectorAll(".desk-factor-entry")).toHaveLength(FACTOR_META.length);
    expect(desk.host.querySelector('a[href="#accruals"]')).not.toBeNull();
    expect(desk.host.querySelector('a[href="/desk/research"]')).not.toBeNull();

    const input = desk.host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(input, "Piotroski");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitUntil(() => desk!.host.querySelectorAll(".desk-factor-entry").length === 1);
    expect(desk.host.querySelector("#fScore")).not.toBeNull();
    expect(desk.host.querySelector("#accruals")).toBeNull();
  });

  it("redirects the classic handbook route", async () => {
    desk = await mountDesk("admin", "/analytics/methodology", "Volatility before direction.", true);
    expect(desk.host.querySelectorAll(".desk-handbook-section")).toHaveLength(8);
  });

  it("opens both Library cards in the desk", async () => {
    desk = await mountDesk("admin", "/desk/research/library", "Research · methods, full records and tools");
    expect(desk.host.querySelector('a[href="/desk/research/library/volatility-handbook"]')).not.toBeNull();
    expect(desk.host.querySelector('a[href="/desk/research/library/factors"]')).not.toBeNull();
    expect(desk.host.querySelector('a[href="/analytics/methodology"]')).toBeNull();
    expect(desk.host.querySelector('a[href="/wiki"]')).toBeNull();
  });
});
