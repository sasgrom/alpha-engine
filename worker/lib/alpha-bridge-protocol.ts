import { appendBridgeMessage, bridgeStatus, readBridgeHandoff, type BridgeAuthor } from "./alpha-bridge";

export interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: {
    protocolVersion?: string;
    name?: string;
    arguments?: { limit?: number; from?: BridgeAuthor; message?: string };
  };
}
export interface JsonRpcResponse { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } }
const PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const result = (id: JsonRpcResponse["id"], value: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result: { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value },
});
const failure = (id: JsonRpcResponse["id"], code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
const tools = [
  {
    name: "read_handoff",
    description: "Read the newest bounded Alpha Bridge handoff messages without executing commands.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
  },
  {
    name: "append_message",
    description: "Append one bounded credential-free message to the shared Alpha Bridge JSONL channel.",
    inputSchema: {
      type: "object",
      required: ["from", "message"],
      properties: {
        from: { type: "string", enum: ["kimi-code", "web-agent", "owner"] },
        message: { type: "string", minLength: 1, maxLength: 4000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "report_status",
    description: "Report fixed bridge, Git-ref and daily-health evidence without shell commands or arbitrary file access.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** Handle one JSON-RPC request using only the bounded Alpha Bridge contract. */
export function createAlphaBridgeHandler(root: string) {
  return async (request: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const id = request.id ?? null;
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") return failure(id, -32600, "Invalid JSON-RPC request");
    if (request.method === "notifications/initialized") return null;
    if (request.method === "initialize") {
      const requested = request.params?.protocolVersion;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.has(requested) ? requested : "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "alpha-bridge", version: "1.0.0" },
          instructions: "Bounded JSONL handoff only. No shell, network listener, arbitrary paths or credentials.",
        },
      };
    }
    if (request.method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (request.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
    if (request.method !== "tools/call") return failure(id, -32601, `Method not found: ${request.method}`);
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    try {
      if (name === "read_handoff") return result(id, readBridgeHandoff(root, args.limit ?? 20));
      if (name === "append_message") {
        const entry = appendBridgeMessage(root, args.from as BridgeAuthor, String(args.message ?? ""));
        return result(id, { ok: true, entry, handoff: readBridgeHandoff(root, 1) });
      }
      if (name === "report_status") return result(id, bridgeStatus(root));
      return failure(id, -32602, `Unknown Alpha Bridge tool: ${String(name)}`);
    } catch (error) {
      return failure(id, -32602, error instanceof Error ? error.message : "Alpha Bridge operation failed");
    }
  };
}
