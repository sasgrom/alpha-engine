/** Debug: what renders at 390px with the QA session cookie? */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn("node", ["dist/boot.js"], { env: { ...process.env, NODE_ENV: "production", PORT: String(PORT) }, stdio: "pipe" });
await new Promise((r) => setTimeout(r, 4000));

const login = await fetch(`${BASE}/api/trpc/auth.login?batch=1`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ "0": { json: { username: "admin", password: "9999" } } }),
});
const setCookie = login.headers.get("set-cookie") ?? "";
console.log("login status:", login.status, "cookie set:", setCookie.includes("kimi_sid="));
const cookiePair = setCookie.split(";")[0];

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const [name, value] = cookiePair.split("=");
await ctx.addCookies([{ name, value, url: BASE }]);
const page = await ctx.newPage();
page.on("console", (m) => console.log("[browser]", m.text().slice(0, 160)));
await page.goto(`${BASE}/`, { waitUntil: "commit" });
await page.waitForTimeout(6000);
console.log("url after load:", page.url());
const html = await page.evaluate(() => document.body.innerText.slice(0, 300));
console.log("body text:", JSON.stringify(html));
const burger = await page.evaluate(() => !!document.querySelector('button[aria-label="Open navigation"]'));
console.log("burger in DOM:", burger);
await page.screenshot({ path: "/tmp/4g-debug.png" });
await browser.close();
srv.kill();
process.exit(0);
