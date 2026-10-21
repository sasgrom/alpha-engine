// 3l cache QA (DB path): miss → live fetch + persist; fresh → no refetch;
// stale → served immediately + background refresh swaps the payload;
// refresh failure keeps serving stale. Cleans up its keys.
import { cachedExternal } from "./api/services/ext-cache";
import { getDb } from "./api/queries/connection";
import { externalCache } from "@db/schema";
import { eq, sql } from "drizzle-orm";

const db = getDb();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); c ? pass++ : fail++; };
const KEY = "qa-ext-cache";
const TTL = 3000; // 3 s — comfortably above hosted-DB roundtrip latency

let calls = 0;
const fetcher = async () => ({ n: ++calls });
const backdate = async () =>
  db.update(externalCache).set({ fetchedAt: new Date(Date.now() - 60_000) }).where(eq(externalCache.key, KEY));

// miss → live
const r1 = await cachedExternal(KEY, TTL, fetcher);
ok("miss fetches live and persists", r1.data.n === 1 && r1.source === "live" && r1.fresh);

// fresh → DB, no refetch
const r2 = await cachedExternal(KEY, TTL, fetcher);
ok("fresh serves from DB without refetch", r2.data.n === 1 && r2.source === "live" && calls === 1);

// stale → immediate stale serve + background refresh (backdate instead of sleeping)
await backdate();
const r3 = await cachedExternal(KEY, TTL, fetcher);
ok("stale serves immediately (fresh=false)", r3.fresh === false && r3.data.n === 1);
await new Promise((r) => setTimeout(r, 300)); // let the background refresh land
const r4 = await cachedExternal(KEY, TTL, fetcher);
ok("background refresh swapped the payload", r4.data.n === 2 && r4.fresh === true, `n=${r4.data.n} calls=${calls}`);

// stale + failing refresh → stale keeps being served
await backdate();
const r5 = await cachedExternal(KEY, TTL, async () => { throw new Error("net down"); });
ok("failed refresh keeps serving stale", r5.fresh === false && r5.data.n === 2);
await new Promise((r) => setTimeout(r, 300));

// payload survives JSON round-trip
const [row] = await db.select().from(externalCache).where(eq(externalCache.key, KEY));
ok("row persisted with JSON payload", JSON.parse(row.payload).n === 2 && row.source === "live");

await db.execute(sql`DELETE FROM external_cache WHERE \`key\` = ${KEY}`);
console.log("cleaned up");
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
