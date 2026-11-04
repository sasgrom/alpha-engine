// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ReviewerTour from "./ReviewerTour";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  status: { data: null as unknown, isLoading: false, isError: false },
}));
vi.mock("@/hooks/useReviewer", () => ({
  useReviewer: () => ({ status: mocks.status, tourAction: { mutate: mocks.action, isPending: false } }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tours = [
  { track: "geography", currentStep: 0, status: "not_started" },
  { track: "technical", currentStep: 0, status: "not_started" },
];

describe("Reviewer guided tours", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.data = { isReviewer: true, ndaAccepted: true, tours };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it("offers both presentation tracks and starts the technical tour", async () => {
    await act(async () => { root!.render(<ReviewerTour />); });
    expect(host!.textContent).toContain("Choose the presentation that fits your review.");
    const option = [...host!.querySelectorAll("button")].find((button) => button.textContent?.includes("Alpha Engine — technical briefing"))!;
    await act(async () => { option!.click(); });
    expect(mocks.action).toHaveBeenCalledWith({ track: "technical", action: "start" });
  });

  it("advances steps and supports never-show-again", async () => {
    mocks.status.data = { isReviewer: true, ndaAccepted: true, tours: [{ track: "technical", currentStep: 0, status: "in_progress" }, { track: "geography", currentStep: 0, status: "not_started" }] };
    await act(async () => { root!.render(<ReviewerTour />); });
    expect(host!.textContent).toContain("Availability before alpha");
    const next = [...host!.querySelectorAll("button")].find((button) => button.textContent === "Next")!;
    await act(async () => { next.click(); });
    expect(mocks.action).toHaveBeenCalledWith({ track: "technical", action: "next" });
    const dismiss = [...host!.querySelectorAll("button")].find((button) => button.textContent === "Never show again")!;
    await act(async () => { dismiss.click(); });
    expect(mocks.action).toHaveBeenCalledWith({ track: "technical", action: "dismiss_forever" });
  });

  it("does not show after completion or permanent dismissal", async () => {
    mocks.status.data = { isReviewer: true, ndaAccepted: true, tours: [{ track: "technical", currentStep: 0, status: "completed" }, { track: "geography", currentStep: 0, status: "dismissed_forever" }] };
    await act(async () => { root!.render(<ReviewerTour />); });
    expect(host!.textContent).not.toContain("Choose the presentation that fits your review.");
  });
});
