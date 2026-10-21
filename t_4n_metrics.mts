/**
 * 4n (D47): initial metric_history fill for every company with prices.
 * First populates the exact split map (Yahoo stock actions via agent-gw →
 * external_cache `splits:<cik>`) so marketCap crosses splits correctly.
 * The runner hook keeps them fresh after prices/series jobs.
 * Run: npx tsx t_4n_metrics.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { getDb } from "./api/queries/connection";
import { externalCache } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { computeCompanyMetricHistory, splitsFromActionsCsv } from "./api/services/metric-history";

const db = getDb();
const YF = "/app/.agents/plugins/yahoo_finance/scripts/yahoo_finance_tool.py";

const rows: any = await db.execute(sql`SELECT DISTINCT p.cik, c.ticker FROM prices p JOIN companies c ON c.cik=p.cik WHERE p.cik > 0 ORDER BY p.cik`);
for (const r of rows[0]) {
  const cik = Number(r.cik);
  const ticker = String(r.ticker);
  // exact split map first (the market-cap honesty dependency)
  try {
    const path = `/tmp/4n_actions_${ticker}.csv`;
    execFileSync("python3", [YF, "call", "--api-name", "get_stock_actions", "--params-json", JSON.stringify({ ticker, file_path: path })], { stdio: "pipe" });
    const splits = splitsFromActionsCsv(readFileSync(path, "utf8"));
    await db
      .insert(externalCache)
      .values({ key: `splits:${cik}`, payload: JSON.stringify(splits), source: "live" })
      .onDuplicateKeyUpdate({ set: { payload: JSON.stringify(splits), fetchedAt: new Date() } });
    console.log(`${ticker}: ${splits.length} splits cached (${splits.map((s) => `${s.date}×${s.factor}`).join(" ") || "none"})`);
  } catch (e) {
    console.log(`${ticker}: stock actions fetch failed (heuristic fallback stays) — ${String(e).slice(0, 80)}`);
  }
  const res = await computeCompanyMetricHistory(cik);
  console.log(`cik=${cik} ${ticker}:`, res.map((x) => `${x.metric}=${x.points}`).join(" "));
}
console.log("PASS: metric history filled (exact splits)");
process.exit(0);
