import { readFileSync } from "node:fs";
import path from "node:path";
import unzipper from "unzipper";
import { EXPECTATIONS_APPLY_TABLES, sha256 } from "./prod-backup";

export interface ExpectationsResultRow {
  cik: number;
  accessionNo: string;
  sourceId: string;
  containerId: string;
  inputSha256: string;
  sourceUrl: string;
  status: string;
  guidanceStatus: string;
  statements: unknown[];
  extractionWarnings: unknown[];
  rejectedEvidence: number;
}

export const normalizeZipEntryPath = (entryPath: string) => entryPath.replaceAll("\\", "/");

export async function loadExpectationsReviewedPackage(packagePath: string) {
  const zipBytes = readFileSync(packagePath);
  const archive = await unzipper.Open.buffer(zipBytes);
  const entries = new Map(archive.files.map((entry) => [normalizeZipEntryPath(entry.path), entry]));
  const manifestEntry = entries.get("manifest.json");
  if (!manifestEntry) throw new Error("Expectations package manifest is missing");
  const manifest = JSON.parse((await manifestEntry.buffer()).toString("utf8"));
  if (manifest.packageVersion !== "3.3" || manifest.packageType !== "reviewed-expectations" || manifest.productionApply !== false ||
    manifest.applyPayload !== "expectations-results.json" || manifest.applyStatus !== "not_run") {
    throw new Error("Expectations package is not the reviewed v3.3 local handoff");
  }
  for (const file of manifest.files) {
    if (file.path.includes("..") || path.isAbsolute(file.path)) throw new Error("Expectations package contains an unsafe path");
    const entry = entries.get(file.path);
    if (!entry) throw new Error(`Expectations package payload is missing: ${file.path}`);
    const bytes = await entry.buffer();
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Expectations package hash mismatch: ${file.path}`);
  }
  if (entries.size !== manifest.files.length + 1) throw new Error("Expectations package file set does not match the manifest");
  const payload = JSON.parse((await entries.get("expectations-results.json")!.buffer()).toString("utf8"));
  if (payload.packageVersion !== "3.3" || payload.resultKeyDefinition !== "(cik, accessionNo, sourceId, containerId)" || !Array.isArray(payload.results)) {
    throw new Error("Expectations exact-key payload is invalid");
  }
  const keys = new Set<string>();
  let statements = 0;
  for (const result of payload.results as ExpectationsResultRow[]) {
    const key = `${result.cik}|${result.accessionNo}|${result.sourceId}|${result.containerId}`;
    if (keys.has(key)) throw new Error("Expectations payload contains a duplicate exact result key");
    keys.add(key);
    if (!Array.isArray(result.statements) || !Array.isArray(result.extractionWarnings) || !/^https:\/\/www\.sec\.gov\/Archives\//.test(result.sourceUrl)) {
      throw new Error("Expectations payload contains an invalid result row");
    }
    statements += result.statements.length;
  }
  if (payload.results.length !== manifest.documents || statements !== manifest.counts.outputStatements || payload.resolverReport?.ambiguousStatements !== 0 ||
    payload.resolverReport?.missingParent !== 0 || payload.resolverReport?.heuristicResolved !== 0) {
    throw new Error("Expectations payload counts or resolver report do not match the manifest");
  }
  const readiness = JSON.parse((await entries.get("production-readiness.json")!.buffer()).toString("utf8"));
  return {
    packagePath,
    packageSha256: sha256(zipBytes),
    manifest,
    readiness,
    results: payload.results as ExpectationsResultRow[],
    statements,
    tables: EXPECTATIONS_APPLY_TABLES,
  };
}
