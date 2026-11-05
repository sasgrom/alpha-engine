import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { upsertBars } from "../api/services/prices";
import { dailyPrice } from "../api/services/daily-price";

const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const root = path.resolve("D:/research/alpha-engine/schwab");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as { tickers: any[] };
const generatedAt = new Date().toISOString();
const pacificDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const results: any[] = [];
for (const company of universe) {
  const result: any = { ...company, status: "pending", source: "schwab", adjustedCloseStatus: "missing_official_adjustment_policy" };
  try {
    const file = path.join(root, "pricehistory", `${company.ticker}.json`);
    if (!existsSync(file)) {
      result.status = "missing";
      result.error = "Official daily price history is absent";
      results.push(result);
      continue;
    }
    const raw = readFileSync(file, "utf8");
    const sourceSha256 = createHash("sha256").update(raw).digest("hex");
    const payload = JSON.parse(raw);
    const candles = payload.candles ?? [];
    const latest = candles.at(-1);
    const date = latest?.datetime ? new Date(latest.datetime).toISOString().slice(0, 10) : null;
    if (!latest || !date || date > pacificDate || !Number.isFinite(latest.close) || latest.close <= 0) {
      result.status = "missing";
      result.error = "No valid official daily close";
      results.push(result);
      continue;
    }
    const capture = manifest.tickers.filter((entry) => entry.ticker === company.ticker && entry.status === "complete").sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1);
    if (!capture) {
      result.status = "error";
      result.error = "No complete manifest capture for daily price history";
      results.push(result);
      continue;
    }
    const written = await upsertBars(company.cik, company.ticker, [{
      date,
      open: latest.open ?? null,
      high: latest.high ?? null,
      low: latest.low ?? null,
      close: latest.close,
      adjClose: null,
      volume: latest.volume ?? null,
    }], "schwab");
    const selected = await dailyPrice(company.cik, date, generatedAt);
    if (selected.status !== "ready" || selected.source !== "schwab" || selected.price !== latest.close) throw new Error("Canonical daily price selection failed");
    Object.assign(result, {
      status: "collected",
      date,
      close: latest.close,
      currency: selected.currency,
      quality: selected.quality,
      actualAsOf: selected.actualAsOf,
      fetchedAt: selected.fetchedAt,
      capturedAt: capture.capturedAt,
      sourceSha256,
      sourceFile: path.relative(root, file).replaceAll("\\", "/"),
      rowsWritten: written,
    });
  } catch (error) {
    result.status = "error";
    result.error = String(error).slice(0, 240);
  }
  results.push(result);
  console.log(`[daily-prices] ${company.ticker}: ${result.status}${result.date ? ` · ${result.date} · ${result.quality}` : result.error ? ` · ${result.error}` : ""}`);
}
const output = {
  schemaVersion: 1,
  generatedAt,
  universeSize: universe.length,
  historyPolicy: "Latest valid official daily candle only; no backdating and no options-intraday spot substitution",
  sourcePolicy: "Schwab preferred when eligible; Stooq historical fallback only; adjClose remains null until a reviewed corporate-action policy exists",
  companies: results,
};
writeFileSync("worker/.runs/local-generated/daily-prices-50.json", `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ companies: results.length, collected: results.filter((result) => result.status === "collected").length, missing: results.filter((result) => result.status === "missing").map((result) => ({ ticker: result.ticker, error: result.error })), errors: results.filter((result) => result.status === "error").map((result) => ({ ticker: result.ticker, error: result.error })) }, null, 2));
await getDb().$client.end();
