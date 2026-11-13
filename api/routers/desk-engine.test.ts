import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";

const index = { schemaVersion: 1, companies: [] };

vi.mock("../services/engine-flow-files", () => ({
  readEngineFlowFile: vi.fn((relative: string) => (relative === "index.json" ? index : { file: relative })),
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

describe("desk engine flow: the owner only", () => {
  it("serves the owner the index and a company's file", async () => {
    await expect(caller({ id: 1, role: "admin" }).desk.engineIndex()).resolves.toEqual(index);
    await expect(caller({ id: 1, role: "admin" }).desk.engineCompany({ cik: 320193 })).resolves.toEqual({ file: "company/320193.json" });
  });

  it("refuses members, reviewers and anonymous readers", async () => {
    await expect(caller({ id: 7, role: "user" }).desk.engineIndex()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller({ id: 7, role: "user" }, { acceptedAt: new Date("2026-11-01T00:00:00Z") }).desk.engineCompany({ cik: 320193 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).desk.engineIndex()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("takes a whole positive number as the CIK, so a request cannot name another file", async () => {
    await expect(caller({ id: 1, role: "admin" }).desk.engineCompany({ cik: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller({ id: 1, role: "admin" }).desk.engineCompany({ cik: "../../.env" as unknown as number })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
