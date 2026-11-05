import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { getDb } from "../api/queries/connection";
import { filings } from "../db/schema";
import { filingIndex } from "../api/services/edgar";
import { isEarningsRelease, rebuildAllEvents } from "../api/services/events";

const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const generatedAt = new Date().toISOString();
const db = getDb();
const results: any[] = [];
try {
  for (const company of universe) {
    const result: any = { ...company, filings8K: 0, item202Filings: 0, status: "pending", failures: [] };
    try {
      const rows = await filingIndex(company.cik, ["8-K"]);
      result.filings8K = rows.length;
      for (const row of rows) {
        await db.insert(filings).values({
          cik: company.cik,
          accessionNo: row.accessionNo,
          form: row.form,
          filingDate: row.filingDate,
          reportDate: row.reportDate,
          primaryDoc: row.primaryDoc,
          items: row.items,
        }).onDuplicateKeyUpdate({ set: { form: row.form, filingDate: row.filingDate, reportDate: row.reportDate, primaryDoc: row.primaryDoc, items: row.items } });
        if (isEarningsRelease(row.items)) result.item202Filings++;
      }
      result.status = result.item202Filings ? "collected" : "not_applicable";
    } catch (error) {
      result.status = "error";
      result.failures.push(String(error).slice(0, 240));
    }
    results.push(result);
    console.log(`[earnings] ${company.ticker}: ${result.status} · 8-K ${result.filings8K} · Item 2.02 ${result.item202Filings} · failures ${result.failures.length}`);
  }
  const rebuild = await rebuildAllEvents();
  const output = { schemaVersion: 1, generatedAt, universeSize: universe.length, companies: results, rebuild };
  writeFileSync("worker/.runs/local-generated/earnings-events-50.json", `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ companies: results.length, collected: results.filter((result) => result.status === "collected").length, notApplicable: results.filter((result) => result.status === "not_applicable").length, errors: results.filter((result) => result.status === "error").map((result) => ({ ticker: result.ticker, failures: result.failures })), rebuild }, null, 2));
} finally {
  await db.$client.end();
}
