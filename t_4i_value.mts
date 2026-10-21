/**
 * 4i QA (D41): compute the factor snapshot + value panel for AAPL on the
 * live (prod) DB and print for sanity review. Also PLD (a REIT — different
 * patterns). Run: npx tsx t_4i_value.mts
 */
import { computeCompanyFactors } from "./api/services/factors";
import { computeCompanyValue } from "./api/services/valuation";

for (const [cik, name] of [[320193, "AAPL"], [1045609, "PLD"]] as const) {
  const f = await computeCompanyFactors(cik);
  const v = await computeCompanyValue(cik);
  console.log(`\n=== ${name} (cik ${cik}) ===`);
  console.log(` asOfQuarter=${f.asOfQuarter}`);
  console.log(` accruals=${f.flowRatios.accruals?.toFixed(4)} grossProfitability=${f.flowRatios.grossProfitability?.toFixed(3)}`);
  console.log(` assetGrowthYoY=${f.growth.assetGrowthYoY?.toFixed(3)} buybackYield=${f.growth.buybackYield?.toFixed(4)}`);
  console.log(` momentum122=${f.priceFactors.momentum122?.toFixed(3)} high52=${f.priceFactors.high52?.toFixed(3)}`);
  console.log(` sue=${f.sue?.toFixed(2)}  F-score=${f.fScore.score}/9  altmanZ=${f.altmanZ?.toFixed(2)}  beneishM=${f.beneishM?.toFixed(2)}`);
  console.log(` value: price=${v.price} mcap=${v.marketCap ? (v.marketCap / 1e12).toFixed(2) + "T" : "—"} wacc=${v.wacc?.toFixed(3)}`);
  console.log(` impliedGrowth=${v.impliedGrowthPct?.toFixed(2)}% fcfCagr=${v.fcfCagrPct?.toFixed(2)}%`);
  console.log(` rim base=${v.rim?.base ? (v.rim.base / 1e9).toFixed(0) + "B" : "—"} epv=${v.epv ? (v.epv / 1e9).toFixed(0) + "B" : "—"} vp=${v.vpRatio?.toFixed(2)} peZ=${v.peZ?.toFixed(2)}`);
}
console.log("\nPASS: 4i value QA printed");
process.exit(0);
