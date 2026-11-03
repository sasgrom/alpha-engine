import path from "node:path";

export interface KimiWebConfig { baseUrl: string; token: string; allowPrivateHttp?: boolean }
interface Envelope<T = unknown> { code?: number; msg?: string; data?: T; request_id?: string }
const jsonHeaders = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

function base(config: KimiWebConfig, websocket = false): string {
  const raw = config.baseUrl.replace(/\/$/, "");
  const loopbackHttp = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(raw);
  if (!/^https:\/\//.test(raw) && !loopbackHttp && !config.allowPrivateHttp) throw new Error("Kimi web URL must use HTTPS or loopback HTTP; set ALPHA_KIMI_WEB_ALLOW_PRIVATE_HTTP=1 only for a private Tailscale address");
  if (websocket) return raw.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return raw;
}
function token(config: KimiWebConfig): string {
  if (!config.token) throw new Error("ALPHA_KIMI_WEB_TOKEN is required for authenticated API calls");
  return config.token;
}
export function kimiWebConfigFromEnv(env = process.env): KimiWebConfig {
  return { baseUrl: env.ALPHA_KIMI_WEB_URL ?? "http://127.0.0.1:58627", token: env.ALPHA_KIMI_WEB_TOKEN ?? "", allowPrivateHttp: env.ALPHA_KIMI_WEB_ALLOW_PRIVATE_HTTP === "1" };
}
async function request<T = unknown>(config: KimiWebConfig, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base(config)}${pathname}`, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Kimi web HTTP ${response.status}: ${text.slice(0, 300)}`);
  const payload = text ? JSON.parse(text) as Envelope<T> : {} as Envelope<T>;
  if (payload.code !== undefined && payload.code !== 0) throw new Error(`Kimi web error ${payload.code}: ${payload.msg ?? "unknown"}`);
  return (payload.data ?? payload) as T;
}

/** Check unauthenticated liveness without exposing the bearer token. */
export async function kimiWebHealth(config: KimiWebConfig): Promise<boolean> {
  const data = await request<{ ok?: boolean }>(config, "/api/v1/healthz");
  return data?.ok === true;
}

/** Create one isolated session for a bounded captain instruction. */
export function createKimiSession(cwd: string, config: KimiWebConfig): Promise<string> {
  return request<Record<string, unknown>>(config, "/api/v1/sessions", {
    method: "POST",
    headers: jsonHeaders(token(config)),
    body: JSON.stringify({ metadata: { cwd: path.resolve(cwd) } }),
  }).then((data) => {
    if (typeof data?.id !== "string") throw new Error("Kimi web session response has no id");
    return data.id;
  });
}

/** Submit a prompt to an existing session; no files, Git or command-line prompt arguments are used. */
export function submitKimiPrompt(sessionId: string, instruction: string, config: KimiWebConfig): Promise<void> {
  if (!sessionId.startsWith("session_")) throw new Error("Invalid Kimi session id");
  return request(config, `/api/v1/sessions/${sessionId}/prompts`, {
    method: "POST",
    headers: jsonHeaders(token(config)),
    body: JSON.stringify({ content: [{ type: "text", text: instruction }] }),
  }).then(() => undefined);
}

/** Wait for the session's turn.ended event and preserve its payload without logging the token. */
export function waitForTurnEnded(sessionId: string, config: KimiWebConfig, timeoutMs = 600_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== "function") return reject(new Error("This Node.js runtime has no WebSocket client"));
    let settled = false;
    const ws = new WebSocket(`${base(config, true)}/api/v1/ws`, [`kimi-code.bearer.${token(config)}`]);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error(`Kimi turn timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", id: "alpha-live-1", payload: { session_ids: [sessionId] } }));
    ws.onmessage = (event) => {
      let frame: { type?: string; payload?: unknown };
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      if (frame.type !== "turn.ended") return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      resolve(frame.payload ?? frame);
    };
    ws.onerror = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      reject(new Error(`Kimi WebSocket connection failed: ${event.message || "unknown error"}`));
    };
    ws.onclose = (event) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Kimi WebSocket closed before turn.ended: code ${event.code} · reason ${event.reason || "unspecified"}`));
      }
    };
  });
}

/** Read a small transcript window after turn completion. */
export function readKimiMessages(sessionId: string, config: KimiWebConfig, pageSize = 20): Promise<unknown> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("pageSize must be 1..100");
  return request(config, `/api/v1/sessions/${sessionId}/messages?page_size=${pageSize}`, { headers: jsonHeaders(token(config)) });
}

/** Run one isolated live instruction end-to-end without Git or a second prompt channel. */
export async function runLiveInstruction(cwd: string, instruction: string, config: KimiWebConfig, timeoutMs = 600_000): Promise<unknown> {
  const sessionId = await createKimiSession(cwd, config);
  const turnPromise = waitForTurnEnded(sessionId, config, timeoutMs);
  await submitKimiPrompt(sessionId, instruction, config);
  const turn = await turnPromise;
  const messages = await readKimiMessages(sessionId, config);
  return { status: "completed", sessionId, turn, messages };
}
