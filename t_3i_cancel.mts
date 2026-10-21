// 3i QA: honest cancel semantics + orphan sweep.
//   1. orphan "running" row (no live executor) -> requestCancel flips it (force-cancelled)
//   2. orphan "queued" row -> requestCancel flips it
//   3. terminal row -> not-cancellable
//   4. sweepOrphanedJobs marks leftover running/queued rows as error
//   5. a LIVE queued job cancels via the flag path (regression of 3h)
// Cleans up every row it creates.
import { createJob, requestCancel, sweepOrphanedJobs } from "./api/services/runner";
import { getDb } from "./api/queries/connection";
import { jobs } from "@db/schema";
import { inArray, sql } from "drizzle-orm";

const db = getDb();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); c ? pass++ : fail++; };
const ids: number[] = [];
const mkRow = async (status: "running" | "queued" | "done") => {
  const r = await db.insert(jobs).values({ type: "prices", params: "{}", status, startedAt: status === "running" ? new Date() : null });
  const id = Number(r[0].insertId);
  ids.push(id);
  return id;
};
const snap = async (id: number) => (await db.select().from(jobs).where(sql`${jobs.id} = ${id}`))[0];

// 1+2+3: orphan/queued/terminal rows
const orphanRunning = await mkRow("running");
const orphanQueued = await mkRow("queued");
const doneRow = await mkRow("done");
ok("orphan running -> force-cancelled", (await requestCancel(orphanRunning)) === "force-cancelled");
ok("orphan queued -> force-cancelled", (await requestCancel(orphanQueued)) === "force-cancelled");
ok("terminal -> not-cancellable", (await requestCancel(doneRow)) === "not-cancellable");
const o = await snap(orphanRunning);
ok("orphan row flipped with honest message",
  o.status === "cancelled" && /no live executor/.test(o.message ?? ""), o.message ?? "");

// 4: sweep marks remaining running/queued as error
const sweepA = await mkRow("running");
const sweepB = await mkRow("queued");
const n = await sweepOrphanedJobs();
const sa = await snap(sweepA), sb = await snap(sweepB);
ok("sweep marks orphans error", n >= 2 && sa.status === "error" && sb.status === "error",
  `swept=${n} a=${sa.status} b=${sb.status}`);
ok("sweep message mentions restart", /restarted/.test(sa.message ?? ""));

// 5: live queued job via flag path (3h regression)
const blocker = await createJob("prices", { tickers: "ZZZQABLOCK" }); // occupies the queue ~30s (network retries)
const liveQ = await createJob("prices", { tickers: "ZZZQAQUEUED" });
ids.push(blocker, liveQ);
await new Promise((r) => setTimeout(r, 1000)); // let the blocker start
const act = await requestCancel(liveQ);
ok("live queued job -> force-cancelled (row flipped immediately)", act === "force-cancelled", act);
const lq = await snap(liveQ);
ok("queued cancel message", /queued/.test(lq.message ?? ""), lq.message ?? "");
// wait for the blocker to finish so the queue is idle for other tests
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  const b = await snap(blocker);
  if (b.status !== "running" && b.status !== "queued") break;
  await new Promise((r) => setTimeout(r, 2000));
}
const lqFinal = await snap(liveQ);
ok("cancelled-queued job never ran", lqFinal.startedAt === null, `startedAt=${lqFinal.startedAt}`);

await db.delete(jobs).where(inArray(jobs.id, ids));
await db.execute(sql`DELETE FROM job_logs WHERE jobId IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
console.log(`cleaned ${ids.length} test jobs`);
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
