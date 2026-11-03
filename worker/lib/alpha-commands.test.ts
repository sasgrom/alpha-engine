import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ackCommand, commandStatus, completeCommand, postCommand, readCommands } from "./alpha-commands";
import { createAlphaBridgeHandler } from "./alpha-bridge-protocol";
import { runNextCommand, kimiSpawnSpec } from "../alpha-bridge-agent";

const root = () => mkdtempSync(path.join(os.tmpdir(), "alpha-commands-"));
describe("captain command protocol", () => {
  let directory = "";
  beforeEach(() => { directory = root(); mkdirSync(path.join(directory, "docs"), { recursive: true }); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("moves pending commands through acknowledged to completed with evidence", () => {
    const posted = postCommand(directory, "Add the F-01 regression test", "web-agent", "f01-test");
    expect(posted.status).toBe("pending");
    expect(ackCommand(directory, posted.id).status).toBe("acknowledged");
    const completed = completeCommand(directory, posted.id, "completed", "Targeted tests passed", ["3/3 tests"]);
    expect(completed.status).toBe("completed");
    expect(completed.evidence).toEqual(["3/3 tests"]);
    expect(commandStatus(directory)).toMatchObject({ pending: 0, acknowledged: 0 });
    expect(readCommands(directory, "completed")[0].summary).toBe("Targeted tests passed");
  });

  it("rejects duplicate IDs and invalid state transitions", () => {
    const posted = postCommand(directory, "Run targeted tests", "web-agent", "unique-command");
    expect(() => postCommand(directory, "Run targeted tests", "web-agent", posted.id)).toThrow("Duplicate");
    expect(() => completeCommand(directory, posted.id, "completed", "Skip acknowledgement")).toThrow("cannot complete");
    ackCommand(directory, posted.id);
    expect(() => ackCommand(directory, posted.id)).toThrow("cannot be acknowledged");
  });

  it("fails closed on unsafe instructions and retains review-only commands as blocked", () => {
    expect(() => postCommand(directory, "Run production apply", "web-agent")).toThrow("Unsafe command");
    const blocked = postCommand(directory, "Run production apply", "owner", "owner-review", true);
    expect(blocked.status).toBe("blocked");
    expect(readCommands(directory, "pending")).toHaveLength(0);
  });

  it("supports the complete MCP command workflow", async () => {
    const handle = createAlphaBridgeHandler(directory);
    await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "post_command", arguments: { instruction: "Run npm run check", requestedId: "check-1", createdBy: "web-agent" } } });
    await handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ack_command", arguments: { id: "check-1" } } });
    const completed = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "complete_command", arguments: { id: "check-1", status: "completed", summary: "TypeScript passed", evidence: ["npm run check"] } } });
    expect(JSON.stringify(completed?.result)).toContain("TypeScript passed");
    const pending = await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_commands", arguments: { status: "pending" } } });
    expect(pending?.result).toMatchObject({ structuredContent: [] });
  });
});

describe("captain executor", () => {
  let directory = "";
  beforeEach(() => { directory = root(); mkdirSync(path.join(directory, "docs"), { recursive: true }); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("executes one pending command and records the result", async () => {
    postCommand(directory, "Run targeted tests", "web-agent", "executor-success");
    const result = await runNextCommand(directory, async () => ({ code: 0, stdout: "Targeted tests passed", stderr: "", timedOut: false })) as { status: string };
    expect(result.status).toBe("completed");
    expect(readCommands(directory, "completed")[0].summary).toBe("Targeted tests passed");
    expect(readCommands(directory, "pending")).toHaveLength(0);
  });

  it("fails closed on executor failure and does not blindly resume acknowledged commands", async () => {
    postCommand(directory, "Run a collector", "web-agent", "executor-failure");
    const result = await runNextCommand(directory, async () => ({ code: 1, stdout: "", stderr: "provider failed", timedOut: false })) as { status: string };
    expect(result.status).toBe("failed");
    expect(readCommands(directory, "failed")[0].summary).toContain("provider failed");
    const next = await runNextCommand(directory) as { status: string };
    expect(next.status).toBe("idle");
    postCommand(directory, "Inspect an interrupted command", "web-agent", "interrupted-command");
    ackCommand(directory, "interrupted-command");
    const interrupted = await runNextCommand(directory) as { status: string };
    expect(interrupted.status).toBe("blocked");
  });

  it("uses a fixed quoted cmd.exe invocation on Windows", () => {
    const spec = kimiSpawnSpec("line one\nline %PATH% & echo unsafe", "win32");
    expect(spec.executable).toBe("cmd.exe");
    expect(spec.shell).toBe(false);
    expect(spec.args.slice(0, 4)).toEqual(["/d", "/s", "/c", "kimi"]);
    expect(spec.args[5]).toBe('"line one line %%PATH%% & echo unsafe"');
    expect(spec.args[5]).not.toContain("\n");
  });

  it("withholds sensitive output without blocking the terminal record", async () => {
    postCommand(directory, "Inspect output", "web-agent", "secret-output");
    const result = await runNextCommand(directory, async () => ({ code: 0, stdout: "access_token=secret-value", stderr: "", timedOut: false })) as { status: string };
    expect(result.status).toBe("completed");
    const file = readFileSync(path.join(directory, "docs", "ALPHA_COMMANDS.jsonl"), "utf8");
    expect(file).toContain("withheld");
    expect(file).not.toContain("secret-value");
  });
});
