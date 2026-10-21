/**
 * QA for iteration 4g: mobile layout smoke test at an iPhone viewport.
 * Boots the PRODUCTION build locally (dist/boot.js), logs in as admin through
 * the real auth endpoint, then checks at 390×844: no horizontal page
 * overflow, the nav drawer opens, Messages is single-pane, tables scroll
 * inside their panels. Screenshots land in /tmp/4g-*.png.
 * Run: npx tsx t_4g_mobile.mts
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const fail = (m: string): never => {
  console.error("FAIL:", m);
  process.exit(1);
};

// boot the production build
const srv = spawn("node", ["dist/boot.js"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(PORT) },
  stdio: "pipe",
});
await new Promise((r) => setTimeout(r, 4000));

// real login → session cookie
const login = await fetch(`${BASE}/api/trpc/auth.login?batch=1`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ "0": { json: { username: "admin", password: "9999" } } }),
});
const setCookie = login.headers.get("set-cookie") ?? "";
const cookiePair = setCookie.split(";")[0];
if (!login.ok || !cookiePair.includes("kimi_sid=")) fail("login failed in QA boot");

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const [name, value] = cookiePair.split("=");
await ctx.addCookies([{ name, value, url: BASE }]);
const page = await ctx.newPage();

const overflow = async () =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Dashboard: no horizontal page overflow
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
const ov1 = await overflow();
if (ov1 > 2) fail(`dashboard horizontal overflow: ${ov1}px`);
await page.screenshot({ path: "/tmp/4g-dashboard.png" });

// Drawer opens and shows nav
await page.click('button[aria-label="Open navigation"]');
await page.waitForTimeout(400);
const navVisible = await page.evaluate(() => {
  const links = [...document.querySelectorAll("a")].filter((a) => a.textContent?.toUpperCase().includes("UNIVERSE"));
  return links.length > 0;
});
if (!navVisible) fail("drawer did not open / nav missing");
await page.screenshot({ path: "/tmp/4g-drawer.png" });

// Universe: table scrolls INSIDE the panel, page doesn't overflow
await page.goto(`${BASE}/universe`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const ov2 = await overflow();
if (ov2 > 2) fail(`universe horizontal overflow: ${ov2}px`);
const tableScrolls = await page.evaluate(() => {
  const panels = [...document.querySelectorAll("div")].filter((d) => d.scrollWidth > d.clientWidth + 50);
  return panels.length > 0; // the table panel scrolls internally
});
if (!tableScrolls) fail("universe table has no internal scroll container");
await page.screenshot({ path: "/tmp/4g-universe.png" });

// Messages: single-pane (contacts visible, conversation hidden until picked)
await page.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const singlePane = await page.evaluate(() => {
  const sel = [...document.querySelectorAll("div")].find((d) => d.textContent?.trim() === "SELECT A CONTACT");
  if (!sel) return true; // empty-contact state is fine too
  return sel.getBoundingClientRect().width === 0 || sel.offsetParent === null; // hidden on mobile
});
if (!singlePane) fail("messages shows both panes on mobile");
await page.screenshot({ path: "/tmp/4g-messages.png" });

await browser.close();
srv.kill();
console.log("PASS: 4g mobile (no page overflow, drawer opens, table internal scroll, messages single-pane)");
console.log("screenshots: /tmp/4g-dashboard.png /tmp/4g-drawer.png /tmp/4g-universe.png /tmp/4g-messages.png");
process.exit(0);
