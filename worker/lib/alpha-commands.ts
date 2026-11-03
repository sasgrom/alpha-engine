import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validatedMessage, withBridgeLock } from "./alpha-bridge";

export type CommandStatus = "pending" | "acknowledged" | "completed" | "failed" | "blocked";
export interface AlphaCommand {
  id: string;
  instruction: string;
  createdAt: string;
  createdBy: "web-agent" | "owner";
  status: CommandStatus;
  acknowledgedAt: string | null;
  completedAt: string | null;
  summary: string | null;
  evidence: string[];
}
interface CommandEvent {
  type: "command" | "ack" | "result";
  id: string;
  at: string;
  instruction?: string;
  createdBy?: "web-agent" | "owner";
  status: CommandStatus;
  note?: string;
  summary?: string;
  evidence?: string[];
}
const FILE = path.join("docs", "ALPHA_COMMANDS.jsonl");
const UNSAFE = /(production\s+(?:apply|deploy|deployment|collection)|db:push\s+--force|drop\s+table|migrat(?:e|ion)|credential|client_secret|refresh_token|access_token|authorization code|gdelt|force-push|reset\s+--hard)/i;
const filePath = (root: string) => path.join(root, FILE);

function readEvents(root: string): CommandEvent[] {
  const file = filePath(root);
  if (!existsSync(file)) return [];
  const events: CommandEvent[] = [];
  for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as CommandEvent;
      if (!event.id || !event.at || !event.type || !event.status) throw new Error("Invalid command event");
      events.push(event);
    } catch { throw new Error(`Alpha command file is corrupt at line ${index + 1}`); }
  }
  return events;
}
function writeEvents(root: string, events: CommandEvent[]): void {
  const file = filePath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : ""), "utf8");
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}
function state(events: CommandEvent[]): AlphaCommand[] {
  const byId = new Map<string, AlphaCommand>();
  for (const event of events) {
    const current = byId.get(event.id);
    if (current) {
      current.status = event.status;
      if (event.type === "ack") current.acknowledgedAt = event.at;
      if (event.type === "result") {
        current.completedAt = event.at;
        current.summary = event.summary ?? null;
        current.evidence = event.evidence ?? [];
      }
    } else if (event.type === "command" && event.instruction && event.createdBy) {
      byId.set(event.id, {
        id: event.id,
        instruction: event.instruction,
        createdAt: event.at,
        createdBy: event.createdBy,
        status: event.status,
        acknowledgedAt: null,
        completedAt: null,
        summary: null,
        evidence: [],
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function commandById(events: CommandEvent[], id: string): AlphaCommand {
  const command = state(events).find((item) => item.id === id);
  if (!command) throw new Error(`Unknown command ${id}`);
  return command;
}
function validId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Command id must contain only letters, digits, underscore and dash, maximum 80 characters");
}
function text(value: string, field: string, max = 4000): string {
  const result = validatedMessage("kimi-code", value);
  if (result.length > max) throw new Error(`${field} exceeds ${max} characters`);
  return result;
}
function evidence(value: string[] | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("evidence must contain at most 20 entries");
  return value.map((entry) => text(entry, "evidence", 2000));
}

/** Create one idempotent captain instruction. Unsafe instructions fail closed or remain blocked for review. */
export function postCommand(root: string, instruction: string, createdBy: "web-agent" | "owner", requestedId?: string, requiresReview = false): AlphaCommand {
  if (!["web-agent", "owner"].includes(createdBy)) throw new Error("Only web-agent or owner can post commands");
  const clean = text(instruction, "instruction");
  if (UNSAFE.test(clean) && !requiresReview) throw new Error("Unsafe command requires an explicit owner review instead of unattended execution");
  const id = requestedId ?? randomUUID();
  validId(id);
  return withBridgeLock(root, () => {
    const events = readEvents(root);
    const commands = state(events);
    if (commands.some((command) => command.id === id)) throw new Error(`Duplicate command id ${id}`);
    if (commands.length >= 100) throw new Error("Alpha command history is full; review completed commands before adding more");
    const event: CommandEvent = { type: "command", id, at: new Date().toISOString(), instruction: clean, createdBy, status: requiresReview ? "blocked" : "pending" };
    writeEvents(root, [...events, event]);
    return commandById(readEvents(root), id);
  });
}

/** Read commands in chronological order with pending-first execution semantics. */
export function readCommands(root: string, status?: CommandStatus, limit = 50): AlphaCommand[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be an integer from 1 to 50");
  if (status && !["pending", "acknowledged", "completed", "failed", "blocked"].includes(status)) throw new Error("Unknown command status");
  const commands = state(readEvents(root)).filter((command) => !status || command.status === status);
  return commands.slice(-limit);
}

/** Acknowledge one pending command exactly once. */
export function ackCommand(root: string, id: string, note = "Accepted by Kimi Code"): AlphaCommand {
  validId(id);
  const clean = text(note, "note", 1000);
  return withBridgeLock(root, () => {
    const events = readEvents(root);
    const command = commandById(events, id);
    if (command.status !== "pending") throw new Error(`Command ${id} cannot be acknowledged from ${command.status}`);
    const event: CommandEvent = { type: "ack", id, at: new Date().toISOString(), status: "acknowledged", note: clean };
    writeEvents(root, [...events, event]);
    return commandById(readEvents(root), id);
  });
}

/** Complete an acknowledged command with a terminal result and bounded evidence. */
export function completeCommand(root: string, id: string, status: "completed" | "failed" | "blocked", summary: string, evidenceRows: string[] = []): AlphaCommand {
  validId(id);
  if (!["completed", "failed", "blocked"].includes(status)) throw new Error("Invalid terminal status");
  const cleanSummary = text(summary, "summary");
  const cleanEvidence = evidence(evidenceRows);
  return withBridgeLock(root, () => {
    const events = readEvents(root);
    const command = commandById(events, id);
    if (command.status !== "acknowledged") throw new Error(`Command ${id} cannot complete from ${command.status}`);
    const event: CommandEvent = { type: "result", id, at: new Date().toISOString(), status, summary: cleanSummary, evidence: cleanEvidence };
    writeEvents(root, [...events, event]);
    return commandById(readEvents(root), id);
  });
}

/** Return pending/active counters without inspecting any external process. */
export function commandStatus(root: string): { pending: number; acknowledged: number; latestAt: string | null } {
  const commands = state(readEvents(root));
  return {
    pending: commands.filter((command) => command.status === "pending").length,
    acknowledged: commands.filter((command) => command.status === "acknowledged").length,
    latestAt: commands.at(-1)?.completedAt ?? commands.at(-1)?.acknowledgedAt ?? commands.at(-1)?.createdAt ?? null,
  };
}
