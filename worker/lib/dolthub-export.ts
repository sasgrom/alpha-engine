import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";

export const DOLT_COLUMNS = ["date", "act_symbol", "expiration", "strike", "call_put", "bid", "ask", "vol", "delta", "gamma", "theta", "vega", "rho"] as const;
export const DOLT_CSV_HEADER = DOLT_COLUMNS.join(",");

export function assertTicker(ticker: string): void {
  if (!/^[A-Z][A-Z0-9.-]{0,19}$/.test(ticker)) throw new Error(`Invalid ticker ${ticker}`);
}
export function assertYear(year: number): void {
  const current = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2019 || year > current) throw new Error(`Invalid year ${year}; expected 2019..${current}`);
}
export function batchSql(ticker: string, year: number): string {
  assertTicker(ticker);
  assertYear(year);
  return `SELECT ${DOLT_COLUMNS.join(", ")} FROM option_chain WHERE act_symbol='${ticker}' AND date BETWEEN '${year}-01-01' AND '${year}-12-31' ORDER BY date, expiration, strike, call_put`;
}

export interface CsvStats { rows: number; firstDate: string | null; lastDate: string | null }
export function csvStats(text: string): CsvStats {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!normalized.trim()) return { rows: 0, firstDate: null, lastDate: null };
  const lines = normalized.trimEnd().split(/\r?\n/);
  if (lines[0] !== DOLT_CSV_HEADER) throw new Error(`Unexpected Dolt CSV header: ${lines[0].slice(0, 160)}`);
  if (lines.length === 1) return { rows: 0, firstDate: null, lastDate: null };
  return { rows: lines.length - 1, firstDate: lines[1].slice(0, 10), lastDate: lines.at(-1)!.slice(0, 10) };
}

export function isAllowedOutputRoot(root: string, platform = process.platform): boolean {
  if (platform !== "win32") return true;
  const resolved = path.win32.resolve(root).toUpperCase();
  return resolved === "D:\\" || resolved.startsWith("D:\\");
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
export function readUniverse<T>(file: string): T[] {
  return JSON.parse(readFileSync(file, "utf8")) as T[];
}
export function mergeBatches<T extends { ticker: string; year: number }>(previous: T[], current: T[]): T[] {
  const map = new Map(previous.map((batch) => [`${batch.ticker}|${batch.year}`, batch]));
  for (const batch of current) map.set(`${batch.ticker}|${batch.year}`, batch);
  return [...map.values()].sort((a, b) => a.ticker.localeCompare(b.ticker) || a.year - b.year);
}
