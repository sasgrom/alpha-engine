import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { writePageDataArtifact } from "./precomputed-page-data";

export function pageDataCodeVersion(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "untracked";
  }
}

export function buildMarketReportGzip(options: { sourceFile: string; root?: string; codeVersion?: string; stateFile?: string }) {
  const sourceFile = path.resolve(options.sourceFile);
  const root = path.resolve(options.root ?? path.join("worker", ".runs", "precomputed-page-data"));
  const sourceBytes = readFileSync(sourceFile);
  const source = JSON.parse(sourceBytes.toString("utf8"));
  if (typeof source.generatedAt !== "string" || !Number.isFinite(Date.parse(source.generatedAt))) throw new Error("schwab-market-data.json has no valid generatedAt");
  const sourceStat = statSync(sourceFile);
  const gzip = gzipSync(sourceBytes, { level: 9 });
  const gzipFile = path.join(root, "schwab-market-data.json.gz");
  mkdirSync(root, { recursive: true });
  const temporary = `${gzipFile}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, gzip);
    renameSync(temporary, gzipFile);
  } finally {
    rmSync(temporary, { force: true });
  }
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const payload = {
    gzipFile: path.basename(gzipFile),
    sourceGeneratedAt: source.generatedAt,
    sourceBytes: sourceStat.size,
    sourceMtimeMs: sourceStat.mtimeMs,
    sourceSha256: hash(sourceBytes),
    gzipSha256: hash(gzip),
  };
  const artifact = writePageDataArtifact({
    key: "market-report-gzip",
    parents: ["schwab-snapshot"],
    stateFile: options.stateFile,
    includeDay: false,
    codeVersion: options.codeVersion ?? pageDataCodeVersion(),
    root,
    inputs: payload,
    payload,
  });
  return { payload, gzipFile, gzipBytes: gzip.length, artifact };
}
