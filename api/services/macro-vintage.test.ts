import { Column, Param, SQL, StringChunk } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { macroPoints, type MacroPoint } from "@db/schema";
import { latestEligibleMacroPoint, type MacroVintageDatabase } from "./macro-vintage";
import { latestMacro } from "./macro";
import { macroPriorAt } from "./probability-engine";

const dialect = new MySqlDialect();

function point(id: number, seriesId: string, date: string, value: number | null, realtimeStart: string | null, realtimeEnd: string | null = null): MacroPoint {
  return { id, seriesId, date, value, realtimeStart, realtimeEnd, fetchedAt: new Date("2025-01-01T00:00:00Z") };
}

function sqlToken(part: unknown, row: MacroPoint): unknown {
  if (part instanceof StringChunk) return part.value.join("");
  if (part instanceof SQL) return evaluatePredicate(part, row);
  if (part instanceof Column) return row[part.name as keyof MacroPoint] ?? null;
  if (part instanceof Param) return part.value;
  if (part === null || ["string", "number", "boolean", "undefined"].includes(typeof part)) return part;
  throw new Error(`Unsupported SQL token: ${String(part)}`);
}

function evaluateTokens(parts: unknown[], row: MacroPoint): unknown {
  const tokens = parts.map((part) => sqlToken(part, row)).filter((part) => part !== "");
  if (tokens.length === 1) return tokens[0];
  for (const operator of [" or ", " and "]) {
    if (!tokens.includes(operator)) continue;
    const groups: unknown[][] = [[]];
    for (const token of tokens) {
      if (token === operator) groups.push([]);
      else groups.at(-1)!.push(token);
    }
    const values = groups.map((group) => Boolean(evaluateTokens(group, row)));
    return operator === " or " ? values.some(Boolean) : values.every(Boolean);
  }
  if (tokens.length === 2 && tokens[1] === " is null") return tokens[0] === null || tokens[0] === undefined;
  if (tokens.length === 2 && tokens[1] === " is not null") return tokens[0] !== null && tokens[0] !== undefined;
  if (tokens.length === 3 && [" = ", " <= ", " >= "].includes(String(tokens[1]))) {
    const [left, operator, right] = tokens;
    if (left === null || left === undefined || right === null || right === undefined) return false;
    if (operator === " = ") return left === right;
    if (operator === " <= ") return (left as string | number) <= (right as string | number);
    return (left as string | number) >= (right as string | number);
  }
  throw new Error(`Unsupported SQL predicate: ${JSON.stringify(tokens)}`);
}

function evaluatePredicate(expression: SQL, row: MacroPoint): unknown {
  const chunks = expression.queryChunks;
  if (chunks.length === 1) return sqlToken(chunks[0], row);
  if (chunks[0] instanceof StringChunk && chunks[0].value.join("") === "(" && chunks.at(-1) instanceof StringChunk && (chunks.at(-1) as StringChunk).value.join("") === ")") {
    return evaluateTokens(chunks.slice(1, -1), row);
  }
  return evaluateTokens(chunks, row);
}

// Execute the actual Drizzle predicate and ordering against rows without a DB or network.
function fakeMacroDb(rows: MacroPoint[]) {
  const queries: { limit: number; selected: MacroPoint[] }[] = [];
  const db = {
    queries,
    select() {
      let selected: MacroPoint[] = [];
      const builder = {
        from(table: unknown) {
          expect(table).toBe(macroPoints);
          return builder;
        },
        where(predicate: SQL | undefined) {
          expect(predicate).toBeInstanceOf(SQL);
          selected = rows.filter((row) => evaluatePredicate(predicate!, row) === true);
          return builder;
        },
        orderBy(...terms: SQL[]) {
          selected = [...selected].sort((a, b) => {
            for (const term of terms) {
              const match = /^`macro_points`\.`(\w+)` (asc|desc)$/.exec(dialect.sqlToQuery(term).sql);
              expect(match, "deterministic macro vintage ordering").not.toBeNull();
              const key = match![1] as keyof MacroPoint;
              const direction = match![2] === "desc" ? -1 : 1;
              const left = a[key];
              const right = b[key];
              if (left === right) continue;
              if (left === null || right === null) return (left === null ? -1 : 1) * direction;
              const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
              return comparison * direction;
            }
            return 0;
          });
          return builder;
        },
        async limit(count: number) {
          queries.push({ limit: count, selected });
          return selected.slice(0, count);
        },
      };
      return builder;
    },
  };
  return db as unknown as MacroVintageDatabase & { queries: typeof queries };
}

const revisions = [
  point(1, "VIXCLS", "2025-01-31", 10, "2025-02-01", "2025-02-28"),
  point(2, "VIXCLS", "2025-01-31", 20, "2025-03-01"),
];

describe("shared macro vintage selection", () => {
  it("selects the original before revision and the revision on its realtime start", async () => {
    const db = fakeMacroDb(revisions);
    expect((await latestEligibleMacroPoint("VIXCLS", "2025-02-15", db))?.value).toBe(10);
    expect((await latestEligibleMacroPoint("VIXCLS", "2025-03-01", db))?.value).toBe(20);
    expect(db.queries.every((query) => query.limit === 1)).toBe(true);
  });

  it("returns no evidence before the first known realtime start", async () => {
    expect(await latestEligibleMacroPoint("VIXCLS", "2025-01-31", fakeMacroDb(revisions))).toBeUndefined();
  });

  it("fails closed for a null realtime start instead of using fetchedAt or an unknown vintage", async () => {
    const legacy = point(1, "VIXCLS", "2020-01-01", 10, null);
    legacy.fetchedAt = new Date("2025-02-01T00:00:00Z");
    expect(await latestEligibleMacroPoint("VIXCLS", "2025-02-15", fakeMacroDb([legacy]))).toBeUndefined();
  });

  it("allows an open-ended vintage with a valid realtime start", async () => {
    expect((await latestEligibleMacroPoint("VIXCLS", "2025-02-15", fakeMacroDb([point(1, "VIXCLS", "2025-01-31", 10, "2025-02-01")])))?.value).toBe(10);
  });

  it("treats both realtime endpoints as inclusive and excludes an expired vintage", async () => {
    const anchor = "2025-02-15";
    expect((await latestEligibleMacroPoint("VIXCLS", anchor, fakeMacroDb([point(1, "VIXCLS", "2025-01-31", 10, anchor, anchor)])))?.id).toBe(1);
    expect((await latestEligibleMacroPoint("VIXCLS", anchor, fakeMacroDb([point(2, "VIXCLS", "2025-01-31", 10, "2025-02-01", anchor)])))?.id).toBe(2);
    expect(await latestEligibleMacroPoint("VIXCLS", anchor, fakeMacroDb([point(3, "VIXCLS", "2025-01-31", 10, "2025-02-01", "2025-02-14")]))).toBeUndefined();
  });

  it("excludes observations later than the anchor", async () => {
    expect(await latestEligibleMacroPoint("VIXCLS", "2025-02-15", fakeMacroDb([point(1, "VIXCLS", "2025-02-16", 10, "2025-02-01")]))).toBeUndefined();
  });

  it("selects each series independently", async () => {
    const db = fakeMacroDb([
      point(1, "VIXCLS", "2025-01-31", 10, "2025-02-01"),
      point(2, "BAMLH0A0HYM2", "2025-02-14", 300, "2025-02-14"),
      point(3, "T10Y2Y", "2025-02-01", 1, "2025-02-01"),
    ]);
    const values = await Promise.all(["VIXCLS", "BAMLH0A0HYM2", "T10Y2Y"].map(async (seriesId) => (await latestEligibleMacroPoint(seriesId, "2025-02-15", db))?.value));
    expect(values).toEqual([10, 300, 1]);
  });

  it("uses the newest active realtime start and resolves ties by id", async () => {
    const db = fakeMacroDb([
      point(1, "VIXCLS", "2025-01-31", 10, "2025-02-01"),
      point(2, "VIXCLS", "2025-01-31", 20, "2025-02-15"),
      point(3, "VIXCLS", "2025-01-31", 30, "2025-02-15"),
    ]);
    expect((await latestEligibleMacroPoint("VIXCLS", "2025-02-15", db))?.id).toBe(3);
  });

  it("keeps the newest eligible null value missing without an older or future substitute", async () => {
    const db = fakeMacroDb([
      point(1, "VIXCLS", "2025-01-01", 10, "2025-01-01"),
      point(2, "VIXCLS", "2025-01-31", null, "2025-02-01"),
      point(3, "VIXCLS", "2025-01-31", 30, "2025-03-01"),
    ]);
    const selected = await latestEligibleMacroPoint("VIXCLS", "2025-02-15", db);
    expect(selected?.id).toBe(2);
    expect(selected?.value).toBeNull();
  });
});

describe("production macro readers", () => {
  it("uses the shared bounded selector for the probability prior at both revision anchors", async () => {
    const rows = ["VIXCLS", "BAMLH0A0HYM2", "T10Y2Y"].flatMap((seriesId, index) => [
      point(index * 2 + 1, seriesId, "2025-01-31", [10, 300, 1][index], "2025-02-01", "2025-02-28"),
      point(index * 2 + 2, seriesId, "2025-01-31", [30, 500, -1][index], "2025-03-01"),
    ]);
    const db = fakeMacroDb(rows);
    expect(await macroPriorAt("2025-02-15", db)).toBe(0.54);
    expect(await macroPriorAt("2025-03-01", db)).toBe(0.35);
    expect(db.queries).toHaveLength(6);
    expect(db.queries.every((query) => query.limit === 1 && query.selected.length <= 3)).toBe(true);
  });

  it("keeps future revisions and legacy null-window rows out of dashboard current evidence", async () => {
    const db = fakeMacroDb([...revisions, point(3, "VIXCLS", "2025-02-15", 99, null)]);
    await expect(latestMacro("2025-02-15", db)).resolves.toEqual([
      { seriesId: "VIXCLS", label: "VIX close", unit: "level", date: "2025-01-31", value: 10 },
    ]);
    expect(db.queries).toHaveLength(8);
    expect(db.queries.every((query) => query.limit === 1)).toBe(true);
  });
});
