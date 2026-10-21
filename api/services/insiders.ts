/**
 * Insider trades collector (4j, D42) — Form 4 acquisition + parse + store.
 * The worker runs etlCompanyInsiders on a schedule; the sandbox QA script
 * (t_4j_insiders.mts) is a thin runner over this module.
 *
 * Acquisition: browse-edgar atom by issuer (type=4) carries accession-number
 * directly; the ownership XML lives at Archives/edgar/data/{issuerCik}/
 * {accn-nodash}/form4.xml (ownership filings carry no -index.json — proven
 * 2026-10-19). Parse is regex-based over the ownership schema.
 */
import { getDb } from "../queries/connection";
import { insiderTrades } from "@db/schema";
import * as edgar from "./edgar";

export interface InsiderTx {
  code: string;
  shares: number | null;
  price: number | null;
  after: number | null;
  date: string | null;
}
export interface ParsedForm4 {
  insider: string | null;
  role: string | null;
  is10b5: boolean;
  txs: InsiderTx[];
}

/** Form 4 list for an issuer via the browse-edgar atom feed. */
export async function form4List(cik: number, count = 60): Promise<{ accession: string; filingDate: string }[]> {
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).padStart(10, "0")}&type=4&dateb=&owner=include&count=${count}&output=atom`;
  const resp = await edgar.secFetch(url);
  const xml = await resp.text();
  const out: { accession: string; filingDate: string }[] = [];
  for (const m of xml.matchAll(/<accession-number>([\d-]+)<\/accession-number>[\s\S]*?<filing-date>([\d-]+)<\/filing-date>/g)) {
    out.push({ accession: m[1], filingDate: m[2] });
  }
  return out;
}

/**
 * Resolve the ownership XML URL via the filing's -index.htm: the filename
 * varies by filer agent (`form4.xml`, `wk-form4a_….xml`, …) and ownership
 * filings carry no -index.json (proven 2026-10-19). The xslF345X06/ copy is
 * the human-rendered duplicate — never take it.
 */
export async function form4XmlUrl(issuerCik: number, accession: string): Promise<string | null> {
  const nodash = accession.replace(/-/g, "");
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${nodash}/${accession}-index.htm`;
  const resp = await edgar.secFetch(indexUrl);
  const html = await resp.text();
  const m = html.match(/href="(\/Archives\/edgar\/data\/[^"]*\.xml)"/i);
  if (!m) return null;
  if (m[1].includes("xslF345X06")) {
    const raw = m[1].replace(/xslF345X06\//, "");
    return `https://www.sec.gov${raw}`;
  }
  return `https://www.sec.gov${m[1]}`;
}

const grab = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}>\\s*<value>([^<]*)</value>`, "i")) ?? xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
};

/** Parse the ownership XML: reporting owner + non-derivative transactions. */
export function parseForm4(xml: string): ParsedForm4 {
  const insider = grab(xml, "rptOwnerName");
  const role = grab(xml, "officerTitle") ?? (/<isDirector>\s*1/.test(xml) ? "Director" : null);
  const is10b5 =
    /<aff10b5One>\s*1\s*<\/aff10b5One>/.test(xml) || /<rule10b5_1>\s*1\s*<\/rule10b5_1>/.test(xml) || /Rule10b5-1/i.test(xml);
  const txs: InsiderTx[] = [];
  for (const block of xml.split(/<nonDerivativeTransaction>/i).slice(1)) {
    const b = block.split(/<\/nonDerivativeTransaction>/i)[0] ?? block;
    const code = grab(b, "transactionCode");
    if (!code) continue;
    const num = (t: string | null) => (t === null ? null : Number(t.replace(/,/g, "")));
    txs.push({
      code: code.toUpperCase(),
      shares: num(grab(b, "transactionShares")),
      price: num(grab(b, "transactionPricePerShare")),
      after: num(grab(b, "sharesOwnedFollowingTransaction")),
      date: grab(b, "transactionDate"),
    });
  }
  return { insider, role, is10b5, txs };
}

/** Fetch + parse + store one company's Form 4 feed. Idempotent via the UQ. */
export async function etlCompanyInsiders(cik: number, count = 60, paceMs = 150): Promise<{ filings: number; txs: number }> {
  const db = getDb();
  const list = await form4List(cik, count);
  let txs = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const f of list) {
    await sleep(paceMs);
    let xml: string;
    try {
      const url = await form4XmlUrl(cik, f.accession);
      if (!url) continue;
      const resp = await edgar.secFetch(url);
      xml = await resp.text();
    } catch {
      continue; // no ownership XML in this directory — skip honestly
    }
    const parsed = parseForm4(xml);
    for (const t of parsed.txs) {
      await db
        .insert(insiderTrades)
        .values({
          cik,
          accessionNo: f.accession,
          insiderName: parsed.insider,
          insiderRole: parsed.role,
          code: t.code,
          shares: t.shares,
          price: t.price,
          sharesAfter: t.after,
          tradeDate: t.date,
          filingDate: f.filingDate,
          is10b5: parsed.is10b5,
        })
        .onDuplicateKeyUpdate({ set: { insiderName: parsed.insider } });
      txs++;
    }
  }
  return { filings: list.length, txs };
}
