import { getBars, week52, avgVolume, beta5y, fundamentalsFromSeries, changePct } from "./api/services/prices";
const bars = await getBars(320193);
const last = bars[bars.length - 1], prev = bars[bars.length - 2];
const w = week52(bars);
const { epsTtm, sharesDiluted } = await fundamentalsFromSeries(320193);
console.log("AAPL quote path:", JSON.stringify({
  bars: bars.length, asOf: last.date, price: last.close, prevClose: prev.close,
  changePct: changePct(last.close!, prev.close!)?.toFixed(4),
  w52: w, avgVol3m: Math.round(avgVolume(bars, 92) ?? 0),
  epsTtm, sharesDiluted,
  marketCap: sharesDiluted ? (last.close! * sharesDiluted / 1e12).toFixed(2) + "T" : null,
  peTtm: epsTtm ? (last.close! / epsTtm).toFixed(1) : null,
  beta: beta5y(bars, []), // no SPY yet -> null expected
}));
process.exit(0);
