/** Execute a live captain instruction through Kimi web without Git or a second prompt channel. */
import path from "node:path";
import { ackCommand, completeCommand, readCommands } from "./lib/alpha-commands";
import { kimiWebConfigFromEnv, kimiWebHealth, runLiveInstruction } from "./lib/alpha-live";
import { validatedMessage } from "./lib/alpha-bridge";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const root = path.resolve(process.cwd());
const directInstruction = arg("--instruction");
const directId = arg("--id");
const pending = directInstruction ? null : readCommands(root, "pending", 1)[0] ?? null;
if (!directInstruction && !pending) {
  console.log(JSON.stringify({ status: "idle", reason: "No pending command and no --instruction" }, null, 2));
  process.exit(0);
}
const instruction = directInstruction ?? pending!.instruction;
const commandId = directId ?? pending?.id ?? null;
const config = kimiWebConfigFromEnv();
if (!await kimiWebHealth(config)) throw new Error("Kimi web is unavailable or health check failed");
try {
  const result = await runLiveInstruction(root, instruction, config);
  if (pending && commandId) completeCommand(root, commandId, "completed", "Live Kimi web instruction completed", [JSON.stringify(result).slice(0, 1800)]);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const summary = error instanceof Error ? error.message : String(error);
  try { validatedMessage("kimi-code", summary); } catch { /* output is sanitized below */ }
  if (pending && commandId) completeCommand(root, commandId, "failed", summary);
  console.error(JSON.stringify({ status: "failed", commandId, summary }, null, 2));
  process.exitCode = 1;
}
