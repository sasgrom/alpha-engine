import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendBridgeMessage, bridgeStatus, readBridgeHandoff } from "./alpha-bridge";
import { createAlphaBridgeHandler } from "./alpha-bridge-protocol";

const SHA = "a".repeat(40);
describe("Alpha Bridge", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "alpha-bridge-"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("appends bounded messages and reports fixed Git and daily evidence", () => {
    appendBridgeMessage(root, "kimi-code", "Schwab captured 51/51");
    mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
    mkdirSync(path.join(root, ".git", "refs", "remotes", "origin"), { recursive: true });
    writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(path.join(root, ".git", "refs", "heads", "main"), `${SHA}\n`);
    writeFileSync(path.join(root, ".git", "refs", "remotes", "origin", "main"), `${SHA}\n`);
    mkdirSync(path.join(root, "public", "reports"), { recursive: true });
    writeFileSync(path.join(root, "public", "reports", "daily-operations.json"), JSON.stringify({
      generatedAt: "2026-11-03T06:00:00Z",
      status: "ok",
      scheduler: { status: "online" },
      schwab: { tickersCapturedToday: 51, tickersExpected: 51, latestCapture: "2026-11-03T05:00:00Z" },
      summary: { checksOk: 20, checksWarning: 0, checksError: 0, checksPending: 2 },
    }));
    expect(readBridgeHandoff(root, 1).messages[0].message).toBe("Schwab captured 51/51");
    expect(bridgeStatus(root)).toMatchObject({
      bridge: { messageCount: 1 },
      git: { head: SHA, originMain: SHA, refsMatch: true },
      dailyOperations: { status: "ok", scheduler: "online", schwab: { capturedToday: 51, expected: 51 } },
    });
  });

  it("rejects secret material and invalid input without creating a channel file", () => {
    expect(() => appendBridgeMessage(root, "kimi-code", "access_token=abc123")).toThrow("credentials");
    expect(() => appendBridgeMessage(root, "kimi-code", " ")).toThrow("1..4000");
    expect(() => readBridgeHandoff(root, 0)).toThrow("limit");
    expect(readBridgeHandoff(root).count).toBe(0);
  });

  it("keeps only the latest 100 messages", () => {
    for (let index = 0; index < 105; index++) appendBridgeMessage(root, "kimi-code", `message-${index}`);
    const handoff = readBridgeHandoff(root, 50);
    expect(handoff.count).toBe(100);
    expect(handoff.messages).toHaveLength(50);
    expect(handoff.messages.at(-1)?.message).toBe("message-104");
    expect(handoff.messages[0].message).toBe("message-55");
  });

  it("fails closed on corrupt JSONL instead of deleting history", () => {
    writeFileSync(path.join(root, "docs", "ALPHA_BRIDGE.jsonl"), "not-json\n");
    expect(() => readBridgeHandoff(root)).toThrow("corrupt");
  });
});

describe("Alpha Bridge MCP protocol", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "alpha-bridge-protocol-"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("supports initialize, tools/list and all three tool calls", async () => {
    const handle = createAlphaBridgeHandler(root);
    const initialized = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(initialized?.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "alpha-bridge" } });
    const listed = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(JSON.stringify(listed?.result)).toContain("append_message");
    const appended = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "append_message", arguments: { from: "kimi-code", message: "F-01 targeted tests passed" } } });
    expect(JSON.stringify(appended?.result)).toContain("F-01 targeted tests passed");
    const handoff = await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_handoff", arguments: { limit: 1 } } });
    expect(JSON.stringify(handoff?.result)).toContain("F-01 targeted tests passed");
    const status = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "report_status", arguments: {} } });
    expect(JSON.stringify(status?.result)).toContain("dailyOperations");
  });

  it("returns protocol errors without executing unknown tools or leaking input", async () => {
    const handle = createAlphaBridgeHandler(root);
    const secret = await handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "append_message", arguments: { from: "kimi-code", message: "Bearer abcdefghijklmnop" } } });
    expect(secret?.error?.message).toContain("credentials");
    expect(JSON.stringify(secret)).not.toContain("abcdefghijklmnop");
    const unknown = await handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "shell", arguments: { command: "rm -rf /" } } });
    expect(unknown?.error?.code).toBe(-32602);
    expect(existsSync(path.join(root, "docs", "ALPHA_BRIDGE.jsonl"))).toBe(false);
  });
});
