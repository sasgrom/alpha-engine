// 3g UI QA: Admin > Tools renders the bulk import card (admin cookie).
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext();
await ctx.addCookies([{
  name: "kimi_sid",
  value: "eyJhbGciOiJIUzI1NiJ9.eyJ1bmlvbklkIjoiZGF0cHBvY2RkZ3NiZDZ0dWI0NDAiLCJjbGllbnRJZCI6InFhIiwiaWF0IjoxNzkxNjYyMzgzLCJleHAiOjE4MjMyMTk5ODN9.tSNMTbCx0S2bsfjEudn52PjQzvNryR7jTYc-HsQbRJg",
  url: "http://localhost:3000",
}]);
const page = await ctx.newPage();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); c ? pass++ : fail++; };

await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Tools" }).click();
await page.waitForTimeout(800);

const card = page.locator(".panel:has-text('Bulk price archive import')");
ok("import card visible", await card.count() === 1);
ok("crutch/TODO note visible", (await page.locator("text=Temporary crutch").count()) >= 1);
ok("file input present", await card.locator("input[type=file]").count() === 1);

// upload a small zip through the real UI path
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  card.locator("input[type=file]").click(),
]);
await chooser.setFiles({ name: "d_us_txt.zip", mimeType: "application/zip", buffer: (await import("fs")).readFileSync("/tmp/test-3g.zip") });
await page.waitForTimeout(300);
const uploadBtn = card.locator("button:has-text('Upload')");
ok("upload button appears after file pick", await uploadBtn.count() === 1);
await uploadBtn.click();
await page.waitForSelector("text=uploaded · batch", { timeout: 15000 });
ok("chunked upload completes in UI", true);
const startBtn = card.locator("button:has-text('Start import')");
ok("start import button appears", await startBtn.count() === 1);
await page.screenshot({ path: "/tmp/qa-3g-admin.png" });
// do NOT launch a second import here (backend path already covered); reset instead
await card.locator("button:has-text('Reset')").click();
ok("reset returns to idle", await card.locator("text=uploaded · batch").count() === 0);

await browser.close();

// cleanup the parts uploaded by the UI run
const { storage } = await import("./api/lib/storage");
const listed = await storage.listFiles({ prefix: "prices-import/", delimiter: "" });
const keys = listed.objects.map((f) => f.key);
if (keys.length) await storage.deleteFiles({ fileKeys: keys });
console.log(`cleaned ${keys.length} leftover storage parts`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
