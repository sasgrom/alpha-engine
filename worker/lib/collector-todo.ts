import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface CollectorTodoItem {
  cik?: number;
  ticker?: string;
  accession?: string;
  reportId?: string;
  document: string;
  url: string;
  error: string;
  attempts: number;
  at: string;
}

export function isCollectorInfrastructureError(error: unknown): boolean {
  return /HTTP (?:403|429)\b|throttl|rate.limit|free.*space|D: drive|D:\\|Invalid.*(?:payload|index)|inconsistent|duplicate|schema|checkpoint/i.test(String(error));
}

export function isCollectorItemError(error: unknown): boolean {
  if (isCollectorInfrastructureError(error)) return false;
  return /HTTP (?:404|5\d\d)\b|fetch failed|request (?:TypeError|TimeoutError)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR|operation was aborted|neither an electronic transaction table|linked document is not a PDF|paper report is not a PDF|PTR response is not a PDF/i.test(String(error));
}

const key = (item: CollectorTodoItem) => JSON.stringify([item.cik ?? null, item.ticker ?? null, item.accession ?? null, item.reportId ?? null, item.document, item.url]);
const line = (item: CollectorTodoItem) => JSON.stringify(item);

export function readCollectorTodo(file: string): CollectorTodoItem[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(row => JSON.parse(row));
}

export function writeCollectorTodo(file: string, items: CollectorTodoItem[]): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, items.length ? `${items.map(line).join("\n")}\n` : "");
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function recordCollectorTodo(file: string, item: CollectorTodoItem): void {
  const rows = readCollectorTodo(file);
  const previous = rows.find(row => key(row) === key(item));
  writeCollectorTodo(file, [...rows.filter(row => key(row) !== key(item)), { ...item, attempts: item.attempts + (previous?.attempts ?? 0) }]);
}

export function clearCollectorTodo(file: string, item: Pick<CollectorTodoItem, "document" | "url"> & Partial<CollectorTodoItem>): void {
  if (!existsSync(file)) return;
  writeCollectorTodo(file, readCollectorTodo(file).filter(row => key(row) !== key(item as CollectorTodoItem)));
}

type TodoIdentity = Omit<CollectorTodoItem, "error" | "attempts" | "at">;

export async function withCollectorRetries<T>(options: {
  operation: () => Promise<T>;
  todoFile: string;
  item: TodoIdentity | (() => TodoIdentity);
  attempts?: number;
  now?: () => Date;
}): Promise<{ value: T | null; error: string | null; attempts: number }> {
  const maximum = options.attempts ?? 3;
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error("Collector attempts must be positive");
  const item = () => typeof options.item === "function" ? options.item() : options.item;
  let latest = "";
  for (let attempt = 1; attempt <= maximum; attempt++) {
    try {
      const value = await options.operation();
      clearCollectorTodo(options.todoFile, item());
      return { value, error: null, attempts: attempt };
    } catch (error) {
      latest = String(error).slice(0, 500);
      if (!isCollectorItemError(error)) throw error;
    }
  }
  recordCollectorTodo(options.todoFile, { ...item(), error: latest, attempts: maximum, at: (options.now?.() ?? new Date()).toISOString() });
  return { value: null, error: latest, attempts: maximum };
}

export async function retryCollectorTodo<T>(options: {
  todoFile: string;
  operation: (item: CollectorTodoItem) => Promise<T>;
  attempts?: number;
}): Promise<{ resolved: number; remaining: number }> {
  const rows = readCollectorTodo(options.todoFile);
  let resolved = 0;
  for (const item of rows) {
    const result = await withCollectorRetries({ operation: () => options.operation(item), todoFile: options.todoFile, item, attempts: options.attempts ?? 2 });
    if (!result.error) resolved++;
  }
  return { resolved, remaining: readCollectorTodo(options.todoFile).length };
}
