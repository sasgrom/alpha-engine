/**
 * 13F refresh v2 (rewritten 5g, after the hang diagnosis):
 *   npx tsx scripts/13f-refresh.mts [--universe funds-13f-top300.json]
 *     [--quarters 12] [--only "Berkshire"] [--totals-only] [--rebuild-events]
 *
 * Per fund (universe JSON): latest 13F-HR(/A) per quarter → info-table XML
 * (CACHED on disk: worker/cache/13f/<fundCik>/<accn>.xml — reruns never
 * refetch) → autoscale value units (dollars-vs-thousands per filing) →
 * fund_quarters full-book total → fund_holdings rows (BATCHED inserts, only
 * securities mapping to our companies via cached CUSIP map + OpenFIGI) →
 * QoQ events (new/exit/±30%) as signals rows for SIGNAL_TIERS only.
 * Deterministic everywhere — no LLM. Local-first: run against the LOCAL db.
 *
 * Hard lessons baked in: batched DB ops (row-per-row UPDATE hung 7 min on
 * BlackRock), collation-safe repair (JS-side), idempotent reruns, network
 * cache, honest NULLs.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { listFilings, listFilingDocs, fetchDoc } from "../worker/lib/edgar";
import {
  loadFundUniverse, latestPerQuarter, parseInfoTable, autoScale13F,
  positionEvent, eventNote, buildPositionRow, SIGNAL_TIERS, type Holding13F,
} from "../worker/lib/thirteenf";
import { startProgress } from "../worker/lib/progress";

// ---------------------------------------------------------------------------
const FORMS_13F = new Set(["13F-HR", "13F-HR/A"]);
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const QUARTERS = Number(arg("--quarters") ?? 12);
const ONLY = arg("--only")?.toLowerCase() ?? null;
const UNIVERSE_FILE = arg("--universe") ?? "funds-13f.json";
const TOTALS_ONLY = process.argv.includes("--totals-only");
const REBUILD = process.argv.includes("--rebuild-events");
const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

const db = getDb();
const prog = startProgress("13f", `quarters=${QUARTERS}, universe=${UNIVERSE_FILE}`);
const cacheDir = (fundCik: number) => path.resolve(import.meta.dirname, "..", "worker", "cache", "13f", String(fundCik));

/** Filing document with disk cache (network only on miss). */
async function infoTableXml(fundCik: number, accessionNo: string): Promise<string | null> {
  const file = path.join(cacheDir(fundCik), `${accessionNo.replace(/-/g, "")}.xml`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const docs = (await listFilingDocs(fundCik, accessionNo)).filter((d) => /\.xml$/i.test(d.name));
  const biggest = docs.sort((a, b) => b.size - a.size)[0];
  if (!biggest) return null;
  const xml = await fetchDoc(fundCik, accessionNo, biggest.name);
  mkdirSync(cacheDir(fundCik), { recursive: true });
  writeFileSync(file, xml);
  return xml;
}

// ---------------------------------------------------------------------------
// CUSIP → company resolution. All batched; FIGI only for unknown cusips.
// ---------------------------------------------------------------------------
const FIGI_KEY = process.env.OPENFIGI_API_KEY ?? null;
const FIGI_CHUNK = FIGI_KEY ? 100 : 25;

async function mapCusips(cusips: string[]): Promise<Map<number, { cik: number | null; ticker: string | null }>> {
  // 1) repair cached rows whose ticker never resolved (JS-side join — the
  //    UPDATE..JOIN hit a collation mismatch; chunked by cik, one UPDATE each)
  try {
    const [pending]: any = await db.execute(sql`SELECT cusip, ticker FROM cusip_map WHERE cik IS NULL AND ticker IS NOT NULL`);
    if (pending.length > 0) {
      const [comp]: any = await db.execute(sql`SELECT cik, ticker FROM companies`);
      const byTicker = new Map(comp.map((c: any) => [String(c.ticker), Number(c.cik)]));
      const byCik = new Map<number, string[]>();
      for (const row of pending) {
        const cik = byTicker.get(String(row.ticker));
        if (cik) (byCik.get(cik) ?? byCik.set(cik, []).get(cik)!).push(String(row.cusip));
      }
      for (const [cik, list] of byCik) {
        for (let i = 0; i < list.length; i += 500) {
          const chunk = list.slice(i, i + 500);
          await db.execute(sql`UPDATE cusip_map SET cik = ${cik} WHERE cusip IN (${sql.join(chunk.map((c) => sql`${c}`), sql`, `)})`);
        }
      }
      if (byCik.size > 0) prog.log(`cusip_map repaired: ${pending.length} re-resolved`);
    }
  } catch { /* repair is best-effort */ }

  // 2) read cache in one batched pass
  const out = new Map<string, { cik: number | null; ticker: string | null }>();
  const missing: string[] = [];
  for (let i = 0; i < cusips.length; i += 1000) {
    const chunk = cusips.slice(i, i + 1000);
    const [rows]: any = await db.execute(sql`SELECT cusip, cik, ticker FROM cusip_map WHERE cusip IN (${sql.join(chunk.map((c) => sql`${c}`), sql`, `)})`);
    for (const r of rows) out.set(String(r.cusip), { cik: r.cik !== null ? Number(r.cik) : null, ticker: r.ticker });
  }
  for (const c of cusips) if (!out.has(c)) missing.push(c);

  // 3) OpenFIGI only for the unknown
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
      const values: any[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const hit = data[j]?.data?.[0];
        values.push({ cusip: chunk[j], ticker: hit?.ticker ?? null, exchCode: hit?.exchCode ?? null, secType: hit?.securityType ?? hit?.securityType2 ?? null });
        out.set(chunk[j], { cik: null, ticker: hit?.ticker ?? null });
      }
      for (let k = 0; k < values.length; k += 500) {
        const vc = values.slice(k, k + 500);
        await db.execute(sql`INSERT IGNORE INTO cusip_map (cusip, cik, ticker, exchCode, secType) VALUES ${sql.join(
          vc.map((v) => sql`(${v.cusip}, ${null}, ${v.ticker}, ${v.exchCode}, ${v.secType})`), sql`, `
        )}`);
      }
      // resolve the fresh tickers against companies in one go
      const tickers = values.map((v) => v.ticker).filter(Boolean);
      if (tickers.length > 0) {
        const [comp]: any = await db.execute(sql`SELECT cik, ticker FROM companies WHERE ticker IN (${sql.join(tickers.map((t) => sql`${t}`), sql`, `)})`);
        const byTicker = new Map(comp.map((c: any) => [String(c.ticker), Number(c.cik)]));
        for (const v of values) {
          const cik = v.ticker ? byTicker.get(v.ticker) ?? null : null;
          if (cik) await db.execute(sql`UPDATE cusip_map SET cik = ${cik} WHERE cusip = ${v.cusip}`);
          out.set(v.cusip, { cik, ticker: v.ticker });
        }
      }
      await SLEEP(3000);
    } catch (err) {
      prog.log(`! figi chunk failed: ${String(err).slice(0, 120)} — those cusips stay unmapped this run`);
      for (const c of chunk) out.set(c, { cik: null, ticker: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// honest-context caches (shared across funds/quarters)
// ---------------------------------------------------------------------------
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
async function fundTotal(fundCik: number, quarterDate: string): Promise<number | null> {
  const [r]: any = await db.execute(sql`SELECT totalValueUsd s FROM fund_quarters WHERE fundCik=${fundCik} AND quarterDate=${quarterDate}`);
  return Number(r[0]?.s ?? 0) || null;
}

/** Batched INSERT IGNORE into signals for event rows. */
async function insertEvents(rows: any[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res: any = await db.execute(sql`INSERT IGNORE INTO signals (cik, source, signalType, eventTs, ingestedAt, score, magnitude, payloadKey, src, note)
      VALUES ${sql.join(chunk.map((r) => sql`(${r.cik}, ${r.source}, ${r.signalType}, ${r.eventTs}, NOW(), ${r.score}, ${r.magnitude}, ${r.payloadKey}, ${r.src}, ${r.note})`), sql`, `)}`);
    n += Number(res[0]?.affectedRows ?? 0);
  }
  return n;
}

/** Events for one fund-quarter pair from holdings maps (shared by both modes). */
async function eventsForQuarter(fund: { cik: number; name: string }, prev: Map<string, { shares: number; valueUsd: number | null }>, cur: Map<string, { cik: number; cls: string; shares: number; valueUsd: number | null; accn: string }>, curQ: string, prevQ: string | null): Promise<number> {
  const rows: any[] = [];
  const filing = { accessionNo: cur.values().next().value?.accn ?? "", form: "13F-HR", filingDate: curQ, reportDate: curQ };
  const totalUsd = await fundTotal(fund.cik, curQ);
  const prevTotalUsd = prevQ ? await fundTotal(fund.cik, prevQ) : totalUsd;
  for (const [k, c] of cur) {
    const p = prev.get(k) ?? null;
    const ev = positionEvent(p?.shares ?? null, c.shares, null);
    if (!ev) continue;
    const ctx = {
      valueUsd: c.valueUsd,
      pctFund: c.valueUsd && totalUsd ? (c.valueUsd / totalUsd) * 100 : null,
      pctCo: c.shares ? await pctOfCompany(c.cik, c.shares) : null,
      holders: await holdersOf(c.cik, curQ),
    };
    rows.push(buildPositionRow(fund.cik, c.cik, filing, ev, eventNote(fund.name, ev, c.cls, ctx), c.cls));
  }
  for (const [k, p] of prev) {
    if (p.shares > 0 && !cur.has(k)) {
      const [cikStr, cls] = k.split(":");
      const ev = positionEvent(p.shares, 0, null);
      if (!ev) continue;
      const ctx = {
        valueUsd: p.valueUsd,
        pctFund: p.valueUsd && prevTotalUsd ? (p.valueUsd / prevTotalUsd) * 100 : null,
        pctCo: await pctOfCompany(Number(cikStr), p.shares),
        holders: await holdersOf(Number(cikStr), curQ),
      };
      rows.push(buildPositionRow(fund.cik, Number(cikStr), filing, ev, eventNote(fund.name, ev, cls, ctx), cls));
    }
  }
  return insertEvents(rows);
}

// ---------------------------------------------------------------------------
const funds = loadFundUniverse(UNIVERSE_FILE).filter((f) => !ONLY || f.name.toLowerCase().includes(ONLY));
const [companies]: any = await db.execute(sql`SELECT cik FROM companies`);
const ourCiks = new Set<number>(companies.map((c: any) => Number(c.cik)));

// ---- --rebuild-events: DB-only regeneration (no network at all) ------------
if (REBUILD) {
  let rebuilt = 0;
  for (const fund of funds.filter((f) => SIGNAL_TIERS.has(f.tier))) {
    const [qs]: any = await db.execute(sql`SELECT DISTINCT quarterDate FROM fund_holdings WHERE fundCik=${fund.cik} ORDER BY quarterDate`);
    const quarters = qs.map((r: any) => String(r.quarterDate).slice(0, 10));
    let prev: Map<string, { shares: number; valueUsd: number | null }> | null = null;
    for (const curQ of quarters) {
      const [rows]: any = await db.execute(sql`SELECT heldCik, secClass, shares, valueUsd, accessionNo FROM fund_holdings WHERE fundCik=${fund.cik} AND quarterDate=${curQ} AND heldCik IS NOT NULL`);
      const cur = new Map<string, { cik: number; cls: string; shares: number; valueUsd: number | null; accn: string }>();
      for (const r of rows) {
        const k = `${r.heldCik}:${r.secClass ?? "COM"}`;
        const c = cur.get(k) ?? { cik: Number(r.heldCik), cls: r.secClass ?? "COM", shares: 0, valueUsd: 0, accn: String(r.accessionNo) };
        c.shares += Number(r.shares ?? 0);
        c.valueUsd = (c.valueUsd ?? 0) + Number(r.valueUsd ?? 0);
        cur.set(k, c);
      }
      if (prev) rebuilt += await eventsForQuarter(fund, prev, cur, curQ, quarters[quarters.indexOf(curQ) - 1]);
      prev = new Map([...cur].map(([k, v]) => [k, { shares: v.shares, valueUsd: v.valueUsd }]));
    }
    prog.log(`${fund.name}: events rebuilt so far ${rebuilt}`);
  }
  prog.done(`rebuild-events: ${rebuilt} rows inserted`);
  process.exit(0);
}

// ---- --totals-only: fill fund_quarters for fund+quarters already in holdings
if (TOTALS_ONLY) {
  let written = 0;
  for (const fund of funds) {
    let filings;
    try { filings = await listFilings(fund.cik, FORMS_13F); } catch { continue; }
    const quarters = latestPerQuarter(filings.map((f) => ({ accessionNo: f.accessionNo, form: f.form, filingDate: f.filingDate, reportDate: f.reportDate || f.filingDate })));
    for (const q of quarters) {
      const [have]: any = await db.execute(sql`SELECT COUNT(*) h FROM fund_holdings WHERE fundCik=${fund.cik} AND quarterDate=${q.reportDate}`);
      const [got]: any = await db.execute(sql`SELECT COUNT(*) g FROM fund_quarters WHERE fundCik=${fund.cik} AND quarterDate=${q.reportDate}`);
      if (Number(have[0].h) === 0 || Number(got[0].g) > 0) continue;
      const xml = await infoTableXml(fund.cik, q.accessionNo);
      if (!xml) continue;
      const holdings = parseInfoTable(xml);
      autoScale13F(holdings);
      await db.execute(sql`INSERT INTO fund_quarters (fundCik, quarterDate, totalValueUsd, positions, accessionNo)
        VALUES (${fund.cik}, ${q.reportDate}, ${holdings.reduce((a, h) => a + (h.valueUsd ?? 0), 0)}, ${holdings.length}, ${q.accessionNo})
        ON DUPLICATE KEY UPDATE totalValueUsd=VALUES(totalValueUsd), positions=VALUES(positions), accessionNo=VALUES(accessionNo)`);
      written++;
    }
    prog.log(`${fund.name}: totals written so far ${written}`);
  }
  prog.done(`totals-only: ${written} fund_quarters rows`);
  process.exit(0);
}

// ---- main pass -------------------------------------------------------------
let totalRows = 0, totalEvents = 0;
for (const fund of funds) {
  prog.stage(`${fund.name} [${fund.tier}]`);
  let filings;
  try { filings = await listFilings(fund.cik, FORMS_13F); }
  catch (err) { prog.log(`x ${fund.name}: submissions failed — ${String(err).slice(0, 100)}`); continue; }
  const quarters = latestPerQuarter(filings.map((f) => ({ accessionNo: f.accessionNo, form: f.form, filingDate: f.filingDate, reportDate: f.reportDate || f.filingDate }))).slice(-QUARTERS);
  if (quarters.length === 0) { prog.stageDone(`${fund.name}: no 13F filings`); continue; }

  // previous-quarter positions per heldCik:secClass, seeded from the DB.
  // Completion comes from fund_jobs (a quarter is seen ONLY if its block
  // completed) — never from "some rows exist": a crashed quarter used to be
  // skipped forever, which is how 2026-09-30 ended up 30x under-filled.
  const prevShares = new Map<string, { shares: number; valueUsd: number | null }>();
  const [seed]: any = await db.execute(sql`SELECT heldCik, secClass, shares, valueUsd, quarterDate FROM fund_holdings WHERE fundCik = ${fund.cik} AND heldCik IS NOT NULL ORDER BY quarterDate`);
  for (const r of seed) {
    prevShares.set(`${r.heldCik}:${r.secClass ?? "COM"}`, { shares: Number(r.shares ?? 0), valueUsd: r.valueUsd !== null ? Number(r.valueUsd) : null });
  }
  const [doneRows]: any = await db.execute(sql`SELECT quarterDate FROM fund_jobs WHERE fundCik = ${fund.cik}`);
  const seenQuarter = new Set(doneRows.map((r: any) => String(r.quarterDate)));

  let fundRows = 0, fundEvents = 0;
  for (const q of quarters) {
    if (seenQuarter.has(q.reportDate)) continue; // idempotent reruns
    try {
      const xml = await infoTableXml(fund.cik, q.accessionNo);
      if (!xml) { prog.log(`! ${fund.name} ${q.reportDate}: no xml info table`); continue; }
      const holdings = parseInfoTable(xml);
      const sc = autoScale13F(holdings);
      if (sc.scale !== 1) prog.log(`! ${fund.name} ${q.reportDate}: value field in DOLLARS (median implied $${Math.round(sc.medianImplied!).toLocaleString("en-US")}) — scaled ÷1000`);
      // full-book total BEFORE universe filtering
      await db.execute(sql`INSERT INTO fund_quarters (fundCik, quarterDate, totalValueUsd, positions, accessionNo)
        VALUES (${fund.cik}, ${q.reportDate}, ${holdings.reduce((a, h) => a + (h.valueUsd ?? 0), 0)}, ${holdings.length}, ${q.accessionNo})
        ON DUPLICATE KEY UPDATE totalValueUsd=VALUES(totalValueUsd), positions=VALUES(positions), accessionNo=VALUES(accessionNo)`);

      const map = await mapCusips([...new Set(holdings.map((h) => h.cusip))]);
      // batched holdings insert
      const values: any[] = [];
      const curShares = new Map<string, { cik: number; cls: string; shares: number; valueUsd: number | null; accn: string }>();
      for (const h of holdings) {
        const m = map.get(h.cusip);
        if (!m?.cik || !ourCiks.has(m.cik)) continue;
        values.push({ fundCik: fund.cik, fundName: fund.name, cusip: h.cusip, secClass: h.secClass, heldCik: m.cik, issuer: h.issuer, shares: h.shares, valueUsd: h.valueUsd, quarterDate: q.reportDate, accessionNo: q.accessionNo, tier: fund.tier });
        const k = `${m.cik}:${h.secClass}`;
        const c = curShares.get(k) ?? { cik: m.cik, cls: h.secClass, shares: 0, valueUsd: 0, accn: q.accessionNo };
        c.shares += h.shares ?? 0;
        c.valueUsd = (c.valueUsd ?? 0) + (h.valueUsd ?? 0);
        curShares.set(k, c);
      }
      for (let i = 0; i < values.length; i += 500) {
        const vc = values.slice(i, i + 500);
        await db.execute(sql`INSERT IGNORE INTO fund_holdings (fundCik, fundName, cusip, secClass, heldCik, issuer, shares, valueUsd, quarterDate, accessionNo, tier)
          VALUES ${sql.join(vc.map((v) => sql`(${v.fundCik}, ${v.fundName}, ${v.cusip}, ${v.secClass}, ${v.heldCik}, ${v.issuer}, ${v.shares}, ${v.valueUsd}, ${v.quarterDate}, ${v.accessionNo}, ${v.tier})`), sql`, `)}`);
      }
      fundRows += values.length;
      // events for signal tiers only
      if (SIGNAL_TIERS.has(fund.tier)) {
        fundEvents += await eventsForQuarter(fund, prevShares, curShares, q.reportDate, quarters[quarters.indexOf(q) - 1]?.reportDate ?? null);
      }
      for (const [k, v] of curShares) prevShares.set(k, { shares: v.shares, valueUsd: v.valueUsd });
      // completion is recorded ONLY here — after holdings AND events landed
      await db.execute(sql`INSERT IGNORE INTO fund_jobs (fundCik, quarterDate) VALUES (${fund.cik}, ${q.reportDate})`);
      prog.item(quarters.indexOf(q) + 1, quarters.length, `${fundRows} rows, ${fundEvents} events`);
    } catch (err) {
      prog.log(`! ${fund.name} ${q.reportDate}: ${String(err).slice(0, 150)}`);
    }
  }
  totalRows += fundRows; totalEvents += fundEvents;
  prog.stageDone(`${fund.name}: ${quarters.length} quarters, ${fundRows} holdings, ${fundEvents} events`);
}
prog.done(`all done - ${totalRows} holdings rows, ${totalEvents} signal events`);
process.exit(0);
