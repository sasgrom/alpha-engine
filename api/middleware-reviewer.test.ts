import { describe, expect, it } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { authedQuery, createRouter } from "./middleware";

const router = createRouter({
  check: authedQuery.query(() => ({ ok: true })),
  change: authedQuery.mutation(() => ({ ok: true })),
});

function request(options: { path: string; method?: string; reviewer: boolean; accepted: boolean }) {
  const user = { id: 42, role: "user", unionId: "local:reviewer", username: "reviewer", name: "Reviewer" };
  const access = options.reviewer ? { userId: 42, firstIpHash: "hash", ndaVersion: "2026-11-04", acceptedAt: options.accepted ? new Date() : null } : null;
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${options.path}`, {
      method: options.method ?? (options.path === "change" ? "POST" : "GET"),
      headers: options.path === "change" ? { "content-type": "application/json" } : undefined,
      body: options.path === "change" ? "{}" : undefined,
    }),
    router,
    createContext: async () => ({ req: new Request("http://localhost"), resHeaders: new Headers(), user: user as never, reviewerAccess: access as never, viewAsUserId: null }),
  });
}

describe("reviewer NDA and read-only middleware", () => {
  it("rejects content before NDA acceptance and allows it afterwards", async () => {
    const pending = await request({ path: "check", reviewer: true, accepted: false });
    expect(pending.status).toBe(403);
    const accepted = await request({ path: "check", reviewer: true, accepted: true });
    expect(accepted.status).toBe(200);
  });

  it("blocks every reviewer mutation even after NDA acceptance", async () => {
    const response = await request({ path: "change", reviewer: true, accepted: true });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("read-only");
  });

  it("does not change behavior for a regular user without reviewer profile", async () => {
    const response = await request({ path: "check", reviewer: false, accepted: false });
    expect(response.status).toBe(200);
  });
});
