// QA: Universe page — the "In universe" switch renders and toggles.
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await ctx.addCookies([{ name: "kimi_sid", value: "eyJhbGciOiJIUzI1NiJ9.eyJ1bmlvbklkIjoiZGF0cHBvY2RkZ3NiZDZ0dWI0NDAiLCJjbGllbnRJZCI6InFhIiwiaWF0IjoxNzkxNjYyMzgzLCJleHAiOjE4MjMyMTk5ODN9.tSNMTbCx0S2bsfjEudn52PjQzvNryR7jTYc-HsQbRJg", url: "http://localhost:3000" }]);
const page = await ctx.newPage();
await page.goto("http://localhost:3000/universe", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const header = await page.locator("th:has-text('In universe')").count();
console.log("switch column header:", header === 1 ? "present" : "MISSING");
const switches = await page.locator("tbody [role='switch']").count();
console.log("switch count in table:", switches);
const rows = await page.locator("tbody tr").count();
console.log("rows visible (onlyUniverse default true):", rows);
// toggle the "Active universe only" filter to show inactive companies too
await page.locator("text=Active universe only").click();
await page.waitForTimeout(1200);
const rowsAll = await page.locator("tbody tr").count();
console.log("rows with filter off:", rowsAll);
await page.screenshot({ path: "/tmp/qa-universe.png", fullPage: false });
await browser.close();
process.exit(0);
