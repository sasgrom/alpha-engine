/**
 * 4m (D46): fill short_interest (Yahoo via agent-gw plugin) for AAPL/NVDA/PLD
 * + the FRED regime pack (igo_open_data plugin) into macro_points, then
 * rebuild events (insider clusters included). Plugin calls run here because
 * the sandbox has python + agent-gw; the prod container is node-only (the
 * worker template carries the same collectors for home runs).
 * Run: npx tsx t_4m_fill.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseSiCsv, ingestShortInterest } from "./api/services/short-interest";
import { MACRO_SERIES, parseFredCsv, ingestMacroPoints } from "./api/services/macro";
import { rebuildAllEvents } from "./api/services/events";

const YF = "/app/.agents/plugins/yahoo_finance/scripts/yahoo_finance_tool.py";
const IGO = "/app/.agents/plugins/igo_open_data/scripts/igo_open_data_tool.py";

// --- short interest ----------------------------------------------------------
for (const [cik, ticker] of [[320193, "AAPL"], [1045810, "NVDA"], [1045609, "PLD"]] as const) {
  const path = `/tmp/4m_si_${ticker}.csv`;
  execFileSync("python3", [YF, "call", "--api-name", "get_stock_info", "--params-json", JSON.stringify({ ticker, file_path: path })], { stdio: "pipe" });
  const pts = parseSiCsv(readFileSync(path, "utf8"));
  const n = await ingestShortInterest(cik, pts, "yahoo_gw");
  console.log(`${ticker}: ${n} SI points (${pts.map((p) => p.settlementDate).join(", ")})`);
}

// --- FRED regime pack ----------------------------------------------------------
// start=2021-01-01: the card reads recent values; the deep history (already
// partially stored from the first pass) pages in fully on the worker later.
for (const s of MACRO_SERIES) {
  const path = `/tmp/4m_fred_${s.id}.csv`;
  execFileSync("python3", [IGO, "call", "--data-source", "fred", "--api-name", "fred_query", "--params-json", JSON.stringify({ id: s.id, filepath: path, limit: 10000, start: "2021-01-01" })], { stdio: "pipe" });
  const pts = parseFredCsv(readFileSync(path, "utf8"));
  const n = await ingestMacroPoints(s.id, pts);
  console.log(`${s.id}: ${n} points (${pts[0]?.date}..${pts[pts.length - 1]?.date})`);
}

// --- events (insider clusters fire when they fire) ------------------------------
const ev = await rebuildAllEvents();
console.log(`events rebuilt: ${ev.companies} companies, ${ev.added} new`);
console.log("PASS: 4m fill");
process.exit(0);
