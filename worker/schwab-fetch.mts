/** Schwab REST snapshots with raw-D: provenance and resumable manifests. */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isSchwabTokenFresh, loadSchwabToken, refreshSchwabToken, saveSchwabToken, schwabGet, schwabTokenDirectory, schwabTraderGet } from "./lib/schwab";
import { sha256Text } from "./lib/schwab-normalize";
import { dedupeExpectationUniverse } from "./lib/universe";
import { loadEdgarUniverse, realCacheRoot } from "./lib/edgar";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";
import type { SchwabManifest, SchwabManifestEntry } from "./lib/schwab-market-data";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const fromTicker = arg("--from-ticker")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "research-universe-51.json";
const root = path.resolve(arg("--root") ?? schwabTokenDirectory());
const manifestPath = path.join(root, "manifest.json");
const prog = startProgress("schwab-fetch", `root ${root} · universe ${universeFile}`);
if (process.platform === "win32" && !/^d:/i.test(root)) throw new Error("Raw Schwab archives must stay on the D: drive");
mkdirSync(root, { recursive: true });
const realRoot = realCacheRoot(root);
const stats = statfsSync(realRoot);
if (stats.bavail * stats.bsize < 2 * 1024 ** 3) throw new Error("Less than 2 GiB free on the Schwab raw archive drive");

const clientId = process.env.SCHWAB_CLIENT_ID;
const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
let token = loadSchwabToken();
if (!isSchwabTokenFresh(token)) {
  if (!clientId || !clientSecret) throw new Error("Access token expired. Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET, then run worker/schwab-refresh.mts");
  token = saveSchwabToken(await refreshSchwabToken(token.refresh_token, clientId, clientSecret));
  prog.log("access token refreshed");
}
const universeAll = dedupeExpectationUniverse(loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only));
if (only && !universeAll.length) throw new Error(`Unknown ticker ${only}`);
const start = fromTicker ? universeAll.findIndex((company) => company.ticker === fromTicker) : 0;
if (fromTicker && start < 0) throw new Error(`Unknown --from-ticker ${fromTicker}`);
const universe = universeAll.slice(Math.max(0, start));

function writeTextAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, file); }
  finally { rmSync(tmp, { force: true }); }
}
async function request(pathname: string, accessToken: string, service: "market" | "trader" = "market"): Promise<string> {
  const result = service === "trader" ? await schwabTraderGet(pathname, accessToken) : await schwabGet(pathname, accessToken);
  if (result.status !== 200) {
    const error = new Error(`HTTP ${result.status}: ${result.body.slice(0, 180)}`) as Error & { httpStatus?: number };
    error.httpStatus = result.status;
    throw error;
  }
  return result.body;
}
const today = new Date().toISOString().slice(0, 10);
const manifest: SchwabManifest = { schemaVersion: 1, tickers: [] };
try {
  const previous = JSON.parse(readFileSync(manifestPath, "utf8")) as SchwabManifest;
  if (previous.schemaVersion === 1 && Array.isArray(previous.tickers)) manifest.tickers.push(...previous.tickers);
} catch { /* fresh manifest */ }
function replaceEntry(entry: SchwabManifestEntry): void {
  const index = manifest.tickers.findIndex((item) => item.ticker === entry.ticker && item.capturedAt.slice(0, 10) === today);
  if (index >= 0) manifest.tickers[index] = entry;
  else manifest.tickers.push(entry);
}
const completedInScope = () => universe.filter((company) => manifest.tickers.some((item) => item.ticker === company.ticker && item.status === "complete" && item.capturedAt.slice(0, 10) === today)).length;
let transportFailures = 0;
for (const company of universe) {
  const previous = manifest.tickers.find((item) => item.ticker === company.ticker && item.status === "complete" && item.capturedAt.slice(0, 10) === today);
  const requiredFiles = [
    `chains/${today}/${company.ticker}.json`,
    `quotes/${today}/${company.ticker}.json`,
    `pricehistory/${company.ticker}.json`,
    `instruments/${company.ticker}.json`,
  ];
  if (previous && requiredFiles.every((file) => existsSync(path.join(root, file)))) {
    prog.item(completedInScope(), universe.length, `${company.ticker} resumed`);
    continue;
  }
  const capturedAt = new Date().toISOString();
  const entry: SchwabManifestEntry = { ticker: company.ticker, status: "partial", capturedAt, sourceHash: "", file: `chains/${today}/${company.ticker}.json` };
  try {
    const chain = await request(`chains?symbol=${encodeURIComponent(company.ticker)}&contractType=ALL&includeQuotes=TRUE`, token.access_token);
    writeTextAtomic(path.join(root, entry.file), chain);
    entry.sourceHash = sha256Text(chain);
    const quote = await request(`quotes?symbols=${encodeURIComponent(company.ticker)}`, token.access_token);
    writeTextAtomic(path.join(root, `quotes/${today}/${company.ticker}.json`), quote);
    const history = await request(`pricehistory?symbol=${encodeURIComponent(company.ticker)}&periodType=month&frequencyType=daily&frequency=1`, token.access_token);
    writeTextAtomic(path.join(root, `pricehistory/${company.ticker}.json`), history);
    const instrument = await request(`instruments?symbol=${encodeURIComponent(company.ticker)}&projection=fundamental`, token.access_token);
    writeTextAtomic(path.join(root, `instruments/${company.ticker}.json`), instrument);
    entry.status = "complete";
    transportFailures = 0;
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    entry.error = String(error).slice(0, 400);
    if (status === undefined) transportFailures++;
    else transportFailures = 0;
  }
  replaceEntry(entry);
  writeJsonAtomic(manifestPath, manifest, true);
  prog.item(completedInScope(), universe.length, `${company.ticker} ${entry.status}`);
  if (transportFailures >= 2) {
    writeJsonAtomic(manifestPath, manifest, true);
    throw new Error("Two consecutive Schwab transport failures; checkpoint saved");
  }
}
const preferences = await request("userPreference", token.access_token, "trader");
writeTextAtomic(path.join(root, "user-preferences.json"), preferences);
writeJsonAtomic(manifestPath, manifest, true);
prog.done(`complete ${completedInScope()}/${universe.length} tickers · manifest ${manifestPath}`);
