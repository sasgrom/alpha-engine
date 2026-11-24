// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { FACTOR_META } from "../../../../api/services/factor-meta";
import { mountDesk, type MountedDesk } from "../../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk Library documents for a member", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("reaches the wiki from the Library without owner build notes", async () => {
    desk = await mountDesk("user", "/desk/research/library", "Research · methods, full records and tools");
    expect(desk.host.querySelector('a[href="/desk/research/library/factors"]')).not.toBeNull();
    expect(desk.host.querySelector('a[href="/desk/research/library/volatility-handbook"]')).toBeNull();
    desk.unmount();
    desk = null;

    desk = await mountDesk("user", "/desk/research/library/factors", "Factor wiki");
    expect(desk.host.querySelectorAll(".desk-factor-entry")).toHaveLength(FACTOR_META.length);
    expect(desk.host.querySelector(".desk-devnotes")).toBeNull();
  });

  it("sends a member away from the handbook", async () => {
    desk = await mountDesk("user", "/desk/research/library/volatility-handbook");
    expect(desk.host.textContent).not.toContain("Volatility before direction.");
    expect(desk.host.querySelector(".desk-handbook-section")).toBeNull();
  });

  it("redirects the classic wiki and preserves the factor anchor", async () => {
    desk = await mountDesk("user", "/wiki#accruals", "Factor wiki", true);
    expect(desk.host.querySelector("#accruals")).not.toBeNull();
    expect(desk.host.textContent).toContain("Accruals (NI−CFO)/Assets");
  });
});
