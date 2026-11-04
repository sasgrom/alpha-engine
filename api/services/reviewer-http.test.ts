import { describe, expect, it, vi } from "vitest";
import { reviewerSecurityHeaders } from "./reviewer-http";

describe("reviewer security headers", () => {
  it("sets anti-indexing and no-store headers on API/report routes", async () => {
    const headers = new Map<string, string>();
    const c = { req: { path: "/reports/daily-operations.json" }, header: (name: string, value: string) => headers.set(name, value) };
    await reviewerSecurityHeaders(c as never, async () => {});
    expect(headers.get("X-Robots-Tag")).toContain("noindex");
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
