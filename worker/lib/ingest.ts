/**
 * Ingest client for the home worker (Variant C, 4k/D45).
 * POSTs validated signal batches to the cloud endpoint with the worker key.
 * The server stamps ingestedAt itself (D43) and INSERT-IGNOREs redeliveries,
 * so resending the same batch is safe and free.
 */
import { fetchJson } from "./http";

export interface SignalRow {
  cik: number;
  source: "gdelt" | "stocktwits" | "reddit" | "youtube" | "trends" | "edgar";
  signalType: "tone" | "buzz" | "label";
  eventTs: string; // "YYYY-MM-DD HH:MM:SS" — content time (client-side)
  score?: number | null;
  magnitude?: number | null;
  payloadKey?: string | null;
  src?: "live" | "backfill";
  note?: string | null; // one-line model rationale (5c), human-facing
}

export interface IngestResult {
  ok: boolean;
  worker?: string;
  accepted?: number;
  skippedDupes?: number;
}

const CHUNK = 500; // hosted-MySQL packet rule, enforced server-side too

export const PROD_INGEST_URL = "https://alphadelta-2.kimi.pro/api/worker/ingest";

export async function postSignals(rows: SignalRow[], opts: { url?: string } = {}): Promise<{ accepted: number; skippedDupes: number; batches: number }> {
  const key = process.env.WORKER_KEY;
  if (!key) throw new Error("WORKER_KEY missing from environment (.env)");
  const url = opts.url ?? process.env.INGEST_URL ?? PROD_INGEST_URL;
  let accepted = 0, skippedDupes = 0, batches = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const res = await fetchJson<IngestResult>(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ kind: "signals", rows: slice }),
      retries: 3,
    });
    accepted += res.accepted ?? 0;
    skippedDupes += res.skippedDupes ?? 0;
    batches++;
  }
  return { accepted, skippedDupes, batches };
}
