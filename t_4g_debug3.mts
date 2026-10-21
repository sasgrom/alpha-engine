/** Debug: find the element causing page-level horizontal overflow on /universe at 390px. */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3103;
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
await page.goto(`${BASE}/universe`, { waitUntil: "commit" });
await page.waitForTimeout(6000);
const wide = await page.evaluate(() => {
  const docW = document.documentElement.clientWidth;
  const bad: { tag: string; cls: string; w: number }[] = [];
  document.querySelectorAll("*").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > docW + 2 || r.right > docW + 2 || r.left < -2) {
      const cls = (el.getAttribute("class") ?? "").slice(0, 60);
      bad.push({ tag: el.tagName.toLowerCase(), cls, w: Math.round(r.width) });
    }
  });
  return { docW, bad: bad.slice(0, 12) };
});
console.log(JSON.stringify(wide, null, 1));
await page.screenshot({ path: "/tmp/4g-universe-debug.png", fullPage: false });
await browser.close();
srv.kill();
process.exit(0);
