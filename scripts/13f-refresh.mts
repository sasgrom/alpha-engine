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
import { loadFundUniverse, latestPerQuarter, parseInfoTable, positionEvent, eventNote, buildPositionRow, SIGNAL_TIERS, autoScale13F } from "../worker/lib/thirteenf";
import { startProgress } from "../worker/lib/progress";

const FORMS_13F = new Set(["13F-HR", "13F-HR/A"]);
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const QUARTERS = Number(arg("--quarters") ?? 12);
const ONLY = arg("--only")?.toLowerCase() ?? null;
// --universe funds-13f-top300.json (5g): events only for SIGNAL_TIERS, the
// rest are aggregates-only holdings rows
const UNIVERSE_FILE = arg("--universe") ?? "funds-13f.json";
const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

const db = getDb();
const prog = startProgress("13f", `quarters=${QUARTERS}`);

// --- honest-context caches (5g) -------------------------------------------------
const sharesOutCache = new Map<number, number | null>();
async function pctOfCompany(cik: number, shares: number): Promise<number | null> {
  if (!sharesOutCache.has(cik)) {
    const [r]: any = await db.execute(sql`SELECT val FROM facts WHERE cik=${cik} AND concept='EntityCommonStockSharesOutstanding' ORDER BY endDate DESC LIMIT 1`);
    sharesOutCache.set(cik, Number(r[0]?.val ?? 0) || null);
  }
  const out = sharesOutCache.get(cik);
  return out ? (shares / out) * 100 : null;
}
const holdersCache = new Map<string, Map<number, number>>();
async function holdersOf(cik: number, quarterDate: string): Promise<number | null> {
  if (!holdersCache.has(quarterDate)) {
    const [r]: any = await db.execute(sql`SELECT heldCik, COUNT(DISTINCT fundCik) n FROM fund_holdings WHERE quarterDate=${quarterDate} AND secClass='COM' GROUP BY heldCik`);
    holdersCache.set(quarterDate, new Map(r.map((x: any) => [Number(x.heldCik), Number(x.n)])));
  }
  return holdersCache.get(quarterDate)?.get(cik) ?? null;
}

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
        // 5f+: metadata rides the SAME response — free enrichment
        await db.execute(sql`INSERT IGNORE INTO cusip_map (cusip, cik, ticker, exchCode, secType)
          VALUES (${chunk[j]}, ${cik}, ${ticker}, ${hit?.exchCode ?? null}, ${hit?.securityType ?? hit?.securityType2 ?? null})`);
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

const funds = loadFundUniverse(UNIVERSE_FILE).filter((f) => !ONLY || f.name.toLowerCase().includes(ONLY));

// --rebuild-events: recompute event rows PURELY from stored fund_holdings
// (no fetching). Needed after note-format upgrades — the seen-quarter guard
// otherwise never regenerates notes. Run with DELETE FROM signals WHERE
// source='13f' first (keys are stable: 13f:pos:fund:cik:class:accn).
const REBUILD = process.argv.includes("--rebuild-events");
if (REBUILD) {
  let rebuilt = 0;
  for (const fund of funds.filter((f) => SIGNAL_TIERS.has(f.tier))) {
    const [qs]: any = await db.execute(sql`SELECT DISTINCT quarterDate FROM fund_holdings WHERE fundCik=${fund.cik} ORDER BY quarterDate`);
    const quarters = qs.map((r: any) => String(r.quarterDate).slice(0, 10));
    for (let i = 1; i < quarters.length; i++) {
      const [prevQ, curQ] = [quarters[i - 1], quarters[i]];
      const load = async (q: string) => {
        const [rows]: any = await db.execute(sql`SELECT heldCik, secClass, shares, valueUsd, accessionNo FROM fund_holdings WHERE fundCik=${fund.cik} AND quarterDate=${q} AND heldCik IS NOT NULL`);
        const m = new Map<string, { cik: number; cls: string; shares: number; valueUsd: number | null; accn: string }>();
        for (const r of rows) {
          const k = `${r.heldCik}:${r.secClass ?? "COM"}`;
          const cur = m.get(k) ?? { cik: Number(r.heldCik), cls: r.secClass ?? "COM", shares: 0, valueUsd: 0, accn: String(r.accessionNo) };
          cur.shares += Number(r.shares ?? 0);
          cur.valueUsd = (cur.valueUsd ?? 0) + Number(r.valueUsd ?? 0);
          m.set(k, cur);
        }
        return m;
      };
      const prev = await load(prevQ), cur = await load(curQ);
      // "% of fund" divides by the REAL book (fund_quarters), never the mapped subset
      const [tot]: any = await db.execute(sql`SELECT totalValueUsd s FROM fund_quarters WHERE fundCik=${fund.cik} AND quarterDate=${curQ}`);
      const fundTotal = Number(tot[0]?.s ?? 0) || null;
      const [pTot]: any = await db.execute(sql`SELECT totalValueUsd s FROM fund_quarters WHERE fundCik=${fund.cik} AND quarterDate=${prevQ}`);
      const prevTotal = Number(pTot[0]?.s ?? 0) || fundTotal;
      const filing = { accessionNo: cur.values().next().value?.accn ?? "", form: "13F-HR", filingDate: curQ, reportDate: curQ };
      const ctxFor = async (cik: number, shares: number | null, valueUsd: number | null, totalUsd: number | null) => ({
        valueUsd,
        pctFund: valueUsd && totalUsd ? (valueUsd / totalUsd) * 100 : null,
        pctCo: shares ? await pctOfCompany(cik, shares) : null,
        holders: await holdersOf(cik, curQ),
      });
      for (const [k, c] of cur) {
        const ev = positionEvent(prev.get(k)?.shares ?? null, c.shares, null);
        if (!ev) continue;
        const note = eventNote(fund.name, ev, c.cls, await ctxFor(c.cik, c.shares, c.valueUsd || null, fundTotal));
        const row = buildPositionRow(fund.cik, c.cik, filing, ev, note, c.cls);
        const res: any = await db.execute(sql`INSERT IGNORE INTO signals (cik, source, signalType, eventTs, ingestedAt, score, magnitude, payloadKey, src, note)
          VALUES (${row.cik}, ${row.source}, ${row.signalType}, ${row.eventTs}, NOW(), ${row.score}, ${row.magnitude}, ${row.payloadKey}, ${row.src}, ${row.note})`);
        rebuilt += Number(res[0]?.affectedRows ?? 0) > 0 ? 1 : 0;
      }
      for (const [k, p] of prev) {
        if (p.shares > 0 && !cur.has(k)) {
          const ev = positionEvent(p.shares, 0, null);
          if (!ev) continue;
          const note = eventNote(fund.name, ev, p.cls, await ctxFor(p.cik, p.shares, p.valueUsd || null, prevTotal));
          const row = buildPositionRow(fund.cik, p.cik, filing, ev, note, p.cls);
          const res: any = await db.execute(sql`INSERT IGNORE INTO signals (cik, source, signalType, eventTs, ingestedAt, score, magnitude, payloadKey, src, note)
            VALUES (${row.cik}, ${row.source}, ${row.signalType}, ${row.eventTs}, NOW(), ${row.score}, ${row.magnitude}, ${row.payloadKey}, ${row.src}, ${row.note})`);
          rebuilt += Number(res[0]?.affectedRows ?? 0) > 0 ? 1 : 0;
        }
      }
    }
    prog.log(`${fund.name}: events rebuilt so far ${rebuilt}`);
  }
  prog.done(`rebuild-events: ${rebuilt} rows inserted`);
  process.exit(0);
}

// --totals-only: backfill fund_quarters (full-book totals) for fund+quarters
// already in fund_holdings — network pass, no events touched.
const TOTALS_ONLY = process.argv.includes("--totals-only");
if (TOTALS_ONLY) {
  let done = 0, written = 0;
  for (const fund of funds) {
    let filings;
    try { filings = await listFilings(fund.cik, FORMS_13F); } catch { continue; }
    const quarters = latestPerQuarter(filings.map((f) => ({ accessionNo: f.accessionNo, form: f.form, filingDate: f.filingDate, reportDate: f.reportDate || f.filingDate })));
    for (const q of quarters) {
      const [have]: any = await db.execute(sql`SELECT COUNT(*) h FROM fund_holdings WHERE fundCik=${fund.cik} AND quarterDate=${q.reportDate}`);
      const [got]: any = await db.execute(sql`SELECT COUNT(*) g FROM fund_quarters WHERE fundCik=${fund.cik} AND quarterDate=${q.reportDate}`);
      if (Number(have[0].h) === 0 || Number(got[0].g) > 0) continue;
      try {
        const docs = (await listFilingDocs(fund.cik, q.accessionNo)).filter((d) => /\.xml$/i.test(d.name));
        const biggest = docs.sort((a, b) => b.size - a.size)[0];
        if (!biggest) continue;
        const holdings = parseInfoTable(await fetchDoc(fund.cik, q.accessionNo, biggest.name));
        autoScale13F(holdings);
        await db.execute(sql`INSERT INTO fund_quarters (fundCik, quarterDate, totalValueUsd, positions, accessionNo)
          VALUES (${fund.cik}, ${q.reportDate}, ${holdings.reduce((a, h) => a + (h.valueUsd ?? 0), 0)}, ${holdings.length}, ${q.accessionNo})
          ON DUPLICATE KEY UPDATE totalValueUsd=VALUES(totalValueUsd), positions=VALUES(positions), accessionNo=VALUES(accessionNo)`);
        written++;
      } catch { /* single filing failure is non-fatal */ }
      if (++done % 50 === 0) prog.item(done, 4000, `${written} totals written`);
    }
    prog.log(`${fund.name}: totals written so far ${written}`);
  }
  prog.done(`totals-only: ${written} fund_quarters rows`);
  process.exit(0);
}

let totalRows = 0, totalEvents = 0;
for (const fund of funds) {
  prog.stage(`${fund.name} [${fund.tier}]`);
  let filings;
  try { filings = await listFilings(fund.cik, FORMS_13F); }
  catch (err) { prog.log(`x ${fund.name}: submissions failed — ${String(err).slice(0, 100)}`); continue; }
  const quarters = latestPerQuarter(filings.map((f) => ({ accessionNo: f.accessionNo, form: f.form, filingDate: f.filingDate, reportDate: f.reportDate || f.filingDate }))).slice(-QUARTERS);
  if (quarters.length === 0) { prog.stageDone(`${fund.name}: no 13F filings`); continue; }

  // previous-quarter shares/values per heldCik:secClass, seeded from the DB
  const prevShares = new Map<string, { shares: number }>();
  const prevValues = new Map<string, { valueUsd: number | null }>();
  let prevTotalUsd: number | null = null;
  const [seed]: any = await db.execute(sql`SELECT heldCik, secClass, shares, valueUsd, quarterDate FROM fund_holdings WHERE fundCik = ${fund.cik} AND heldCik IS NOT NULL ORDER BY quarterDate`);
  const seenQuarter = new Set<string>();
  for (const r of seed) {
    seenQuarter.add(String(r.quarterDate));
    if (r.shares != null) {
      prevShares.set(`${r.heldCik}:${r.secClass ?? "COM"}`, { shares: Number(r.shares) });
      prevValues.set(`${r.heldCik}:${r.secClass ?? "COM"}`, { valueUsd: r.valueUsd !== null ? Number(r.valueUsd) : null });
    }
  }
  const [tot]: any = await db.execute(sql`SELECT totalValueUsd s FROM fund_quarters WHERE fundCik = ${fund.cik} ORDER BY quarterDate DESC LIMIT 1`);
  prevTotalUsd = Number(tot[0]?.s ?? 0) || null;

  let fundRows = 0, fundEvents = 0;
  for (const q of quarters) {
    if (seenQuarter.has(q.reportDate)) { continue; } // idempotent reruns
    try {
      const docs = (await listFilingDocs(fund.cik, q.accessionNo)).filter((d) => /\.xml$/i.test(d.name));
      const biggest = docs.sort((a, b) => b.size - a.size)[0];
      if (!biggest) { prog.log(`! ${fund.name} ${q.reportDate}: no xml info table`); continue; }
      const holdings = parseInfoTable(await fetchDoc(fund.cik, q.accessionNo, biggest.name));
      const sc = autoScale13F(holdings); // some filers report dollars, not thousands
      if (sc.scale !== 1) prog.log(`! ${fund.name} ${q.reportDate}: value field is in DOLLARS (median implied $${Math.round(sc.medianImplied!).toLocaleString("en-US")}) — scaled ÷1000`);
      // full-book total BEFORE universe filtering — the honest "% of fund" basis
      await db.execute(sql`INSERT INTO fund_quarters (fundCik, quarterDate, totalValueUsd, positions, accessionNo)
        VALUES (${fund.cik}, ${q.reportDate}, ${holdings.reduce((a, h) => a + (h.valueUsd ?? 0), 0)}, ${holdings.length}, ${q.accessionNo})
        ON DUPLICATE KEY UPDATE totalValueUsd=VALUES(totalValueUsd), positions=VALUES(positions), accessionNo=VALUES(accessionNo)`);
      const map = await mapCusips([...new Set(holdings.map((h) => h.cusip))]);
      const curShares = new Map<string, { cik: number; cls: string; shares: number }>();
      for (const h of holdings) {
        const m = map.get(h.cusip);
        if (!m?.cik || !ourCiks.has(m.cik)) continue; // outside our universe
        await db.execute(sql`INSERT IGNORE INTO fund_holdings (fundCik, fundName, cusip, secClass, heldCik, issuer, shares, valueUsd, quarterDate, accessionNo, tier)
          VALUES (${fund.cik}, ${fund.name}, ${h.cusip}, ${h.secClass}, ${m.cik}, ${h.issuer}, ${h.shares}, ${h.valueUsd}, ${q.reportDate}, ${q.accessionNo}, ${fund.tier})`);
        const k = `${m.cik}:${h.secClass}`;
        const cur = curShares.get(k) ?? { cik: m.cik, cls: h.secClass, shares: 0, valueUsd: 0 };
        cur.shares += h.shares ?? 0;
        cur.valueUsd += h.valueUsd ?? 0;
        curShares.set(k, cur);
        fundRows++;
      }
      // events vs previous quarter (per heldCik:secClass — a PUT is not the
      // stock). 5g: only SIGNAL_TIERS generate events; "institutional" funds
      // feed the aggregates (ownership %, crowding, flows), not the stream.
      // Notes carry honest computed context: $, % of fund book, % of company,
      // crowding (holders count from what's stored — full after --rebuild-events).
      // fundTotalUsd is computed for EVERY tier (prevTotalUsd tracking needs it)
      const fundTotalUsd = holdings.reduce((a, h) => a + (h.valueUsd ?? 0), 0);
      const rows: any[] = [];
      if (SIGNAL_TIERS.has(fund.tier)) {
        const ctxFor = async (cik: number, shares: number | null, valueUsd: number | null, totalUsd: number | null) => ({
          valueUsd,
          pctFund: valueUsd && totalUsd ? (valueUsd / totalUsd) * 100 : null,
          pctCo: shares ? await pctOfCompany(cik, shares) : null,
          holders: await holdersOf(cik, q.reportDate),
        });
        for (const [k, cur] of curShares) {
          const prev = prevShares.get(k)?.shares ?? null;
          const ev = positionEvent(prev, cur.shares, null);
          if (ev) rows.push(buildPositionRow(fund.cik, cur.cik, q, ev, eventNote(fund.name, ev, cur.cls, await ctxFor(cur.cik, cur.shares, cur.valueUsd || null, fundTotalUsd)), cur.cls));
        }
        for (const [k, prev] of prevShares) {
          if (prev.shares > 0 && !curShares.has(k)) {
            const [cikStr, cls] = k.split(":");
            const ev = positionEvent(prev.shares, 0, null);
            const prevVal = prevValues.get(k)?.valueUsd ?? null;
            if (ev) rows.push(buildPositionRow(fund.cik, Number(cikStr), q, ev, eventNote(fund.name, ev, cls, await ctxFor(Number(cikStr), prev.shares, prevVal, prevTotalUsd ?? fundTotalUsd)), cls));
          }
        }
      }
      for (const r of rows) {
        const res: any = await db.execute(sql`INSERT IGNORE INTO signals (cik, source, signalType, eventTs, ingestedAt, score, magnitude, payloadKey, src, note)
          VALUES (${r.cik}, ${r.source}, ${r.signalType}, ${r.eventTs}, NOW(), ${r.score}, ${r.magnitude}, ${r.payloadKey}, ${r.src}, ${r.note})`);
        fundEvents += Number(res[0]?.affectedRows ?? 0) > 0 ? 1 : 0;
      }
      for (const [k, v] of curShares) { prevShares.set(k, { shares: v.shares }); prevValues.set(k, { valueUsd: v.valueUsd || null }); }
      prevTotalUsd = fundTotalUsd || prevTotalUsd;
      prog.item(quarters.indexOf(q) + 1, quarters.length, `${fundRows} rows, ${fundEvents} events`);
    } catch (err) {
      prog.log(`! ${fund.name} ${q.reportDate}: ${String(err).slice(0, 120)}`);
    }
  }
  totalRows += fundRows; totalEvents += fundEvents;
  prog.stageDone(`${fund.name}: ${quarters.length} quarters, ${fundRows} holdings, ${fundEvents} events`);
}
prog.done(`all done - ${totalRows} holdings rows, ${totalEvents} signal events`);
process.exit(0);
