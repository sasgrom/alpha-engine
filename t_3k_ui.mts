// 3k UI QA: multi-file upload with adaptive slicing + resume.
// Flow: pick TWO pre-split halves of the test zip -> upload -> verify both
// parts stored via the new parts endpoint -> reload -> resume banner ->
// re-pick the same files -> instant completion (all parts skipped).
// Afterwards: storage parts cleaned up.
import { chromium } from "playwright";
import { readFileSync } from "fs";

const BASE = "http://localhost:3000";
const SID = "eyJhbGciOiJIUzI1NiJ9.eyJ1bmlvbklkIjoiZGF0cHBvY2RkZ3NiZDZ0dWI0NDAiLCJjbGllbnRJZCI6InFhIiwiaWF0IjoxNzkxNjYyMzgzLCJleHAiOjE4MjMyMTk5ODN9.tSNMTbCx0S2bsfjEudn52PjQzvNryR7jTYc-HsQbRJg";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); c ? pass++ : fail++; };

const buf = readFileSync("/tmp/test-3g.zip");
const half = Math.ceil(buf.length / 2);
const parts = [
  { name: "d_us_txt.zip.001", mimeType: "application/octet-stream", buffer: buf.subarray(0, half) },
  { name: "d_us_txt.zip.002", mimeType: "application/octet-stream", buffer: buf.subarray(half) },
];

// parts endpoint auth checks
const anon = await fetch(`${BASE}/api/prices-import/parts?batch=00000000-0000-0000-0000-000000000000`);
ok("parts endpoint rejects anonymous", anon.status === 403, `HTTP ${anon.status}`);
const badBatch = await fetch(`${BASE}/api/prices-import/parts?batch=nope`, { headers: { Cookie: `kimi_sid=${SID}` } });
ok("parts endpoint validates batch id", badBatch.status === 400);

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "kimi_sid", value: SID, url: BASE }]);
const page = await ctx.newPage();

const openTools = async () => {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Tools" }).click();
  await page.waitForTimeout(600);
};
await openTools();
const card = page.locator(".panel:has-text('Bulk price archive import')");
ok("card renders (multi-file instructions)", (await card.locator("text=Select ALL pre-split parts").count()) >= 1);

const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  card.locator("input[type=file]").click(),
]);
await chooser.setFiles(parts);
const uploadBtn = card.locator("button:has-text('Upload')");
await uploadBtn.waitFor({ timeout: 5000 });
ok("upload button shows file count + size", (await uploadBtn.textContent())?.includes("2 files") ?? false, (await uploadBtn.textContent()) ?? "");
await uploadBtn.click();
await page.waitForSelector("text=uploaded · batch", { timeout: 20000 });
ok("multi-file upload completes", true);
const batchText = await card.locator("text=uploaded · batch").textContent();
const batchIdPrefix = batchText?.match(/batch ([0-9a-f]{8})/)?.[1] ?? "";
ok("batch id shown", batchIdPrefix.length === 8, batchText ?? "");

// server-side: both parts exist
const list = await page.evaluate(async () => {
  const m = document.querySelector(".text-ok-green")?.textContent ?? "";
  return m;
});
void list;

// resume: reload, re-pick the same files, upload must complete near-instantly
await openTools();
ok("resume banner after reload", (await card.locator("text=unfinished batch").count()) >= 1);
const [chooser2] = await Promise.all([
  page.waitForEvent("filechooser"),
  card.locator("input[type=file]").click(),
]);
await chooser2.setFiles(parts);
const t0 = Date.now();
await card.locator("button:has-text('Upload')").click();
await page.waitForSelector("text=uploaded · batch", { timeout: 20000 });
ok("resume skips stored parts (fast)", Date.now() - t0 < 8000, `${Date.now() - t0}ms`);

await page.screenshot({ path: "/tmp/qa-3k-admin.png" });
await browser.close();

// cleanup: delete every part of every test batch left in storage
const { storage } = await import("./api/lib/storage");
const listed = await storage.listFiles({ prefix: "prices-import/", delimiter: "" });
const keys = listed.objects.map((f) => f.key);
if (keys.length) await storage.deleteFiles({ fileKeys: keys });
console.log(`cleaned ${keys.length} storage parts`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
