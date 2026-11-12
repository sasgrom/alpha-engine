import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPORT_FILE_POLICY, reportFilePolicy } from "@contracts/report-files";
import { env } from "../lib/env";
import { existingReport } from "./worker-operational";
import { MARKET_REPORT_PARENTS, PAGE_DATA_KEYS } from "./page-data";
import { readPageDataArtifact } from "../../worker/lib/precomputed-page-data";

interface ReportCandidate {
  body: string | Buffer;
  generatedAt: Date;
  source: "database" | "static";
  compressed: boolean;
}

function generatedAtFromBody(body: string, name: string): Date | null {
  try {
    if (name.endsWith(".json")) {
      const value = JSON.parse(body).generatedAt;
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date : null;
    }
    const match = body.match(/\bGenerated:\s*([^\s·]+)/i);
    const date = match ? new Date(match[1]) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

export async function reportFileResponse(name: string, options: { db?: any; staticRoot?: string; pageDataRoot?: string; operationsStateFile?: string; acceptEncoding?: string } = {}): Promise<Response> {
  // A name outside the whitelist is not served: an honest 404, not a server error.
  if (!REPORT_FILE_POLICY[name]) return Response.json({ error: "Report not found" }, { status: 404 });
  const policy = reportFilePolicy(name);
  const root = options.staticRoot ?? path.resolve(process.cwd(), env.isProduction ? "dist/public/reports" : "public/reports");
  const pageDataRoot = options.pageDataRoot ?? path.resolve(process.cwd(), "worker", ".runs", "precomputed-page-data");
  const staticFile = path.join(root, name);
  let staticCandidate: ReportCandidate | null = null;
  if (name === "schwab-market-data.json" && /(?:^|,)\s*gzip(?:\s*,|\s*$)/.test(options.acceptEncoding ?? "")) {
    try {
      const cached = readPageDataArtifact<{
        gzipFile: string;
        sourceGeneratedAt: string;
        sourceBytes: number;
        sourceMtimeMs: number;
        sourceSha256: string;
        gzipSha256: string;
      }>({ key: PAGE_DATA_KEYS.marketReport, parents: MARKET_REPORT_PARENTS, root: pageDataRoot, stateFile: options.operationsStateFile, includeDay: false });
      if (cached && existsSync(staticFile)) {
        const payload = cached.payload;
        const sourceBytes = readFileSync(staticFile);
        const sourceMatches = sourceBytes.length === payload.sourceBytes
          && createHash("sha256").update(sourceBytes).digest("hex") === payload.sourceSha256;
        const generatedAt = new Date(payload.sourceGeneratedAt);
        if (sourceMatches && path.basename(payload.gzipFile) === payload.gzipFile && Number.isFinite(generatedAt.getTime())) {
          const gzip = readFileSync(path.join(pageDataRoot, payload.gzipFile));
          if (createHash("sha256").update(gzip).digest("hex") === payload.gzipSha256) {
            staticCandidate = { body: gzip, generatedAt, source: "static", compressed: true };
          }
        }
      }
    } catch {
    }
  }
  if (!staticCandidate && existsSync(staticFile)) {
    const body = readFileSync(staticFile, "utf8");
    const generatedAt = generatedAtFromBody(body, name);
    if (generatedAt) staticCandidate = { body, generatedAt, source: "static", compressed: false };
  }
  let databaseCandidate: ReportCandidate | null = null;
  try {
    const row = await existingReport(name, options.db);
    if (row) {
      const bodyHash = createHash("sha256").update(row.body).digest("hex");
      if (bodyHash !== row.sha256) throw new Error("Stored report hash mismatch");
      const generatedAt = new Date(row.generatedAt);
      if (!Number.isFinite(generatedAt.getTime())) throw new Error("Stored report generatedAt is invalid");
      databaseCandidate = { body: row.body, generatedAt, source: "database", compressed: false };
    }
  } catch (error) {
    if (error instanceof Error && (error.message === "Stored report hash mismatch" || error.message === "Stored report generatedAt is invalid")) throw error;
  }
  const selected = databaseCandidate && (!staticCandidate || databaseCandidate.generatedAt.getTime() > staticCandidate.generatedAt.getTime()) ? databaseCandidate : staticCandidate;
  if (!selected) return Response.json({ error: "Report not found or generatedAt unavailable" }, { status: databaseCandidate ? 500 : 404 });
  const encoded = typeof selected.body === "string" && selected.body.startsWith("gzip-base64:");
  const compressed = selected.compressed || encoded;
  const body = encoded && typeof selected.body === "string" ? Buffer.from(selected.body.slice("gzip-base64:".length), "base64") : selected.body;
  return new Response(body, {
    headers: {
      "content-type": `${policy.contentType}; charset=utf-8`,
      ...(compressed ? { "content-encoding": "gzip" } : {}),
      "x-report-generated-at": selected.generatedAt.toISOString(),
      "x-report-source": selected.source,
      "cache-control": "private, no-store",
      "vary": "accept-encoding",
    },
  });
}
