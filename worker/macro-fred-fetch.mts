/** Local FRED/ALFRED collector with raw evidence, vintage history and day-precision availability. */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MACRO_RESEARCH_START, realtimeResearchStart, selectMacroSeries, type MacroGroup, type MacroSeriesDefinition } from "./lib/macro-sources";
import { fetchFredText, mergeVintageDates, normalizeFredObservations, realtimeChunks, sha256Text, type FredObservation, type FredSeriesMetadata, type NormalizedMacroPoint } from "./lib/fred";
import { prepareMacroRoot, writeTextAtomic } from "./lib/macro-io";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

interface RawArtifact { file: string; sha256: string }
interface SeriesManifestEntry {
  seriesId: string;
  group: MacroGroup;
  status: "complete" | "empty" | "error";
  availabilityMode?: "alfred_vintages" | "current_fred_only";
  capturedAt: string;
  rows: number;
  firstObservation: string | null;
  lastObservation: string | null;
  firstVintage: string | null;
  lastVintage: string | null;
  raw: { metadata: RawArtifact | null; observations: RawArtifact | null; vintageDates: RawArtifact | null };
  notes?: string;
  error?: string;
}
interface FredManifest { schemaVersion: 1; generatedAt: string; researchSince: "2000-01-01"; entries: SeriesManifestEntry[] }

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const group = arg("--group");
const series = arg("--series")?.toUpperCase() ?? null;
const force = process.argv.includes("--force");
const from = arg("--from") ?? MACRO_RESEARCH_START;
const to = arg("--to") ?? "9999-12-31";
const outRoot = path.resolve(arg("--out") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const apiKey = process.env.FRED_API_KEY?.trim() ?? "";
if (!/^[a-z0-9]{32}$/.test(apiKey)) throw new Error("Set FRED_API_KEY in the current shell session; do not paste it into chat or Git.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("--from and --to must be YYYY-MM-DD");
if (from < MACRO_RESEARCH_START) throw new Error(`--from must be ${MACRO_RESEARCH_START} or later; pre-2000 history is outside the Alpha Engine research window.`);
const selected = selectMacroSeries(group, series);
const root = prepareMacroRoot(outRoot);
const manifestPath = path.join(root, "manifest-fred.json");
const previous: FredManifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8")) as FredManifest
  : { schemaVersion: 1, generatedAt: "", researchSince: MACRO_RESEARCH_START, entries: [] };
const results: SeriesManifestEntry[] = [];
const prog = startProgress("macro-fred", `${selected.length} series · local only · no production sync`);

function pathsFor(seriesId: string) {
  const directory = path.join(root, "raw", "fred", seriesId);
  return {
    metadata: path.join(directory, "metadata.json"),
    observations: path.join(directory, "observations.json"),
    vintageDates: path.join(directory, "vintagedates.json"),
    normalized: path.join(root, "normalized", "fred", `${seriesId}.json`),
  };
}
function readArtifact(file: string): RawArtifact | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  return { file, sha256: sha256Text(text) };
}
function sameArtifact(previous: RawArtifact | null, current: RawArtifact | null): boolean {
  return Boolean(previous && current && previous.sha256 === current.sha256);
}
function persistManifest(): void {
  const merged = new Map(previous.entries.map((entry) => [entry.seriesId, entry]));
  for (const entry of results) merged.set(entry.seriesId, entry);
  writeJsonAtomic(manifestPath, { schemaVersion: 1, generatedAt: new Date().toISOString(), researchSince: MACRO_RESEARCH_START, entries: [...merged.values()].sort((a, b) => a.seriesId.localeCompare(b.seriesId)) } satisfies FredManifest, true);
}
function parseMetadata(raw: string, seriesId: string): FredSeriesMetadata {
  const payload = JSON.parse(raw) as { seriess?: FredSeriesMetadata[] };
  const metadata = payload.seriess?.[0];
  if (!metadata?.id || metadata.id !== seriesId) throw new Error(`FRED metadata mismatch for ${seriesId}`);
  return metadata;
}
function materialize(definition: MacroSeriesDefinition, rawMetadata: string, rawObservations: string, capturedAt: string): NormalizedMacroPoint[] {
  const metadata = parseMetadata(rawMetadata, definition.seriesId);
  const observations = (JSON.parse(rawObservations) as { observations?: FredObservation[] }).observations ?? [];
  return normalizeFredObservations(definition.seriesId, observations, metadata, sha256Text(rawObservations), capturedAt);
}

for (const [index, definition] of selected.entries()) {
  const files = pathsFor(definition.seriesId);
  const prior = previous.entries.find((entry) => entry.seriesId === definition.seriesId);
  const raw = { metadata: readArtifact(files.metadata), observations: readArtifact(files.observations), vintageDates: readArtifact(files.vintageDates) };
  const canResume = !force && prior?.status === "complete" && prior.capturedAt.slice(0, 10) === new Date().toISOString().slice(0, 10) &&
    sameArtifact(prior.raw.metadata, raw.metadata) && sameArtifact(prior.raw.observations, raw.observations) && sameArtifact(prior.raw.vintageDates, raw.vintageDates);
  try {
    let capturedAt = prior?.capturedAt ?? new Date().toISOString();
    if (canResume) {
      prog.log(`${definition.seriesId}: resumed ${prior.rows} rows`);
    } else {
      capturedAt = new Date().toISOString();
      const rawMetadata = await fetchFredText("series", { series_id: definition.seriesId }, apiKey);
      const rawFirstVintage = await fetchFredText("series/vintagedates", { series_id: definition.seriesId, sort_order: "asc", limit: "1" }, apiKey);
      writeTextAtomic(path.join(root, "raw", "fred", definition.seriesId, "vintage-first.json"), rawFirstVintage);
      const firstVintage = (JSON.parse(rawFirstVintage) as { vintage_dates?: string[] }).vintage_dates?.[0] ?? null;
      const observationChunks: FredObservation[][] = [];
      const vintageDateChunks: string[][] = [];
      if (firstVintage) {
        const researchStart = realtimeResearchStart(firstVintage);
        const chunks = realtimeChunks(researchStart, capturedAt.slice(0, 10));
        prog.log(`${definition.seriesId}: source vintage ${firstVintage} · research start ${researchStart} · ${chunks.length} five-year real-time chunks`);
        for (const chunk of chunks) {
          let rawObservations: string;
          let rawVintageDates: string;
          try {
            rawObservations = await fetchFredText("series/observations", {
              series_id: definition.seriesId,
              realtime_start: chunk.start,
              realtime_end: chunk.end,
              observation_start: from,
              observation_end: to,
              output_type: "3",
              sort_order: "asc",
              limit: "100000",
            }, apiKey);
            rawVintageDates = await fetchFredText("series/vintagedates", {
              series_id: definition.seriesId,
              realtime_start: chunk.start,
              realtime_end: chunk.end,
              sort_order: "asc",
              limit: "10000",
            }, apiKey);
          } catch (error) {
            throw new Error(`${definition.seriesId} real-time ${chunk.start}…${chunk.end}: ${error instanceof Error ? error.message : String(error)}`);
          }
          const suffix = `${chunk.start}_${chunk.end}`;
          writeTextAtomic(path.join(root, "raw", "fred", definition.seriesId, "chunks", `observations-${suffix}.json`), rawObservations);
          writeTextAtomic(path.join(root, "raw", "fred", definition.seriesId, "chunks", `vintagedates-${suffix}.json`), rawVintageDates);
          observationChunks.push((JSON.parse(rawObservations) as { observations?: FredObservation[] }).observations ?? []);
          vintageDateChunks.push((JSON.parse(rawVintageDates) as { vintage_dates?: string[] }).vintage_dates ?? []);
        }
      } else {
        prog.log(`${definition.seriesId}: no ALFRED vintages; using current FRED observations only`);
        const rawCurrent = await fetchFredText("series/observations", {
          series_id: definition.seriesId,
          observation_start: from,
          observation_end: to,
          output_type: "1",
          sort_order: "asc",
          limit: "100000",
        }, apiKey);
        observationChunks.push((JSON.parse(rawCurrent) as { observations?: FredObservation[] }).observations ?? []);
      }
      const combinedObservations = JSON.stringify({ observations: observationChunks.flat() });
      const combinedVintageDates = JSON.stringify({ vintage_dates: mergeVintageDates(vintageDateChunks) });
      writeTextAtomic(files.metadata, rawMetadata);
      writeTextAtomic(files.observations, combinedObservations);
      writeTextAtomic(files.vintageDates, combinedVintageDates);
      raw.metadata = readArtifact(files.metadata);
      raw.observations = readArtifact(files.observations);
      raw.vintageDates = readArtifact(files.vintageDates);
    }
    const rows = materialize(definition, readFileSync(files.metadata, "utf8"), readFileSync(files.observations, "utf8"), capturedAt);
    writeJsonAtomic(files.normalized, rows, false);
    const vintageDates = (JSON.parse(readFileSync(files.vintageDates, "utf8")) as { vintage_dates?: string[] }).vintage_dates ?? [];
    results.push({
      seriesId: definition.seriesId,
      group: definition.group,
      status: rows.length ? "complete" : "empty",
      availabilityMode: vintageDates.length ? "alfred_vintages" : "current_fred_only",
      capturedAt,
      rows: rows.length,
      firstObservation: rows[0]?.observationPeriod ?? null,
      lastObservation: rows.at(-1)?.observationPeriod ?? null,
      firstVintage: vintageDates[0] ?? null,
      lastVintage: vintageDates.at(-1) ?? null,
      raw,
      ...(definition.notes ? { notes: definition.notes } : {}),
    });
    prog.item(index + 1, selected.length, `${definition.seriesId} · ${rows.length} vintage rows`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ seriesId: definition.seriesId, group: definition.group, status: "error", capturedAt: new Date().toISOString(), rows: 0, firstObservation: null, lastObservation: null, firstVintage: null, lastVintage: null, raw, error: message.slice(0, 600) });
    prog.log(`! ${definition.seriesId}: ${message.slice(0, 300)}`);
  }
  persistManifest();
}
const errors = results.filter((entry) => entry.status === "error").length;
const rows = results.reduce((total, entry) => total + entry.rows, 0);
prog.done(`series ${results.length} · rows ${rows} · errors ${errors} · manifest ${manifestPath}`);
if (errors) process.exitCode = 1;
