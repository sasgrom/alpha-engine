// E2E QA for iteration 3g: bulk zip chunked upload + import.
// Flow: split /tmp/test-3g.zip into 2 raw halves -> POST both through the real
// chunk endpoint (admin cookie) -> launch prices.startImport via tRPC ->
// poll the job in DB -> verify imported bars -> cleanup rows + storage parts.
import { readFileSync } from "fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const BASE = "http://localhost:3000";
const COOKIE = "kimi_sid=eyJhbGciOiJIUzI1NiJ9.eyJ1bmlvbklkIjoiZGF0cHBvY2RkZ3NiZDZ0dWI0NDAiLCJjbGllbnRJZCI6InFhIiwiaWF0IjoxNzkxNjYyMzgzLCJleHAiOjE4MjMyMTk5ODN9.tSNMTbCx0S2bsfjEudn52PjQzvNryR7jTYc-HsQbRJg";
const batch = crypto.randomUUID();
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  cond ? pass++ : fail++;
};

const buf = readFileSync("/tmp/test-3g.zip");
const half = Math.ceil(buf.length / 2);
const parts = [buf.subarray(0, half), buf.subarray(half)];
console.log(`zip ${buf.length} bytes -> ${parts.length} parts, batch ${batch}`);

// --- upload both halves through the real endpoint
for (let i = 0; i < parts.length; i++) {
  const res = await fetch(`${BASE}/api/prices-import/chunk?batch=${batch}&idx=${i}`, {
    method: "POST",
    headers: { Cookie: COOKIE, "Content-Type": "application/octet-stream" },
    body: parts[i],
  });
  const body: any = await res.json().catch(() => null);
  ok(`chunk ${i} accepted`, res.ok && body?.key?.includes(`prices-import/${batch}/part-000${i}`), JSON.stringify(body));
}

// --- negative: bad batch id rejected
const bad = await fetch(`${BASE}/api/prices-import/chunk?batch=nope&idx=0`, {
  method: "POST", headers: { Cookie: COOKIE }, body: "x",
});
ok("invalid batch rejected", bad.status === 400);

// --- negative: no cookie rejected
const anon = await fetch(`${BASE}/api/prices-import/chunk?batch=${batch}&idx=9`, { method: "POST", body: "x" });
ok("anonymous rejected", anon.status === 401 || anon.status === 403, `HTTP ${anon.status}`);

// --- launch the import job via tRPC
const tr = await fetch(`${BASE}/api/trpc/prices.startImport`, {
  method: "POST",
  headers: { Cookie: COOKIE, "Content-Type": "application/json" },
  body: JSON.stringify({ json: { batch } }),
});
const trBody: any = await tr.json().catch(() => null);
// the mutation returns the raw numeric job id (createJob's return value)
const jobId = trBody?.result?.data?.json ?? trBody?.result?.data;
ok("startImport accepted", tr.ok && typeof jobId === "number", `HTTP ${tr.status} jobId=${jobId}`);

// --- poll job to completion
const db = getDb();
let job: any = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const rows: any = await db.execute(sql`SELECT status, processed, total, message FROM jobs WHERE id=${jobId}`);
  job = rows[0]?.[0];
  if (job && (job.status === "done" || job.status === "error")) break;
}
ok("job finished done", job?.status === "done", JSON.stringify(job));

// --- job log mentions matches + missing
const logs: any = await db.execute(sql`SELECT level, message FROM job_logs WHERE jobId=${jobId} ORDER BY id`);
const lines = (logs[0] ?? []).map((l: any) => `[${l.level}] ${l.message}`);
console.log("--- job log ---"); lines.forEach((l: string) => console.log("  " + l));
ok("log: import finished with 2 matched", lines.some((l: string) => l.includes("Import finished") && l.includes("2/2")));
ok("log: unwanted ticker not mentioned as imported", !lines.some((l: string) => l.includes("ZZZNOPE")));

// --- DB verification
const aapl: any = await db.execute(sql`SELECT COUNT(*) n, MIN(date) mn, MAX(date) mx FROM prices WHERE cik=320193 AND source='stooq'`);
ok("AAPL bars = 60", Number(aapl[0][0].n) === 60, JSON.stringify(aapl[0][0]));
const spy: any = await db.execute(sql`SELECT COUNT(*) n FROM prices WHERE cik=0 AND ticker='SPY' AND source='stooq'`);
ok("SPY benchmark bars = 60 (cik=0)", Number(spy[0][0].n) === 60, JSON.stringify(spy[0][0]));
const zzz: any = await db.execute(sql`SELECT COUNT(*) n FROM prices WHERE ticker='ZZZNOPE'`);
ok("unwanted ticker not imported", Number(zzz[0][0].n) === 0);
const sample: any = await db.execute(sql`SELECT date, open, close, adjClose, volume FROM prices WHERE cik=320193 AND source='stooq' ORDER BY date LIMIT 1`);
console.log("sample row:", JSON.stringify(sample[0][0]));
ok("adjClose equals close", Number(sample[0][0].adjClose) === Number(sample[0][0].close));

// --- read path: prices.history ALL via tRPC
const hq = await fetch(`${BASE}/api/trpc/prices.history?input=${encodeURIComponent(JSON.stringify({ json: { cik: 320193, range: "ALL" } }))}`, {
  headers: { Cookie: COOKIE },
});
const hqBody: any = await hq.json().catch(() => null);
const bars = hqBody?.result?.data?.json?.bars ?? hqBody?.result?.data?.bars;
ok("prices.history ALL returns imported bars", Array.isArray(bars) && bars.length === 60, `HTTP ${hq.status} n=${bars?.length}`);

// --- cleanup: DB rows + storage parts
await db.execute(sql`DELETE FROM prices WHERE source='stooq' AND ticker IN ('AAPL','SPY')`);
const left: any = await db.execute(sql`SELECT COUNT(*) n FROM prices WHERE source='stooq'`);
ok("cleanup: test rows removed", Number(left[0][0].n) === 0);

const { storage } = await import("./api/lib/storage");
const listed = await storage.listFiles({ prefix: `prices-import/${batch}/`, delimiter: "" });
const keys = listed.objects.map((f) => f.key);
if (keys.length) await storage.deleteFiles({ fileKeys: keys });
const after = await storage.listFiles({ prefix: `prices-import/${batch}/`, delimiter: "" });
ok("cleanup: storage parts removed", after.objects.length === 0, `deleted ${keys.length} parts`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
