/**
 * Reads the server's security event log (perimeter.recordSecurityEvent) for the Operations page: the latest events,
 * counts for the last hour and day, and whether sign-in failures have spiked. Read only; the tail of the file only.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { securityEventsFile } from "./perimeter";

export interface SecurityEvent { at: string; kind: string; ip: string; path?: string; detail?: string }
export interface SecuritySummary {
  checkedAt: string;
  lastHour: Record<string, number>;
  lastDay: Record<string, number>;
  /** Failed and locked sign-ins and wrong second-factor codes in the last hour. */
  failedSignInsLastHour: number;
  /** True at SPIKE or more of those in an hour: someone is guessing. */
  spike: boolean;
  events: SecurityEvent[];
}

export const SPIKE = 10;
const FAILURES = new Set(["login_failed", "login_locked", "second_factor_failed"]);
const TAIL_BYTES = 256 * 1024;

/** The last part of the log as events, oldest first; unreadable lines are skipped. */
export function readSecurityTail(file: string = securityEventsFile()): SecurityEvent[] {
  if (!existsSync(file)) return [];
  const size = statSync(file).size, start = Math.max(0, size - TAIL_BYTES), buffer = Buffer.alloc(size - start);
  const handle = openSync(file, "r");
  try { readSync(handle, buffer, 0, buffer.length, start); } finally { closeSync(handle); }
  const lines = buffer.toString("utf8").split("\n");
  if (start > 0) lines.shift(); // the first line may be cut
  const events: SecurityEvent[] = [];
  for (const line of lines) { if (!line.trim()) continue; try { const event = JSON.parse(line) as SecurityEvent; if (event.at && event.kind) events.push(event); } catch { /* a torn line */ } }
  return events;
}

export function summarizeSecurity(events: SecurityEvent[], now: Date, shown = 100): SecuritySummary {
  const lastHour: Record<string, number> = {}, lastDay: Record<string, number> = {};
  const time = now.getTime();
  for (const event of events) {
    const age = time - Date.parse(event.at);
    if (!(age >= 0)) continue;
    if (age <= 86_400_000) lastDay[event.kind] = (lastDay[event.kind] ?? 0) + 1;
    if (age <= 3_600_000) lastHour[event.kind] = (lastHour[event.kind] ?? 0) + 1;
  }
  const failedSignInsLastHour = Object.entries(lastHour).filter(([kind]) => FAILURES.has(kind)).reduce((sum, [, count]) => sum + count, 0);
  return { checkedAt: now.toISOString(), lastHour, lastDay, failedSignInsLastHour, spike: failedSignInsLastHour >= SPIKE, events: events.slice(-shown).reverse() };
}

export function readSecuritySummary(now: Date = new Date(), file: string = securityEventsFile()): SecuritySummary {
  return summarizeSecurity(readSecurityTail(file), now);
}
