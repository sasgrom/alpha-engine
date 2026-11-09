import { gunzipSync, gzipSync } from "node:zlib";
import { verifyWorkerKey } from "./worker";
import { ReviewedApplyError, applyExpectationsReviewed, createExpectationsBackup } from "./worker-expectations";

const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

export async function readWorkerGzipJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-encoding")?.toLowerCase() !== "gzip") throw new ReviewedApplyError(400, "gzip request body required");
  const compressed = Buffer.from(await request.arrayBuffer());
  let bytes: Buffer;
  try {
    bytes = gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch {
    throw new ReviewedApplyError(400, "Invalid or oversized gzip request body");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ReviewedApplyError(400, "Gzip JSON body required");
  }
}

function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof ReviewedApplyError) return Response.json({ error: error.message, details: error.details }, { status: error.status });
  return Response.json({ error: fallback }, { status: 500 });
}

export async function handleWorkerExpectationsBackup(request: Request): Promise<Response> {
  try {
    const label = await verifyWorkerKey(request.headers.get("authorization"), { touch: false });
    if (!label) return Response.json({ error: "unknown or revoked worker key" }, { status: 401 });
    const backup = await createExpectationsBackup();
    const compressed = gzipSync(JSON.stringify(backup), { level: 6 });
    return new Response(compressed, {
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": String(compressed.length),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "Expectations backup failed");
  }
}

export async function handleWorkerExpectationsApply(request: Request): Promise<Response> {
  try {
    const label = await verifyWorkerKey(request.headers.get("authorization"));
    if (!label) return Response.json({ error: "unknown or revoked worker key" }, { status: 401 });
    const input = await readWorkerGzipJson(request);
    const result = await applyExpectationsReviewed(input);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error, "Expectations reviewed apply failed");
  }
}
