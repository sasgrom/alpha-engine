// 4a UI QA: /screener page + earnings markers on the AAPL chart.
// Seeds two temporary AAPL earnings events inside the 1Y window for the
// screenshot, then removes them.
import { chromium } from "playwright";
import { getDb } from "./api/queries/connection";
import { events } from "@db/schema";
import { and, eq, sql } from "drizzle-orm";

const db = getDb();
const ACCN = ["0000320193-26-990001", "0000320193-26-990002"];
await db.insert(events).values([
  { cik: 320193, type: "earnings", eventDate: "2026-01-30", filingDate: "2026-01-30", accessionNo: ACCN[0] },
  { cik: 320193, type: "earnings", eventDate: "2026-07-31", filingDate: "2026-07-31", accessionNo: ACCN[1] },
]).onDuplicateKeyUpdate({ set: { accessionNo: sql`VALUES(\`accessionNo\`)` } });

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addCookies([{ name: "kimi_sid", value: "eyJhbGciOiJIUzI1NiJ9.eyJ1bmlvbklkIjoiZGF0cHBvY2RkZ3NiZDZ0dWI0NDAiLCJjbGllbnRJZCI6InFhIiwiaWF0IjoxNzkxNjYyMzgzLCJleHAiOjE4MjMyMTk5ODN9.tSNMTbCx0S2bsfjEudn52PjQzvNryR7jTYc-HsQbRJg", url: "http://localhost:3000" }]);
const page = await ctx.newPage();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); c ? pass++ : fail++; };

// screener page
await page.goto("http://localhost:3000/screener", { waitUntil: "networkidle" });
await page.waitForTimeout(2500); // first build may take a moment
const nav = await page.locator("nav >> text=Screener").count();
ok("nav has Screener", nav === 1);
const bodyText = await page.locator("tbody").textContent().catch(() => "");
ok("screener rows render", (bodyText ?? "").includes("AAPL") && (bodyText ?? "").includes("NVDA"));
ok("metrics visible (FCF mgn + beta)", (bodyText ?? "").includes("31.9%") && (bodyText ?? "").includes("1.08"));
await page.screenshot({ path: "/tmp/qa-4a-screener.png" });

// company chart with earnings markers
await page.goto("http://localhost:3000/company/AAPL", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const markerNote = await page.locator("text=EARNINGS EVENT").count();
ok("earnings markers note under chart", markerNote >= 1);
const lines = await page.locator(".recharts-reference-line").count();
ok("reference lines drawn", lines >= 2, `${lines} lines`);
await page.screenshot({ path: "/tmp/qa-4a-aapl-events.png" });

await browser.close();
await db.delete(events).where(and(eq(events.cik, 320193), sql`${events.accessionNo} IN ('${ACCN[0]}','${ACCN[1]}')`));
console.log("temp events cleaned");
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
