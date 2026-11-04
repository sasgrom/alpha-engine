// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import PresentationOnly from "./PresentationOnly";

const mocks = vi.hoisted(() => ({ user: { id: 1, role: "user" }, status: { data: null as unknown, isLoading: false, isError: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, isLoading: false }) }));
vi.mock("@/hooks/useReviewer", () => ({ useReviewer: () => ({ status: mocks.status }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PresentationOnly", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it("allows an NDA-accepted reviewer but not an ordinary user", async () => {
    mocks.status.data = { isReviewer: true, ndaAccepted: true, tours: [] };
    await act(async () => { root!.render(<MemoryRouter><PresentationOnly><div>Presentation</div></PresentationOnly></MemoryRouter>); });
    expect(host!.textContent).toContain("Presentation");
    mocks.status.data = { isReviewer: false, ndaAccepted: false, tours: [] };
    await act(async () => { root!.render(<MemoryRouter><PresentationOnly><div>Presentation</div></PresentationOnly></MemoryRouter>); });
    expect(host!.textContent).toContain("insufficient role");
  });

  it("allows the owner admin", async () => {
    mocks.user.role = "admin";
    mocks.status.data = { isReviewer: false, ndaAccepted: false, tours: [] };
    await act(async () => { root!.render(<MemoryRouter><PresentationOnly><div>Presentation</div></PresentationOnly></MemoryRouter>); });
    expect(host!.textContent).toContain("Presentation");
    mocks.user.role = "user";
  });
});
