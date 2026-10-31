/**
 * Local ZIP alternative to storage-based research price import.
 * Reads a Stooq ZIP directly from disk; no object storage or credentials required.
 * Run: npx tsx scripts/import-research-prices-file.mts --file D:\prices\53tickers.zip [--tickers COP]
 */
import "dotenv/config";
import * as unzipper from "unzipper";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { entryToTicker, parseMetastockDaily } from "../api/services/price-import";
import { upsertBars } from "../api/services/prices";

const fIdx = process.argv.indexOf("--file");
const file = fIdx > -1 ? process.argv[fIdx + 1] : null;
if (!file) { console.error("[prices-file] --file is required"); process.exit(1); }
const tIdx = process.argv.indexOf("--tickers");
const only = tIdx > -1 ? new Set(String(process.argv[tIdx + 1] ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)) : null;
const universe = loadEdgarUniverse("research-universe-53.json").filter((c) => !only || only.has(c.ticker));
const wanted = new Map<string, number>(universe.map((c) => [c.ticker, c.cik]));
wanted.set("SPY", 0);
const sourceTickers = new Set([...wanted.keys(), "XOM"]);
let matched = 0, barsWritten = 0;
const tickers: string[] = [];
const missing: string[] = [];
const zip = await unzipper.Open.file(file);
for (const entry of zip.files) {
  if (entry.type !== "File") continue;
  const sourceTicker = entryToTicker(entry.path, sourceTickers);
  if (!sourceTicker) { entry.autodrain(); continue; }
  const targets = [sourceTicker, ...(sourceTicker === "XOM" ? ["XOM_PRE"] : [])].filter((t) => wanted.has(t));
  if (targets.length === 0) { entry.autodrain(); continue; }
  const bars = parseMetastockDaily((await entry.buffer()).toString("utf8"));
  for (const ticker of targets) {
    const cik = wanted.get(ticker)!;
    const written = await upsertBars(cik, ticker, bars, "stooq");
    matched++;
    barsWritten += written;
    tickers.push(ticker);
    console.log(`[prices-file] ${ticker} (cik ${cik}): ${bars.length} bars imported${ticker === sourceTicker ? "" : ` via ${sourceTicker}`}`);
  }
}
for (const ticker of wanted.keys()) if (!tickers.includes(ticker)) missing.push(ticker);
console.log(`[prices-file] done: ${matched}/${wanted.size} targets · ${barsWritten} bars · ${missing.length} missing${missing.length ? ` (${missing.join(",")})` : ""}`);
process.exit(missing.length > 0 ? 1 : 0);
