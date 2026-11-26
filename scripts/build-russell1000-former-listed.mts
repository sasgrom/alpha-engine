import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { secGet } from "../worker/lib/edgar";
import {
  commonStockListings,
  type ExchangeCompanyRow,
} from "../worker/lib/russell1000-listed";

const ROOT = "D:/research/alpha-engine/index-membership/russell1000";
const companies = JSON.parse(
  readFileSync(path.join(ROOT, "companies.json"), "utf8")
).companies as any[];
const former = new Map(
  companies
    .filter(company => company.status === "former" && !company.inOurRegistry)
    .map(company => [company.cik, company])
);
const day = new Date().toISOString().slice(0, 10);
const sourceUrl = "https://www.sec.gov/files/company_tickers_exchange.json";
const sourceFile = path.join(ROOT, `k27-company_tickers_exchange-${day}.json`);
let raw: Buffer;
if (existsSync(sourceFile)) raw = readFileSync(sourceFile);
else {
  raw = Buffer.from(await (await secGet(sourceUrl)).arrayBuffer());
  const temporary = `${sourceFile}.tmp-${process.pid}`;
  writeFileSync(temporary, raw, { flag: "wx" });
  renameSync(temporary, sourceFile);
}
const sourceHash = createHash("sha256").update(raw).digest("hex");
const body = JSON.parse(raw.toString("utf8"));
const fields = body.fields as string[];
const rows = (body.data as any[][]).map(
  values =>
    Object.fromEntries(
      fields.map((field, index) => [field, values[index]])
    ) as ExchangeCompanyRow
);
const common = commonStockListings(rows);
const universe = common
  .filter(row => former.has(row.cik))
  .map(row => ({
    cik: row.cik,
    ticker: row.ticker,
    name: row.name,
    exchange: row.exchange,
  }))
  .sort((a, b) => a.cik - b.cik || a.ticker.localeCompare(b.ticker));
const listedCiks = new Set(universe.map(row => row.cik));
const allFormerRows = rows.filter(row => former.has(row.cik));
const gone = [...former.keys()]
  .filter(cik => !listedCiks.has(cik))
  .map(cik => {
    const companyRows = allFormerRows.filter(row => row.cik === cik);
    return {
      cik,
      tickers: companyRows.map(row => row.ticker),
      name: former.get(cik).name,
      reason: companyRows.length
        ? "No current common-stock listing; only excluded instrument rows are present"
        : "No current SEC exchange listing",
    };
  });
const universeFile = path.resolve(
  "worker/edgar-universe-r1000-former-listed.json"
);
const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    url: sourceUrl,
    file: sourceFile,
    bytes: raw.length,
    sha256: sourceHash,
  },
  formerCompanies: former.size,
  listedCompanies: listedCiks.size,
  goneCompanies: gone.length,
  commonShareListings: universe.length,
  gone,
  universe: { file: universeFile, bytes: 0, sha256: "" },
};
mkdirSync(path.dirname(universeFile), { recursive: true });
const universeTemporary = `${universeFile}.tmp-${process.pid}`;
writeFileSync(universeTemporary, `${JSON.stringify(universe, null, 2)}\n`, {
  flag: "wx",
});
renameSync(universeTemporary, universeFile);
const universeBytes = readFileSync(universeFile);
evidence.universe = {
  file: universeFile,
  bytes: universeBytes.length,
  sha256: createHash("sha256").update(universeBytes).digest("hex"),
};
const evidenceFile = path.join(ROOT, "k27-former-listed-evidence.json");
const evidenceTemporary = `${evidenceFile}.tmp-${process.pid}`;
writeFileSync(evidenceTemporary, `${JSON.stringify(evidence, null, 2)}\n`, {
  flag: "wx",
});
renameSync(evidenceTemporary, evidenceFile);
console.log(
  JSON.stringify(
    {
      former: former.size,
      listedCompanies: listedCiks.size,
      goneCompanies: gone.length,
      commonShareListings: universe.length,
      universeFile,
      evidenceFile,
      sourceHash,
    },
    null,
    2
  )
);
