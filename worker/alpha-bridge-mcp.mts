/** Local stdio-only Alpha Bridge MCP server. No shell, sockets or arbitrary file access. */
import path from "node:path";
import { createAlphaBridgeHandler, type JsonRpcRequest, type JsonRpcResponse } from "./lib/alpha-bridge-protocol";

const root = path.resolve(process.cwd());
const handle = createAlphaBridgeHandler(root);
process.stdin.setEncoding("utf8");
let buffer = "";
function write(response: JsonRpcResponse | null): void {
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let request: JsonRpcRequest;
    try { request = JSON.parse(line) as JsonRpcRequest; }
    catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }); continue; }
    void handle(request).then(write).catch((error: unknown) => {
      write({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32603, message: error instanceof Error ? error.message : "Alpha Bridge internal error" } });
    });
  }
});
process.stdin.on("end", () => process.exit(0));
console.error("[alpha-bridge] stdio MCP ready · bounded JSONL only · no shell/network");
