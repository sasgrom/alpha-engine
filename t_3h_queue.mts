// 3h queue QA: FIFO serialization + cancel-while-queued (D24).
// Launches three real prices jobs with an empty scope (SPY sync fails fast
// in the sandbox — no external network), then checks:
//   A. j2 does not start before j1 finishes (serialization)
//   B. a job cancelled while queued never runs (startedAt stays NULL)
// Cleans up its own job rows afterwards.
import { createJob, requestCancel } from "./api/services/runner";
import { getDb } from "./api/queries/connection";
import { jobs } from "@db/schema";
import { inArray, sql } from "drizzle-orm";

const db = getDb();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); c ? pass++ : fail++; };

const snap = async (id: number) =>
  (await db.select().from(jobs).where(sql`${jobs.id} = ${id}`))[0];

const j1 = await createJob("prices", { tickers: "ZZZQA1" });
const j2 = await createJob("prices", { tickers: "ZZZQA2" });
const j3 = await createJob("prices", { tickers: "ZZZQA3" });
console.log(`jobs: ${j1}, ${j2}, ${j3}`);

// cancel j3 immediately — it should still be queued behind j1/j2
await requestCancel(j3);
const j3mid = await snap(j3);
console.log("j3 right after cancel:", j3mid.status);

// observed overlap tracker: while polling, j2 must never be running while j1 is
let overlap = false;
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  const [a, b, c] = await Promise.all([snap(j1), snap(j2), snap(j3)]);
  if (a.status === "running" && (b.status === "running")) overlap = true;
  const fin = (s: string) => s === "done" || s === "error" || s === "cancelled";
  if (fin(a.status) && fin(b.status) && fin(c.status)) break;
  await new Promise((r) => setTimeout(r, 2000));
}

const a = await snap(j1), b = await snap(j2), c = await snap(j3);
console.log("final:", JSON.stringify({ j1: a.status, j2: b.status, j3: c.status }));
ok("no concurrent execution observed", !overlap);
ok("j2 started only after j1 finished",
  !a.finishedAt || !b.startedAt || new Date(b.startedAt) >= new Date(a.finishedAt),
  `j1.finished=${a.finishedAt} j2.started=${b.startedAt}`);
ok("j3 cancelled while queued, never ran", c.status === "cancelled" && c.startedAt === null,
  `status=${c.status} startedAt=${c.startedAt}`);

await db.delete(jobs).where(inArray(jobs.id, [j1, j2, j3]));
await db.execute(sql`DELETE FROM job_logs WHERE jobId IN (${j1}, ${j2}, ${j3})`);
console.log("cleaned up test jobs");
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
