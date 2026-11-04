/** Targeted read-only BAML chunk verification, not a full collector.
 * Writes only new official-response evidence; never edits normalized data or manifests. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchFredText, redactFredSecrets } from "../worker/lib/fred";
import { classifyBamlChunk } from "../worker/lib/macro-source-remediation";

const seriesId = "BAMLH0A0HYM2";
const macroRoot = path.resolve(process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro");
const outDir = path.resolve(`worker/.runs/baml-chunk-verification-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
mkdirSync(outDir, { recursive: true });
const apiKey = process.env.FRED_API_KEY?.trim() ?? "";
if (!/^[a-z0-9]{32}$/.test(apiKey)) throw new Error("FRED_API_KEY is unavailable in application configuration");
const localDir = path.join(macroRoot, "raw/fred", seriesId);
const local = {
  metadata: { id: JSON.parse(readFileSync(path.join(localDir, "metadata.json"), "utf8")).seriess?.[0]?.id },
  observations: JSON.parse(readFileSync(path.join(localDir, "chunks/observations-2023-10-31_2023-12-31.json"), "utf8")).observations ?? [],
  vintageDates: JSON.parse(readFileSync(path.join(localDir, "chunks/vintagedates-2023-10-31_2023-12-31.json"), "utf8")).vintage_dates ?? [],
};
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const result: any = { schemaVersion: 1, generatedAt: new Date().toISOString(), seriesId, networkCalls: [] };
try {
  const metadataText = await fetchFredText("series", { series_id: seriesId }, apiKey);
  result.networkCalls.push({ endpoint: "series", status: "success" });
  const observationText = await fetchFredText("series/observations", {
    series_id: seriesId,
    realtime_start: "2023-10-31",
    realtime_end: "2023-12-31",
    observation_start: "2023-10-31",
    observation_end: "2023-12-31",
    output_type: "1",
    sort_order: "asc",
    limit: "100000",
  }, apiKey);
  result.networkCalls.push({ endpoint: "series/observations", status: "success" });
  const vintageText = await fetchFredText("series/vintagedates", {
    series_id: seriesId,
    realtime_start: "2023-10-31",
    realtime_end: "2023-12-31",
    sort_order: "asc",
    limit: "10000",
  }, apiKey);
  result.networkCalls.push({ endpoint: "series/vintagedates", status: "success" });
  const official = {
    metadata: { id: JSON.parse(metadataText).seriess?.[0]?.id },
    observations: JSON.parse(observationText).observations ?? [],
    vintageDates: JSON.parse(vintageText).vintage_dates ?? [],
  };
  result.verification = classifyBamlChunk(local, official);
  const archiveDir = path.join(macroRoot, "review", seriesId, new Date().toISOString().replaceAll(":", "").replaceAll(".", ""));
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(path.join(archiveDir, "observations.json"), observationText, { flag: "wx" });
  writeFileSync(path.join(archiveDir, "vintagedates.json"), vintageText, { flag: "wx" });
  writeFileSync(path.join(archiveDir, "metadata.json"), metadataText, { flag: "wx" });
  result.officialEvidence = { archiveDir, observationsSha256: sha256(observationText), vintageDatesSha256: sha256(vintageText), metadataSha256: sha256(metadataText) };
  result.normalizedOrManifestChanged = false;
  result.chunkDeleted = false;
} catch (error) {
  result.verification = { classification: "UNVERIFIED_OR_STALE_CHUNK", reason: redactFredSecrets(error instanceof Error ? error.message : String(error), apiKey).slice(0, 600) };
  result.networkCalls.push({ status: "error" });
  result.normalizedOrManifestChanged = false;
  result.chunkDeleted = false;
  writeFileSync(path.join(outDir, "verification.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
writeFileSync(path.join(outDir, "verification.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
