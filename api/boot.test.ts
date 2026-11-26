import { describe, expect, it, vi } from "vitest";

vi.mock("./services/runner", () => ({ sweepOrphanedJobs: async () => 0 }));
const { default: app } = await import("./boot");

describe("removed raw routes", () => {
  it("answers the deleted price chunk route with the JSON 404 fallback", async () => {
    const response = await app.request("http://127.0.0.1:3000/api/prices-import/chunk", { method: "POST" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
  });
});
