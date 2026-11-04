import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Param, SQL } from "drizzle-orm";
import { applyExactMacroWindowRemediation, buildExactMacroWindowPlan, createMacroPointBackup, EXACT_MACRO_WINDOW_TARGETS, verifyExactWindowTable, verifyMacroPointBackup, type MacroPointBackupRow, type MacroWindowDatabase } from "./macro-window-remediation";

const rows = EXACT_MACRO_WINDOW_TARGETS.map((target) => ({ id: target.id, seriesId: target.seriesId, date: target.observationPeriod, value: target.value, realtimeStart: target.realtimeStart, realtimeEnd: target.realtimeStart, fetchedAt: "2026-10-19T19:42:00.000Z" }));
const archives = Object.fromEntries(EXACT_MACRO_WINDOW_TARGETS.map((target) => [target.seriesId, [{ seriesId: target.seriesId, observationPeriod: target.observationPeriod, value: target.value, availableAt: `${target.realtimeStart}T00:00:00.000Z`, supersededAt: null, sourceHash: "official" }]]));
const evidence = Object.fromEntries(EXACT_MACRO_WINDOW_TARGETS.map((target) => [target.seriesId, { path: `D:/official/${target.seriesId}.json`, sha256: "official-hash" }]));
const goodPlan = () => buildExactMacroWindowPlan(rows, archives, evidence);
function params(node: unknown): unknown[] {
  if (typeof node === "number") return [node];
  if (node instanceof Param) return [node.value];
  if (node instanceof SQL) return node.queryChunks.flatMap(params);
  if (Array.isArray(node)) return node.flatMap(params);
  return [];
}
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node instanceof SQL) return node.queryChunks.flatMap(strings);
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object" && "value" in node) return strings((node as { value: unknown }).value);
  return [];
}
function fakeDb(initial: MacroPointBackupRow[], failOnUpdate = 0, rawMysqlTimestamps = false) {
  const current = new Map(initial.map((row) => [row.id, { ...row }]));
  let updates = 0;
  let transactions = 0;
  const db: MacroWindowDatabase = {
    transaction: async (callback) => {
      transactions++;
      const before = new Map(current);
      try {
        return await callback({ execute: async (query: SQL) => {
          const text = strings(query).join("");
          const ids = params(query).filter((value): value is number => typeof value === "number");
          if (text.includes("UPDATE macro_points")) {
            updates++;
            if (updates === failOnUpdate) throw new Error("forced update failure");
            expect(text).toContain("SET realtimeEnd = NULL");
            expect(text).not.toContain("fetchedAt =");
            const id = ids[0];
            const row = current.get(id);
            if (!row || row.realtimeEnd !== row.realtimeStart) return [{ affectedRows: 0 }];
            current.set(id, { ...row, realtimeEnd: null });
            return [{ affectedRows: 1 }];
          }
          const id = ids[0];
          return [[current.get(id)].filter(Boolean).map((row) => ({ ...row, fetchedAt: rawMysqlTimestamps ? String(row.fetchedAt).replace("T", " ").replace(/\.\d{3}Z$/, "") : row.fetchedAt }))];
        } });
      } catch (error) {
        current.clear();
        for (const [id, row] of before) current.set(id, row);
        throw error;
      }
    },
  };
  return { db, current, updates: () => updates, transactions: () => transactions };
}

describe("exact macro realtime-window remediation", () => {
  it("plans exactly five realtimeEnd-only changes against official evidence", () => {
    const plan = goodPlan();
    expect(plan.status).toBe("planned");
    expect(plan.diffs.map((diff) => [diff.id, diff.realtimeEndBefore, diff.realtimeEndAfter])).toEqual(EXACT_MACRO_WINDOW_TARGETS.map((target) => [target.id, target.realtimeStart, null]));
    expect(plan.mismatches).toEqual([]);
  });

  it("fails the whole plan for any mismatch or non-open-ended official vintage", () => {
    const changed = rows.map((row) => row.id === 44671 ? { ...row, value: 5.1 } : row);
    expect(buildExactMacroWindowPlan(changed, archives).status).toBe("mismatch");
    const closed = { ...archives, DGS10: [{ ...archives.DGS10[0], supersededAt: "2026-10-19T23:59:59.999Z" }] };
    expect(buildExactMacroWindowPlan(rows, closed).status).toBe("mismatch");
    const repeated = rows.map((row) => row.id === 44671 ? { ...row, realtimeEnd: null } : row);
    expect(buildExactMacroWindowPlan(repeated, archives).status).toBe("mismatch");
  });

  it("changes only the five realtimeEnd fields in one transaction", async () => {
    const other = { id: 999999, seriesId: "VIXCLS", date: "2026-11-02", value: 21.15, realtimeStart: "2026-11-02", realtimeEnd: null, fetchedAt: "2026-11-04T12:30:00.000Z" };
    const fake = fakeDb([...rows, other]);
    const result = await applyExactMacroWindowRemediation(fake.db, goodPlan());
    expect(result.updatedRows).toBe(5);
    expect(fake.transactions()).toBe(1);
    expect(fake.updates()).toBe(5);
    expect(fake.current.get(999999)).toEqual(other);
    const verification = verifyExactWindowTable([...rows, other], [...fake.current.values()], EXACT_MACRO_WINDOW_TARGETS.map((target) => target.id));
    expect(verification).toMatchObject({ status: "pass", changedRows: 5, unchangedRows: 1, newRows: 0, duplicateVintageGroups: 0, availabilityInversions: 0, nullRealtimeStartRows: 0 });
  });

  it("normalizes equivalent raw MySQL UTC timestamps without changing other fields", async () => {
    const fake = fakeDb(rows, 0, true);
    const result = await applyExactMacroWindowRemediation(fake.db, goodPlan());
    expect(result.updatedRows).toBe(5);
    for (const target of EXACT_MACRO_WINDOW_TARGETS) {
      const row = fake.current.get(target.id);
      expect(row?.realtimeEnd).toBeNull();
      expect(row?.fetchedAt).toBe("2026-10-19T19:42:00.000Z");
    }
  });

  it("rolls back all five changes after an artificial error", async () => {
    const fake = fakeDb(rows, 3);
    await expect(applyExactMacroWindowRemediation(fake.db, goodPlan())).rejects.toThrow("forced update failure");
    expect(fake.transactions()).toBe(1);
    expect([...fake.current.values()]).toEqual(rows);
  });

  it("rejects a stale plan before opening a transaction", async () => {
    const fake = fakeDb(rows);
    await expect(applyExactMacroWindowRemediation(fake.db, buildExactMacroWindowPlan([], archives))).rejects.toThrow("Refusing apply");
    expect(fake.transactions()).toBe(0);
    expect(fake.updates()).toBe(0);
  });

  it("verifies backup SHA256 and exact table fingerprint", () => {
    const dir = mkdtempSync(path.join("worker/.runs", "macro-window-backup-test-"));
    try {
      const manifest = createMacroPointBackup(rows, dir);
      const verified = verifyMacroPointBackup(path.join(dir, "backup-manifest.json"), rows);
      expect(verified.fingerprint).toBe(manifest.fingerprint);
      expect(verified.manifest.rows).toBe(5);
      expect(readFileSync(path.join(dir, "backup-macro-points.json"), "utf8")).toContain("44671");
      expect(() => verifyMacroPointBackup(path.join(dir, "backup-manifest.json"), rows.map((row) => row.id === 44671 ? { ...row, value: 5.1 } : row))).toThrow("fingerprint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
