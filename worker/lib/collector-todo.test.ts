import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isCollectorInfrastructureError, isCollectorItemError, readCollectorTodo, retryCollectorTodo, withCollectorRetries } from "./collector-todo";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "collector-todo-"));
  dirs.push(dir);
  return path.join(dir, "todo.jsonl");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("collector retry and todo rule", () => {
  it("records a failing document after two retries and continues with the next company", async () => {
    const file = temp();
    const completed: string[] = [];
    let attempts = 0;
    for (const document of ["good.htm", "bad.htm", "later.htm"]) {
      const result = await withCollectorRetries({
        operation: async () => {
          if (document === "bad.htm") {
            attempts++;
            throw new Error("SecHttpError: HTTP 504");
          }
          return document;
        },
        todoFile: file,
        item: { cik: 1, ticker: "AAA", accession: "a1", document, url: `https://sec.invalid/${document}` },
      });
      if (result.value) completed.push(result.value);
    }
    expect(completed).toEqual(["good.htm", "later.htm"]);
    expect(attempts).toBe(3);
    expect(readCollectorTodo(file)).toEqual([expect.objectContaining({ accession: "a1", document: "bad.htm", error: expect.stringContaining("HTTP 504"), attempts: 3 })]);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("runs one two-attempt post pass and retains only still-failing items", async () => {
    const file = temp();
    await withCollectorRetries({ operation: async () => { throw new Error("HTTP 404"); }, todoFile: file, item: { reportId: "r1", document: "report", url: "https://invalid.test/r1" } });
    let attempts = 0;
    const result = await retryCollectorTodo({ todoFile: file, operation: async () => { attempts++; throw new Error("HTTP 404"); } });
    expect(result).toEqual({ resolved: 0, remaining: 1 });
    expect(attempts).toBe(2);
    expect(readCollectorTodo(file)[0].attempts).toBe(5);
    await retryCollectorTodo({ todoFile: file, operation: async () => "ok" });
    expect(readCollectorTodo(file)).toEqual([]);
  });

  it("stops on infrastructure and code errors without recording them as document skips", async () => {
    const file = temp();
    for (const error of [new Error("HTTP 429"), new Error("TypeError: undefined is not a function")]) {
      await expect(withCollectorRetries({ operation: async () => { throw error; }, todoFile: file, item: { document: "x", url: "https://invalid.test/x" } })).rejects.toThrow();
    }
    expect(isCollectorInfrastructureError("HTTP 429")).toBe(true);
    expect(isCollectorItemError("HTTP 503")).toBe(true);
    expect(isCollectorItemError("TypeError: undefined is not a function")).toBe(false);
    expect(readCollectorTodo(file)).toEqual([]);
  });
});
