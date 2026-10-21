/** Debug 2: trace network responses in the browser at 390px with a session. */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3102;
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const [name, value] = cookiePair.split("=");
await ctx.addCookies([{ name, value, url: BASE }]);
const page = await ctx.newPage();
page.on("response", (r) => {
  if (!r.url().includes("fonts")) console.log("[net]", r.status(), r.url().slice(0, 90));
});
page.on("console", (m) => console.log("[console]", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(`${BASE}/`, { waitUntil: "commit" });
await page.waitForTimeout(9000);
console.log("url:", page.url());
const rootLen = await page.evaluate(() => document.getElementById("root")?.innerHTML.length ?? -1);
console.log("root html length:", rootLen);
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
console.log("body:", JSON.stringify(bodyText));
await browser.close();
srv.kill();
process.exit(0);
