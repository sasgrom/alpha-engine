import { evaluateCompany } from "../api/services/probability-engine";
import { writeFileSync } from "node:fs";
for (const [ticker, cik] of [["AAPL", 320193], ["NVDA", 1045810], ["MSFT", 789019]] as const) {
  const r = await evaluateCompany(cik);
  if (!r) { console.log(ticker, "no report"); continue; }
  const pts = (r as any).points as any[];
  const rows = pts.filter((p) => p.anchor >= "2016-01-01");
  const correct = (p: any) => (p.p >= 0.5) === p.realizedUp;
  const upCalls = rows.filter((p) => p.p >= 0.5), downCalls = rows.filter((p) => p.p < 0.5);
  const acc = rows.filter(correct).length / rows.length;
  const upAcc = upCalls.length ? upCalls.filter(correct).length / upCalls.length : null;
  const downAcc = downCalls.length ? downCalls.filter(correct).length / downCalls.length : null;
  const base = rows.filter((p) => p.ret > 0).length / rows.length;
  const ePlus = downCalls.length ? downCalls.filter((p) => p.ret > 0).length / downCalls.length : null;
  const eMinus = upCalls.length ? upCalls.filter((p) => p.ret <= 0).length / upCalls.length : null;
  const lines: string[] = [];
  lines.push(`# ${ticker} — walk-forward backtest, last 10 years (EXCESS return over SPY, ${rows.length} anchors)\n`);
  lines.push(`- overall accuracy: ${(acc * 100).toFixed(1)}%`);
  lines.push(`- up-call accuracy: ${upAcc === null ? "n/a" : (upAcc * 100).toFixed(1) + "%"}`);
  lines.push(`- down-call accuracy: ${downAcc === null ? "n/a" : (downAcc * 100).toFixed(1) + "%"}`);
  lines.push(`- baseline (outperform SPY): ${(base * 100).toFixed(1)}%`);
  lines.push(`- e_plus (lost money on down calls): ${ePlus === null ? "n/a" : (ePlus * 100).toFixed(1) + "%"}`);
  lines.push(`- e_minus (unrealized profit on up calls): ${eMinus === null ? "n/a" : (eMinus * 100).toFixed(1) + "%"}`);
  lines.push(`- current P: ${(r.currentP! * 100).toFixed(1)}%\n`);
  lines.push(`| anchor | p(up) | call | next-63d excess ret | realized vs SPY | correct? |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const p of rows) lines.push(`| ${p.anchor} | ${(p.p * 100).toFixed(1)}% | ${p.p >= 0.5 ? "UP" : "DOWN"} | ${(p.ret * 100).toFixed(1)}% | ${p.realizedUp ? "outperform" : "underperform"} | ${correct(p) ? "✓" : "✗"} |`);
  writeFileSync(`/mnt/agents/output/${ticker}_backtest_excess_10y.md`, lines.join("\n"));
  console.log(ticker, { anchors: rows.length, acc: +(acc*100).toFixed(1), upAcc: upAcc === null ? null : +(upAcc*100).toFixed(1), downAcc: downAcc === null ? null : +(downAcc*100).toFixed(1), baselineExcess: +(base*100).toFixed(1), P: (r.currentP!*100).toFixed(1) });
}
process.exit(0);
