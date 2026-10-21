// 3g verification continued: read path + cleanup (import itself already ran as job 2210001).
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const BASE = "http://localhost:3000";
const COOKIE = "kimi_sid=eyJhbGciOiJIUzI1NiJ9.eyJ1bmlvbklkIjoiZGF0cHBvY2RkZ3NiZDZ0dWI0NDAiLCJjbGllbnRJZCI6InFhIiwiaWF0IjoxNzkxNjYyMzgzLCJleHAiOjE4MjMyMTk5ODN9.tSNMTbCx0S2bsfjEudn52PjQzvNryR7jTYc-HsQbRJg";
const batch = "63318211-aeef-4ba9-b3f2-645315fd19d1";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); c ? pass++ : fail++; };

const hq = await fetch(`${BASE}/api/trpc/prices.history?input=${encodeURIComponent(JSON.stringify({ json: { cik: 320193, range: "ALL" } }))}`, { headers: { Cookie: COOKIE } });
const hb: any = await hq.json().catch(() => null);
const bars = hb?.result?.data?.json?.bars ?? hb?.result?.data?.bars;
ok("prices.history ALL returns 60 imported bars", Array.isArray(bars) && bars.length === 60, `HTTP ${hq.status} n=${bars?.length}`);
ok("history bars carry source stooq", bars?.[0]?.source === "stooq", JSON.stringify(bars?.[0])?.slice(0, 120));

const db = getDb();
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
