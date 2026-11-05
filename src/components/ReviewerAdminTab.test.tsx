// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ReviewerAdminTab from "./ReviewerAdminTab";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  resetIp: vi.fn(),
  resetNda: vi.fn(),
  resetTour: vi.fn(),
  deleteUser: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({
      admin: {
        reviewerList: { invalidate: mocks.invalidate },
        usersList: { invalidate: mocks.invalidate },
      },
    }),
    admin: {
      reviewerList: {
        useQuery: () => ({
          data: [
            {
              userId: 42,
              username: "reviewer",
              name: "Reviewer",
              ndaAccepted: true,
              acceptedAt: "2026-11-04T00:00:00Z",
              ndaVersion: "2026-11-04",
              firstIpBound: true,
              universeSize: 50,
              tours: [],
            },
          ],
        }),
      },
      createReviewer: { useMutation: () => ({ mutate: mocks.create, isPending: false }) },
      resetReviewerFirstIp: { useMutation: () => ({ mutate: mocks.resetIp, isPending: false }) },
      resetReviewerNda: { useMutation: () => ({ mutate: mocks.resetNda, isPending: false }) },
      resetReviewerTour: { useMutation: () => ({ mutate: mocks.resetTour, isPending: false }) },
      deleteUser: { useMutation: () => ({ mutate: mocks.deleteUser, isPending: false }) },
    },
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReviewerAdminTab", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it("creates a reviewer with owner-provided credentials", async () => {
    await act(async () => { root!.render(<ReviewerAdminTab />); });
    const setInput = async (label: string, value: string) => {
      await act(async () => {
        const input = host!.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput("Reviewer username", "new_reviewer");
    await setInput("Reviewer password", "secret1");
    await setInput("Reviewer display name", "New Reviewer");
    const createButton = [...host!.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Create")!;

    await act(async () => { createButton.click(); });
    expect(mocks.create).toHaveBeenCalledWith({ username: "new_reviewer", password: "secret1", name: "New Reviewer" });
  });

  it("resets IP+NDA, NDA, tour and deletes the profile", async () => {
    await act(async () => { root!.render(<ReviewerAdminTab />); });
    const click = async (text: string) => {
      const button = [...host!.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
      await act(async () => { button.click(); });
    };
    await click("Reset IP+NDA");
    await click("Reset NDA");
    await click("Reset tour");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await click("Delete");
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.resetIp).toHaveBeenCalledWith({ userId: 42 });
    expect(mocks.resetNda).toHaveBeenCalledWith({ userId: 42 });
    expect(mocks.resetTour).toHaveBeenCalledWith({ userId: 42 });
    expect(mocks.deleteUser).toHaveBeenCalledWith({ userId: 42 });
    confirm.mockRestore();
  });
});
