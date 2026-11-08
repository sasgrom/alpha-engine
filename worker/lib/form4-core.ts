import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchDoc, realCacheRoot } from "./edgar";

export interface Form4UniverseCompany { cik: number; ticker: string; name: string }
export interface Form4ManifestEntry {
  accessionNo: string;
  form: string;
  filingDate: string;
  acceptanceDateTime: string;
  acceptanceSource?: "sec_header";
  periodOfReport: string;
  issuerCik: number;
  ownerCik: number | null;
  rptOwnerName: string | null;
  sourceUrl: string;
  inputSha256: string | null;
  fetched: boolean;
  dead: boolean;
  failCount: number;
  error?: string;
}

export interface Form4Transaction {
  issuerCik: number;
  ticker: string;
  accessionNo: string;
  eventTs: string;
  availableAt: string;
  transactionCode: string;
  transactionFormType: string;
  equitySwapInvolved: boolean | null;
  shares: number | null;
  pricePerShare: number | null;
  valueUsd: number | null;
  acquiredDisposedCode: string;
  directOrIndirect: string;
  natureOfOwnership: string;
  sharesOwnedAfter: number | null;
  percentOwnedAfter: number | null;
  ownerCik: number | null;
  rptOwnerName: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  officerTitle: string | null;
  footnotes: string[];
  sourceUrl: string;
  inputSha256: string;
  periodOfReport: string;
  isAmendment: boolean;
  amendmentOf: string | null;
}

export interface PriceBar { date: string; close: number; volume: number }

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function writeTextAtomic(file: string, value: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, value);
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function readJsonFile<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

export function loadForm4Universe(file: string, tickers = ""): Form4UniverseCompany[] {
  const universe = JSON.parse(readFileSync(file, "utf8")) as Form4UniverseCompany[];
  const requested = new Set(tickers.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean));
  const selected = requested.size ? universe.filter((company) => requested.has(company.ticker)) : universe;
  if (requested.size) {
    const missing = [...requested].filter((ticker) => !selected.some((company) => company.ticker === ticker));
    if (missing.length) throw new Error(`Unknown universe tickers: ${missing.join(",")}`);
  }
  return selected;
}

export function isForm4Placeholder(company: Form4UniverseCompany): boolean {
  return /_(?:PRE|SYNTH)$/i.test(company.ticker) || !Number.isInteger(company.cik) || company.cik <= 0;
}

export function assertForm4DiskSpace(cacheRoot: string): void {
  mkdirSync(cacheRoot, { recursive: true });
  const stats = statfsSync(realCacheRoot(cacheRoot));
  if (stats.bavail * stats.bsize < 15 * 2 ** 30) throw new Error("Free disk space below 15 GiB; checkpoint saved");
}

export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function addBusinessDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isBusinessDay(date)) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function loadReviewedPriceBars(ticker: string): PriceBar[] | null {
  const root = process.env.FORM4_PRICE_ROOT ?? "D:/research/alpha-engine/schwab/pricehistory";
  const file = path.join(root, `${ticker}.json`);
  if (!existsSync(file)) return null;
  const payload = JSON.parse(readFileSync(file, "utf8")) as { empty?: boolean; candles?: { close?: number; volume?: number; datetime?: number }[] };
  if (payload.empty || !Array.isArray(payload.candles) || !payload.candles.length) return null;
  return payload.candles.filter((bar) => Number.isFinite(bar.close) && Number.isFinite(bar.volume) && Number.isFinite(bar.datetime)).map((bar) => ({
    date: new Date(bar.datetime!).toISOString().slice(0, 10),
    close: bar.close!,
    volume: bar.volume!,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export function finiteNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function boolFromXml(value: string | null | undefined): boolean | null {
  if (!value) return null;
  if (/^(?:1|true)$/i.test(value.trim())) return true;
  if (/^(?:0|false)$/i.test(value.trim())) return false;
  return null;
}

export function parseSecAcceptanceDateTime(header: string): string {
  const match = header.match(/<ACCEPTANCE-DATETIME>(\d{14})/i);
  if (!match) throw new Error("SEC acceptance datetime is missing from index-headers");
  const value = match[1];
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
}

export async function fetchSecAcceptanceDateTime(cik: number, accessionNo: string): Promise<string> {
  const header = await fetchDoc(cik, accessionNo, `${accessionNo}-index-headers.html`);
  return parseSecAcceptanceDateTime(header);
}
