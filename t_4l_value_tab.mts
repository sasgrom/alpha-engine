/**
 * 4l hotfix QA: the Value tab must render (the 4j build crashed the whole
 * page on a stale factors cache). Boot the prod build locally, log in, open
 * /company/AAPL, click VALUE, assert content + zero page errors.
 * Run: npx tsx t_4l_value_tab.mts
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3104;
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn("node", ["dist/boot.js"], { env: { ...process.env, NODE_ENV: "production", PORT: String(PORT) }, stdio: "pipe" });
await new Promise((r) => setTimeout(r, 4000));

const login = await fetch(`${BASE}/api/trpc/auth.login?batch=1`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ "0": { json: { username: "admin", password: "9999" } } }),
});
const cookiePair = (login.headers.get("set-cookie") ?? "").split(";")[0];

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const [name, value] = cookiePair.split("=");
await ctx.addCookies([{ name, value, url: BASE }]);
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/company/AAPL`, { waitUntil: "commit" });
await page.waitForTimeout(5000);
// click the VALUE tab
await page.click('button:has-text("VALUE")');
// the first factors read after the purge computes cold (dozens of series
// queries + 5y of bars) — give it real time
await page.waitForTimeout(20000);

const text = await page.evaluate(() => document.body.innerText);
const ok = text.toUpperCase().includes("INTRINSIC VALUE") || text.toUpperCase().includes("FACTOR LIBRARY") || text.toUpperCase().includes("COMPUTING FACTORS");
const crashed = await page.evaluate(() => (document.getElementById("root")?.innerHTML.length ?? 0) === 0);
if (errors.length > 0) console.error("pageerrors:", errors.join(" | "));
if (crashed) {
  console.error("FAIL: tree empty after VALUE click");
  process.exit(1);
}
if (!ok) {
  console.error("FAIL: no value content rendered. Body head:", JSON.stringify(text.slice(0, 300)));
  process.exit(1);
}
console.log("VALUE tab rendered; page errors:", errors.length === 0 ? "none" : errors.join(" | "));
await page.screenshot({ path: "/tmp/4l-value.png" });
await browser.close();
srv.kill();
console.log("PASS: 4l value tab renders after the cache-version fix");
process.exit(0);
