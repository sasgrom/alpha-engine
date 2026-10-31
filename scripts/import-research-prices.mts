/**
 * Import a previously browser-uploaded Stooq ZIP batch for research-universe-53.
 * Includes SPY and maps xom.us.txt to both current XOM and XOM_PRE evidence.
 * Run: npx tsx scripts/import-research-prices.mts --batch <uploaded-batch-uuid>
 */
import "dotenv/config";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { importPricesFromStorage } from "../api/services/price-import";

const idx = process.argv.indexOf("--batch");
const batch = idx > -1 ? process.argv[idx + 1] : "";
if (!/^[0-9a-f-]{36}$/.test(batch)) { console.error("[prices] --batch must be the uploaded batch UUID"); process.exit(1); }
const uIdx = process.argv.indexOf("--universe");
const file = uIdx > -1 ? process.argv[uIdx + 1] : "research-universe-53.json";
const tIdx = process.argv.indexOf("--tickers");
const onlyTickers = tIdx > -1 ? new Set(String(process.argv[tIdx + 1] ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)) : null;
const universe = loadEdgarUniverse(file).filter((c) => !onlyTickers || onlyTickers.has(c.ticker));
if (onlyTickers && universe.length !== onlyTickers.size) {
  console.error(`[prices] ticker list does not match the universe: ${[...onlyTickers].join(",")}`);
  process.exit(1);
}
const wanted = new Map<string, number>(universe.map((c) => [c.ticker, c.cik]));
wanted.set("SPY", 0);
const report = await importPricesFromStorage(
  batch,
  async (level, message) => console.log(`[prices ${level}] ${message}`),
  undefined,
  undefined,
  { wanted, aliases: { XOM: ["XOM_PRE"] } },
);
console.log(`[prices] done: ${report.filesMatched}/${report.filesWanted} targets · ${report.barsWritten} bars · ${report.missing.length} missing${report.missing.length ? ` (${report.missing.join(",")})` : ""}`);
process.exit(report.missing.length > 0 ? 1 : 0);
