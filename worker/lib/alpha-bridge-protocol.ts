import { appendBridgeMessage, bridgeStatus, readBridgeHandoff, type BridgeAuthor } from "./alpha-bridge";
import { ackCommand, completeCommand, postCommand, readCommands, type CommandStatus } from "./alpha-commands";

export interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: {
    protocolVersion?: string;
    name?: string;
    arguments?: {
      limit?: number;
      from?: BridgeAuthor;
      message?: string;
      instruction?: string;
      requestedId?: string;
      createdBy?: "web-agent" | "owner";
      requiresReview?: boolean;
      status?: CommandStatus;
      id?: string;
      note?: string;
      summary?: string;
      evidence?: string[];
    };
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
  {
    name: "post_command",
    description: "Post one idempotent captain instruction for Kimi Code; unsafe instructions fail closed or remain blocked.",
    inputSchema: {
      type: "object",
      required: ["instruction"],
      properties: {
        instruction: { type: "string", minLength: 1, maxLength: 4000 },
        requestedId: { type: "string", minLength: 1, maxLength: 80 },
        createdBy: { type: "string", enum: ["web-agent", "owner"] },
        requiresReview: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_commands",
    description: "Read captain commands filtered by pending, acknowledged, completed, failed or blocked status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "acknowledged", "completed", "failed", "blocked"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ack_command",
    description: "Acknowledge one pending command exactly once before execution.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", minLength: 1, maxLength: 80 }, note: { type: "string", maxLength: 1000 } },
      additionalProperties: false,
    },
  },
  {
    name: "complete_command",
    description: "Complete an acknowledged command with terminal status, summary and bounded evidence.",
    inputSchema: {
      type: "object",
      required: ["id", "status", "summary"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 80 },
        status: { type: "string", enum: ["completed", "failed", "blocked"] },
        summary: { type: "string", minLength: 1, maxLength: 4000 },
        evidence: { type: "array", items: { type: "string", maxLength: 2000 }, maxItems: 20 },
      },
      additionalProperties: false,
    },
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
      if (name === "post_command") return result(id, postCommand(root, args.instruction ?? "", args.createdBy ?? "web-agent", args.requestedId, args.requiresReview ?? false));
      if (name === "read_commands") return result(id, readCommands(root, args.status, args.limit ?? 50));
      if (name === "ack_command") return result(id, ackCommand(root, String(args.id ?? ""), args.note));
      if (name === "complete_command") return result(id, completeCommand(root, String(args.id ?? ""), args.status as "completed" | "failed" | "blocked", String(args.summary ?? ""), args.evidence));
      return failure(id, -32602, `Unknown Alpha Bridge tool: ${String(name)}`);
    } catch (error) {
      return failure(id, -32602, error instanceof Error ? error.message : "Alpha Bridge operation failed");
    }
  };
}
