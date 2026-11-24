import type { Context, Next } from "hono";
import { REPORT_FILE_POLICY } from "@contracts/report-files";
import { authenticateSession } from "./sessions";
import { getReviewerAccess } from "./reviewer-access";

/** Enforce NDA on direct report URLs as well as the React shell. */
export async function reviewerReportAccess(c: Context, next: Next) {
  const user = await authenticateSession(c.req.raw.headers).catch(() => null);
  if (!user) return c.json({ error: "Authentication required" }, 401);
  if (user.role !== "admin") {
    const access = await getReviewerAccess(user.id);
    if (!access?.acceptedAt) return c.json({ error: "NDA required" }, 403);
    const name = c.req.path.startsWith("/reports/") ? c.req.path.slice("/reports/".length) : "";
    if (REPORT_FILE_POLICY[name]?.access === "owner") return c.json({ error: "Owner access required" }, 403);
  }
  return next();
}

/** Anti-indexing and safe transport defaults; these are not anti-screenshot claims. */
export async function reviewerSecurityHeaders(c: Context, next: Next) {
  const path = c.req.path;
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (path.startsWith("/api/") || path.startsWith("/reports/")) c.header("Cache-Control", "private, no-store");
  await next();
}
