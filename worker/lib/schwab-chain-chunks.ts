import { sha256Text } from "./schwab-normalize";

export interface SchwabDateChunk { fromDate: string; toDate: string }
export interface SchwabChunkPayload extends SchwabDateChunk { raw: string }
const iso = (date: Date) => date.toISOString().slice(0, 10);

export function monthlySchwabChunks(today: string, months = 60): SchwabDateChunk[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isInteger(months) || months < 1 || months > 60) throw new Error("Invalid Schwab chunk range");
  const start = new Date(`${today}T00:00:00Z`);
  if (!Number.isFinite(start.getTime())) throw new Error("Invalid Schwab chunk start date");
  const chunks: SchwabDateChunk[] = [];
  let from = start;
  for (let index = 0; index < months; index++) {
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    chunks.push({ fromDate: iso(from), toDate: iso(to) });
    from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  }
  return chunks;
}

export function isSchwabBodyOverflow(error: unknown): boolean {
  return (error as { httpStatus?: number })?.httpStatus === 502 && /TooBigBody|Body buffer overflow/i.test(String(error));
}

function mergeExpirations(docs: Record<string, unknown>[], key: "callExpDateMap" | "putExpDateMap"): Record<string, Record<string, unknown[]>> {
  const out: Record<string, Record<string, unknown[]>> = {};
  for (const doc of docs) {
    const expirations = doc[key];
    if (!expirations || typeof expirations !== "object" || Array.isArray(expirations)) continue;
    for (const [expiration, strikeMap] of Object.entries(expirations as Record<string, unknown>) ) {
      if (!strikeMap || typeof strikeMap !== "object" || Array.isArray(strikeMap)) throw new Error(`Invalid Schwab strike map in ${key}`);
      for (const [strike, contracts] of Object.entries(strikeMap as Record<string, unknown>) ) {
        if (!Array.isArray(contracts)) throw new Error(`Invalid Schwab contracts in ${key}/${expiration}/${strike}`);
        (out[expiration] ??= {})[strike] = [...(out[expiration]?.[strike] ?? []), ...contracts];
      }
    }
  }
  return out;
}

export function mergeSchwabChunks(payloads: SchwabChunkPayload[]): string {
  if (!payloads.length) throw new Error("No Schwab chunks to merge");
  const docs = payloads.map((payload) => JSON.parse(payload.raw) as Record<string, unknown>);
  const merged: Record<string, unknown> = { ...docs[0] };
  merged.status = docs.every((doc) => doc.status === "SUCCESS") ? "SUCCESS" : "PARTIAL";
  merged.isDelayed = docs.some((doc) => Boolean(doc.isDelayed));
  merged.isChainTruncated = docs.some((doc) => Boolean(doc.isChainTruncated));
  merged.callExpDateMap = mergeExpirations(docs, "callExpDateMap");
  merged.putExpDateMap = mergeExpirations(docs, "putExpDateMap");
  merged._alphaChunking = {
    schemaVersion: 1,
    chunks: payloads.map((payload) => ({ fromDate: payload.fromDate, toDate: payload.toDate, sha256: sha256Text(payload.raw) })),
  };
  return JSON.stringify(merged);
}
