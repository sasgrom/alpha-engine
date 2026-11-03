/** Bounded captain-command executor. One pending command, one process, no hidden retries. */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ackCommand, completeCommand, readCommands, type AlphaCommand } from "./lib/alpha-commands";
import { validatedMessage } from "./lib/alpha-bridge";

export interface CommandExecution { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export type CommandExecutor = (prompt: string, root: string) => Promise<CommandExecution>;
const TIMEOUT_MS = 600_000;
const tail = (value: string, length: number) => value.slice(-length);
function safeOutput(value: string): string {
  try { return validatedMessage("kimi-code", value); }
  catch { return "Executor output withheld because it may contain sensitive material"; }
}

/** Invoke one non-interactive Kimi CLI prompt with bounded process and background limits. */
export const runKimiPrompt: CommandExecutor = (prompt, root) => new Promise((resolve, reject) => {
  const executable = process.platform === "win32" ? "kimi.cmd" : "kimi";
  const child = spawn(executable, ["-p", prompt, "--output-format", "text"], {
    cwd: root,
    env: {
      ...process.env,
      KIMI_CODE_TRUST_WORKSPACE: "1",
      KIMI_CODE_BACKGROUND_MAX_RUNNING_TASKS: "1",
      KIMI_CODE_BACKGROUND_BASH_TASK_TIMEOUT_S: "600",
      KIMI_CODE_BACKGROUND_PRINT_WAIT_CEILING_S: "600",
      KIMI_SUBAGENT_TIMEOUT_MS: String(TIMEOUT_MS),
    },
    shell: false,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    killSignal: "SIGTERM",
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout = tail(stdout + chunk.toString(), 12_000); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = tail(stderr + chunk.toString(), 12_000); });
  child.on("error", reject);
  child.on("close", (code, signal) => resolve({ code, stdout, stderr, timedOut: signal === "SIGTERM" }));
});

function withAgentLock<T>(root: string, action: () => T): T | { status: "busy" } {
  const lock = path.join(root, "worker", ".runs", "alpha-bridge-agent.lock");
  mkdirSync(path.dirname(lock), { recursive: true });
  try { mkdirSync(lock); }
  catch { return { status: "busy" }; }
  try { return action(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}

function promptFor(command: AlphaCommand): string {
  return [
    "You are the Alpha Engine local executor. Follow AGENTS.md and docs/KIMI_CODE_HANDOFF.md.",
    `Command id: ${command.id}.`,
    `Captain instruction: ${command.instruction}`,
    "Work autonomously only within the existing owner authorization. Do not ask routine questions.",
    "Use bounded evidence and at most two attempts per failing step, then diagnose instead of retrying.",
    "Never perform production apply/deployment, cloud collection, schema/storage migration, deletion, credential handling, paused GPU lanes, GDELT or history-changing Git operations.",
    "Do not start duplicate servers, schedulers or collectors. Do not commit generated/raw artifacts or secrets.",
    "Run relevant tests and report exact evidence, files changed, commit if safely created, and remaining blockers.",
  ].join("\n");
}

/** Execute at most one pending command, preserving interrupted acknowledged commands for review. */
export async function runNextCommand(root: string, execute: CommandExecutor = runKimiPrompt): Promise<unknown> {
  return withAgentLock(root, async () => {
    const next = readCommands(root, "pending", 1)[0];
    if (!next) {
      const interrupted = readCommands(root, "acknowledged", 1)[0];
      return interrupted ? { status: "blocked", reason: `Command ${interrupted.id} is already acknowledged; inspect its outcome before rerunning` } : { status: "idle" };
    }
    const acknowledged = ackCommand(root, next.id);
    let execution: CommandExecution;
    try { execution = await execute(promptFor(acknowledged), root); }
    catch (error) {
      const summary = safeOutput(error instanceof Error ? error.message : String(error));
      const command = completeCommand(root, next.id, "failed", summary);
      return { status: command.status, command };
    }
    const output = execution.timedOut ? `Kimi CLI timed out after ${TIMEOUT_MS / 1000}s` : execution.code === 0 ? execution.stdout : `Kimi CLI exited with code ${execution.code ?? "unknown"}: ${execution.stderr || execution.stdout}`;
    const summary = output.trim() ? safeOutput(tail(output, 3500)) : execution.code === 0 ? "Command completed with no textual output" : "Executor failed without output";
    const evidence = [tail(execution.stdout, 1800), tail(execution.stderr, 1000)].filter((value) => value.trim()).map(safeOutput);
    const command = completeCommand(root, next.id, execution.code === 0 && !execution.timedOut ? "completed" : "failed", summary, evidence);
    return { status: command.status, command };
  });
}

if (process.argv[1]?.endsWith("alpha-bridge-agent.mts")) {
  const result = await runNextCommand(path.resolve(process.cwd()));
  console.log(JSON.stringify(result, null, 2));
}
