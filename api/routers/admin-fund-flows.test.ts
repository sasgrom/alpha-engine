import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";

const graph = {
  funds: [{ cik: 1, name: "Fund A", tier: "fundamental" }],
  companies: [{ cik: 2, ticker: "AAA", sector: "Financials" }],
  edges: [],
  guard: null,
};

vi.mock("../services/institutional", () => ({
  fundFlowsGraph: vi.fn(async () => graph),
}));

function caller(user: unknown, reviewerAccess?: unknown) {
  return appRouter.createCaller({
    req: new Request("http://127.0.0.1/"),
    resHeaders: new Headers(),
    viewAsUserId: null,
    user: user as any,
    reviewerAccess: reviewerAccess as any,
  });
}

describe("Fund Flows presentation authorization", () => {
  it("allows an authenticated read-only presentation user", async () => {
    await expect(caller({ id: 7, role: "user" }).admin.fundFlows({ limit: 50 })).resolves.toEqual(graph);
  });

  it("requires authentication", async () => {
    await expect(caller(null).admin.fundFlows({ limit: 50 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires NDA acceptance for a reviewer profile", async () => {
    await expect(caller({ id: 7, role: "user" }, { acceptedAt: null }).admin.fundFlows({ limit: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
