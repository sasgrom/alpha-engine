// 3l visual QA: AAPL company page with real price data.
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addCookies([{ name: "kimi_sid", value: "eyJhbGciOiJIUzI1NiJ9.eyJ1bmlvbklkIjoiZGF0cHBvY2RkZ3NiZDZ0dWI0NDAiLCJjbGllbnRJZCI6InFhIiwiaWF0IjoxNzkxNjYyMzgzLCJleHAiOjE4MjMyMTk5ODN9.tSNMTbCx0S2bsfjEudn52PjQzvNryR7jTYc-HsQbRJg", url: "http://localhost:3000" }]);
const page = await ctx.newPage();
await page.goto("http://localhost:3000/company/AAPL", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/qa-3l-aapl.png", fullPage: false });
const txt = await page.locator(".t-panel:has-text('as of')").first().textContent();
console.log("quote header:", txt?.slice(0, 120));
await browser.close();
process.exit(0);
