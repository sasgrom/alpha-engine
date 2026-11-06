import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { applyDdl030, ddl030Statement, type Ddl030Database } from "../../apply-ddl-030.mts";

const ddl = readFileSync("db/ddl/030_cusip_map_ticker_text.sql", "utf8");
const fingerprint = createHash("sha256").update("CREATE cusip_map ticker varchar(20)").digest("hex");
const backup = { table: "cusip_map", rowsTotal: 2, tableFingerprint: fingerprint };
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node instanceof SQL) return node.queryChunks.flatMap(strings);
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object" && "value" in node) return strings((node as { value: unknown }).value);
  return [];
}
function fakeDb(rowsTotal = 2, createTable = "CREATE cusip_map ticker varchar(20)") {
  let dataType = "varchar";
  const calls: string[] = [];
  const db = {
    execute: vi.fn(async (query: unknown) => {
      const text = strings(query).join("");
      if (text.includes("information_schema.COLUMNS")) return [[{ DATA_TYPE: dataType }]];
      if (text.includes("COUNT(*) AS rowsTotal")) return [[{ rowsTotal }]];
      if (text.includes("SHOW CREATE TABLE")) return [[{ "Create Table": createTable }]];
      calls.push(text);
      if (/drop|truncate|create table/i.test(text)) throw new Error("Forbidden statement reached database");
      if (text === "ALTER TABLE cusip_map MODIFY COLUMN ticker TEXT NULL") dataType = "text";
      return [[]];
    }),
  };
  return { db: db as unknown as Ddl030Database, calls };
}

describe("DDL 030 OpenFIGI ticker text migration", () => {
  it("alters only the intended column once and skips a repeat apply", async () => {
    const fake = fakeDb();
    const log = vi.fn();
    await applyDdl030(fake.db, ddl, backup, log);
    await applyDdl030(fake.db, ddl, backup, log);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toBe("ALTER TABLE cusip_map MODIFY COLUMN ticker TEXT NULL");
    expect(log).toHaveBeenNthCalledWith(1, "step 1/1: applied");
    expect(log).toHaveBeenNthCalledWith(2, "step 1/1: ticker already uses TEXT; skipping");
    for (const message of log.mock.calls.map(([message]) => message)) {
      expect(message).not.toMatch(/DATABASE_URL|password|secret|ALTER TABLE/i);
    }
  });

  it("stops on a backup row-count mismatch before altering the table", async () => {
    const fake = fakeDb(3);
    await expect(applyDdl030(fake.db, ddl, backup)).rejects.toThrow("Backup row-count mismatch");
    expect(fake.calls).toHaveLength(0);
  });

  it("stops on a changed pre-migration table fingerprint", async () => {
    const fake = fakeDb(2, "changed schema");
    await expect(applyDdl030(fake.db, ddl, backup)).rejects.toThrow("Backup table fingerprint mismatch");
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects unexpected statements before any database query", async () => {
    const fake = fakeDb();
    expect(() => ddl030Statement("ALTER TABLE cusip_map DROP COLUMN ticker;")).toThrow("Unsupported DDL statement");
    expect(() => ddl030Statement(`${ddl} DROP TABLE cusip_map;`)).toThrow("Unsupported DDL statement");
    expect(fake.calls).toHaveLength(0);
  });
});
