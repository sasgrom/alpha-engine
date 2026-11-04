import { readFileSync } from "node:fs";
import { Param, SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { applyDdl029, splitDdl029Statements, type Ddl029Database } from "../../apply-ddl-029.mts";

const ddl = readFileSync("db/ddl/029_reviewer_access.sql", "utf8");
function params(node: unknown): unknown[] {
  if (typeof node === "number" || typeof node === "string") return [node];
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
function fakeDb(existingIndex = false) {
  const tables = new Set(["reviewer_access"]);
  let indexExists = existingIndex;
  const calls: { kind: string; text: string }[] = [];
  const db = {
    execute: vi.fn(async (query: unknown) => {
      const text = strings(query).join("");
      const values = params(query);
      if (text.includes("information_schema.STATISTICS")) {
        expect(values).toContain("reviewer_access");
        expect(values).toContain("idx_reviewer_access_accepted");
        calls.push({ kind: "index_check", text });
        return [[{ count: indexExists ? 1 : 0 }]];
      }
      calls.push({ kind: "ddl", text });
      if (text.startsWith("CREATE TABLE IF NOT EXISTS `reviewer_tour_preferences`")) tables.add("reviewer_tour_preferences");
      if (text.startsWith("CREATE INDEX")) {
        if (indexExists) throw new Error("Duplicate index");
        indexExists = true;
      }
      if (/drop|alter|truncate/i.test(text)) throw new Error("Forbidden statement reached database");
      return [[]];
    }),
  };
  return { db: db as unknown as Ddl029Database, tables, calls, indexExists: () => indexExists };
}

describe("DDL 029 sequential apply", () => {
  it("executes each statement once, creates the index once and is idempotent", async () => {
    const fake = fakeDb();
    const log = vi.fn();
    await applyDdl029(fake.db, ddl, log);
    expect(fake.tables.has("reviewer_access")).toBe(true);
    expect(fake.tables.has("reviewer_tour_preferences")).toBe(true);
    expect(fake.indexExists()).toBe(true);
    expect(fake.calls.filter((call) => call.kind === "ddl")).toHaveLength(3);
    expect(fake.calls.filter((call) => call.kind === "index_check")).toHaveLength(1);
    expect(fake.calls.map((call) => call.kind)).toEqual(["ddl", "ddl", "index_check", "ddl"]);

    await applyDdl029(fake.db, ddl, log);
    expect(fake.calls.filter((call) => call.kind === "index_check")).toHaveLength(2);
    expect(fake.calls.filter((call) => call.kind === "ddl" && call.text.startsWith("CREATE INDEX"))).toHaveLength(1);
    expect(fake.calls.filter((call) => call.kind === "ddl" && call.text.startsWith("CREATE TABLE IF NOT EXISTS `reviewer_access`"))).toHaveLength(2);
    expect(fake.tables.has("reviewer_access")).toBe(true);
    expect(fake.tables.has("reviewer_tour_preferences")).toBe(true);
    expect(log).toHaveBeenCalledWith("step 3/3: idx_reviewer_access_accepted already exists; skipping");
    for (const message of log.mock.calls.map(([message]) => message)) {
      expect(message).toMatch(/^step \d+\/3: /);
      expect(message).not.toContain("CREATE TABLE");
      expect(message).not.toContain("CREATE INDEX");
      expect(message).not.toMatch(/DATABASE_URL|password|secret|mysql/i);
    }
  });

  it("skips an already present index before executing it", async () => {
    const fake = fakeDb(true);
    const log = vi.fn();
    await applyDdl029(fake.db, ddl, log);
    expect(fake.calls.filter((call) => call.kind === "index_check")).toHaveLength(1);
    expect(fake.calls.filter((call) => call.kind === "ddl" && call.text.startsWith("CREATE INDEX"))).toHaveLength(0);
    expect(log).toHaveBeenCalledWith("step 3/3: idx_reviewer_access_accepted already exists; skipping");
  });

  it("rejects unexpected statements before any database write", async () => {
    const fake = fakeDb();
    await expect(applyDdl029(fake.db, "ALTER TABLE `reviewer_access` ADD COLUMN `tmp` int;")).rejects.toThrow("Unsupported DDL statement");
    await expect(applyDdl029(fake.db, "CREATE TABLE `another_table` (id int);")).rejects.toThrow("Unsupported DDL statement");
    expect(fake.calls).toHaveLength(0);
  });

  it("keeps the original three statements in order", () => {
    const statements = splitDdl029Statements(ddl);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("`reviewer_access`");
    expect(statements[1]).toContain("`reviewer_tour_preferences`");
    expect(statements[2]).toContain("`idx_reviewer_access_accepted`");
  });
});
