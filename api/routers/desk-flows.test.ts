import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";

const overview = { schemaVersion: 1, quarters: [], funds: [], companies: [] };

vi.mock("../services/fund-flows-files", () => ({
  readFundFlowsFile: vi.fn((relative: string) => (relative === "overview.json" ? overview : { file: relative })),
}));

type Context = Exclude<Parameters<typeof appRouter.createCaller>[0], (...args: never[]) => unknown>;

function caller(user: unknown, reviewerAccess?: unknown) {
  return appRouter.createCaller({
    req: new Request("http://127.0.0.1/"),
    resHeaders: new Headers(),
    viewAsUserId: null,
    user: user as Context["user"],
    reviewerAccess: reviewerAccess as Context["reviewerAccess"],
  });
}

describe("desk fund flows: every signed-in user", () => {
  it("serves the owner, members and reviewers who accepted the NDA", async () => {
    await expect(caller({ id: 1, role: "admin" }).desk.flowsOverview()).resolves.toEqual(overview);
    await expect(caller({ id: 7, role: "user" }).desk.flowsOverview()).resolves.toEqual(overview);
    await expect(caller({ id: 7, role: "user" }, { acceptedAt: new Date("2026-11-01T00:00:00Z") }).desk.flowsFund({ cik: 1067983 })).resolves.toEqual({ file: "fund/1067983.json" });
    await expect(caller({ id: 1, role: "admin" }).desk.flowsCompany({ cik: 320193 })).resolves.toEqual({ file: "company/320193.json" });
  });

  it("refuses reviewers without the NDA and anonymous readers", async () => {
    await expect(caller({ id: 7, role: "user" }, { acceptedAt: null }).desk.flowsFund({ cik: 1067983 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).desk.flowsCompany({ cik: 320193 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("takes a whole positive number as the CIK, so a request cannot name another file", async () => {
    await expect(caller({ id: 1, role: "admin" }).desk.flowsFund({ cik: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller({ id: 1, role: "admin" }).desk.flowsFund({ cik: 1.5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller({ id: 1, role: "admin" }).desk.flowsCompany({ cik: "../../.env" as unknown as number })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
