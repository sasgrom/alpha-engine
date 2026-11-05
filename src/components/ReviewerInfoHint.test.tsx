// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewerGuideProvider } from "@/hooks/useReviewerGuide";
import { REVIEWER_NAV_GUIDE } from "@/content/reviewer-guide";
import ReviewerInfoHint from "./ReviewerInfoHint";

const hoverState = vi.hoisted(() => ({ capable: true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rect = (top: number, left: number, width: number, height: number) => ({
  top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => ({}),
}) as DOMRect;

describe("Reviewer evidence information", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    hoverState.capable = true;
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: hoverState.capable, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    document.querySelectorAll(".reviewer-guide-popover,.reviewer-guide-focus").forEach((node) => node.remove());
    root = null;
    host = null;
  });

  const render = async () => {
    await act(async () => {
      root!.render(
        <ReviewerGuideProvider userId={42}>
          <div data-guide-block style={{ width: 500, height: 240 }}>
            <ReviewerInfoHint id="tile:test" content={REVIEWER_NAV_GUIDE["/analytics"]} />
          </div>
        </ReviewerGuideProvider>,
      );
    });
    return host!.querySelector<HTMLButtonElement>("[data-reviewer-info='tile:test']")!;
  };

  it("opens detailed guidance on desktop hover and blurs only the surrounding screen", async () => {
    const button = await render();
    Object.assign(window, { innerWidth: 1440, innerHeight: 800 });
    host!.querySelector<HTMLElement>("[data-guide-block]")!.getBoundingClientRect = () => rect(300, 100, 600, 300);
    button.getBoundingClientRect = () => rect(310, 646, 44, 44);
    await act(async () => { button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    expect(document.querySelector(".reviewer-guide-popover")?.textContent).toContain("CALCULATION PATH / FORMULA");
    expect(document.querySelector(".reviewer-guide-popover")?.textContent).toContain("Spearman");
    expect(document.querySelectorAll(".reviewer-guide-focus > div")).toHaveLength(4);
    const popover = document.querySelector<HTMLElement>(".reviewer-guide-popover")!;
    expect(popover.style.top).toBe("362px");
    expect(popover.style.left).toBe("260px");
    expect(popover.style.maxHeight).toBe("426px");
    const connector = document.querySelector<HTMLElement>(".reviewer-guide-connector")!;
    expect(connector.style.left).toBe("690px");
    expect(connector.style.height).toBe("8px");
    const labels = [...document.querySelectorAll(".reviewer-guide-popover dt")].map((node) => node.textContent);
    expect(labels.slice(0, 4)).toEqual(["HOW TO USE IT", "HYPOTHESIS & LIMITS", "WHAT IT REPRESENTS", "WHY THIS TILE EXISTS"]);
    await act(async () => { button.click(); });
    expect(document.querySelector(".reviewer-guide-popover")).not.toBeNull();
    await act(async () => { document.querySelector<HTMLButtonElement>("button[aria-label='Close information']")!.click(); });
    expect(document.querySelector(".reviewer-guide-popover")).toBeNull();
  });

  it("opens and closes on tap when hover is unavailable", async () => {
    hoverState.capable = false;
    const button = await render();
    await act(async () => { button.click(); });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".reviewer-guide-popover")?.textContent).toContain("HOW TO USE IT");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector(".reviewer-guide-popover")).toBeNull();
  });
});
