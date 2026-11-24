import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readSecurityTail, summarizeSecurity, type SecurityEvent } from "./security-events";

const folder = mkdtempSync(path.join(tmpdir(), "security-events-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const NOW = new Date("2026-11-24T12:00:00Z");
const event = (minutesAgo: number, kind: string, ip = "1.2.3.4"): SecurityEvent => ({ at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(), kind, ip });

describe("the security event log", () => {
  it("reads the events and skips a torn line", () => {
    const file = path.join(folder, "events.jsonl");
    writeFileSync(file, [JSON.stringify(event(5, "login_failed")), "{\"at\":\"2026-11-24T11:5", JSON.stringify(event(1, "login")), ""].join("\n"));
    expect(readSecurityTail(file).map((row) => row.kind)).toEqual(["login_failed", "login"]);
    expect(readSecurityTail(path.join(folder, "absent.jsonl"))).toEqual([]);
  });

  it("counts by kind for the last hour and day and lists the newest first", () => {
    const summary = summarizeSecurity([event(2000, "login_failed"), event(300, "refused"), event(50, "login_failed"), event(10, "login"), event(1, "login_failed")], NOW);
    expect(summary.lastHour).toEqual({ login_failed: 2, login: 1 });
    expect(summary.lastDay).toEqual({ refused: 1, login_failed: 2, login: 1 });
    expect(summary.failedSignInsLastHour).toBe(2);
    expect(summary.spike).toBe(false);
    expect(summary.events[0].kind).toBe("login_failed");
    expect(summary.events).toHaveLength(5);
  });

  it("calls ten failed sign-ins in an hour a spike, counting locks and wrong codes", () => {
    const events = [...Array.from({ length: 6 }, (_, index) => event(index + 1, "login_failed")), event(8, "login_locked"), event(9, "login_locked"), event(11, "second_factor_failed"), event(12, "second_factor_failed"), event(13, "refused")];
    const summary = summarizeSecurity(events, NOW);
    expect(summary.failedSignInsLastHour).toBe(10);
    expect(summary.spike).toBe(true);
  });

  it("shows at most the asked number of events", () => {
    expect(summarizeSecurity(Array.from({ length: 30 }, (_, index) => event(index, "refused")), NOW, 7).events).toHaveLength(7);
  });
});
