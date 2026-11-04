// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ReviewerGate from "./ReviewerGate";

const mocks = vi.hoisted(() => ({ status: { data: null as unknown, isLoading: false, isError: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 42, role: "user", name: "Reviewer" } }) }));
vi.mock("@/hooks/useReviewer", () => ({
  useReviewer: () => ({ status: mocks.status, acceptNda: { mutate: vi.fn() }, tourAction: { mutate: vi.fn() } }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Reviewer access gate", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it("shows NDA instead of content until accepted", async () => {
    mocks.status.data = { isReviewer: true, ndaAccepted: false, tours: [] };
    await act(async () => { root!.render(<ReviewerGate><div>Secret research</div></ReviewerGate>); });
    expect(host!.textContent).toContain("Confidential research preview");
    expect(host!.textContent).not.toContain("Secret research");
  });

  it("unlocks the presentation after NDA acceptance", async () => {
    mocks.status.data = { isReviewer: true, ndaAccepted: true, tours: [{ track: "technical", currentStep: 0, status: "completed" }, { track: "geography", currentStep: 0, status: "completed" }] };
    await act(async () => { root!.render(<ReviewerGate><div>Secret research</div></ReviewerGate>); });
    expect(host!.textContent).toContain("Secret research");
    expect(host!.textContent).not.toContain("Confidential research preview");
  });
});
