import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import mysql, { type Connection } from "mysql2/promise";
import { filingDocUrl, secGet } from "../worker/lib/edgar";
import { chunkFigiIds, shouldRetryFigi429 } from "../worker/lib/figi";
import {
  buildNameIndex,
  buildOrderFreeNameIndex,
  calendarQuarterEnds,
  latestReportOnOrBefore,
  matchHolding,
  membershipAgreement,
  mergeCompanyMembership,
  normalizeIssuerName,
  orderFreeIssuerName,
  parseNportXml,
  secDisplayIssuerName,
  type CompanyMembership,
  type FigiCandidate,
  type HoldingMatcher,
  type MatchedHolding,
  type NameIdentity,
  type NportReport,
  type ReportRef,
} from "../worker/lib/russell1000";
import {
  GICS_SECTORS,
  SIC_SECTOR_RULES,
  sectorFromSic,
  validateSectorMap,
} from "../worker/lib/russell1000-sector";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const ROOT = path.resolve(
  arg("--root") ?? "D:/research/alpha-engine/index-membership"
);
const OUT = path.join(ROOT, "russell1000");
const NPORT = path.join(ROOT, "nport");
const SUBMISSIONS = path.resolve(
  ROOT,
  "..",
  "engine",
  "events",
  "sec-submissions"
);
const START = "2019-09-30";
const FTS = "https://efts.sec.gov/LATEST/search-index";
const SEC_DATA = "https://data.sec.gov";
const MIN_FREE_BYTES = 2 * 1024 ** 3;

if (process.platform === "win32" && !/^D:/i.test(ROOT.replace(/\\/g, "/")))
  throw new Error("K26 requires a D: output root");
mkdirSync(OUT, { recursive: true });
const realRoot = realpathSync(ROOT);
if (process.platform === "win32" && !/^D:/i.test(realRoot.replace(/\\/g, "/")))
  throw new Error("K26 output realpath must remain on D:");
const freeBytes = statfsSync(realRoot).bavail * statfsSync(realRoot).bsize;
if (freeBytes < MIN_FREE_BYTES)
  throw new Error("K26 requires at least 2 GiB free on D:");

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeAtomic(file: string, value: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, value, { flag: "wx" });
  renameSync(temporary, file);
}

function writeJsonAtomic(file: string, value: unknown): void {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function inputEvidence(file: string) {
  const body = readFileSync(file);
  return { path: file, bytes: body.length, sha256: sha256(body) };
}

async function secJson(url: string): Promise<any> {
  return (await secGet(url)).json();
}

interface FundSpec {
  symbol: "IWB" | "VRNIX";
  cik: number;
  seriesId: string;
  classId: string;
}

interface FundReport extends ReportRef {
  parsed: NportReport;
  rawPath: string;
  sourceUrl: string;
}

interface RegistryRow {
  cik: number;
  ticker: string;
  name: string | null;
  sic: string | null;
  sicDescription: string | null;
  sector: string | null;
}

interface CompanyIdentity {
  cik: number;
  name: string;
  formerNames: Array<{ name: string; from?: string; to?: string }>;
  tickers: string[];
  sic: string | null;
  sicDescription: string | null;
  stateOfIncorporation: string | null;
}

async function openDatabase(variable: string): Promise<Connection> {
  const uri = process.env[variable];
  if (!uri) throw new Error(`${variable} is required for its read-only query`);
  return mysql.createConnection({ uri, multipleStatements: false });
}

async function loadRegistry(): Promise<RegistryRow[]> {
  const connection = await openDatabase("DATABASE_URL");
  try {
    const [rows] = await connection.execute(
      "SELECT cik,ticker,name,sic,sicDescription,sector FROM companies ORDER BY cik"
    );
    return (rows as any[]).map(row => ({
      cik: Number(row.cik),
      ticker: String(row.ticker),
      name: row.name === null ? null : String(row.name),
      sic: row.sic === null ? null : String(row.sic),
      sicDescription:
        row.sicDescription === null ? null : String(row.sicDescription),
      sector: row.sector === null ? null : String(row.sector),
    }));
  } finally {
    await connection.end();
  }
}

async function loadCusipMap(curatedFile: string) {
  const curated = readJson<Array<{ cusip: string; cik: number }>>(curatedFile);
  const ciksByCusip = new Map<string, Set<number>>();
  const sourcesByCusip = new Map<string, Set<string>>();
  const add = (cusip: string, cik: number, source: string) => {
    if (!/^[A-Z0-9*#@]{9}$/.test(cusip) || !Number.isInteger(cik) || cik <= 0)
      return;
    const ciks = ciksByCusip.get(cusip) ?? new Set<number>();
    ciks.add(cik);
    ciksByCusip.set(cusip, ciks);
    const sources = sourcesByCusip.get(cusip) ?? new Set<string>();
    sources.add(source);
    sourcesByCusip.set(cusip, sources);
  };
  for (const row of curated)
    add(
      String(row.cusip).toUpperCase(),
      Number(row.cik),
      "claude-cusip-company-map"
    );
  const connection = await openDatabase("RESEARCH_DATABASE_URL");
  try {
    const [rows] = await connection.execute(
      "SELECT DISTINCT cusip,companyCik FROM std_13f_positions WHERE companyCik IS NOT NULL AND companyCik > 0"
    );
    for (const row of rows as any[])
      add(
        String(row.cusip).toUpperCase(),
        Number(row.companyCik),
        "alpha_research.std_13f_positions"
      );
  } finally {
    await connection.end();
  }
  const cusipToCik = new Map<string, number>();
  const conflicts: Array<{ cusip: string; ciks: number[]; sources: string[] }> =
    [];
  for (const [cusip, ciks] of ciksByCusip) {
    if (ciks.size === 1) cusipToCik.set(cusip, [...ciks][0]);
    else
      conflicts.push({
        cusip,
        ciks: [...ciks].sort((a, b) => a - b),
        sources: [...(sourcesByCusip.get(cusip) ?? [])].sort(),
      });
  }
  return { cusipToCik, conflicts, distinctCusips: ciksByCusip.size };
}

async function discoverFunds(): Promise<{
  funds: FundSpec[];
  evidenceFile: string;
}> {
  const url = "https://www.sec.gov/files/company_tickers_mf.json";
  const body = await secJson(url);
  const fields = body.fields as string[];
  const rows = (body.data as any[][]).map(values =>
    Object.fromEntries(fields.map((field, index) => [field, values[index]]))
  );
  const funds = (["IWB", "VRNIX"] as const).map((symbol): FundSpec => {
    const matches = rows.filter(row => row.symbol === symbol);
    if (matches.length !== 1)
      throw new Error(
        `Expected one SEC mutual-fund mapping for ${symbol}; found ${matches.length}`
      );
    return {
      symbol,
      cik: Number(matches[0].cik),
      seriesId: String(matches[0].seriesId),
      classId: String(matches[0].classId),
    };
  });
  const evidenceFile = path.join(NPORT, "company_tickers_mf.json");
  writeJsonAtomic(evidenceFile, body);
  return { funds, evidenceFile };
}

async function discoverReports(fund: FundSpec): Promise<ReportRef[]> {
  const reports = new Map<string, ReportRef>();
  const end = new Date().toISOString().slice(0, 10);
  const rawResponses: any[] = [];
  for (let from = 0; ; from += 100) {
    const query = new URLSearchParams({
      q: `"${fund.seriesId}"`,
      forms: "NPORT-P",
      startdt: "2019-01-01",
      enddt: end,
      from: String(from),
      size: "100",
    });
    const body = await secJson(`${FTS}?${query}`);
    rawResponses.push(body);
    const hits = body?.hits?.hits ?? [];
    for (const hit of hits) {
      const source = hit._source ?? {};
      if (!(source.ciks ?? []).map(Number).includes(fund.cik)) continue;
      const accession = String(source.adsh);
      reports.set(accession, {
        accession,
        reportDate: String(source.period_ending),
        filed: String(source.file_date),
        sha256: "",
      });
    }
    if (hits.length < 100) break;
  }
  const result = [...reports.values()]
    .filter(report => report.reportDate >= START)
    .sort(
      (a, b) =>
        a.reportDate.localeCompare(b.reportDate) ||
        a.filed.localeCompare(b.filed)
    );
  if (!result.length)
    throw new Error(
      `SEC full-text search returned no N-PORT reports for ${fund.symbol}`
    );
  writeJsonAtomic(path.join(NPORT, fund.seriesId, "discovery.json"), {
    schemaVersion: 1,
    fund,
    source: FTS,
    query: { seriesId: fund.seriesId, form: "NPORT-P", start: START, end },
    reports: result,
    rawResponses,
  });
  return result;
}

async function collectFundReports(
  fund: FundSpec,
  refs: ReportRef[]
): Promise<FundReport[]> {
  const directory = path.join(NPORT, fund.seriesId);
  mkdirSync(directory, { recursive: true });
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? readJson<any>(manifestPath)
    : {
        schemaVersion: 1,
        ticker: fund.symbol,
        cik: fund.cik,
        seriesId: fund.seriesId,
        classId: fund.classId,
        files: {},
      };
  if (
    manifest.schemaVersion !== 1 ||
    manifest.seriesId !== fund.seriesId ||
    manifest.cik !== fund.cik
  )
    throw new Error(`Checkpoint identity mismatch: ${manifestPath}`);
  const reports: FundReport[] = [];
  for (const [index, ref] of refs.entries()) {
    const file = path.join(directory, `${ref.accession}.xml`);
    const sourceUrl = filingDocUrl(fund.cik, ref.accession, "primary_doc.xml");
    let body: Buffer;
    let fetchedAt: string;
    let reused = false;
    if (existsSync(file)) {
      body = readFileSync(file);
      fetchedAt =
        manifest.files?.[ref.accession]?.fetchedAt ??
        statSync(file).mtime.toISOString();
      reused = true;
    } else {
      body = Buffer.from(await (await secGet(sourceUrl)).arrayBuffer());
      fetchedAt = new Date().toISOString();
    }
    const digest = sha256(body);
    const parsed = parseNportXml(body.toString("utf8"));
    if (
      parsed.seriesId !== fund.seriesId ||
      parsed.reportDate !== ref.reportDate
    )
      throw new Error(`N-PORT identity mismatch for ${ref.accession}`);
    const previous = manifest.files?.[ref.accession];
    if (
      previous &&
      (previous.sha256 !== digest || previous.reportDate !== ref.reportDate)
    )
      throw new Error(
        `N-PORT checkpoint hash/date mismatch for ${ref.accession}`
      );
    if (!reused) writeAtomic(file, body);
    manifest.files[ref.accession] = {
      reportDate: ref.reportDate,
      filed: ref.filed,
      form: "NPORT-P",
      source: sourceUrl,
      bytes: body.length,
      sha256: digest,
      fetchedAt,
      reused,
    };
    writeJsonAtomic(manifestPath, manifest);
    reports.push({ ...ref, sha256: digest, parsed, rawPath: file, sourceUrl });
    console.log(
      `${fund.symbol} ${index + 1}/${refs.length} ${ref.reportDate} ${ref.accession} ${reused ? "reused" : "fetched"} ${body.length} bytes`
    );
  }
  return reports;
}

async function collectFigi(cusips: string[]) {
  const directory = path.join(OUT, "openfigi");
  mkdirSync(directory, { recursive: true });
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? readJson<any>(manifestPath)
    : {
        schemaVersion: 1,
        source: "https://api.openfigi.com/v3/mapping",
        anonymous: true,
        chunks: {},
      };
  if (manifest.schemaVersion !== 1 || manifest.anonymous !== true)
    throw new Error("OpenFIGI checkpoint identity mismatch");
  const figiByCusip = new Map<string, FigiCandidate[]>();
  const stats = {
    inputCusips: cusips.length,
    chunksFetched: 0,
    chunksReused: 0,
    candidateRows: 0,
  };
  for (const chunk of chunkFigiIds(cusips)) {
    const request = chunk.items.map(idValue => ({
      idType: "ID_CUSIP",
      idValue,
    }));
    const key = sha256(JSON.stringify(request));
    const file = path.join(directory, `${key}.json`);
    let evidence: any;
    if (existsSync(file)) {
      evidence = readJson<any>(file);
      if (JSON.stringify(evidence.request) !== JSON.stringify(request))
        throw new Error("OpenFIGI checkpoint request mismatch");
      stats.chunksReused++;
    } else {
      let response: any;
      for (let attempt = 0; ; attempt++) {
        const res = await fetch("https://api.openfigi.com/v3/mapping", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 && shouldRetryFigi429(attempt)) {
          await new Promise(resolve => setTimeout(resolve, 15_000));
          continue;
        }
        if (!res.ok)
          throw new Error(`OpenFIGI HTTP ${res.status} for checkpoint ${key}`);
        response = await res.json();
        break;
      }
      evidence = { request, response, fetchedAt: new Date().toISOString() };
      writeJsonAtomic(file, evidence);
      stats.chunksFetched++;
      await new Promise(resolve => setTimeout(resolve, 3_000));
    }
    const digest = sha256(readFileSync(file));
    manifest.chunks[key] = {
      file,
      request,
      sha256: digest,
      fetchedAt: evidence.fetchedAt,
    };
    writeJsonAtomic(manifestPath, manifest);
    for (let index = 0; index < chunk.items.length; index++) {
      const candidates = (evidence.response[index]?.data ?? []).map(
        (row: any) => ({
          ticker: typeof row.ticker === "string" ? row.ticker : null,
          name: typeof row.name === "string" ? row.name : null,
          exchange: typeof row.exchCode === "string" ? row.exchCode : null,
        })
      );
      figiByCusip.set(chunk.items[index], candidates);
      stats.candidateRows += candidates.length;
    }
  }
  writeJsonAtomic(manifestPath, manifest);
  return { figiByCusip, stats, manifestPath };
}

async function main() {
  const registry = await loadRegistry();
  const registryByCik = new Map(registry.map(row => [row.cik, row]));
  const curatedFile = path.join(ROOT, "cusip-company-map.json");
  const sp500File = path.join(ROOT, "sp500-membership.json");
  const cusip = await loadCusipMap(curatedFile);
  const { funds, evidenceFile: mutualFundEvidenceFile } = await discoverFunds();
  const tickerUrl = "https://www.sec.gov/files/company_tickers.json";
  const tickerBody = await secJson(tickerUrl);
  const tickerFile = path.join(NPORT, "company_tickers.json");
  writeJsonAtomic(tickerFile, tickerBody);
  const tickerRows = Object.values(tickerBody).map((row: any) => ({
    cik: Number(row.cik_str),
    ticker: String(row.ticker),
    name: String(row.title),
  }));
  const tickersByCik = new Map<number, string[]>();
  for (const row of tickerRows)
    tickersByCik.set(row.cik, [
      ...(tickersByCik.get(row.cik) ?? []),
      row.ticker,
    ]);
  const tickerCikCounts = new Map<string, Set<number>>();
  for (const row of tickerRows) {
    const key = row.ticker.toUpperCase().replace(/\./g, "-");
    tickerCikCounts.set(
      key,
      new Set([...(tickerCikCounts.get(key) ?? []), row.cik])
    );
  }
  const tickerToCik = new Map<string, number>();
  for (const [ticker, ciks] of tickerCikCounts) {
    if (ciks.size === 1) tickerToCik.set(ticker, [...ciks][0]);
  }

  const reportsByFund = new Map<string, FundReport[]>();
  for (const fund of funds)
    reportsByFund.set(
      fund.symbol,
      await collectFundReports(fund, await discoverReports(fund))
    );

  const identities = new Map<number, CompanyIdentity>();
  const identityNames: NameIdentity[] = tickerRows.map(row => ({
    cik: row.cik,
    name: row.name,
    kind: "current",
  }));
  const loadIdentity = async (cik: number): Promise<CompanyIdentity> => {
    const existing = identities.get(cik);
    if (existing) return existing;
    const file = path.join(
      SUBMISSIONS,
      `CIK${String(cik).padStart(10, "0")}.json`
    );
    const sourceUrl = `${SEC_DATA}/submissions/CIK${String(cik).padStart(10, "0")}.json`;
    let body: any;
    if (existsSync(file)) body = readJson<any>(file);
    else {
      body = await secJson(sourceUrl);
      if (Number(body.cik) !== cik)
        throw new Error(`Submission identity mismatch for CIK ${cik}`);
      writeJsonAtomic(file, body);
    }
    const currentNames = tickerRows
      .filter(row => row.cik === cik)
      .map(row => row.name);
    const identity: CompanyIdentity = {
      cik,
      name: String(
        body.name ??
          currentNames[0] ??
          registryByCik.get(cik)?.name ??
          `CIK ${cik}`
      ),
      formerNames: (body.formerNames ?? []).map((row: any) => ({
        name: String(row.name),
        from: row.from,
        to: row.to,
      })),
      tickers: [
        ...new Set([
          ...(body.tickers ?? []).map(String),
          ...(tickersByCik.get(cik) ?? []),
          ...(registryByCik.has(cik) ? [registryByCik.get(cik)!.ticker] : []),
        ]),
      ].sort(),
      sic:
        body.sic === null || body.sic === undefined
          ? (registryByCik.get(cik)?.sic ?? null)
          : String(body.sic),
      sicDescription:
        body.sicDescription === null || body.sicDescription === undefined
          ? (registryByCik.get(cik)?.sicDescription ?? null)
          : String(body.sicDescription),
      stateOfIncorporation:
        body.stateOfIncorporation === null ||
        body.stateOfIncorporation === undefined
          ? null
          : String(body.stateOfIncorporation),
    };
    identities.set(cik, identity);
    for (let index = identityNames.length - 1; index >= 0; index--) {
      if (
        identityNames[index].cik === cik &&
        identityNames[index].kind === "current"
      )
        identityNames.splice(index, 1);
    }
    const currentFrom = identity.formerNames
      .filter(
        former =>
          normalizeIssuerName(secDisplayIssuerName(former.name)) !==
          normalizeIssuerName(secDisplayIssuerName(identity.name))
      )
      .map(former => former.to?.slice(0, 10))
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1);
    identityNames.push({
      cik,
      name: identity.name,
      kind: "current",
      from: currentFrom,
    });
    for (const former of identity.formerNames)
      identityNames.push({
        cik,
        name: former.name,
        kind: "former",
        from: former.from,
        to: former.to,
      });
    return identity;
  };

  const ambiguousIdentityNames = new Set<string>();
  const figiByCusip = new Map<string, FigiCandidate[]>();
  const matchAll = (): Map<string, MatchedHolding[]> => {
    const result = new Map<string, MatchedHolding[]>();
    for (const [symbol, reports] of reportsByFund) {
      result.set(
        symbol,
        reports.map(report => {
          const nameToCik = buildNameIndex(identityNames, report.reportDate);
          const orderFreeNameToCik = buildOrderFreeNameIndex(
            identityNames,
            report.reportDate
          );
          for (const name of ambiguousIdentityNames) {
            nameToCik.delete(name);
            orderFreeNameToCik.delete(orderFreeIssuerName(name));
          }
          const matcher: HoldingMatcher = {
            cusipToCik: cusip.cusipToCik,
            nameToCik,
            orderFreeNameToCik,
            tickerToCik,
            figiByCusip,
          };
          return report.parsed.holdings.map(holding =>
            matchHolding(holding, matcher)
          );
        })
      );
    }
    return result;
  };
  let matched: Map<string, MatchedHolding[]> = new Map();
  for (let round = 0; round < 4; round++) {
    matched = matchAll();
    const ciks = new Set<number>();
    for (const reports of matched.values())
      for (const holdings of reports)
        for (const holding of holdings) if (holding.cik) ciks.add(holding.cik);
    const missing = [...ciks]
      .filter(cik => !identities.has(cik))
      .sort((a, b) => a - b);
    console.log(
      `Identity round ${round + 1}: ${ciks.size} matched companies, ${missing.length} submissions to read`
    );
    for (const [index, cik] of missing.entries()) {
      await loadIdentity(cik);
      if ((index + 1) % 100 === 0)
        console.log(`Identity submissions ${index + 1}/${missing.length}`);
    }
    if (!missing.length) break;
    if (round === 3) throw new Error("Identity matching did not converge");
  }

  const unmatchedNames = new Map<string, string>();
  for (const reports of matched.values()) {
    for (const holdings of reports) {
      for (const holding of holdings) {
        if (!holding.cik)
          unmatchedNames.set(normalizeIssuerName(holding.name), holding.name);
      }
    }
  }
  const identitySearchDir = path.join(OUT, "identity-search");
  mkdirSync(identitySearchDir, { recursive: true });
  const identitySearch = {
    queries: unmatchedNames.size,
    resolved: 0,
    unresolved: 0,
    ambiguous: 0,
    candidatesRead: 0,
  };
  const identityCandidates = new Map<string, number[]>();
  for (const [normalized, name] of unmatchedNames) {
    const searchName = normalizeIssuerName(name);
    const searchSize = "100";
    const file = path.join(
      identitySearchDir,
      `${sha256(`${name}\n${searchName}\n${searchSize}`)}.json`
    );
    let evidence: any;
    if (existsSync(file)) evidence = readJson<any>(file);
    else {
      const query = new URLSearchParams({
        q: `"${searchName}"`,
        size: searchSize,
      });
      evidence = {
        query: name,
        searchName,
        searchSize,
        response: await secJson(`${FTS}?${query}`),
      };
      writeJsonAtomic(file, evidence);
    }
    if (
      evidence.query !== name ||
      evidence.searchName !== searchName ||
      evidence.searchSize !== searchSize
    )
      throw new Error(`Identity-search checkpoint mismatch for ${name}`);
    const candidates = new Set<number>();
    const orderFree = orderFreeIssuerName(name);
    for (const hit of evidence.response?.hits?.hits ?? []) {
      const source = hit._source ?? {};
      const names = source.display_names ?? [];
      const ciks = source.ciks ?? [];
      for (
        let index = 0;
        index < Math.min(names.length, ciks.length);
        index++
      ) {
        if (orderFreeIssuerName(String(names[index])) === orderFree)
          candidates.add(Number(ciks[index]));
      }
    }
    const verified: number[] = [];
    for (const candidate of candidates) {
      const identity = await loadIdentity(candidate);
      identitySearch.candidatesRead++;
      const exact = [
        identity.name,
        ...identity.formerNames.map(row => row.name),
      ].some(candidateName => orderFreeIssuerName(candidateName) === orderFree);
      if (exact) verified.push(candidate);
    }
    identityCandidates.set(
      normalized,
      verified.sort((a, b) => a - b)
    );
    if (verified.length === 1) identitySearch.resolved++;
    else {
      identitySearch.unresolved++;
      if (verified.length > 1) {
        identitySearch.ambiguous++;
        ambiguousIdentityNames.add(normalized);
      }
    }
    const processed = identitySearch.resolved + identitySearch.unresolved;
    if (processed % 50 === 0)
      console.log(`Identity searches ${processed}/${unmatchedNames.size}`);
  }
  matched = matchAll();
  const openFigiCusips = new Set<string>();
  for (const reports of matched.values()) {
    for (const holdings of reports) {
      for (const holding of holdings) {
        if (holding.cik) continue;
        if (holding.cusip) openFigiCusips.add(holding.cusip);
        if (holding.isin && /^(?:US|CA)[A-Z0-9]{10}$/.test(holding.isin))
          openFigiCusips.add(holding.isin.slice(2, 11));
      }
    }
  }
  const figiEvidence = await collectFigi([...openFigiCusips].sort());
  for (const [cusip, candidates] of figiEvidence.figiByCusip)
    figiByCusip.set(cusip, candidates);
  matched = matchAll();
  for (let round = 0; round < 2; round++) {
    const ciks = new Set<number>();
    for (const reports of matched.values())
      for (const holdings of reports)
        for (const holding of holdings) if (holding.cik) ciks.add(holding.cik);
    const missing = [...ciks]
      .filter(cik => !identities.has(cik))
      .sort((a, b) => a - b);
    for (const cik of missing) await loadIdentity(cik);
    matched = matchAll();
    if (!missing.length) break;
  }

  const holdingsFiles: Record<string, string> = {};
  const unmatchedRows: any[] = [];
  const matchingByReport: any[] = [];
  const matchedReports = new Map<
    string,
    Array<{
      report: FundReport;
      holdings: MatchedHolding[];
      members: CompanyMembership[];
    }>
  >();
  for (const fund of funds) {
    const sourceReports = reportsByFund.get(fund.symbol)!;
    const holdingsByReport = matched.get(fund.symbol)!;
    const outputReports: any[] = [];
    const completed: Array<{
      report: FundReport;
      holdings: MatchedHolding[];
      members: CompanyMembership[];
    }> = [];
    for (let index = 0; index < sourceReports.length; index++) {
      const report = sourceReports[index];
      const holdings = holdingsByReport[index];
      const members = mergeCompanyMembership(holdings);
      const totalWeight = holdings.reduce(
        (sum, holding) => sum + holding.weightPct,
        0
      );
      const matchedWeight = holdings
        .filter(holding => holding.cik)
        .reduce((sum, holding) => sum + holding.weightPct, 0);
      const unmatched = holdings.filter(holding => !holding.cik);
      for (const holding of unmatched)
        unmatchedRows.push({
          symbol: fund.symbol,
          seriesId: fund.seriesId,
          accession: report.accession,
          reportDate: report.reportDate,
          name: holding.name,
          title: holding.title,
          cusip: holding.cusip,
          isin: holding.isin,
          weightPct: holding.weightPct,
          valueUsd: holding.valueUsd,
          candidateCiks:
            identityCandidates.get(normalizeIssuerName(holding.name)) ?? [],
        });
      matchingByReport.push({
        symbol: fund.symbol,
        accession: report.accession,
        reportDate: report.reportDate,
        equityLines: holdings.length,
        equityWeightPct: totalWeight,
        matchedWeightPct: matchedWeight,
        matchedShare: totalWeight > 0 ? matchedWeight / totalWeight : 0,
        unmatchedLines: unmatched.length,
      });
      completed.push({ report, holdings, members });
      outputReports.push({
        accession: report.accession,
        reportDate: report.reportDate,
        filed: report.filed,
        sourceUrl: report.sourceUrl,
        sourceSha256: report.sha256,
        holdings,
        excluded: report.parsed.excluded,
        members,
      });
    }
    matchedReports.set(fund.symbol, completed);
    const holdingsFile = path.join(OUT, `holdings-${fund.seriesId}.json`);
    writeJsonAtomic(holdingsFile, {
      schemaVersion: 1,
      fund,
      reports: outputReports,
    });
    holdingsFiles[fund.symbol] = holdingsFile;
  }

  const iwb = matchedReports.get("IWB")!;
  const vrnix = matchedReports.get("VRNIX")!;
  const newestIwb = iwb
    .map(row => row.report.reportDate)
    .sort()
    .at(-1)!;
  const quarterEnds = calendarQuarterEnds(START, newestIwb);
  const membershipQuarters: Record<string, any> = {};
  const coverageGaps: any[] = [];
  for (const quarter of quarterEnds) {
    const selected = latestReportOnOrBefore(
      iwb.map(row => ({ ...row.report, members: row.members })),
      quarter
    ) as (ReportRef & { members: CompanyMembership[] }) | null;
    if (!selected) {
      coverageGaps.push({
        symbol: "IWB",
        quarter,
        secAnswer:
          "No matching report returned by the recorded SEC full-text query",
      });
      continue;
    }
    if (selected.reportDate !== quarter)
      coverageGaps.push({
        symbol: "IWB",
        quarter,
        selectedReportDate: selected.reportDate,
        accession: selected.accession,
        secAnswer: "Latest available report predates the quarter end",
      });
    membershipQuarters[quarter] = {
      source: {
        seriesId: "S000004347",
        accession: selected.accession,
        reportDate: selected.reportDate,
        filed: selected.filed,
        sha256: selected.sha256,
      },
      equityLines: selected.members.reduce(
        (sum, member) => sum + member.lines.length,
        0
      ),
      companyCount: selected.members.length,
      members: selected.members,
    };
  }

  const crossCheck = quarterEnds.map(quarter => {
    const left = membershipQuarters[quarter];
    const right = latestReportOnOrBefore(
      vrnix.map(row => ({ ...row.report, members: row.members })),
      quarter
    ) as (ReportRef & { members: CompanyMembership[] }) | null;
    if (!left || !right)
      return {
        quarter,
        eligible: false,
        pass: null,
        reason: "No VRNIX report exists on or before this quarter end",
        disagreements: [],
      };
    if (quarter.endsWith("-06-30") && right.reportDate.endsWith("-05-31")) {
      return {
        quarter,
        eligible: false,
        pass: null,
        reason:
          "VRNIX's May report predates the June Russell rebalance; this is not a same-rebalance comparison",
        iwbSource: left.source,
        vrnixSource: {
          seriesId: "S000030000",
          accession: right.accession,
          reportDate: right.reportDate,
          filed: right.filed,
          sha256: right.sha256,
        },
        disagreements: [],
      };
    }
    const leftByCik = new Map<number, CompanyMembership>(
      left.members.map((row: CompanyMembership) => [row.cik, row])
    );
    const rightByCik = new Map<number, CompanyMembership>(
      right.members.map((row: CompanyMembership) => [row.cik, row])
    );
    const leftSet = new Set(leftByCik.keys());
    const rightSet = new Set(rightByCik.keys());
    const intersection = [...leftSet].filter(cik => rightSet.has(cik)).length;
    const disagreements = [...new Set([...leftSet, ...rightSet])]
      .filter(cik => leftSet.has(cik) !== rightSet.has(cik))
      .map(cik => ({
        cik,
        name: identities.get(cik)?.name ?? registryByCik.get(cik)?.name ?? null,
        iwbWeightPct: leftByCik.get(cik)?.weightPct ?? null,
        vrnixWeightPct: rightByCik.get(cik)?.weightPct ?? null,
      }))
      .sort(
        (a, b) =>
          Math.max(b.iwbWeightPct ?? 0, b.vrnixWeightPct ?? 0) -
          Math.max(a.iwbWeightPct ?? 0, a.vrnixWeightPct ?? 0)
      );
    const agreement = membershipAgreement(leftSet, rightSet);
    return {
      quarter,
      eligible: true,
      reason: null,
      iwbSource: left.source,
      vrnixSource: {
        seriesId: "S000030000",
        accession: right.accession,
        reportDate: right.reportDate,
        filed: right.filed,
        sha256: right.sha256,
      },
      iwbCompanies: leftSet.size,
      vrnixCompanies: rightSet.size,
      sharedCompanies: intersection,
      iwbCoverage: intersection / leftSet.size,
      vrnixCoverage: intersection / rightSet.size,
      agreement,
      pass: agreement >= 0.98,
      disagreements,
    };
  });

  const sp500 = readJson<any>(sp500File);
  const sp500Consistency = quarterEnds
    .filter(quarter => sp500.quarters?.[quarter] && membershipQuarters[quarter])
    .map(quarter => {
      const expected = new Set<number>(
        (sp500.quarters[quarter].members as any[]).map(row =>
          Number(typeof row === "object" ? row.cik : row)
        )
      );
      const actual = new Set<number>(
        membershipQuarters[quarter].members.map(
          (row: CompanyMembership) => row.cik
        )
      );
      const missing = [...expected]
        .filter(cik => !actual.has(cik))
        .sort((a, b) => a - b);
      const share = expected.size
        ? (expected.size - missing.length) / expected.size
        : null;
      return {
        quarter,
        sp500Members: expected.size,
        russellMembers: actual.size,
        includedShare: share,
        pass: share !== null && share >= 0.97,
        missing: missing.map(cik => ({
          cik,
          name:
            identities.get(cik)?.name ?? registryByCik.get(cik)?.name ?? null,
        })),
      };
    });

  const membershipFile = path.join(OUT, "membership.json");
  writeJsonAtomic(membershipFile, {
    schemaVersion: 1,
    rule: "A company is a member at date t if it is held in the latest IWB N-PORT-P report with reportDate on or before t; this can lag a new joiner by up to one quarter.",
    start: START,
    newestReportDate: newestIwb,
    quarters: membershipQuarters,
  });

  const { GICS_BY_CIK } = await import("../api/services/gics-snapshot");
  const quartersByCik = new Map<number, string[]>();
  for (const [quarter, row] of Object.entries<any>(membershipQuarters))
    for (const member of row.members)
      quartersByCik.set(member.cik, [
        ...(quartersByCik.get(member.cik) ?? []),
        quarter,
      ]);
  const companies = [...quartersByCik.keys()]
    .sort((a, b) => a - b)
    .map(cik => {
      const identity = identities.get(cik);
      const registryRow = registryByCik.get(cik);
      const quarters = quartersByCik.get(cik)!.sort();
      const registrySector =
        registryRow?.sector ?? GICS_BY_CIK.get(cik)?.sector ?? null;
      const sector =
        registrySector ?? sectorFromSic(identity?.sic ?? registryRow?.sic);
      return {
        cik,
        tickers: identity?.tickers ?? (registryRow ? [registryRow.ticker] : []),
        name: identity?.name ?? registryRow?.name ?? `CIK ${cik}`,
        formerNames: identity?.formerNames ?? [],
        sic: identity?.sic ?? registryRow?.sic ?? null,
        sicDescription:
          identity?.sicDescription ?? registryRow?.sicDescription ?? null,
        stateOfIncorporation: identity?.stateOfIncorporation ?? null,
        firstQuarter: quarters[0],
        lastQuarter: quarters.at(-1),
        status: quarters.at(-1) === quarterEnds.at(-1) ? "active" : "former",
        inOurRegistry: Boolean(registryRow),
        sector,
        sectorSource: registrySector
          ? "registry"
          : sector
            ? "sic-map"
            : "unmapped",
      };
    });
  const companiesFile = path.join(OUT, "companies.json");
  writeJsonAtomic(companiesFile, { schemaVersion: 1, companies });

  const unmatchedFile = path.join(OUT, "unmatched.json");
  writeJsonAtomic(unmatchedFile, {
    schemaVersion: 1,
    rows: unmatchedRows,
    totalLines: unmatchedRows.length,
    totalWeightPct: unmatchedRows.reduce((sum, row) => sum + row.weightPct, 0),
    cusipConflicts: cusip.conflicts,
  });

  const sectorValidation = validateSectorMap(
    registry.map(row => ({
      cik: row.cik,
      sic: row.sic ?? identities.get(row.cik)?.sic ?? null,
      registrySector: row.sector ?? GICS_BY_CIK.get(row.cik)?.sector ?? null,
    }))
  );
  const sectorMapFile = path.join(OUT, "sector-map.json");
  writeJsonAtomic(sectorMapFile, {
    schemaVersion: 1,
    method:
      "Documented most-specific SIC numeric ranges mapped to the 11 GICS sectors; this is an approximation, not an official GICS classification.",
    sectors: GICS_SECTORS,
    rules: SIC_SECTOR_RULES,
    validationSource: {
      file: "api/services/gics-snapshot.ts",
      sourceCommit: execFileSync(
        "git",
        ["log", "-1", "--format=%H", "--", "api/services/gics-snapshot.ts"],
        { encoding: "utf8" }
      ).trim(),
      buildCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    },
    validation: { ...sectorValidation, confusion: sectorValidation.confusion },
  });

  const active = companies.filter(
    company => company.status === "active" && !company.inOurRegistry
  );
  const former = companies.filter(
    company => company.status === "former" && !company.inOurRegistry
  );
  const universeRow = (company: (typeof companies)[number]) => ({
    cik: company.cik,
    ticker: company.tickers[0] ?? `CIK${company.cik}`,
    name: company.name,
  });
  const activeUniverseFile = path.resolve(
    "worker/edgar-universe-r1000-new.json"
  );
  const formerUniverseFile = path.resolve(
    "worker/edgar-universe-r1000-former.json"
  );
  writeJsonAtomic(activeUniverseFile, active.map(universeRow));
  writeJsonAtomic(formerUniverseFile, former.map(universeRow));

  const latestMembers = new Set<number>(
    membershipQuarters[quarterEnds.at(-1)!].members.map(
      (row: CompanyMembership) => row.cik
    )
  );
  const registryCurrentRussell = registry
    .filter(row => latestMembers.has(row.cik))
    .map(row => ({ cik: row.cik, ticker: row.ticker }));
  const knownJoiners = ["CAVA", "ARM"].map(ticker => {
    const company = companies.find(row => row.tickers.includes(ticker));
    return company
      ? {
          ticker,
          cik: company.cik,
          firstQuarter: company.firstQuarter,
          lastQuarter: company.lastQuarter,
          status: company.status,
        }
      : { ticker, found: false };
  });
  const recentJoiner = knownJoiners.find(
    row => row.firstQuarter && row.firstQuarter >= "2023-09-30"
  );
  const formerExample = companies
    .filter(company => company.status === "former")
    .sort(
      (a, b) => b.lastQuarter!.localeCompare(a.lastQuarter!) || a.cik - b.cik
    )[0];
  const sizeByReport = funds.flatMap(fund =>
    reportsByFund.get(fund.symbol)!.map(report => ({
      symbol: fund.symbol,
      accession: report.accession,
      reportDate: report.reportDate,
      equityLines: report.parsed.holdings.length,
      excludedLines: report.parsed.excluded.length,
      withinExpectedRange:
        report.parsed.holdings.length >= 950 &&
        report.parsed.holdings.length <= 1060,
    }))
  );
  const eligibleCrossCheck = crossCheck.filter(row => row.eligible);
  const gates = {
    coverage: {
      pass: coverageGaps.length === 0 && quarterEnds.length > 0,
      quarterEnds: quarterEnds.length,
      first: quarterEnds[0],
      last: quarterEnds.at(-1),
      gaps: coverageGaps,
      vrnixNote:
        "VRNIX reports February, May, August and November month ends; the cross-check applies the same latest-on-or-before rule.",
    },
    size: {
      pass: sizeByReport
        .filter(row => row.symbol === "IWB")
        .every(row => row.withinExpectedRange),
      expectedEquityLines: [950, 1060],
      reports: sizeByReport,
      outsideRangeReason:
        "Observed count is outside the task's expected range; no cause is inferred.",
    },
    matching: {
      pass: matchingByReport.every(row => row.matchedShare >= 0.995),
      threshold: 0.995,
      reports: matchingByReport,
      unmatchedLines: unmatchedRows.length,
      unmatchedWeightPct: unmatchedRows.reduce(
        (sum, row) => sum + row.weightPct,
        0
      ),
      cusipConflicts: cusip.conflicts.length,
    },
    crossCheck: {
      pass:
        eligibleCrossCheck.length > 0 &&
        eligibleCrossCheck.every(row => row.pass === true),
      threshold: 0.98,
      eligibleQuarters: eligibleCrossCheck.length,
      excludedQuarters: crossCheck.length - eligibleCrossCheck.length,
      quarters: crossCheck,
    },
    sp500Consistency: {
      pass:
        sp500Consistency.length > 0 && sp500Consistency.every(row => row.pass),
      threshold: 0.97,
      quarters: sp500Consistency,
    },
    knownCases: {
      pass:
        Boolean(recentJoiner && formerExample) &&
        registryCurrentRussell.length > 0,
      registryCurrentRussellCount: registryCurrentRussell.length,
      registryCurrentRussell,
      knownJoiners,
      selectedRecentJoiner: recentJoiner ?? null,
      formerExample: formerExample ?? null,
    },
    sectorMap: {
      informational: true,
      agreementShare: sectorValidation.agreementShare,
    },
  };
  const pass = [
    gates.coverage,
    gates.size,
    gates.matching,
    gates.crossCheck,
    gates.sp500Consistency,
    gates.knownCases,
  ].every(gate => gate.pass);
  const buildFile = path.join(OUT, "build.json");
  writeJsonAtomic(buildFile, {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    codeCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    codeDirty:
      execFileSync(
        "git",
        [
          "status",
          "--porcelain",
          "--",
          "scripts/build-russell1000-membership.mts",
          "worker/lib/russell1000.ts",
          "worker/lib/russell1000-sector.ts",
        ],
        { encoding: "utf8" }
      ).trim().length > 0,
    codeInputs: Object.fromEntries(
      [
        "scripts/build-russell1000-membership.mts",
        "worker/lib/russell1000.ts",
        "worker/lib/russell1000-sector.ts",
      ].map(file => [file, inputEvidence(path.resolve(file))])
    ),
    realRoot,
    freeBytes,
    inputs: {
      mutualFundMap: inputEvidence(mutualFundEvidenceFile),
      companyTickers: inputEvidence(tickerFile),
      curatedCusipMap: inputEvidence(curatedFile),
      sp500Membership: inputEvidence(sp500File),
      discovery: Object.fromEntries(
        funds.map(fund => [
          fund.symbol,
          inputEvidence(path.join(NPORT, fund.seriesId, "discovery.json")),
        ])
      ),
      researchCusipSource:
        "SELECT DISTINCT cusip,companyCik FROM alpha_research.std_13f_positions (read-only)",
      researchCusipRowsSha256: sha256(
        JSON.stringify(
          [...cusip.cusipToCik].sort(([a], [b]) => a.localeCompare(b))
        )
      ),
      registrySource:
        "SELECT cik,ticker,name,sic,sicDescription,sector FROM alpha_engine.companies (read-only)",
      registryRowsSha256: sha256(JSON.stringify(registry)),
      openFigiManifest: inputEvidence(figiEvidence.manifestPath),
    },
    counts: {
      registryCompanies: registry.length,
      reports: Object.fromEntries(
        [...reportsByFund].map(([symbol, reports]) => [symbol, reports.length])
      ),
      rawBytes: [...reportsByFund.values()]
        .flat()
        .reduce((sum, report) => sum + readFileSync(report.rawPath).length, 0),
      matchedCompanies: companies.length,
      activeNewCompanies: active.length,
      formerNewCompanies: former.length,
      unmatchedLines: unmatchedRows.length,
      distinctCusips: cusip.distinctCusips,
      identitySearch,
      openFigi: figiEvidence.stats,
      trackingStockLines: [...matched.values()]
        .flat()
        .flat()
        .filter(row => row.trackingStock).length,
      matchSources: Object.fromEntries(
        [
          ...new Set(
            [...matched.values()]
              .flat()
              .flat()
              .map(row => row.matchSource ?? "unmatched")
          ),
        ]
          .sort()
          .map(source => [
            source,
            [...matched.values()]
              .flat()
              .flat()
              .filter(row => (row.matchSource ?? "unmatched") === source)
              .length,
          ])
      ),
    },
    gates,
    overallPass: pass,
    outputs: Object.fromEntries(
      [
        ...Object.values(holdingsFiles),
        membershipFile,
        companiesFile,
        unmatchedFile,
        sectorMapFile,
        activeUniverseFile,
        formerUniverseFile,
      ].map(file => [file, inputEvidence(file)])
    ),
  });
  console.log(
    JSON.stringify(
      {
        pass,
        reports: Object.fromEntries(
          [...reportsByFund].map(([symbol, reports]) => [
            symbol,
            reports.length,
          ])
        ),
        companies: companies.length,
        activeNew: active.length,
        formerNew: former.length,
        unmatchedLines: unmatchedRows.length,
        minimumMatchedShare: Math.min(
          ...matchingByReport.map(row => row.matchedShare)
        ),
        minimumCrossCheckAgreement: Math.min(
          ...eligibleCrossCheck.map(row => row.agreement)
        ),
        minimumSp500Share: Math.min(
          ...sp500Consistency.map(row => row.includedShare ?? 0)
        ),
        sectorAgreement: sectorValidation.agreementShare,
        buildFile,
      },
      null,
      2
    )
  );
  if (!pass) process.exitCode = 1;
}

await main();
