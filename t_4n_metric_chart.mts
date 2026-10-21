/**
 * 4n QA (D47): the stat tiles chart their stored history on click. Boot the
 * prod build, log in, open /company/AAPL, click the Market cap tile, assert
 * the dialog renders a chart with points. Run: npx tsx t_4n_metric_chart.mts
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3105;
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
await page.waitForTimeout(6000);
await page.click('text=Market cap >> nth=0');
await page.waitForTimeout(4000);

const body = await page.evaluate(() => document.body.innerText);
const hasDialog = body.toUpperCase().includes("MARKET CAP — HISTORY");
const svgPoints = await page.evaluate(() => document.querySelectorAll("dialog svg, [role='dialog'] svg").length);
if (errors.length) console.error("pageerrors:", errors.join(" | "));
if (!hasDialog || svgPoints === 0) {
  console.error("FAIL: dialog/chart missing —", JSON.stringify(body.slice(0, 200)));
  process.exit(1);
}
console.log(`PASS: metric history dialog renders (svg nodes: ${svgPoints}, page errors: ${errors.length})`);
await page.screenshot({ path: "/tmp/4n-dialog.png" });
await browser.close();
srv.kill();
process.exit(0);
