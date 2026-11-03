import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createKimiSession, kimiWebConfigFromEnv, kimiWebHealth, runLiveInstruction } from "./alpha-live";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static timeline: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string, public protocols: string[]) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.();
      this.onmessage?.({ data: JSON.stringify({ type: "turn.ended", payload: { status: "done" } }) });
      this.onclose?.();
    });
  }
  send(): void { FakeWebSocket.timeline.push("subscribe"); }
  close(): void { /* idempotent test close */ }
}

describe("Kimi web live bridge", () => {
  let server: Server;
  let baseUrl = "";
  const calls: { method: string; url: string; body: string; authorization: string | undefined }[] = [];
  beforeEach(async () => {
    FakeWebSocket.instances = [];
    FakeWebSocket.timeline = [];
    calls.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        FakeWebSocket.timeline.push(req.url!);
        calls.push({ method: req.method!, url: req.url!, body, authorization: req.headers.authorization });
        res.setHeader("content-type", "application/json");
        if (req.url === "/api/v1/healthz") return res.end(JSON.stringify({ code: 0, data: { ok: true } }));
        if (req.url === "/api/v1/sessions" && req.method === "POST") return res.end(JSON.stringify({ code: 0, data: { id: "session_test" } }));
        if (req.url === "/api/v1/sessions/session_test/prompts" && req.method === "POST") return res.end(JSON.stringify({ code: 0, data: {} }));
        if (req.url === "/api/v1/sessions/session_test/messages?page_size=20") return res.end(JSON.stringify({ code: 0, data: { items: [{ type: "assistant.delta", text: "hello" }] } }));
        res.statusCode = 404;
        res.end(JSON.stringify({ code: 40401, msg: "not found" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    vi.unstubAllGlobals();
  });

  it("creates a session, submits the prompt and waits for turn.ended", async () => {
    const result = await runLiveInstruction("C:\\dev\\alpha-engine", "Say hello world", { baseUrl, token: "secret-token" }) as { status: string; sessionId: string };
    expect(result.status).toBe("completed");
    expect(result.sessionId).toBe("session_test");
    expect(calls.map((call) => call.url)).toEqual(["/api/v1/sessions", "/api/v1/sessions/session_test/prompts", "/api/v1/sessions/session_test/messages?page_size=20"]);
    expect(calls[1].body).toContain("Say hello world");
    expect(calls.every((call) => call.authorization === "Bearer secret-token")).toBe(true);
    expect(FakeWebSocket.instances[0].url).toBe(`${baseUrl.replace("http://", "ws://")}/api/v1/ws`);
    expect(FakeWebSocket.instances[0].protocols).toEqual(["kimi-code.bearer.secret-token"]);
    expect(FakeWebSocket.timeline.indexOf("subscribe")).toBeLessThan(FakeWebSocket.timeline.indexOf("/api/v1/sessions/session_test/prompts"));
  });

  it("checks liveness and requires a token only for authenticated calls", async () => {
    expect(await kimiWebHealth({ baseUrl, token: "" })).toBe(true);
    expect(() => createKimiSession("/tmp/project", { baseUrl, token: "" })).toThrow("ALPHA_KIMI_WEB_TOKEN");
  });

  it("allows private HTTP only with an explicit opt-in", async () => {
    const privateUrl = baseUrl.replace("127.0.0.1", "100.64.0.1");
    let rejection: unknown;
    try { await kimiWebHealth({ baseUrl: privateUrl, token: "" }); }
    catch (error) { rejection = error; }
    expect(String(rejection)).toContain("ALPHA_KIMI_WEB_ALLOW_PRIVATE_HTTP");
    expect(await kimiWebHealth({ baseUrl, token: "", allowPrivateHttp: true })).toBe(true);
  });

  it("uses environment configuration without exposing its default token", () => {
    const config = kimiWebConfigFromEnv({});
    expect(config.baseUrl).toBe("http://127.0.0.1:58627");
    expect(config.token).toBe("");
  });
});
