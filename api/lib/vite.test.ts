import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStaticFiles } from "./vite";

function app() {
  const instance = new Hono<{ Bindings: HttpBindings }>();
  instance.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));
  serveStaticFiles(instance);
  return instance;
}

describe("production static and SPA fallback", () => {
  it("serves the SPA for a direct presentation route with HTML accept", async () => {
    const response = await app().fetch(new Request("http://127.0.0.1/project-state", { headers: { accept: "text/html" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('<div id="root">');
  });

  it("keeps an unknown API route as a real JSON 404", async () => {
    const response = await app().fetch(new Request("http://127.0.0.1/api/unknown", { headers: { accept: "text/html" } }));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Not Found" });
  });
});
