import { evaluateCompany } from "../api/services/probability-engine";
for (const cik of [320193, 1045810, 789019]) {
  const r = await evaluateCompany(cik);
  if (!r) { console.log(cik, "no report"); continue; }
  const pts = (r as any).points as any[];
  const rows = pts.filter((p) => p.anchor >= "2016-01-01");
  const correct = (p: any) => (p.p >= 0.5) === p.realizedUp;
  const upCalls = rows.filter((p) => p.p >= 0.5), downCalls = rows.filter((p) => p.p < 0.5);
  const acc = rows.filter(correct).length / rows.length;
  const upAcc = upCalls.length ? upCalls.filter(correct).length / upCalls.length : null;
  const downAcc = downCalls.length ? downCalls.filter(correct).length / downCalls.length : null;
  const base = rows.filter((p) => p.ret > 0).length / rows.length;
  console.log(cik, { anchors: rows.length, acc: +(acc*100).toFixed(1), upAcc: upAcc === null ? null : +(upAcc*100).toFixed(1), downAcc: downAcc === null ? null : +(downAcc*100).toFixed(1), baselineExcess: +(base*100).toFixed(1), P: (r.currentP!*100).toFixed(1) });
}
process.exit(0);
