/**
 * A company's short interest from the desk's FINRA file (worker/finra-short-interest.mts,
 * worker/.runs/desk-short-interest.json). The parsed file is kept while its modification time and size are
 * unchanged. The app's short_interest table is not read: it held 50 companies and ended on 2026-10-15.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DESK_SHORT_INTEREST_SCHEMA_VERSION, type DeskShortInterestFile, type DeskShortInterestPoint, type ShareCount } from "../../worker/lib/finra-short-interest";

export interface ShortInterestReading {
  settlementDate: string;
  sharesShort: number;
  /** FINRA does not publish a float, so no share of float is given. */
  shortPercentOfFloat: null;
  /** Shares short / the share count known at the settlement date, all classes (see DeskShortInterestPoint). */
  shortPercentOfShares: number | null;
  shareCount: ShareCount | null;
  /** Days to cover: shares short over average daily volume. */
  shortRatio: number | null;
  source: "finra";
}

let cached: { file: string; mtimeMs: number; size: number; value: DeskShortInterestFile } | null = null;

export function deskShortInterestFile(): string {
  return path.resolve(process.cwd(), "worker/.runs/desk-short-interest.json");
}

export function readDeskShortInterestFile(file: string = deskShortInterestFile()): DeskShortInterestFile | null {
  if (!existsSync(file)) return null;
  const { mtimeMs, size } = statSync(file);
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs && cached.size === size) return cached.value;
  const value = JSON.parse(readFileSync(file, "utf8")) as DeskShortInterestFile;
  if (value.schemaVersion !== DESK_SHORT_INTEREST_SCHEMA_VERSION) throw new Error(`Desk short interest file schema ${String(value.schemaVersion)} is not the expected ${DESK_SHORT_INTEREST_SCHEMA_VERSION}; rebuild it`);
  cached = { file, mtimeMs, size, value };
  return value;
}

const reading = (point: DeskShortInterestPoint): ShortInterestReading => ({ settlementDate: point.date, sharesShort: point.shares, shortPercentOfFloat: null, shortPercentOfShares: point.shareOfShares ?? null, shareCount: point.shareCount ?? null, shortRatio: point.daysToCover, source: "finra" });

/** The latest reading, the one before it and the change in shares short; null for a company FINRA does not list. */
export function latestDeskShortInterest(cik: number, file: string = deskShortInterestFile()): { current: ShortInterestReading; prior: ShortInterestReading | null; deltaShares: number | null } | null {
  const points = readDeskShortInterestFile(file)?.companies[String(cik)];
  if (!points?.length) return null;
  const [current, prior] = points;
  return { current: reading(current), prior: prior ? reading(prior) : null, deltaShares: prior ? current.shares - prior.shares : null };
}
