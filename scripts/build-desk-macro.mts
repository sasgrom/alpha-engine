/**
 * Writes the Today page's macro card file from the macro archive on D: the newest published value of each of the
 * card's FRED series (worker/lib/desk-macro.ts), read from the normalized vintage files the FRED fetch keeps.
 *
 *   npx tsx scripts/build-desk-macro.mts [--archive <macro archive folder>] [--out <file>] [--dry-run]
 *
 * A missing archive, a manifest entry that is not complete or an unreadable series file stops the build and leaves
 * the previous file in place (the D: drive may be away; nothing is rebuilt from an incomplete read).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildDeskMacro, DESK_MACRO_SERIES, type MacroVintageRow } from "../worker/lib/desk-macro";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const archive = path.resolve(arg("--archive") ?? "D:/research/alpha-engine/macro");
const out = path.resolve(arg("--out") ?? "worker/.runs/desk-macro.json");
const dryRun = process.argv.includes("--dry-run");

const manifestFile = path.join(archive, "manifest-fred.json");
if (!existsSync(manifestFile)) throw new Error(`FRED manifest not found at ${manifestFile}; nothing was changed`);
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { generatedAt: string; entries: { seriesId: string; status: string; lastObservation: string }[] };
const entries = new Map(manifest.entries.map((entry) => [entry.seriesId, entry]));

const rowsBySeries = new Map<string, MacroVintageRow[]>();
for (const { seriesId } of DESK_MACRO_SERIES) {
  const entry = entries.get(seriesId);
  if (!entry) throw new Error(`${seriesId} is not in the FRED manifest; nothing was changed`);
  if (entry.status !== "complete") throw new Error(`${seriesId} is ${entry.status} in the FRED manifest, not complete; nothing was changed`);
  const file = path.join(archive, "normalized", "fred", `${seriesId}.json`);
  if (!existsSync(file)) throw new Error(`${file} not found; nothing was changed`);
  rowsBySeries.set(seriesId, JSON.parse(readFileSync(file, "utf8")) as MacroVintageRow[]);
}

const result = buildDeskMacro({ rowsBySeries, archiveGeneratedAt: manifest.generatedAt, builtAt: new Date().toISOString() });
for (const point of result.series) {
  // the value shown must be for the period the manifest names as the series' last
  const last = entries.get(point.seriesId)!.lastObservation;
  if (point.date !== last) throw new Error(`${point.seriesId}: newest value in force is for ${point.date}, the manifest's last observation is ${last}; nothing was changed`);
}
if (result.series.length !== DESK_MACRO_SERIES.length) throw new Error(`only ${result.series.length} of ${DESK_MACRO_SERIES.length} series have a value in force; nothing was changed`);
if (!dryRun) writeJsonAtomic(out, result);
console.log(`[desk-macro] ${dryRun ? "dry run · " : ""}${result.series.map((point) => `${point.seriesId} ${point.value} (${point.date})`).join(" · ")} · archive of ${manifest.generatedAt} · ${out}`);
