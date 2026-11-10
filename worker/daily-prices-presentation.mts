import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { upsertBars } from "../api/services/prices";
import { dailyPrice } from "../api/services/daily-price";
import { latestCompleteOfficialDailyBars, latestCompletedSchwabDailyDate } from "./lib/schwab-daily";

const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const root = path.resolve("D:/research/alpha-engine/schwab");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as { tickers: any[] };
const now = new Date();
const generatedAt = now.toISOString();
const pacificDate = latestCompletedSchwabDailyDate(now);
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
    const bars = latestCompleteOfficialDailyBars(payload, pacificDate, 2);
    const [previous, latest] = bars;
    const capture = manifest.tickers.filter((entry) => entry.ticker === company.ticker && entry.status === "complete").sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1);
    if (!capture) {
      result.status = "error";
      result.error = "No complete manifest capture for daily price history";
      results.push(result);
      continue;
    }
    const written = await upsertBars(company.cik, company.ticker, bars, "schwab");
    const selected = await dailyPrice(company.cik, latest.date, generatedAt);
    const previousSelected = await dailyPrice(company.cik, previous.date, generatedAt);
    if (selected.status !== "ready" || selected.source !== "schwab" || selected.price !== latest.close) throw new Error("Canonical latest daily price selection failed");
    if (previousSelected.status !== "ready" || previousSelected.source !== "schwab" || previousSelected.price !== previous.close) throw new Error("Canonical previous daily price selection failed");
    Object.assign(result, {
      status: "collected",
      date: latest.date,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
      previousDate: previous.date,
      previousClose: previousSelected.price,
      change: selected.price! - previousSelected.price!,
      changePct: (selected.price! - previousSelected.price!) / previousSelected.price!,
      currency: selected.currency,
      quality: selected.quality,
      actualAsOf: selected.actualAsOf,
      fetchedAt: selected.fetchedAt,
      previousFetchedAt: previousSelected.fetchedAt,
      capturedAt: capture.capturedAt,
      sourceSha256,
      sourceFile: path.relative(root, file).replaceAll("\\", "/"),
      rowsWritten: written,
      bars: [
        { ...previous, fetchedAt: previousSelected.fetchedAt },
        { ...latest, fetchedAt: selected.fetchedAt },
      ],
    });
  } catch (error) {
    result.status = "error";
    result.error = String(error).slice(0, 240);
  }
  results.push(result);
  console.log(`[daily-prices] ${company.ticker}: ${result.status}${result.date ? ` · ${result.date} · ${result.quality}` : result.error ? ` · ${result.error}` : ""}`);
}
const output = {
  schemaVersion: 2,
  generatedAt,
  universeSize: universe.length,
  historyPolicy: "Latest two completed-session official daily candles with OHLCV; current Pacific session excluded before 16:00; no backdating and no options-intraday spot substitution",
  sourcePolicy: "Schwab preferred when eligible; Stooq historical fallback only; same-source previous close; adjClose remains null until a reviewed corporate-action policy exists",
  companies: results,
};
writeFileSync("worker/.runs/local-generated/daily-prices-50.json", `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ companies: results.length, collected: results.filter((result) => result.status === "collected").length, missing: results.filter((result) => result.status === "missing").map((result) => ({ ticker: result.ticker, error: result.error })), errors: results.filter((result) => result.status === "error").map((result) => ({ ticker: result.ticker, error: result.error })) }, null, 2));
await getDb().$client.end();
