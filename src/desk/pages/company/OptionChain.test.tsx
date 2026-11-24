// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "../../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
});

const dialog = () => document.querySelector("[role=dialog]");
const rows = () => [...(dialog()?.querySelectorAll("[data-option-chain] tbody tr") ?? [])].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim()));
const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
};
const button = (label: string, within: ParentNode) => [...within.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);

describe("the option chain on the company page, for the owner", () => {
  it("opens the latest chain with calls and puts around each strike near the money, and marks the strike at the price", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Open the option chain");
    expect(desk.calls).not.toContain("desk.companyOptionChain");
    await click(button("Open the option chain", desk.host));
    await waitUntil(() => rows().length > 0);
    expect(dialog()!.textContent).toContain("Captured Nov 24, 2026 at 00:47 UTC, with the share at $349.48. A snapshot, not a live quote.");
    // within 15% of 349.48: the strikes of 250 and 450 wait behind "All 5 strikes"
    expect(rows().map((row) => row[6])).toEqual(["345", "350", "355"]);
    // calls: open interest, volume, volatility, delta, bid, ask | strike | puts: bid, ask, delta, volatility, volume, open interest
    expect(rows()[0]).toEqual(["3.4K", "120", "26.6%", "0.63", "11.00", "11.40", "345", "0.40", "0.80", "−0.37", "26.6%", "120", "3.4K"]);
    expect([...dialog()!.querySelectorAll("[data-at-money]")].map((row) => row.querySelectorAll("td")[6].textContent)).toEqual(["350"]);
    await click(button("All 5 strikes", dialog()!));
    expect(rows().map((row) => row[6])).toEqual(["250", "345", "350", "355", "450"]);
    // a strike with a put and no call
    expect(rows()[4].slice(0, 6)).toEqual(["—", "—", "—", "—", "—", "—"]);
  });

  it("reads another expiration when it is chosen", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Open the option chain");
    await click(button("Open the option chain", desk.host));
    await waitUntil(() => rows().length > 0);
    const select = dialog()!.querySelector("select[aria-label=Expiration]") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Nov 27, 2026 · 3 days", "Dec 18, 2026 · 24 days"]);
    expect(select.value).toBe("2026-12-18");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "2026-11-27");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitUntil(() => rows().length === 1);
    expect(rows()[0][6]).toBe("350");
    expect(dialog()!.textContent).toContain("2 contracts");
  });
});
