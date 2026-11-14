import { existsSync } from "node:fs";
import path from "node:path";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { DeskIntradayMarker, DeskIntradayResponse, DeskIntradayMarket } from "@contracts/intraday";
import { SECTOR_FUND_BY_SECTOR } from "@contracts/intraday";
import type { DeskSnapshot } from "@contracts/desk-snapshot";
import { filings } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "../lib/env";
import { readDeskSnapshot } from "./desk-snapshot";
import { defaultIntradayRoot, listIntradaySessions, readIntradayJsonFile, readPriceAdjustments, readReleaseCalendar, readStoredIntradaySession, type ReleaseCalendarRow } from "../../worker/lib/intraday-storage";
import { easternDay, etWallToIso, intradayMarketOpen, prepareIntradaySeries, type PriceAdjustment } from "../../worker/lib/intraday-views";

const RELEASE_FILES = ["D:/research/alpha-engine/engine/events/quarters-50.jsonl", "D:/research/alpha-engine/engine/events/quarters-rest.jsonl"];
const ADJUSTMENTS_FILE = path.resolve("worker/.runs/price-adjustments.jsonl");

interface FilingMarkerRow {
  accessionNo: string;
  form: string;
  filingDate: string | null;
}

export interface IntradayServiceOptions {
  root?: string;
  snapshot?: DeskSnapshot | null;
  adjustments?: PriceAdjustment[];
  releases?: ReleaseCalendarRow[];
  filings?: FilingMarkerRow[];
  now?: Date;
}

function normalizedTicker(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function secUrl(cik: number, accessionNo: string | null): string | null {
  return accessionNo ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNo.replaceAll("-", "")}` : null;
}

async function loadFilings(cik: number, from: string, to: string): Promise<FilingMarkerRow[]> {
  return getDb().select({ accessionNo: filings.accessionNo, form: filings.form, filingDate: filings.filingDate }).from(filings).where(and(eq(filings.cik, cik), inArray(filings.form, ["8-K", "8-K/A"]), gte(filings.filingDate, from), lte(filings.filingDate, to)));
}

function companyMarkers(cik: number, releases: ReleaseCalendarRow[], filingRows: FilingMarkerRow[], sessionDates: Set<string>): DeskIntradayMarker[] {
  const markers: DeskIntradayMarker[] = [], seenAccessions = new Set<string>(), exactByAccession = new Map<string, string>();
  for (const row of releases) {
    if (Number(row.cik) !== cik) continue;
    for (const [accession, accepted] of [[row.periodicAccession, row.periodicAcceptedEt], [row.earningsAccession, row.earningsAcceptedEt]] as const) {
      if (accession && accepted) exactByAccession.set(accession, accepted);
    }
    for (const filing of row.earningsFilings ?? []) exactByAccession.set(filing.accessionNo, filing.acceptedEt);
    if (!row.firstPublicationEt) continue;
    const time = etWallToIso(row.firstPublicationEt);
    if (!time) continue;
    const date = easternDay(time);
    if (!sessionDates.has(date)) continue;
    const accessionNo = row.earningsAccession ?? row.periodicAccession;
    if (accessionNo) seenAccessions.add(accessionNo);
    markers.push({ time, date, kind: "release", label: row.earningsAccession ? "Earnings release" : `${row.periodicForm} filing`, accessionNo, sourceUrl: secUrl(cik, accessionNo), precision: "second" });
  }
  for (const filing of filingRows) {
    if (seenAccessions.has(filing.accessionNo) || !filing.filingDate) continue;
    const accepted = exactByAccession.get(filing.accessionNo), time = accepted ? etWallToIso(accepted) : null;
    const date = time ? easternDay(time) : filing.filingDate;
    if (!sessionDates.has(date)) continue;
    markers.push({ time, date, kind: "8-K", label: `${filing.form}${time ? "" : " · filing date only"}`, accessionNo: filing.accessionNo, sourceUrl: secUrl(cik, filing.accessionNo), precision: time ? "second" : "day" });
  }
  return markers.sort((a, b) => Number(a.time === null) - Number(b.time === null) || (a.time ?? "").localeCompare(b.time ?? "") || a.label.localeCompare(b.label));
}

export async function intradayForCompany(input: { ticker: string; sessions: number }, options: IntradayServiceOptions = {}): Promise<DeskIntradayResponse | null> {
  const snapshot = options.snapshot === undefined ? readDeskSnapshot() : options.snapshot;
  const wanted = normalizedTicker(input.ticker), company = snapshot?.companies.find(row => normalizedTicker(row.ticker) === wanted || normalizedTicker(row.registryTicker) === wanted);
  if (!company) return null;
  const root = options.root ?? defaultIntradayRoot(), requestedSessions = Math.max(1, Math.min(5, Math.trunc(input.sessions)));
  const stored = listIntradaySessions(root).slice(-requestedSessions).flatMap(session => {
    const value = readStoredIntradaySession(root, session);
    return value ? [value] : [];
  });
  if (!stored.length) return null;
  const sectorFund = SECTOR_FUND_BY_SECTOR[company.sector] ?? null;
  const prepared = stored.map(value => ({
    value,
    company: prepareIntradaySeries(value, company.ticker, options.adjustments ?? readPriceAdjustments(ADJUSTMENTS_FILE)),
    spy: prepareIntradaySeries(value, "SPY"),
    sector: sectorFund ? prepareIntradaySeries(value, sectorFund) : null,
  }));
  if (prepared.every(row => row.company.bars.length === 0)) return null;
  const dates = new Set(stored.map(value => value.session));
  const releases = options.releases ?? readReleaseCalendar(RELEASE_FILES);
  const filingRows = options.filings ?? await loadFilings(company.cik, stored[0].session, stored.at(-1)!.session);
  const markers = companyMarkers(company.cik, releases, filingRows, dates);
  const latest = prepared.at(-1)!;
  const status = prepared.length < requestedSessions || prepared.some(row => row.company.bars.length === 0 || row.spy.bars.length === 0 || (sectorFund && !row.sector?.bars.length)) ? "partial" : "ok";
  return {
    schemaVersion: 1,
    ticker: company.ticker,
    cik: company.cik,
    name: company.name,
    sector: company.sector,
    sectorFund,
    requestedSessions,
    status,
    session: latest.value.session,
    asOf: latest.value.updatedAt,
    marketOpen: intradayMarketOpen(latest.value.session, latest.value.updatedAt, options.now ?? new Date()),
    delayed: latest.company.delayed,
    sessions: prepared.map(row => ({ date: row.value.session, company: row.company, spy: row.spy, sector: row.sector, markers: markers.filter(marker => marker.date === row.value.session) })),
  };
}

export function intradayMarketFile(): string {
  return path.resolve(process.cwd(), env.isProduction ? "dist/public/reports" : "public/reports", "desk-intraday-market.json");
}

export function readIntradayMarketReport(file = intradayMarketFile(), now = new Date()): DeskIntradayMarket | null {
  if (!existsSync(file)) return null;
  const report = readIntradayJsonFile<DeskIntradayMarket>(file);
  if (report?.schemaVersion !== 1 || typeof report.session !== "string" || typeof report.asOf !== "string") throw new Error("Invalid intraday market summary");
  return { ...report, marketOpen: intradayMarketOpen(report.session, report.asOf, now) };
}
