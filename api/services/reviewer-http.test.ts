import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_FILE_POLICY } from "@contracts/report-files";
import { authenticateSession as authenticateRequest } from "./sessions";
import { getReviewerAccess } from "./reviewer-access";
import { reviewerReportAccess, reviewerSecurityHeaders } from "./reviewer-http";

vi.mock("./sessions", () => ({ authenticateSession: vi.fn() }));
vi.mock("./reviewer-access", () => ({ getReviewerAccess: vi.fn() }));

const ownerReports = Object.entries(REPORT_FILE_POLICY).filter(([, policy]) => policy.access === "owner").map(([name]) => name);
const reviewerReports = Object.entries(REPORT_FILE_POLICY).filter(([, policy]) => policy.access === "reviewer").map(([name]) => name);

function app(): Hono {
  const value = new Hono();
  value.use("/reports/*", reviewerReportAccess);
  value.get("/reports/:name", (c) => c.text("ok"));
  return value;
}

describe("reviewer report access", () => {
  beforeEach(() => {
    vi.mocked(getReviewerAccess).mockResolvedValue({ acceptedAt: new Date("2026-11-01T00:00:00Z") } as never);
  });

  it("pins the owner-only report set, including artifacts no reviewer page reads", () => {
    expect(ownerReports).toEqual([
      "daily-operations.json", "daily-operations.md", "weekly-coverage.json", "weekly-coverage.md",
      "daily-prices-schwab.json", "universe-coverage-50.json", "data-health.json", "data-health.md",
    ]);
  });

  it("refuses every owner report to a reviewer and admits every reviewer report", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ id: 3, role: "user" } as never);
    for (const name of ownerReports) {
      const response = await app().request(`/reports/${name}`);
      expect(response.status, name).toBe(403);
    }
    for (const name of reviewerReports) {
      const response = await app().request(`/reports/${name}`);
      expect(response.status, name).toBe(200);
    }
  });

  it("admits the owner to owner and reviewer reports", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ id: 1, role: "admin" } as never);
    for (const name of [...ownerReports, ...reviewerReports]) {
      const response = await app().request(`/reports/${name}`);
      expect(response.status, name).toBe(200);
    }
  });

  it("still requires the NDA before a reviewer can read any report", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ id: 3, role: "user" } as never);
    vi.mocked(getReviewerAccess).mockResolvedValue(null as never);
    expect((await app().request("/reports/schwab-context.json")).status).toBe(403);
  });
});

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
