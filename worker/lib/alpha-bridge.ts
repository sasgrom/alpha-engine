import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type BridgeAuthor = "kimi-code" | "web-agent" | "owner";
export interface BridgeMessage { id: string; at: string; from: BridgeAuthor; message: string }
const BRIDGE_FILE = path.join("docs", "ALPHA_BRIDGE.jsonl");
const BRIDGE_LOCK = path.join("worker", ".runs", "alpha-bridge.lock");
const DAILY_FILE = path.join("public", "reports", "daily-operations.json");
const MAX_MESSAGES = 100;
const SENSITIVE = /(SCHWAB_CLIENT_SECRET|FRED_API_KEY|KIMI_AGENTGW_API_KEY|APP_SECRET|DATABASE_URL|BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[A-Za-z0-9_\-.=]{12,}|(?:access|refresh)_token"?\s*[:=]|client_secret"?\s*[:=]|password"?\s*[:=]|api[_-]?key"?\s*[:=])/i;
const bridgePath = (root: string) => path.join(root, BRIDGE_FILE);
const lockPath = (root: string) => path.join(root, BRIDGE_LOCK);

function readMessages(root: string): BridgeMessage[] {
  const file = bridgePath(root);
  if (!existsSync(file)) return [];
  const rows: BridgeMessage[] = [];
  for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as BridgeMessage;
      if (!value.id || !value.at || !value.from || typeof value.message !== "string") throw new Error("Invalid message shape");
      rows.push(value);
    } catch { throw new Error(`Alpha Bridge file is corrupt at line ${index + 1}`); }
  }
  return rows;
}
function atomicWrite(root: string, messages: BridgeMessage[]): void {
  const file = bridgePath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, messages.map((message) => JSON.stringify(message)).join("\n") + (messages.length ? "\n" : ""), "utf8");
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}
function withBridgeLock<T>(root: string, action: () => T): T {
  const lock = lockPath(root);
  mkdirSync(path.dirname(lock), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
    try { mkdirSync(lock); acquired = true; }
    catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      if (attempt < 2) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  if (!acquired) throw new Error("Alpha Bridge is busy; append was not performed");
  try { return action(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}
function hasControlCharacters(text: string): boolean {
  return [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
}
function validatedMessage(from: BridgeAuthor, message: string): string {
  if (!["kimi-code", "web-agent", "owner"].includes(from)) throw new Error("Unknown Alpha Bridge author");
  const text = message.trim();
  if (!text || text.length > 4000) throw new Error("Alpha Bridge message must contain 1..4000 characters");
  if (hasControlCharacters(text)) throw new Error("Alpha Bridge message contains control characters");
  if (SENSITIVE.test(text)) throw new Error("Alpha Bridge message appears to contain credentials or secret material");
  return text;
}

/** Read the newest shared handoff messages without executing any commands. */
export function readBridgeHandoff(root: string, limit = 20): { messages: BridgeMessage[]; count: number; latestAt: string | null } {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be an integer from 1 to 50");
  const all = readMessages(root);
  return { messages: all.slice(-limit), count: all.length, latestAt: all.at(-1)?.at ?? null };
}

/** Append one bounded, credential-free message to the shared Git-backed JSONL channel. */
export function appendBridgeMessage(root: string, from: BridgeAuthor, message: string): BridgeMessage {
  const text = validatedMessage(from, message);
  return withBridgeLock(root, () => {
    const all = readMessages(root);
    const entry: BridgeMessage = { id: randomUUID(), at: new Date().toISOString(), from, message: text };
    const next = [...all, entry].slice(-MAX_MESSAGES);
    atomicWrite(root, next);
    return entry;
  });
}

interface DailyHealthDocument {
  generatedAt?: string;
  status?: string;
  scheduler?: { status?: string };
  schwab?: { tickersCapturedToday?: number; tickersExpected?: number; latestCapture?: string };
  summary?: { checksOk?: number; checksWarning?: number; checksError?: number; checksPending?: number };
}
function readJsonFile(file: string): DailyHealthDocument | null {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as DailyHealthDocument : null; }
  catch { return null; }
}
function readGitRef(root: string, name: "HEAD" | "refs/heads/main" | "refs/remotes/origin/main"): string | null {
  const file = path.join(root, ".git", name);
  try {
    const value = readFileSync(file, "utf8").trim();
    if (name === "HEAD" && value.startsWith("ref: ")) return readGitRef(root, value.slice(5) as "refs/remotes/origin/main");
    return /^[0-9a-f]{40}$/.test(value) ? value : null;
  } catch { return null; }
}
function readOriginMain(root: string): string | null {
  const direct = readGitRef(root, "refs/remotes/origin/main");
  if (direct) return direct;
  try {
    for (const line of readFileSync(path.join(root, ".git", "packed-refs"), "utf8").split(/\r?\n/)) {
      if (line.endsWith(" refs/remotes/origin/main")) return line.slice(0, 40);
    }
  } catch { /* packed refs are optional */ }
  return null;
}

/** Report only fixed bridge, Git-ref and daily-health evidence; never run Git or another shell. */
export function bridgeStatus(root: string): unknown {
  const handoff = readBridgeHandoff(root, 1);
  const daily = readJsonFile(path.join(root, DAILY_FILE));
  const head = readGitRef(root, "HEAD");
  const originMain = readOriginMain(root);
  return {
    bridge: { messageCount: handoff.count, latestAt: handoff.latestAt },
    git: { head, originMain, refsMatch: head && originMain ? head === originMain : null },
    dailyOperations: daily ? {
      generatedAt: daily.generatedAt ?? null,
      status: daily.status ?? null,
      scheduler: daily.scheduler?.status ?? null,
      schwab: daily.schwab ? {
        capturedToday: daily.schwab.tickersCapturedToday ?? null,
        expected: daily.schwab.tickersExpected ?? null,
        latestCapture: daily.schwab.latestCapture ?? null,
      } : null,
      checks: daily.summary ? {
        ok: daily.summary.checksOk ?? null,
        warning: daily.summary.checksWarning ?? null,
        error: daily.summary.checksError ?? null,
        pending: daily.summary.checksPending ?? null,
      } : null,
    } : null,
  };
}
