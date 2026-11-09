import { gzipSync } from "node:zlib";

export type WorkerExpectationsEndpoint = "/api/worker/backup-expectations" | "/api/worker/apply-expectations-reviewed";

export function workerExpectationsApiUrl(endpoint: WorkerExpectationsEndpoint, ingestUrl = process.env.PROD_INGEST_URL): string {
  if (!ingestUrl) throw new Error("PROD_INGEST_URL is required for --via-api");
  const url = new URL(ingestUrl);
  if (url.protocol !== "https:" || url.pathname !== "/api/worker/ingest") throw new Error("PROD_INGEST_URL must be an HTTPS /api/worker/ingest endpoint");
  url.pathname = endpoint;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export const gzipWorkerJson = (value: unknown) => gzipSync(JSON.stringify(value), { level: 6 });

async function responseJson(response: Response): Promise<any> {
  const body: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ? `Worker API refused the request: ${body.error}` : `Worker API returned HTTP ${response.status}`);
  return body;
}

export async function fetchExpectationsBackupViaApi(): Promise<any> {
  const key = process.env.WORKER_KEY;
  if (!key) throw new Error("WORKER_KEY is required for --via-api");
  const response = await fetch(workerExpectationsApiUrl("/api/worker/backup-expectations"), {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: "{}",
  });
  if (response.headers.get("content-encoding")?.toLowerCase() !== "gzip") throw new Error("Worker backup response was not gzip encoded");
  return responseJson(response);
}

export async function applyExpectationsViaApi(input: unknown): Promise<any> {
  const key = process.env.WORKER_KEY;
  if (!key) throw new Error("WORKER_KEY is required for --via-api");
  const body = gzipWorkerJson(input);
  const response = await fetch(workerExpectationsApiUrl("/api/worker/apply-expectations-reviewed"), {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "content-encoding": "gzip", "content-length": String(body.length) },
    body,
  });
  return responseJson(response);
}
