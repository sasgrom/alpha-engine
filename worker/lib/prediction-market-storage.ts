import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DailyExpectationState, PredictionSnapshot } from "../../contracts/prediction-markets";
import { renameWithRetry, writeJsonAtomic } from "./json-file";

export interface PredictionStore {
  exists(file: string): boolean;
  readText(file: string): string;
  readJson(file: string): any;
  writeJson(file: string, value: unknown): void;
  appendText(file: string, text: string): void;
  writeText(file: string, text: string): void;
}

export const nodePredictionStore: PredictionStore = {
  exists: existsSync,
  readText: file => readFileSync(file, "utf8"),
  readJson: file => JSON.parse(readFileSync(file, "utf8")),
  writeJson: (file, value) => writeJsonAtomic(file, value),
  appendText(file, text) {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, text, "utf8");
  },
  writeText(file, text) {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, text, "utf8");
      renameWithRetry(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  },
};

export function memoryPredictionStore(): { store: PredictionStore; files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    store: {
      exists: file => files.has(file),
      readText(file) {
        if (!files.has(file)) throw new Error(`Missing fixture file: ${file}`);
        return files.get(file)!;
      },
      readJson: file => JSON.parse(files.get(file)!),
      writeJson: (file, value) => files.set(file, JSON.stringify(value)),
      appendText: (file, text) => files.set(file, (files.get(file) ?? "") + text),
      writeText: (file, text) => files.set(file, text),
    },
  };
}

function lines(store: PredictionStore, file: string): string[] {
  return store.exists(file) ? store.readText(file).split(/\r?\n/).filter(line => line.trim()) : [];
}

export function readSnapshots(store: PredictionStore, file: string): PredictionSnapshot[] {
  return lines(store, file).map(line => {
    const row = JSON.parse(line) as PredictionSnapshot;
    if (!row.venue || !row.market || !row.fetchedAt) throw new Error(`Invalid prediction snapshot in ${file}`);
    return row;
  });
}

function signature(row: PredictionSnapshot): string {
  return JSON.stringify({
    series: row.series, ticker: row.ticker, cik: row.cik, kind: row.kind, venue: row.venue, market: row.market, event: row.event, title: row.title,
    yesBid: row.yesBid, yesAsk: row.yesAsk, last: row.last, volume: row.volume, openInterest: row.openInterest, closeTime: row.closeTime,
    strikeType: row.strikeType, floor: row.floor, cap: row.cap, liquidityFlag: row.liquidityFlag, rulesHash: row.rulesHash, status: row.status,
    result: row.result, settlementValue: row.settlementValue, settlementRaw: row.settlementRaw, volume24h: row.volume24h, liquidity: row.liquidity,
  });
}

export function appendSnapshots(store: PredictionStore, file: string, rows: PredictionSnapshot[]): { appended: number; skipped: number; sha256: string } {
  const existing = readSnapshots(store, file), known = new Set(existing.map(signature));
  const fresh = rows.filter(row => !known.has(signature(row)));
  if (fresh.length) store.appendText(file, `${fresh.map(row => JSON.stringify(row)).join("\n")}\n`);
  if (!store.exists(file)) store.writeText(file, "");
  return { appended: fresh.length, skipped: rows.length - fresh.length, sha256: createHash("sha256").update(store.readText(file)).digest("hex") };
}

export function updateDailyState(store: PredictionStore, file: string, state: DailyExpectationState): string {
  const rows = new Map<string, DailyExpectationState>();
  for (const line of lines(store, file)) {
    const row = JSON.parse(line) as DailyExpectationState;
    if (!row.date) throw new Error(`Invalid daily expectation state in ${file}`);
    rows.set(row.date, row);
  }
  rows.set(state.date, { ...rows.get(state.date), ...state });
  store.writeText(file, `${[...rows.values()].sort((a, b) => a.date.localeCompare(b.date)).map(row => JSON.stringify(row)).join("\n")}\n`);
  return createHash("sha256").update(store.readText(file)).digest("hex");
}

export function previousFedUpper(store: PredictionStore, file: string): number | null {
  const row = lines(store, file).map(line => JSON.parse(line) as DailyExpectationState).filter(row => typeof row.fedNow === "number").at(-1);
  return row?.fedNow ?? null;
}

export interface PolySettlementRecord {
  event: string;
  decisionDay: string;
  question: string;
  change: number | null;
  orMore: boolean;
  resolvedYes: boolean;
  volume: number | null;
  history: { t: number; p: number }[];
}

export function mergePolySettlement(store: PredictionStore, file: string, record: PolySettlementRecord): { wrote: boolean; sha256: string } {
  const rows: PolySettlementRecord[] = store.exists(file) ? store.readJson(file) : [];
  if (!Array.isArray(rows)) throw new Error(`Invalid settlement history ${file}`);
  const index = rows.findIndex(row => row.event === record.event && row.question === record.question);
  const wrote = index < 0;
  if (index < 0) rows.push(record);
  store.writeJson(file, rows);
  return { wrote, sha256: createHash("sha256").update(store.readText(file)).digest("hex") };
}
