/** Collect Schwab context data separately from option chains: hours, movers and intraday bars. */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isSchwabTokenFresh, loadSchwabToken, refreshSchwabToken, saveSchwabToken, schwabGet, schwabTokenDirectory } from "./lib/schwab";
import { buildSchwabContextReport, contextSourceHash, schwabMarketHoursPath, type SchwabContextFile } from "./lib/schwab-context";
import { writeSchwabJsonOutputs } from "./lib/schwab-output";
import { loadEdgarUniverse, realCacheRoot } from "./lib/edgar";
import { startProgress } from "./lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const root = path.resolve(arg("--root") ?? schwabTokenDirectory());
const today = new Date().toISOString().slice(0, 10);
const capturedAt = new Date().toISOString();
const prog = startProgress("schwab-context", `hours + movers + instruments + AAPL/SPY intraday · root ${root}`);
if (process.platform === "win32" && !/^d:/i.test(root)) throw new Error("Raw Schwab archives must stay on the D: drive");
mkdirSync(root, { recursive: true });
const stats = statfsSync(realCacheRoot(root));
if (stats.bavail * stats.bsize < 2 * 1024 ** 3) throw new Error("Less than 2 GiB free on the Schwab raw archive drive");
let token = loadSchwabToken();
if (!isSchwabTokenFresh(token)) {
  const clientId = process.env.SCHWAB_CLIENT_ID, clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Access token expired. Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET, then run worker/schwab-refresh.mts");
  token = saveSchwabToken(await refreshSchwabToken(token.refresh_token, clientId, clientSecret));
  prog.log("access token refreshed");
}
function writeTextAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}
async function request(pathname: string): Promise<string> {
  const result = await schwabGet(pathname, token.access_token);
  if (result.status !== 200) {
    const error = new Error(`HTTP ${result.status}: ${result.body.slice(0, 180)}`) as Error & { httpStatus?: number };
    error.httpStatus = result.status;
    throw error;
  }
  return result.body;
}
const tasks = [
  { kind: "hours/equity", pathname: schwabMarketHoursPath("equity"), file: `context/${today}/hours-equity.json` },
  { kind: "hours/option", pathname: schwabMarketHoursPath("option"), file: `context/${today}/hours-option.json` },
  { kind: "movers/SPX", pathname: `movers/${encodeURIComponent("$SPX")}`, file: `context/${today}/movers-SPX.json` },
  { kind: "movers/COMPX", pathname: `movers/${encodeURIComponent("$COMPX")}`, file: `context/${today}/movers-COMPX.json` },
  { kind: "movers/DJI", pathname: `movers/${encodeURIComponent("$DJI")}`, file: `context/${today}/movers-DJI.json` },
  { kind: "intraday/AAPL", pathname: "pricehistory?symbol=AAPL&periodType=day&period=5&frequencyType=minute&frequency=5&needExtendedHoursData=true", file: `intraday/${today}/AAPL-5m.json` },
  { kind: "intraday/SPY", pathname: "pricehistory?symbol=SPY&periodType=day&period=5&frequencyType=minute&frequency=5&needExtendedHoursData=true", file: `intraday/${today}/SPY-5m.json` },
];
const files: SchwabContextFile[] = [];
const successful = new Map<string, string>();
let transportFailures = 0;
for (const task of tasks) {
  try {
    const raw = await request(task.pathname);
    writeTextAtomic(path.join(root, task.file), raw);
    successful.set(task.kind, raw);
    files.push({ kind: task.kind, capturedAt, sourceHash: contextSourceHash(raw), status: "complete" });
    transportFailures = 0;
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    files.push({ kind: task.kind, capturedAt, sourceHash: "", status: "failed", error: String(error).slice(0, 300) });
    if (status === undefined) transportFailures++;
    else transportFailures = 0;
  }
  prog.item(files.length, tasks.length, task.kind);
  if (transportFailures >= 2) break;
}
const instruments: Record<string, string> = {};
for (const company of loadEdgarUniverse("research-universe-50.json")) {
  const file = path.join(root, "instruments", `${company.ticker}.json`);
  if (!existsSync(file)) {
    files.push({ kind: `instrument/${company.ticker}`, capturedAt, sourceHash: "", status: "failed", error: "Instrument file missing" });
    continue;
  }
  const raw = readFileSync(file, "utf8");
  instruments[company.ticker] = raw;
  files.push({ kind: `instrument/${company.ticker}`, capturedAt, sourceHash: contextSourceHash(raw), status: "complete" });
}
const report = buildSchwabContextReport({
  generatedAt: new Date().toISOString(), capturedAt,
  hours: { equity: successful.get("hours/equity") ?? "{}", option: successful.get("hours/option") ?? "{}" },
  movers: { SPX: successful.get("movers/SPX") ?? "[]", COMPX: successful.get("movers/COMPX") ?? "[]", DJI: successful.get("movers/DJI") ?? "[]" },
  instruments,
  intraday: { AAPL: successful.get("intraday/AAPL") ?? "{}", SPY: successful.get("intraday/SPY") ?? "{}" },
  files,
});
writeSchwabJsonOutputs("schwab-context.json", report);
prog.done(`complete ${report.coverage.complete}/${report.coverage.expected} context endpoints · errors ${report.coverage.errors}`);
if (transportFailures >= 2) throw new Error("Two consecutive Schwab context transport failures; checkpoint saved");
