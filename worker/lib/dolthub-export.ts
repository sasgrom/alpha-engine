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

/**
 * One snapshot date for many symbols. The table's primary key starts with the date, so this is a short read,
 * while one symbol over a year makes Dolt read the whole year. Rows come per symbol in expiration, strike,
 * call/put order, which is the order of a per-ticker export within one date.
 */
export function dateSql(date: string, symbols: string[]): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date ${date}`);
  if (!symbols.length) throw new Error("At least one symbol is required");
  for (const symbol of symbols) assertTicker(symbol);
  return `SELECT ${DOLT_COLUMNS.join(", ")} FROM option_chain WHERE date = '${date}' AND act_symbol IN (${symbols.map((symbol) => `'${symbol}'`).join(", ")}) ORDER BY act_symbol, expiration, strike, call_put`;
}

/** Dolt CSV output of one query split into its data lines per symbol (second column), in output order. */
export function splitBySymbol(text: string): Map<string, string[]> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.length);
  const bySymbol = new Map<string, string[]>();
  if (!lines.length) return bySymbol;
  if (lines[0] !== DOLT_CSV_HEADER) throw new Error(`Unexpected Dolt CSV header: ${lines[0].slice(0, 160)}`);
  for (const line of lines.slice(1)) {
    const symbol = line.split(",", 2)[1];
    if (!symbol) throw new Error(`Malformed Dolt CSV line: ${line.slice(0, 160)}`);
    (bySymbol.get(symbol) ?? bySymbol.set(symbol, []).get(symbol)!).push(line);
  }
  return bySymbol;
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

export interface CsvInspection extends CsvStats { invalidRows: number; duplicates: number }
export function inspectCsv(text: string): CsvInspection {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!normalized.trim()) return { rows: 0, firstDate: null, lastDate: null, invalidRows: 0, duplicates: 0 };
  const lines = normalized.trimEnd().split(/\r?\n/);
  if (lines[0] !== DOLT_CSV_HEADER) throw new Error(`Unexpected Dolt CSV header: ${lines[0].slice(0, 160)}`);
  const seen = new Set<string>();
  let invalidRows = 0, duplicates = 0, previousDate = "";
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length !== DOLT_COLUMNS.length || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) || (previousDate && parts[0] < previousDate)) {
      invalidRows++;
    }
    previousDate = parts[0];
    const key = `${parts[0]}|${parts[2]}|${parts[3]}|${parts[4]}`;
    if (seen.has(key)) duplicates++;
    seen.add(key);
  }
  return { ...csvStats(normalized), invalidRows, duplicates };
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
