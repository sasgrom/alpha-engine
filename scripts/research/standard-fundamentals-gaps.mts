/** Read-only mining of candidate XBRL tags for the standard-fundamentals gaps. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "../../api/queries/connection";
import { companies as companyRegistry, facts } from "@db/schema";
import { renameWithRetry, writeJsonAtomic } from "../../worker/lib/json-file";
import { startProgress } from "../../worker/lib/progress";

type Kind = "flow" | "instant";
type FieldCode = "costRev" | "opinc" | "intexp" | "ebt" | "depamor" | "capex" | "sbcomp" | "payDiv" | "buybacks" | "debtCurrent" | "debtNonCurrent" | "acctRec" | "acctPay" | "inventory" | "ppeq" | "deferredRev" | "cashAndEq" | "sharesBasic" | "ncfx";
type Related = "revenueMinusGrossProfit" | "ebt" | "netincPlusTax" | "ncfi" | "liabilitiesCurrent" | "totalLiabilities" | "assetsCurrent" | "totalAssets" | "shareswa";
interface FieldRule { kind: Kind; pattern: string; related?: Related; smaller?: boolean; close?: boolean; differentMeasure?: string }
interface LabField { code: string; kind: string; tags: string[]; derive?: { uses: string[] }[] }
interface LabDefinition { code: FieldCode; kind: Kind; tags: string[]; existing: Set<string>; rule: FieldRule }
interface Quarter { end: string; start: string }
type FieldVersion = [string, number | null, number];
type QuarterValues = [number, FieldVersion[]];
interface CompanyFile { cik: number; ticker: string; name: string; predecessor?: number; quarters: Quarter[]; fields: Record<string, QuarterValues[]> }
interface CompanyIndex { cik: number; ticker: string; name: string; mergedInto?: number }
interface CandidateFact { concept: string; value: number; startDate: string | null; endDate: string; filed: string | null; form: string | null; accessionNo: string | null; unit: string; factId: number }
interface CandidateCompany { cik: number; ticker: string; sector: string; quarters: CandidateFact[] }
interface Candidate { concept: string; companies: CandidateCompany[] }
interface CompanyGap { cik: number; ticker: string; sector: string; coverage: number; missingQuarters: string[]; note?: string }
interface SectorCoverage { sector: string; companies: number; quarters: number; covered: number; coverage: number; companiesUnder90: number }
interface FieldResult { field: FieldCode; kind: Kind; coverageBySector: SectorCoverage[]; companiesUnder90: CompanyGap[]; candidates: Candidate[] }
interface ScopeCheck {
  cik: number; ticker: string; sector: string; concept: string; quarterEnd: string; candidateValue: number; unit: string;
  candidatePeriodStart: string | null; candidatePeriodEnd: string; basis: string; basisValue: number | null; basisPeriodStart: string | null;
  basisPeriodEnd: string | null; ratio: number | null; absoluteRatio: number | null; aggregation: string; offsetDays: number | null;
  constraint: string; judgement: string; suggestedSign: number; factId?: number;
}
interface Checkpoint { version: 1; inputHash: string; processedCiks: number[]; queryCount: number; factCount: number; factHashes: Record<string, string>; fields: FieldResult[]; sectorSources: unknown; complete: boolean }

const ROOT = "D:/research/alpha-engine/fundamentals/standard/v1";
const LAB_FIELDS = "C:/dev/alpha-engine-lab/src/fundamentals/fields.mts";
const REST_UNIVERSE = "D:/research/alpha-engine/engine/events/universe-rest.json";
const REVIEW_UNIVERSE = "worker/research-universe-50.json";
const SINCE = "2010-01-01";
const MINING_BUDGET_MS = 14 * 60_000;
const FIELD_RULES: Record<FieldCode, FieldRule> = {
  costRev: { kind: "flow", pattern: "^Cost(s)?Of|BenefitsLossesAndExpenses|PolicyholderBenefits", related: "revenueMinusGrossProfit" },
  opinc: { kind: "flow", pattern: "OperatingIncome|IncomeLossFromOperations", related: "ebt", close: true, differentMeasure: "^OtherNonoperatingIncomeExpense$" },
  intexp: { kind: "flow", pattern: "Interest.*Expense|InterestAndDebtExpense", differentMeasure: "^InterestIncomeExpenseNet$|^InterestIncomeExpenseNonoperatingNet$|^InterestAndDividendIncomeOperating$" },
  ebt: { kind: "flow", pattern: "BeforeIncomeTaxes", related: "netincPlusTax" },
  depamor: { kind: "flow", pattern: "Depreciation|Amortization" },
  capex: { kind: "flow", pattern: "^PaymentsToAcquire|^PaymentsFor(Capital|Construction)|CapitalExpenditure", related: "ncfi", differentMeasure: "^PaymentsToAcquireAvailableForSaleSecurities|^PaymentsToAcquireHeldToMaturitySecurities|^PaymentsToAcquireMarketableSecurities|^PaymentsToAcquireBusinesses|^PaymentsToAcquireInvestments|^PaymentsToAcquireOtherInvestments|^PaymentsToAcquireSubsidiaries|^PaymentsToAcquireAffiliates" },
  sbcomp: { kind: "flow", pattern: "ShareBased|StockBased|StockCompensation" },
  payDiv: { kind: "flow", pattern: "Dividend", differentMeasure: "PreferredStock|PreferenceStock|MinorityInterest" },
  buybacks: { kind: "flow", pattern: "Repurchase|TreasuryStockAcquired", differentMeasure: "PreferredStock|PreferenceStock" },
  debtCurrent: { kind: "instant", pattern: "Debt|Borrowings|Notes|CommercialPaper", related: "liabilitiesCurrent", smaller: true, differentMeasure: "^LongTermDebt$|^LongTermDebtAndCapitalLeaseObligations$|^AvailableForSaleSecurities|^HeldToMaturitySecurities|^MarketableSecurities" },
  debtNonCurrent: { kind: "instant", pattern: "Debt|Borrowings|Notes", related: "totalLiabilities", smaller: true, differentMeasure: "^AvailableForSaleSecurities|^HeldToMaturitySecurities|^MarketableSecurities" },
  acctRec: { kind: "instant", pattern: "Receivable", related: "assetsCurrent", smaller: true, differentMeasure: "^LoansAndLeasesReceivable" },
  acctPay: { kind: "instant", pattern: "Payable", related: "liabilitiesCurrent", smaller: true },
  inventory: { kind: "instant", pattern: "Inventor", related: "assetsCurrent", smaller: true },
  ppeq: { kind: "instant", pattern: "PropertyPlant|RealEstateInvestment", related: "totalAssets", smaller: true, differentMeasure: "^AccumulatedDepreciation" },
  deferredRev: { kind: "instant", pattern: "DeferredRevenue|ContractWithCustomerLiability", differentMeasure: "Noncurrent" },
  cashAndEq: { kind: "instant", pattern: "^Cash", related: "totalAssets", smaller: true, differentMeasure: "ShortTermInvestments" },
  sharesBasic: { kind: "instant", pattern: "SharesOutstanding|SharesIssued", related: "shareswa", close: true, differentMeasure: "PreferredStock|PreferenceStock" },
  ncfx: { kind: "flow", pattern: "EffectOfExchangeRate" },
};
const FIELD_CODES = Object.keys(FIELD_RULES) as FieldCode[];
const REGEXES = Object.fromEntries(FIELD_CODES.map(code => [code, new RegExp(FIELD_RULES[code].pattern, "i")])) as Record<FieldCode, RegExp>;
const iso = (value: unknown): string => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const days = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const duration = (start: string, end: string): number => (Date.parse(end) - Date.parse(start)) / 86_400_000;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");
const valueText = (value: number | null, unit = "USD"): string => value === null ? "—" : `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 3 }).format(value)} ${unit}`;
const ratioText = (ratio: number | null): string => ratio === null ? "not computable" : ratio.toFixed(4);

export function periodMatches(fact: { startDate: string | null; endDate: string }, quarterEnd: string, kind: Kind): boolean {
  if (days(fact.endDate, quarterEnd) > 5) return false;
  if (kind === "instant") return fact.startDate === null;
  if (fact.startDate === null) return false;
  const length = duration(fact.startDate, fact.endDate);
  return length >= 60 && length <= 400;
}

export function latestFieldValues(company: CompanyFile, code: string): Map<string, { value: number; filed: string }> {
  const result = new Map<string, { value: number; filed: string }>();
  const quarters = new Map(company.quarters.map((quarter, index) => [index, quarter.end]));
  for (const [index, versions] of company.fields[code] ?? []) {
    const end = quarters.get(index);
    if (!end) continue;
    for (const [filed, value] of versions) if (finite(value)) result.set(end, { value, filed });
  }
  return result;
}

function candidateScore(fact: CandidateFact, quarterEnd: string): number[] {
  return [days(fact.endDate, quarterEnd), fact.startDate ? duration(fact.startDate, fact.endDate) : 0, -(fact.filed?.length ? Date.parse(fact.filed) : 0)];
}
function betterCandidate(candidate: CandidateFact, prior: CandidateFact, quarterEnd: string): boolean {
  const a = candidateScore(candidate, quarterEnd), b = candidateScore(prior, quarterEnd);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return candidate.factId < prior.factId;
}
function readCompany(cik: number): CompanyFile | null {
  const file = path.join(ROOT, "company", `${cik}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as CompanyFile : null;
}
export function presentQuarters(company: CompanyFile, code: FieldCode, quarters = company.quarters): number {
  const values = latestFieldValues(company, code);
  return quarters.filter(quarter => values.has(quarter.end)).length;
}
function nearest(values: Map<string, { value: number; filed: string }>, end: string): { value: number; filed: string; end: string; offset: number } | null {
  const endDates = [...values.keys()].sort((a, b) => days(a, end) - days(b, end) || a.localeCompare(b));
  const nearestEnd = endDates[0];
  if (!nearestEnd) return null;
  return { ...values.get(nearestEnd)!, end: nearestEnd, offset: days(nearestEnd, end) };
}
function sameDurationValues(company: CompanyFile, code: string, start: string | null, end: string): { value: number; filed: string; offset: number; start?: string | null; end?: string } | null {
  const values = latestFieldValues(company, code);
  if (!start || duration(start, end) <= 120) {
    const result = nearest(values, end);
    return result ? { ...result, start: company.quarters.find(quarter => quarter.end === result.end)?.start ?? null } : null;
  }
  const quarters = company.quarters.filter(quarter => quarter.start >= start && quarter.end <= end);
  if (!quarters.length || quarters.some(quarter => !values.has(quarter.end))) return null;
  return quarters.reduce((total, quarter) => ({ value: total.value + values.get(quarter.end)!.value, filed: values.get(quarter.end)!.filed, offset: 0, start, end }), { value: 0, filed: quarters[0].end, offset: 0, start, end });
}
function relatedBasis(company: CompanyFile, rule: FieldRule, start: string | null, end: string): { basis: string; value: number | null; filed: string | null; start: string | null; end: string | null; aggregation: string; offset: number | null } | null {
  if (!rule.related) return null;
  const one = (code: string) => sameDurationValues(company, code, start, end);
  if (rule.related === "revenueMinusGrossProfit") {
    const revenue = one("revenue"), gross = one("grossProfit");
    return { basis: "revenue − grossProfit", value: revenue && gross ? revenue.value - gross.value : null, filed: revenue?.filed ?? gross?.filed ?? null, start: revenue?.start ?? gross?.start ?? start, end: revenue?.end ?? gross?.end ?? end, aggregation: start && duration(start, end) > 120 ? "same_duration_sum" : "nearest_quarter", offset: revenue?.offset ?? gross?.offset ?? null };
  }
  if (rule.related === "netincPlusTax") {
    const net = one("netinc"), tax = one("taxExp");
    return { basis: "netinc + taxExp", value: net && tax ? net.value + tax.value : null, filed: net?.filed ?? tax?.filed ?? null, start: net?.start ?? tax?.start ?? start, end: net?.end ?? tax?.end ?? end, aggregation: start && duration(start, end) > 120 ? "same_duration_sum" : "nearest_quarter", offset: net?.offset ?? tax?.offset ?? null };
  }
  const code = rule.related as FieldCode;
  const value = one(code);
  if (!value) return { basis: code, value: null, filed: null, start, end, aggregation: "unavailable", offset: null };
  return { basis: code, value: value.value, filed: value.filed, start: value.start ?? start, end: value.end ?? end, aggregation: start && duration(start, end) > 120 ? "same_duration_sum" : "nearest_quarter", offset: value.offset };
}

export function scopeCheck(company: CompanyFile, code: FieldCode, candidate: CandidateFact): ScopeCheck {
  const rule = FIELD_RULES[code];
  const own = sameDurationValues(company, code, candidate.startDate, candidate.endDate);
  const basis = own ? { ...own, basis: code, aggregation: candidate.startDate && duration(candidate.startDate, candidate.endDate) > 120 ? "same_duration_sum" : "nearest_quarter" }
    : relatedBasis(company, rule, candidate.startDate, candidate.endDate);
  const value = basis?.value ?? null;
  const ratio = value !== null && value !== 0 ? candidate.value / value : null;
  const absoluteRatio = ratio === null ? null : Math.abs(ratio);
  const semanticExcluded = rule.differentMeasure ? new RegExp(rule.differentMeasure, "i").test(candidate.concept) : false;
  const constraint = `${semanticExcluded ? `semantic exclusion ${rule.differentMeasure}; ` : ""}${rule.smaller ? "absolute candidate < absolute basis" : rule.close ? "ratio near 1 (wider tolerance for operating/share measures)" : "ratio near 1"}`;
  let judgement = "a different measure";
  if (!semanticExcluded && value !== null && value !== 0 && absoluteRatio !== null && (!rule.smaller || Math.abs(candidate.value) < Math.abs(value))) {
    const near = rule.close ? absoluteRatio >= 0.75 && absoluteRatio <= 1.333 : absoluteRatio >= 0.9 && absoluteRatio <= 1.1;
    if (near) judgement = "same scope, add to list";
    else if (absoluteRatio < 1 && !rule.close) judgement = "a part, do not add";
  }
  return {
    cik: company.cik, ticker: company.ticker, sector: "Unknown", concept: candidate.concept, quarterEnd: candidate.endDate,
    candidateValue: candidate.value, unit: candidate.unit, candidatePeriodStart: candidate.startDate, candidatePeriodEnd: candidate.endDate,
    basis: basis?.basis ?? "no comparable field evidence", basisValue: value, basisPeriodStart: basis?.start ?? null, basisPeriodEnd: basis?.end ?? null,
    ratio, absoluteRatio, aggregation: basis?.aggregation ?? "unavailable", offsetDays: basis?.offset ?? null, constraint,
    judgement, suggestedSign: value !== null && candidate.value * value < 0 ? -1 : 1, factId: candidate.factId,
  };
}

function candidateCounts(candidate: Candidate): { companies: number; quarters: number } {
  return { companies: candidate.companies.length, quarters: candidate.companies.reduce((sum, company) => sum + company.quarters.length, 0) };
}
function candidateSort(a: Candidate, b: Candidate): number {
  const ac = candidateCounts(a), bc = candidateCounts(b);
  return bc.quarters - ac.quarters || bc.companies - ac.companies || a.concept.localeCompare(b.concept);
}
function materializeCandidate(concept: string, companies: Map<number, CandidateCompany & { byEnd: Map<string, CandidateFact> }>): Candidate {
  return { concept, companies: [...companies.values()].map(company => ({ cik: company.cik, ticker: company.ticker, sector: company.sector, quarters: [...company.byEnd.values()].sort((a, b) => a.endDate.localeCompare(b.endDate)) })).sort((a, b) => a.cik - b.cik) };
}

function sectorMetadata(rows: Array<{ cik: number; ticker?: string; sector?: string | null }>, file: string): { byCik: Map<number, string>; present: boolean; file: string } {
  return { byCik: new Map(rows.filter(row => row.sector).map(row => [row.cik, row.sector!])), present: rows.some(row => row.sector), file };
}
async function main(): Promise<void> {
  const started = Date.now();
  const root = realpathSync(ROOT);
  if (path.parse(root).root.toUpperCase() !== "D:\\") throw new Error("The fundamentals archive is unavailable on D:");
  const labPath = path.resolve(LAB_FIELDS);
  const lab = await import(pathToFileURL(labPath).href) as { FIELDS: LabField[] };
  const definitions = new Map<FieldCode, LabDefinition>();
  for (const field of lab.FIELDS) {
    if (!FIELD_CODES.includes(field.code as FieldCode)) continue;
    const code = field.code as FieldCode;
    const existing = new Set<string>();
    for (const tag of field.tags) for (const part of tag.replace(/^-/, "").split("+")) existing.add(part);
    for (const derive of field.derive ?? []) for (const use of derive.uses) if (use.startsWith("tag:") || use.startsWith("cover:")) existing.add(use.split(":")[1]);
    definitions.set(code, { code, kind: FIELD_RULES[code].kind, tags: [...existing], existing, rule: FIELD_RULES[code] });
  }
  if (definitions.size !== FIELD_CODES.length) throw new Error(`Expected ${FIELD_CODES.length} field definitions, got ${definitions.size}`);
  const index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8")) as { generatedAt: string; companies: CompanyIndex[] };
  const companyIndexes = [...index.companies].sort((a, b) => a.cik - b.cik);
  const rest = sectorMetadata(JSON.parse(readFileSync(REST_UNIVERSE, "utf8")), REST_UNIVERSE);
  const review = sectorMetadata(JSON.parse(readFileSync(REVIEW_UNIVERSE, "utf8")), REVIEW_UNIVERSE);
  const db = getDb();
  const registry = await db.select({ cik: companyRegistry.cik, sector: companyRegistry.sector }).from(companyRegistry);
  const registrySectors = new Map(registry.filter(row => row.sector).map(row => [row.cik, row.sector!]));
  const sectorOf = (cik: number, mergedInto?: number): { sector: string; source: string } => {
    if (rest.byCik.has(cik)) return { sector: rest.byCik.get(cik)!, source: rest.file };
    if (review.byCik.has(cik)) return { sector: review.byCik.get(cik)!, source: review.file };
    const registrySector = registrySectors.get(cik) ?? (mergedInto ? registrySectors.get(mergedInto) : undefined);
    return registrySector ? { sector: registrySector, source: "companies.sector" } : { sector: "Unknown", source: "unmapped" };
  };
  const scriptHash = hashText(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const inputHash = createHash("sha256").update(readFileSync(path.join(root, "index.json"))).update(readFileSync(labPath)).update(readFileSync(REST_UNIVERSE)).update(readFileSync(REVIEW_UNIVERSE)).update(scriptHash).update(JSON.stringify(registry)).digest("hex");
  const gapsDir = path.join(root, "gaps");
  mkdirSync(gapsDir, { recursive: true });
  const checkpointPath = path.join(gapsDir, "checkpoint.json");
  let checkpoint: Checkpoint | null = null;
  if (existsSync(checkpointPath)) {
    const saved = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint;
    if (saved.version === 1 && saved.inputHash === inputHash) checkpoint = saved;
  }
  const processed = new Set(checkpoint?.processedCiks ?? []);
  const sectorSources = checkpoint?.sectorSources ?? {
    [REST_UNIVERSE]: rest.present ? "sector property present" : "no sector property in file",
    [REVIEW_UNIVERSE]: review.present ? "sector property present" : "no sector property in file",
    "companies.sector": `${registrySectors.size} mapped CIKs; read-only fallback when both universe files omit sector`,
    Unknown: "unmapped companies are not assigned a sector",
  };
  const fields = new Map<FieldCode, FieldResult>(checkpoint?.fields.map(result => [result.field, result]) ?? FIELD_CODES.map(code => [code, { field: code, kind: FIELD_RULES[code].kind, coverageBySector: [], companiesUnder90: [], candidates: [] }]));
  const candidateMaps = new Map<FieldCode, Map<string, Map<number, CandidateCompany & { byEnd: Map<string, CandidateFact> }>>>();
  for (const code of FIELD_CODES) {
    candidateMaps.set(code, new Map());
    for (const candidate of fields.get(code)!.candidates) {
      const byConcept = new Map<number, CandidateCompany & { byEnd: Map<string, CandidateFact> }>();
      for (const company of candidate.companies) byConcept.set(company.cik, { ...company, byEnd: new Map(company.quarters.map(fact => [fact.endDate, fact])) });
      candidateMaps.get(code)!.set(candidate.concept, byConcept);
    }
  }
  const sectorStats = new Map<FieldCode, Map<string, { companies: number; quarters: number; covered: number; under90: number }>>();
  for (const code of FIELD_CODES) {
    const bySector = new Map<string, { companies: number; quarters: number; covered: number; under90: number }>();
    for (const coverage of fields.get(code)!.coverageBySector) bySector.set(coverage.sector, { companies: coverage.companies, quarters: coverage.quarters, covered: coverage.covered, under90: coverage.companiesUnder90 });
    sectorStats.set(code, bySector);
  }
  const gapKeys = new Set(checkpoint?.fields.flatMap(result => result.companiesUnder90.map(company => `${result.field}|${company.cik}`)) ?? []);
  let queryCount = checkpoint?.queryCount ?? 0;
  let factCount = checkpoint?.factCount ?? 0;
  const factHashes: Record<string, string> = checkpoint?.factHashes ?? {};
  const prog = startProgress("standard-fundamentals-gaps", `${companyIndexes.length} companies · ${FIELD_CODES.length} fields · read-only`);
  const saveCheckpoint = (complete: boolean) => {
    const serialized: Checkpoint = {
      version: 1, inputHash, processedCiks: [...processed].sort((a, b) => a - b), queryCount, factCount, factHashes,
      fields: FIELD_CODES.map(code => ({
        field: code, kind: FIELD_RULES[code].kind,
        coverageBySector: [...sectorStats.get(code)!.entries()].map(([sector, value]) => ({ sector, companies: value.companies, quarters: value.quarters, covered: value.covered, coverage: value.quarters ? value.covered / value.quarters : 0, companiesUnder90: value.under90 })).sort((a, b) => a.coverage - b.coverage || a.sector.localeCompare(b.sector)),
        companiesUnder90: fields.get(code)!.companiesUnder90,
        candidates: [...candidateMaps.get(code)!.entries()].map(([concept, companies]) => materializeCandidate(concept, companies)).sort(candidateSort),
      })),
      sectorSources, complete,
    };
    writeJsonAtomic(checkpointPath, serialized, true);
    for (const [code, result] of fields) fields.set(code, serialized.fields.find(field => field.field === code)!);
  };
  if (checkpoint?.complete && companyIndexes.every(company => processed.has(company.cik))) prog.item(companyIndexes.length, companyIndexes.length, "reusing the completed mining checkpoint");
  for (const [index, companyInfo] of companyIndexes.entries()) {
    if (processed.has(companyInfo.cik)) continue;
    if (Date.now() - started > MINING_BUDGET_MS) {
      saveCheckpoint(false);
      throw new Error("Mining budget reached; the checkpoint is complete through the last company and can be resumed");
    }
    const company = readCompany(companyInfo.cik);
    const sector = sectorOf(companyInfo.cik, companyInfo.mergedInto ?? company?.predecessor);
    const quarters = (company?.quarters ?? []).filter(quarter => quarter.end >= SINCE);
    const missingByField = new Map<FieldCode, string[]>();
    for (const code of FIELD_CODES) {
      const present = company ? presentQuarters(company, code, quarters) : 0;
      const stat = sectorStats.get(code)!.get(sector.sector) ?? { companies: 0, quarters: 0, covered: 0, under90: 0 };
      stat.companies++;
      stat.quarters += quarters.length;
      stat.covered += present;
      const coverage = quarters.length ? present / quarters.length : 0;
      const missing = company && coverage < 0.9 ? quarters.filter(quarter => !latestFieldValues(company, code).has(quarter.end)).map(quarter => quarter.end) : [];
      if (coverage < 0.9) {
        stat.under90++;
        if (!gapKeys.has(`${code}|${companyInfo.cik}`)) {
          fields.get(code)!.companiesUnder90.push({ cik: companyInfo.cik, ticker: companyInfo.ticker, sector: sector.sector, coverage, missingQuarters: missing, ...(company ? {} : { note: companyInfo.mergedInto ? `predecessor merged into ${companyInfo.mergedInto}` : "no quarterly series in the dataset" }) });
          gapKeys.add(`${code}|${companyInfo.cik}`);
        }
      }
      sectorStats.get(code)!.set(sector.sector, stat);
      if (company && missing.length) missingByField.set(code, missing);
    }
    if (company && missingByField.size) {
      const queryCiks = [companyInfo.cik, ...(company.predecessor ? [company.predecessor] : [])];
      for (const queryCik of queryCiks) {
        const rawRows = await db.select({ id: facts.id, taxonomy: facts.taxonomy, concept: facts.concept, unit: facts.unit, startDate: facts.startDate, endDate: facts.endDate, val: facts.val, form: facts.form, filed: facts.filed, accn: facts.accn }).from(facts).where(and(eq(facts.cik, queryCik), gte(facts.endDate, "2009-12-26")));
        queryCount++;
        factCount += rawRows.length;
        factHashes[`${companyInfo.cik}:${queryCik}`] = hashText(JSON.stringify(rawRows));
        for (const row of rawRows) {
          const value = Number(row.val);
          if (row.taxonomy !== "us-gaap" || !Number.isFinite(value)) continue;
          const end = row.endDate;
          for (const [code, missing] of missingByField) {
            const definition = definitions.get(code)!;
            if (definition.existing.has(row.concept) || !REGEXES[code].test(row.concept)) continue;
            const expectedUnit = code === "sharesBasic" ? "shares" : "USD";
            if (row.unit.toLowerCase() !== expectedUnit.toLowerCase()) continue;
            for (const quarterEnd of missing) {
              if (!periodMatches({ startDate: row.startDate, endDate: end }, quarterEnd, definition.kind)) continue;
              const fact: CandidateFact = { concept: row.concept, value, startDate: row.startDate, endDate: end, filed: row.filed, form: row.form, accessionNo: row.accn, unit: row.unit, factId: row.id };
              const byConcept = candidateMaps.get(code)!.get(row.concept) ?? new Map<number, CandidateCompany & { byEnd: Map<string, CandidateFact> }>();
              const byCompany = byConcept.get(companyInfo.cik) ?? { cik: companyInfo.cik, ticker: companyInfo.ticker, sector: sector.sector, quarters: [], byEnd: new Map<string, CandidateFact>() };
              const prior = byCompany.byEnd.get(quarterEnd);
              if (!prior || betterCandidate(fact, prior, quarterEnd)) byCompany.byEnd.set(quarterEnd, fact);
              byCompany.quarters = [...byCompany.byEnd.values()];
              byConcept.set(companyInfo.cik, byCompany);
              candidateMaps.get(code)!.set(row.concept, byConcept);
            }
          }
        }
      }
    }
    processed.add(companyInfo.cik);
    if (processed.size % 25 === 0 || index === companyIndexes.length - 1) saveCheckpoint(false);
    prog.item(index + 1, companyIndexes.length, `${companyInfo.ticker} · ${queryCount} SELECTs · ${factCount} facts`);
  }
  saveCheckpoint(true);
  const generatedAt = new Date().toISOString();
  const outputFields = [];
  for (const code of FIELD_CODES) {
    const result = fields.get(code)!;
    const candidates = result.candidates.slice(0, 5).map(candidate => {
      const scopeChecks: ScopeCheck[] = [];
      for (const company of candidate.companies.slice(0, 3)) {
        const companyFile = readCompany(company.cik);
        if (!companyFile) continue;
        const latest = [...company.quarters].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
        const check = scopeCheck(companyFile, code, latest);
        check.sector = company.sector;
        scopeChecks.push(check);
      }
      const judgement = !scopeChecks.length ? "a different measure" : scopeChecks.every(check => check.judgement === "same scope, add to list") ? "same scope, add to list" : scopeChecks.some(check => check.judgement === "a different measure") ? "a different measure" : "a part, do not add";
      return { ...candidate, companyCount: candidateCounts(candidate).companies, companyQuarters: candidateCounts(candidate).quarters, scopeChecks, judgement };
    });
    const realGapExamples = candidates.length ? [] : result.companiesUnder90.slice(0, 3).map(company => ({ cik: company.cik, ticker: company.ticker, sector: company.sector, missingQuarters: company.missingQuarters, ratio: null, judgement: "real gap", reason: "no new matching us-gaap candidate tags for the missing quarters" }));
    outputFields.push({ ...result, candidates, realGapExamples });
  }
  const report = {
    schemaVersion: 1,
    generatedAt,
    datasetGeneratedAt: index.generatedAt,
    scope: { from: SINCE, endToleranceDays: 5, flowDurationDays: [60, 400], coverageThreshold: 0.9, candidateTaxonomy: "us-gaap", unitGuard: "USD except sharesBasic=shares", candidateTagsExcluded: "field tags and all tags used by existing identities", semanticExclusions: Object.fromEntries(FIELD_CODES.filter(code => FIELD_RULES[code].differentMeasure).map(code => [code, FIELD_RULES[code].differentMeasure])), scopeCaveat: "The facts table has no XBRL dimensions; ratios are scope evidence, not proof of a consolidated total" },
    sectorSources,
    queryCount,
    factCount,
    companies: companyIndexes.length,
    companiesWithSeries: companyIndexes.filter(company => readCompany(company.cik)).length,
    factHashes,
    fields: outputFields,
    elapsedMs: Date.now() - started,
    productionWrite: false,
    schemaChange: false,
    datasetOrDefinitionWrite: false,
  };
  if (report.fields.length !== FIELD_CODES.length || report.elapsedMs > 15 * 60_000) throw new Error("Report validation failed: field count or runtime budget");
  for (const field of report.fields) {
    const examples = field.candidates.reduce((sum, candidate) => sum + candidate.scopeChecks.length, field.realGapExamples.length);
    if (field.candidates.length > 5 || field.companiesUnder90.length > 0 && examples < 3) throw new Error(`Insufficient scope examples for ${field.field}`);
  }
  const jsonPath = path.join(gapsDir, "gaps.json");
  const markdownPath = path.join(gapsDir, "gaps.md");
  writeJsonAtomic(jsonPath, report, true);
  const lines = ["# Standard fundamentals: gap candidates", "", `Generated: ${generatedAt} · dataset ${index.generatedAt} · ${report.elapsedMs} ms`, "", "Read-only mining. No field definitions or dataset values were changed. Counts are distinct company-quarter ends with no existing value. Candidate periods allow ±5 days; flows last 60–400 days and balances are instants. Values include reported zeroes. Ratios compare candidate value / nearest same-duration field or related value. Absolute ratios judge scope; a negative suggested sign means the candidate is an outflow on the old convention. The facts table has no XBRL dimensions, so these are scope checks, not proof of a consolidated total.", "", "Sector sources:", ...Object.entries(sectorSources).map(([key, value]) => `- ${key}: ${value}`), ""];
  for (const field of report.fields) {
    lines.push(`## ${field.field}`, "", `Companies under 90%: ${field.companiesUnder90.length}. Full missing-quarter lists are in gaps.json.`, "", "Coverage by sector:", ...field.coverageBySector.map(coverage => `- ${coverage.sector}: ${pct(coverage.coverage)} · ${coverage.covered}/${coverage.quarters} quarters · ${coverage.companiesUnder90}/${coverage.companies} companies under 90%`), "", "Top candidates:");
    if (!field.candidates.length) lines.push("- **real gap** — no new matching us-gaap tags for the missing quarters.");
    for (const candidate of field.candidates) {
      lines.push(`### ${candidate.concept}`, "", `${candidate.companyCount} companies · ${candidate.companyQuarters} quarters · **${candidate.judgement}**`, "");
      for (const check of candidate.scopeChecks) lines.push(`- ${check.ticker} (${check.sector}) ${check.quarterEnd}: candidate ${valueText(check.candidateValue, check.unit)}; ${check.basis} ${valueText(check.basisValue, check.unit)}; ratio ${ratioText(check.ratio)} (absolute ${ratioText(check.absoluteRatio)}) · ${check.aggregation} · ${check.constraint} · ${check.judgement}${check.suggestedSign < 0 ? " · suggested sign −1" : ""}`);
      if (!candidate.scopeChecks.length) lines.push("- No comparable field or related value was available; no scope equivalence is claimed.");
    }
    for (const example of field.realGapExamples) lines.push(`- ${example.ticker} (${example.sector}): ${example.missingQuarters.slice(-3).join(", ")} · ratio not applicable · ${example.reason} · **real gap**`);
    lines.push("");
  }
  const temporary = `${markdownPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${lines.join("\n")}\n`, "utf8");
  renameWithRetry(temporary, markdownPath);
  prog.done(`${queryCount} SELECTs · ${factCount} facts · ${FIELD_CODES.length} fields · ${report.elapsedMs} ms · ${jsonPath}`);
  process.exit(0);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
