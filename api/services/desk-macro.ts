/**
 * Reads the Today page's macro card file (scripts/build-desk-macro.mts, worker/.runs/desk-macro.json). The parsed
 * file is kept while its modification time and size are unchanged. A missing file gives an empty card: the page says
 * no readings are stored, it does not fall back to the app's old macro table.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DESK_MACRO_SCHEMA_VERSION, type DeskMacroFile } from "../../worker/lib/desk-macro";

export interface DeskMacroReading { seriesId: string; label: string; unit: string; date: string; value: number | null }

let cached: { file: string; mtimeMs: number; size: number; value: DeskMacroReading[] } | null = null;

export function deskMacroFile(): string {
  return path.resolve(process.cwd(), "worker/.runs/desk-macro.json");
}

export function readDeskMacro(file: string = deskMacroFile()): DeskMacroReading[] {
  if (!existsSync(file)) return [];
  const { mtimeMs, size } = statSync(file);
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs && cached.size === size) return cached.value;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as DeskMacroFile;
  if (parsed.schemaVersion !== DESK_MACRO_SCHEMA_VERSION) throw new Error(`Desk macro file schema ${String(parsed.schemaVersion)} is not the expected ${DESK_MACRO_SCHEMA_VERSION}; rebuild it`);
  const value = parsed.series.map((point) => ({ seriesId: point.seriesId, label: point.label, unit: point.unit, date: point.date, value: point.value }));
  cached = { file, mtimeMs, size, value };
  return value;
}
