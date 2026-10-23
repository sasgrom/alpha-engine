/**
 * 13F refresh (5f) — run at home against the LOCAL db first (probation):
 *   npx tsx scripts/13f-refresh.mts [--quarters 12] [--only "Berkshire"]
 *
 * Per fund (worker/funds-13f.json): latest 13F-HR(/A) filing per quarter →
 * information-table XML → holdings → CUSIP map (OpenFIGI, cached in cusip_map)
 * → fund_holdings rows (only securities mapping to our companies) →
 * quarter-over-quarter events (new/exit/±30%) as signals rows
 * (source="13f", signalType="position", deterministic notes — NO LLM).
 * Prod push goes through scripts/push-local-signals.mts --source 13f as usual.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { listFilings, listFilingDocs, fetchDoc } from "../worker/lib/edgar";
import { loadFundUniverse, latestPerQuarter, parseInfoTable, positionEvent, eventNote, buildPositionRow } from "../worker/lib/thirteenf";
import { startProgress } from "../worker/lib/progress";

const FORMS_13F = new Set(["13F-HR", "13F-HR/A"]);
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const QUARTERS = Number(arg("--quarters") ?? 12);
const ONLY = arg("--only")?.toLowerCase() ?? null;
const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

const db = getDb();
const prog = startProgress("13f", `quarters=${QUARTERS}`);

// company registry (only mapped-to-our-companies holdings are stored)
const [companies]: any = await db.execute(sql`SELECT cik FROM companies`);
const ourCiks = new Set<number>(companies.map((c: any) => Number(c.cik)));

async function mapCusips(cusips: string[]): Promise<Map<string, { cik: number | null; ticker: string | null }>> {
  const out = new Map<string, { cik: number | null; ticker: string | null }>();
  const missing: string[] = [];
  for (const c of cusips) {
    const [r]: any = await db.execute(sql`SELECT cik, ticker FROM cusip_map WHERE cusip = ${c} LIMIT 1`);
    if (r.length > 0) out.set(c, { cik: r[0].cik, ticker: r[0].ticker });
    else missing.push(c);
  }
  // OpenFIGI: anonymous = 25 jobs/request (100 → HTTP 413, proven on
  // Berkshire); with a free OPENFIGI_API_KEY in .env — 100/request and a
  // bigger rate budget. 429 backs off and retries the same chunk either way.
  const FIGI_KEY = process.env.OPENFIGI_API_KEY ?? null;
  const FIGI_CHUNK = FIGI_KEY ? 100 : 25;
  for (let i = 0; i < missing.length; i += FIGI_CHUNK) {
    const chunk = missing.slice(i, i + FIGI_CHUNK);
    try {
      const res = await fetch("https://api.openfigi.com/v3/mapping", {
        method: "POST",
        headers: { "content-type": "application/json", ...(FIGI_KEY ? { "X-OPENFIGI-APIKEY": FIGI_KEY } : {}) },
        body: JSON.stringify(chunk.map((c) => ({ idType: "ID_CUSIP", idValue: c }))),
      });
      if (res.status === 429) { await SLEEP(15_000); i -= FIGI_CHUNK; continue; }
      if (!res.ok) throw new Error(`figi HTTP ${res.status}`);
      const data = (await res.json()) as any[];
      for (let j = 0; j < chunk.length; j++) {
        const hit = data[j]?.data?.[0];
        const ticker = hit?.ticker ?? null;
        // resolve ticker → our cik via companies registry
        let cik: number | null = null;
        if (ticker) {
          const [r]: any = await db.execute(sql`SELECT cik FROM companies WHERE ticker = ${ticker} LIMIT 1`);
          cik = r.length ? Number(r[0].cik) : null;
        }
        await db.execute(sql`INSERT IGNORE INTO cusip_map (cusip, cik, ticker) VALUES (${chunk[j]}, ${cik}, ${ticker})`);
        out.set(chunk[j], { cik, ticker });
      }
      await SLEEP(3000);
    } catch (err) {
      prog.log(`! figi mapping chunk failed: ${String(err).slice(0, 120)} — cusips left unmapped`);
      for (const c of chunk) out.set(c, { cik: null, ticker: null });
    }
  }
  return out;
}

const funds = loadFundUniverse().filter((f) => !ONLY || f.name.toLowerCase().includes(ONLY));
let totalRows = 0, totalEvents = 0;
for (const fund of funds) {
  prog.stage(`${fund.name} [${fund.tier}]`);
  let filings;
  try { filings = await listFilings(fund.cik, FORMS_13F); }
  catch (err) { prog.log(`x ${fund.name}: submissions failed — ${String(err).slice(0, 100)}`); continue; }
  const quarters = latestPerQuarter(filings.map((f) => ({ accessionNo: f.accessionNo, form: f.form, filingDate: f.filingDate, reportDate: f.reportDate || f.filingDate }))).slice(-QUARTERS);
  if (quarters.length === 0) { prog.stageDone(`${fund.name}: no 13F filings`); continue; }

  // previous-quarter shares per heldCik, seeded from what the DB already has
  const prevShares = new Map<number, number>();
  const [seed]: any = await db.execute(sql`SELECT heldCik, shares, quarterDate FROM fund_holdings WHERE fundCik = ${fund.cik} AND heldCik IS NOT NULL ORDER BY quarterDate`);
  const seenQuarter = new Set<string>();
  for (const r of seed) { seenQuarter.add(String(r.quarterDate)); if (r.shares != null) prevShares.set(Number(r.heldCik), Number(r.shares)); }

  let fundRows = 0, fundEvents = 0;
  for (const q of quarters) {
    if (seenQuarter.has(q.reportDate)) { continue; } // idempotent reruns
    try {
      const docs = (await listFilingDocs(fund.cik, q.accessionNo)).filter((d) => /\.xml$/i.test(d.name));
      const biggest = docs.sort((a, b) => b.size - a.size)[0];
      if (!biggest) { prog.log(`! ${fund.name} ${q.reportDate}: no xml info table`); continue; }
      const holdings = parseInfoTable(await fetchDoc(fund.cik, q.accessionNo, biggest.name));
      const map = await mapCusips([...new Set(holdings.map((h) => h.cusip))]);
      const curShares = new Map<number, number>();
      for (const h of holdings) {
        const m = map.get(h.cusip);
        if (!m?.cik || !ourCiks.has(m.cik)) continue; // outside our universe
        await db.execute(sql`INSERT IGNORE INTO fund_holdings (fundCik, fundName, cusip, heldCik, issuer, shares, valueUsd, quarterDate, accessionNo, tier)
          VALUES (${fund.cik}, ${fund.name}, ${h.cusip}, ${m.cik}, ${h.issuer}, ${h.shares}, ${h.valueUsd}, ${q.reportDate}, ${q.accessionNo}, ${fund.tier})`);
        curShares.set(m.cik, (curShares.get(m.cik) ?? 0) + (h.shares ?? 0));
        fundRows++;
      }
      // events vs previous quarter
      const rows: any[] = [];
      for (const [heldCik, shares] of curShares) {
        const ev = positionEvent(prevShares.get(heldCik) ?? null, shares, null);
        if (ev) rows.push(buildPositionRow(fund.cik, heldCik, q, ev, eventNote(fund.name, ev)));
      }
      for (const [heldCik, prev] of prevShares) {
        if (prev > 0 && !curShares.has(heldCik)) {
          const ev = positionEvent(prev, 0, null);
          if (ev) rows.push(buildPositionRow(fund.cik, heldCik, q, ev, eventNote(fund.name, ev)));
        }
      }
      for (const r of rows) {
        const res: any = await db.execute(sql`INSERT IGNORE INTO signals (cik, source, signalType, eventTs, ingestedAt, score, magnitude, payloadKey, src, note)
          VALUES (${r.cik}, ${r.source}, ${r.signalType}, ${r.eventTs}, NOW(), ${r.score}, ${r.magnitude}, ${r.payloadKey}, ${r.src}, ${r.note})`);
        fundEvents += Number(res[0]?.affectedRows ?? 0) > 0 ? 1 : 0;
      }
      for (const [k, v] of curShares) prevShares.set(k, v);
      prog.item(quarters.indexOf(q) + 1, quarters.length, `${fundRows} rows, ${fundEvents} events`);
    } catch (err) {
      prog.log(`! ${fund.name} ${q.reportDate}: ${String(err).slice(0, 120)}`);
    }
  }
  totalRows += fundRows; totalEvents += fundEvents;
  prog.stageDone(`${fund.name}: ${quarters.length} quarters, ${fundRows} holdings, ${fundEvents} events`);
}
prog.done(`all done — ${totalRows} holdings rows, ${totalEvents} signal events`);
process.exit(0);
