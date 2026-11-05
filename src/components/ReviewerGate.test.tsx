// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import ReviewerGate from "./ReviewerGate";

const mocks = vi.hoisted(() => ({
  user: { id: 42, role: "user", name: "Reviewer" },
  status: { data: null as unknown, isLoading: false, isError: false },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useReviewer", () => ({
  useReviewer: () => ({ status: mocks.status, acceptNda: { mutate: vi.fn() }, tourAction: { mutate: vi.fn() } }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const defaultTours = [
  { track: "geography", currentStep: 0, status: "not_started" },
  { track: "technical", currentStep: 0, status: "not_started" },
];

describe("Reviewer access gate", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(() => {
    mocks.user = { id: 42, role: "user", name: "Reviewer" };
    mocks.status.data = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it("shows NDA instead of content until accepted", async () => {
    mocks.status.data = { isReviewer: true, ndaAccepted: false, tours: [] };
    await act(async () => { root!.render(<MemoryRouter><ReviewerGate><div>Secret research</div></ReviewerGate></MemoryRouter>); });
    expect(host!.textContent).toContain("Confidential research preview");
    expect(host!.textContent).not.toContain("Secret research");
  });

  it("unlocks the presentation after NDA acceptance", async () => {
    mocks.status.data = { isReviewer: true, ndaAccepted: true, tours: [{ track: "technical", currentStep: 0, status: "completed" }, { track: "geography", currentStep: 0, status: "completed" }] };
    await act(async () => { root!.render(<MemoryRouter><ReviewerGate><div>Secret research</div></ReviewerGate></MemoryRouter>); });
    expect(host!.textContent).toContain("Secret research");
    expect(host!.textContent).not.toContain("Confidential research preview");
  });

  it("renders children without reviewer controls for an authenticated admin", async () => {
    mocks.user = { id: 1, role: "admin", name: "Admin" };
    mocks.status.data = { isReviewer: false, ndaAccepted: false, tours: defaultTours };
    await act(async () => { root!.render(<MemoryRouter><ReviewerGate><div>Secret research</div></ReviewerGate></MemoryRouter>); });
    expect(host!.textContent).toContain("Secret research");
    expect(host!.textContent).not.toContain("Two ways to explore");
    expect(host!.querySelector(".reviewer-tour-backdrop")).toBeNull();
    expect(host!.textContent).not.toContain("Confidential research preview");
  });

  it("keeps the tour for a reviewer with not_started tracks", async () => {
    mocks.status.data = { isReviewer: true, ndaAccepted: true, tours: defaultTours };
    await act(async () => { root!.render(<MemoryRouter><ReviewerGate><div>Secret research</div></ReviewerGate></MemoryRouter>); });
    expect(host!.textContent).toContain("Secret research");
    expect(host!.textContent).toContain("Two ways to explore");
    expect(host!.querySelector(".reviewer-tour-backdrop")).not.toBeNull();
  });
});
