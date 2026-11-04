// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ReviewerNdaGate from "./ReviewerNdaGate";

const mocks = vi.hoisted(() => ({ accept: vi.fn(), logout: vi.fn() }));
vi.mock("@/hooks/useReviewer", () => ({
  useReviewer: () => ({ acceptNda: { mutate: mocks.accept, isPending: false, isError: false } }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ logout: mocks.logout }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Reviewer NDA gate", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it("requires an explicit NDA acceptance and records it only on agreement", async () => {
    await act(async () => { root!.render(<ReviewerNdaGate />); });
    expect(host!.textContent).toContain("Confidential research preview");
    expect(host!.textContent).toContain("For academic review and discussion with Dr. Larry Souza only.");
    expect(mocks.accept).not.toHaveBeenCalled();
    const agree = [...host!.querySelectorAll("button")].find((button) => button.textContent === "I agree")!;
    await act(async () => { agree.click(); });
    expect(mocks.accept).toHaveBeenCalledTimes(1);
  });

  it("declines by signing out without recording consent", async () => {
    await act(async () => { root!.render(<ReviewerNdaGate />); });
    const decline = [...host!.querySelectorAll("button")].find((button) => button.textContent === "Decline and sign out")!;
    await act(async () => { decline.click(); });
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});
