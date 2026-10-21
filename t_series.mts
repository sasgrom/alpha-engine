import { buildCompanySeries } from "./api/services/series";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const r = await buildCompanySeries(320193);
console.log("AAPL build:", JSON.stringify(r));
const db = getDb();
// canonical revenue series, latest vintage
const rev: any = await db.execute(sql`SELECT periodEnd, val/1e9 bn, derivation FROM series_points WHERE cik=320193 AND concept='RevenueFromContractWithCustomerExcludingAssessedTax' AND kind='flow' AND vintage='latest' ORDER BY periodEnd DESC LIMIT 6`);
console.log("Revenue (latest):", rev[0].map((x: any) => `${x.periodEnd?.toISOString?.().slice(0,10) ?? x.periodEnd}=${Number(x.bn).toFixed(1)}B(${x.derivation})`).join("  "));
// first vs latest comparison on an older quarter (revision visibility)
const cmp: any = await db.execute(sql`SELECT vintage, val/1e9 bn, sourceFiled FROM series_points WHERE cik=320193 AND concept='RevenueFromContractWithCustomerExcludingAssessedTax' AND periodEnd='2019-12-28' ORDER BY vintage`);
console.log("2019Q1 first/latest:", cmp[0].map((x: any) => `${x.vintage}=${Number(x.bn).toFixed(2)}B filed ${x.sourceFiled?.toISOString?.().slice(0,10) ?? x.sourceFiled}`).join(" | "));
// health
const h: any = await db.execute(sql`SELECT concept, pointsCount, ROUND(gridCoverage,2) cov, ROUND(revisionRate,3) rr, flags FROM series_health WHERE cik=320193 AND flags IS NOT NULL LIMIT 5`);
console.log("flagged series sample:"); h[0].forEach((x: any) => console.log(" ", x.concept, "cov", x.cov, "revRate", x.rr, x.flags?.slice(0, 80)));
const c: any = await db.execute(sql`SELECT * FROM company_data_health WHERE cik=320193`);
console.log("company rollup:", JSON.stringify(c[0][0]).slice(0, 300));
process.exit(0);
