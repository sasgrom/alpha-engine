/**
 * The server's outer guards (2026-11-24, owner: "lets put our defences up"). The desk is served from the home
 * machine and reached through one trusted proxy on the same machine (Tailscale serve). These rules assume exactly
 * that and refuse the rest:
 *   loopback only     a connection whose socket is not this machine is refused: nothing on the home or any other
 *                     network talks to port 3000 directly
 *   machine routes    the worker's ingest and the old OAuth callback answer only to a direct local call, never to a
 *                     request that came through the proxy
 *   same origin       a state-changing request that names an Origin must name this site (cross-site request forgery)
 *   headers           strict transport, a content-security policy, no framing, no sniffing, no referrer
 *   client address    the address the proxy itself wrote, not one the visitor can put in a header
 * Every refusal is written to worker/.runs/security-events.jsonl (never a password, a cookie or a token).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Context, Next } from "hono";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
/** Routes for local machines only (prefix match). */
export const MACHINE_ROUTES = ["/api/worker/", "/api/oauth/"];

/** True when the request came through the proxy (it adds these), false for a direct local call. */
export function cameThroughProxy(headers: Headers): boolean {
  return headers.has("x-forwarded-for") || headers.has("x-forwarded-host") || headers.has("tailscale-user-login") || headers.has("cf-connecting-ip");
}

/**
 * The visitor's address as the trusted proxy saw it. A proxy appends the address it saw to whatever the visitor sent,
 * so the last entry is the proxy's own and the earlier ones are the visitor's claim. A direct local call is "local".
 */
export function trustedClientIp(headers: Headers): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded.at(-1) ?? "local";
}

/** The host of an Origin or Referer value; null when it is absent or unreadable. */
function hostOf(value: string | null): string | null {
  if (!value) return null;
  try { return new URL(value).host.toLowerCase(); } catch { return null; }
}

/** Why a request is refused, or null when it may pass. Pure: the middleware below only adds the socket. */
export function perimeterRefusal(input: { method: string; path: string; headers: Headers; remoteAddress: string | null }): { status: 403 | 404; reason: string } | null {
  if (input.remoteAddress !== null && !LOOPBACK.has(input.remoteAddress)) return { status: 403, reason: "not a local connection" };
  const proxied = cameThroughProxy(input.headers);
  if (proxied && (MACHINE_ROUTES.some((prefix) => input.path.startsWith(prefix)) || input.path.includes("/oauth/callback"))) return { status: 404, reason: "machine route through the proxy" };
  if (!["GET", "HEAD", "OPTIONS"].includes(input.method.toUpperCase())) {
    const origin = hostOf(input.headers.get("origin"));
    const host = (input.headers.get("x-forwarded-host") ?? input.headers.get("host") ?? "").toLowerCase();
    if (origin !== null && origin !== host) return { status: 403, reason: "cross-site request" };
    // a browser always names the Origin on a cross-site POST; a proxied POST without one and with a foreign Referer is refused too
    const referer = hostOf(input.headers.get("referer"));
    if (proxied && origin === null && referer !== null && referer !== host) return { status: 403, reason: "cross-site request" };
  }
  return null;
}

const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  "connect-src 'self' blob: data:", "worker-src 'self' blob:", "media-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = { "Content-Security-Policy": CSP, "X-DNS-Prefetch-Control": "off", "Origin-Agent-Cluster": "?1" };
  // only where the visitor is on HTTPS (through the proxy): a local http call must not be told to upgrade
  if (cameThroughProxy(headers)) result["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return result;
}

export function securityEventsFile(): string {
  return path.resolve(process.cwd(), "worker/.runs/security-events.jsonl");
}

/** One line per event: what, when, from where. Never a secret. A failed write must not fail the request. */
export function recordSecurityEvent(event: { kind: string; ip: string; path?: string; detail?: string }, file: string = securityEventsFile()): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...event, detail: event.detail?.slice(0, 200) }) + "\n");
  } catch { /* the guard still refuses; only the note is lost */ }
}

/** The middleware: refuse what the rules refuse, add the headers to everything else. */
export async function perimeter(c: Context, next: Next) {
  const headers = c.req.raw.headers;
  const remoteAddress = ((c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress) ?? null;
  const refusal = perimeterRefusal({ method: c.req.method, path: c.req.path, headers, remoteAddress });
  if (refusal) {
    recordSecurityEvent({ kind: "refused", ip: remoteAddress && !LOOPBACK.has(remoteAddress) ? remoteAddress : trustedClientIp(headers), path: c.req.path, detail: refusal.reason });
    return c.json({ error: refusal.status === 404 ? "Not Found" : "Forbidden" }, refusal.status);
  }
  for (const [name, value] of Object.entries(securityHeaders(headers))) c.header(name, value);
  await next();
}
