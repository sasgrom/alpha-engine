import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cameThroughProxy, perimeterRefusal, recordSecurityEvent, securityHeaders, trustedClientIp } from "./perimeter";

const folder = mkdtempSync(path.join(tmpdir(), "perimeter-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const headers = (values: Record<string, string>) => new Headers(values);
const proxied = { "x-forwarded-for": "100.82.217.81", "x-forwarded-host": "alpha-desk.tail4e6355.ts.net", host: "alpha-desk.tail4e6355.ts.net" };
const refusal = (method: string, pathName: string, values: Record<string, string>, remoteAddress: string | null = "127.0.0.1") => perimeterRefusal({ method, path: pathName, headers: headers(values), remoteAddress });

describe("the visitor's address", () => {
  it("is the entry the proxy wrote, not the one the visitor claims", () => {
    expect(trustedClientIp(headers({ "x-forwarded-for": "1.2.3.4, 100.82.217.81" }))).toBe("100.82.217.81");
    expect(trustedClientIp(headers({ "x-forwarded-for": "100.82.217.81" }))).toBe("100.82.217.81");
    expect(trustedClientIp(headers({}))).toBe("local");
  });

  it("knows a proxied request from a direct local call", () => {
    expect(cameThroughProxy(headers(proxied))).toBe(true);
    expect(cameThroughProxy(headers({ "tailscale-user-login": "a@b" }))).toBe(true);
    expect(cameThroughProxy(headers({ host: "127.0.0.1:3000" }))).toBe(false);
  });
});

describe("what the perimeter refuses", () => {
  it("refuses any connection that is not from this machine", () => {
    expect(refusal("GET", "/desk", { host: "192.168.1.20:3000" }, "192.168.1.55")).toEqual({ status: 403, reason: "not a local connection" });
    expect(refusal("GET", "/desk", { host: "127.0.0.1:3000" }, "::ffff:127.0.0.1")).toBeNull();
    expect(refusal("GET", "/desk", { host: "127.0.0.1:3000" }, "::1")).toBeNull();
    // no socket is known in tests and the dev server: nothing is refused on that ground
    expect(refusal("GET", "/desk", { host: "127.0.0.1:3000" }, null)).toBeNull();
  });

  it("keeps the machine routes for direct local calls", () => {
    expect(refusal("POST", "/api/worker/ingest", { host: "127.0.0.1:3000", authorization: "Bearer x" })).toBeNull();
    expect(refusal("POST", "/api/worker/ingest", { ...proxied, authorization: "Bearer x" })).toEqual({ status: 404, reason: "machine route through the proxy" });
    expect(refusal("POST", "/api/prices-import/chunk", proxied)?.status).toBe(404);
    expect(refusal("GET", "/api/oauth/callback", proxied)?.status).toBe(404);
    expect(refusal("GET", "/api/trpc/auth.me", proxied)).toBeNull();
  });

  it("refuses a state-changing request from another site", () => {
    expect(refusal("POST", "/api/trpc/auth.login", { ...proxied, origin: "https://alpha-desk.tail4e6355.ts.net" })).toBeNull();
    expect(refusal("POST", "/api/trpc/auth.login", { ...proxied, origin: "https://evil.example" })).toEqual({ status: 403, reason: "cross-site request" });
    expect(refusal("POST", "/api/trpc/auth.login", { ...proxied, referer: "https://evil.example/page" })?.reason).toBe("cross-site request");
    expect(refusal("POST", "/api/trpc/auth.login", { ...proxied, origin: "not a url" })).toBeNull();
    // a read is not refused on its origin; a local script without an Origin may post
    expect(refusal("GET", "/api/trpc/auth.me", { ...proxied, origin: "https://evil.example" })).toBeNull();
    expect(refusal("POST", "/api/trpc/auth.login", { host: "127.0.0.1:3000" })).toBeNull();
    expect(refusal("POST", "/api/trpc/auth.login", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })).toBeNull();
  });
});

describe("headers and the event log", () => {
  it("always sends the content policy and sends strict transport only through the proxy", () => {
    const direct = securityHeaders(headers({ host: "127.0.0.1:3000" }));
    expect(direct["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(direct["Content-Security-Policy"]).toContain("script-src 'self'");
    expect(direct["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders(headers(proxied))["Strict-Transport-Security"]).toMatch(/max-age=31536000/);
  });

  it("writes one line per event and cuts a long detail", () => {
    const file = path.join(folder, "nested", "events.jsonl");
    recordSecurityEvent({ kind: "refused", ip: "1.2.3.4", path: "/api/worker/ingest", detail: "x".repeat(500) }, file);
    recordSecurityEvent({ kind: "login_failed", ip: "1.2.3.4" }, file);
    const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "refused", ip: "1.2.3.4", path: "/api/worker/ingest" });
    expect(lines[0].detail).toHaveLength(200);
    expect(lines[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
