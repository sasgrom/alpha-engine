import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { getDb } from "../api/queries/connection";
import { insiderTrades } from "../db/schema";
import { form4List, form4XmlUrl, parseForm4 } from "../api/services/insiders";
import { secFetch } from "../api/services/edgar";

const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const filingsPerCompany = 60;
const generatedAt = new Date().toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 240);
const db = getDb();
const results: any[] = [];
try {
  for (const company of universe) {
    const result: any = { ...company, filingsProcessed: 0, transactionsKept: 0, missingOwnershipXml: 0, failures: [], status: "pending" };
    try {
      const filings = await form4List(company.cik, filingsPerCompany);
      if (!filings.length) result.status = "missing_official";
      for (const filing of filings) {
        result.filingsProcessed++;
        try {
          const url = await form4XmlUrl(company.cik, filing.accession);
          if (!url) {
            result.missingOwnershipXml++;
            continue;
          }
          if (url.includes("xslF345X06")) throw new Error("Human-rendered Form 4 duplicate was selected");
          const response = await secFetch(url);
          const xml = await response.text();
          if (!/<ownershipDocument[\s>]/i.test(xml)) {
            result.missingOwnershipXml++;
            continue;
          }
          const parsed = parseForm4(xml);
          for (const transaction of parsed.txs) {
            await db.insert(insiderTrades).values({
              cik: company.cik,
              accessionNo: filing.accession,
              insiderName: parsed.insider,
              insiderRole: parsed.role,
              code: transaction.code,
              shares: transaction.shares,
              price: transaction.price,
              sharesAfter: transaction.after,
              tradeDate: transaction.date,
              filingDate: filing.filingDate,
              is10b5: parsed.is10b5,
            }).onDuplicateKeyUpdate({ set: { insiderName: parsed.insider } });
            result.transactionsKept++;
          }
        } catch (error) {
          const message = errorText(error);
          if (/HTTP 40[34]|404|410/.test(message)) result.missingOwnershipXml++;
          else result.failures.push({ accessionNo: filing.accession, error: message });
        }
        await sleep(150);
      }
      if (result.status === "pending") result.status = result.failures.length ? "error" : result.filingsProcessed ? "collected" : "missing_official";
    } catch (error) {
      result.status = "error";
      result.failures.push({ error: errorText(error) });
    }
    results.push(result);
    console.log(`[insiders] ${company.ticker}: ${result.status} · filings ${result.filingsProcessed} · kept ${result.transactionsKept} · missing XML ${result.missingOwnershipXml} · failures ${result.failures.length}`);
  }
  const output = { schemaVersion: 1, generatedAt, filingsPerCompany, universeSize: universe.length, companies: results };
  writeFileSync("worker/.runs/local-generated/insider-trades-50.json", `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ companies: results.length, collected: results.filter((result) => result.status === "collected").length, missingOfficial: results.filter((result) => result.status === "missing_official").length, errors: results.filter((result) => result.status === "error").map((result) => ({ ticker: result.ticker, failures: result.failures })) }, null, 2));
} finally {
  await db.$client.end();
}
