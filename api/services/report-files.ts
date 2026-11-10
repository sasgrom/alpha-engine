import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { reportFilePolicy } from "@contracts/report-files";
import { env } from "../lib/env";
import { existingReport } from "./worker-operational";

interface ReportCandidate {
  body: string;
  generatedAt: Date;
  source: "database" | "static";
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

export async function reportFileResponse(name: string, options: { db?: any; staticRoot?: string } = {}): Promise<Response> {
  const policy = reportFilePolicy(name);
  const root = options.staticRoot ?? path.resolve(process.cwd(), env.isProduction ? "dist/public/reports" : "public/reports");
  const staticFile = path.join(root, name);
  let staticCandidate: ReportCandidate | null = null;
  if (existsSync(staticFile)) {
    const body = readFileSync(staticFile, "utf8");
    const generatedAt = generatedAtFromBody(body, name);
    if (generatedAt) staticCandidate = { body, generatedAt, source: "static" };
  }
  let databaseCandidate: ReportCandidate | null = null;
  try {
    const row = await existingReport(name, options.db);
    if (row) {
      const bodyHash = createHash("sha256").update(row.body).digest("hex");
      if (bodyHash !== row.sha256) throw new Error("Stored report hash mismatch");
      const generatedAt = new Date(row.generatedAt);
      if (!Number.isFinite(generatedAt.getTime())) throw new Error("Stored report generatedAt is invalid");
      databaseCandidate = { body: row.body, generatedAt, source: "database" };
    }
  } catch (error) {
    if (error instanceof Error && (error.message === "Stored report hash mismatch" || error.message === "Stored report generatedAt is invalid")) throw error;
  }
  const selected = databaseCandidate && (!staticCandidate || databaseCandidate.generatedAt.getTime() > staticCandidate.generatedAt.getTime()) ? databaseCandidate : staticCandidate;
  if (!selected) return Response.json({ error: "Report not found or generatedAt unavailable" }, { status: databaseCandidate ? 500 : 404 });
  const compressed = selected.body.startsWith("gzip-base64:");
  const body = compressed ? Buffer.from(selected.body.slice("gzip-base64:".length), "base64") : selected.body;
  return new Response(body, {
    headers: {
      "content-type": `${policy.contentType}; charset=utf-8`,
      ...(compressed ? { "content-encoding": "gzip" } : {}),
      "x-report-generated-at": selected.generatedAt.toISOString(),
      "x-report-source": selected.source,
      "cache-control": "private, no-store",
    },
  });
}
