import { isEightKForm } from "./edgar";
import { MAX_INPUT_CHARS } from "./ollama";
import { buildExpectationPrompt, EXPECTATIONS_SCHEMA_VERSION, type ExpectationPromptContext } from "./expectations";

export interface CohortSourceDocument {
  cik: number;
  ticker: string;
  accessionNo: string;
  sourceId: string;
  form: string;
  role: "primary" | "exhibit" | "amendment";
  sourceFile: string;
  filingDate: string;
  eventTs: string;
  reportDate: string;
  plain: string;
}
export interface CohortContainerSource {
  sourceId: string;
  accessionNo: string;
  form: string;
  role: CohortSourceDocument["role"];
  sourceFile: string;
  filingDate: string;
  eventTs: string;
  reportDate: string;
  start: number;
  end: number;
}
export interface CohortContainer {
  containerId: string;
  cohortId: string;
  index: number;
  text: string;
  charBytes: number;
  estimatedTokens: number;
  inputSha256: string;
  sources: CohortContainerSource[];
}
export interface UnpackedBlock {
  sourceId: string;
  accessionNo: string;
  reason: "no_candidate_text" | "indivisible_block_exceeds_context" | "cache_unreadable";
  charBytes: number;
  estimatedTokens: number;
}
export interface CohortPack {
  schemaVersion: number;
  generatedAt: string;
  contextTokens: number;
  maxInputChars: number;
  outputTokens: number;
  coverage: {
    periods: number;
    documents: number;
    packedDocuments: number;
    containers: number;
    charBytes: number;
    estimatedTokens: number;
    unpacked: number;
  };
  containers: CohortContainer[];
  unpacked: UnpackedBlock[];
}

interface SourceUnit {
  source: CohortSourceDocument;
  text: string;
}
interface MutableContainer {
  text: string;
  sources: CohortContainerSource[];
}

export const DEFAULT_COHORT_OUTPUT_TOKENS = 4096;
export const estimateCohortTokens = (text: string) => Math.ceil(text.length / 4);
export const cohortInputLimit = (contextTokens: number) => Math.floor(contextTokens * 0.8 * 4);
const MONTHS: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
function periodDate(month: string, day: string, year: string): string {
  return `${year}-${MONTHS[month.toLowerCase()]}-${day.padStart(2, "0")}`;
}

/** Earnings 8-K reportDate is often the filing date; read the fiscal period from content. */
export function cohortPeriodKey(source: CohortSourceDocument): string {
  if (!isEightKForm(source.form) && source.reportDate) return source.reportDate;
  const text = source.plain.slice(0, 50_000);
  const match = text.match(/\b(?:quarter|three months|six months|nine months|year)\s+(?:ended|ending)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,)?\s+(\d{4})/i);
  if (match) return periodDate(match[1], match[2], match[3]);
  if (source.reportDate && source.reportDate !== source.filingDate) return source.reportDate;
  return `unresolved:${source.accessionNo}`;
}

const MANAGEMENT_HEADING_RE = /(?:guidance|outlook)/i;
const NON_MANAGEMENT_HEADING_RE = /(?:accounting|derivative|regulatory|income tax|tax guidance|audit|fair value|internal control|revenue recognition|environmental|privacy|cyber|sanctions|import|export)/i;
const ACTUAL_SECTION_RE = /(?:results of operations|consolidated results|financial performance|segment results|segment information|cash flows?|liquidity and capital resources|supplemental financial information)/i;
const BOUNDARY_RE = /^(?:item\s+\d|part\s+[ivx]+|conference call|forward-looking|webcast|additional information|highlights|non-gaap|financial statements|consolidated results|results of operations|recent accounting guidance|notes to|table of contents|contents|exhibit)/i;
const NUMBER_RE = /(?:\d+(?:\.\d+)?\s*%|\$\s*\d|\b\d+(?:\.\d+)?\s*(?:billion|million|basis points|bps)\b)/i;
const EXPECTATION_RE = /\b(?:guidance|outlook|expect|expects|expected|anticipate|anticipates|anticipated|project|projection|forecast|target)\b/i;

function isBoundary(line: string): boolean {
  const value = line.trim();
  if (!value || value.length > 150) return false;
  if (BOUNDARY_RE.test(value)) return true;
  return /^[A-Z][A-Z0-9 &(),.'-]{5,}$/.test(value) && !/[.;:]$/.test(value);
}
function isSubheading(line: string): boolean {
  const value = line.trim();
  if (value.length < 4 || value.length > 120 || /[$%]/.test(value) || /[.;:]$/.test(value)) return false;
  const words = value.split(/\s+/);
  return words.length <= 14 && /^[A-Z]/.test(value) && !/^\d/.test(value);
}

/** Whole source sections: no 4K/16K/90-line arbitrary truncation. */
export function extractWholeSourceBlocks(source: CohortSourceDocument): string[] {
  if (source.plain.trim().length < 30) return [];
  if (isEightKForm(source.form)) return [source.plain];
  const lines = source.plain.split("\n");
  const blocks: string[] = [];
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].trim();
    const management = heading.length <= 140 && MANAGEMENT_HEADING_RE.test(heading) && !NON_MANAGEMENT_HEADING_RE.test(heading);
    const actual = heading.length <= 140 && ACTUAL_SECTION_RE.test(heading) && !NON_MANAGEMENT_HEADING_RE.test(heading);
    if (!management && !actual) continue;
    if (used.has(i)) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (isBoundary(lines[j])) { end = j; break; }
    }
    const text = lines.slice(i, end).join("\n").trim();
    if (text.length < 30 || !NUMBER_RE.test(text) || (management && !EXPECTATION_RE.test(text))) continue;
    blocks.push(text);
    for (let j = i; j < end; j++) used.add(j);
    i = end - 1;
  }
  return blocks;
}

function splitBySubheadings(text: string, maxChars: number): string[] | null {
  const lines = text.split("\n");
  const headings: number[] = [];
  for (let i = 1; i < lines.length; i++) if (isSubheading(lines[i])) headings.push(i);
  if (!headings.length) return null;
  const bounds = [0, ...headings, lines.length];
  const parts: string[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const part = lines.slice(bounds[i], bounds[i + 1]).join("\n").trim();
    if (part) parts.push(part);
  }
  return parts.every((part) => part.length <= maxChars) ? parts : null;
}
function splitByParagraphs(text: string, maxChars: number): string[] | null {
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length <= 1 || paragraphs.some((part) => part.length > maxChars)) return null;
  const parts: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars && current) {
      parts.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.every((part) => part.length <= maxChars) ? parts : null;
}

function materialize(source: CohortSourceDocument, text: string, maxChars: number, unpacked: UnpackedBlock[]): SourceUnit[] {
  if (text.length <= maxChars) return [{ source, text }];
  const subsection = splitBySubheadings(text, maxChars);
  if (subsection) return subsection.map((part) => ({ source, text: part }));
  const paragraphs = splitByParagraphs(text, maxChars);
  if (paragraphs) return paragraphs.map((part) => ({ source, text: part }));
  unpacked.push({
    sourceId: source.sourceId,
    accessionNo: source.accessionNo,
    reason: "indivisible_block_exceeds_context",
    charBytes: Buffer.byteLength(text),
    estimatedTokens: estimateCohortTokens(text),
  });
  return [];
}

function sourceHeader(source: CohortSourceDocument): string {
  return `[SOURCE_ID ${source.sourceId} | accession ${source.accessionNo} | form ${source.form} | role ${source.role} | eventTs ${source.eventTs} | reportDate ${source.reportDate || "undated"}]`;
}

export function cohortSourceText(container: CohortContainer, sourceId: string): string | null {
  const source = container.sources.find((item) => item.sourceId === sourceId);
  return source ? container.text.slice(source.start, source.end) : null;
}

export function buildCohortExpectationPrompt(container: CohortContainer, sourceId: string, context: ExpectationPromptContext): string {
  return `${buildExpectationPrompt(container.text, context)}\n\nCOHORT ROUTING:\nExtract ONLY from SOURCE_ID ${sourceId}. All other SOURCE_ID blocks are background context, never extraction targets. The guidanceStatus must describe only this source document. Do not merge values from different SOURCE_ID blocks.`;
}

export function buildCohortPack(
  documents: CohortSourceDocument[],
  options: { contextTokens: number; outputTokens?: number; generatedAt: string },
): CohortPack {
  const maxInputChars = cohortInputLimit(options.contextTokens);
  const outputTokens = options.outputTokens ?? DEFAULT_COHORT_OUTPUT_TOKENS;
  const unpacked: UnpackedBlock[] = [];
  const periods = new Map<string, CohortSourceDocument[]>();
  for (const source of documents) {
    const key = cohortPeriodKey(source);
    if (!periods.has(key)) periods.set(key, []);
    periods.get(key)!.push(source);
  }
  const containers: CohortContainer[] = [];
  for (const [period, sources] of [...periods.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const units: SourceUnit[] = [];
    for (const source of sources.sort((a, b) => `${a.eventTs} ${a.sourceId}`.localeCompare(`${b.eventTs} ${b.sourceId}`))) {
      const blocks = extractWholeSourceBlocks(source);
      if (!blocks.length) {
        unpacked.push({ sourceId: source.sourceId, accessionNo: source.accessionNo, reason: "no_candidate_text", charBytes: Buffer.byteLength(source.plain), estimatedTokens: estimateCohortTokens(source.plain) });
        continue;
      }
      for (const block of blocks) units.push(...materialize(source, block, maxInputChars - 512, unpacked));
    }
    const mutable: MutableContainer[] = [];
    for (const unit of units) {
      const header = sourceHeader(unit.source);
      const addition = `${mutable.length ? "\n\n" : ""}${header}\n${unit.text}`;
      const current = mutable.at(-1);
      if (!current || current.text.length + addition.length > maxInputChars) {
        mutable.push({ text: `${header}\n${unit.text}`, sources: [] });
      } else {
        current.text += addition;
      }
    }
    for (const item of mutable) {
      let cursor = 0;
      const containerSources: CohortContainerSource[] = [];
      const seenSources = new Set<string>();
      for (const unit of units) {
        const header = sourceHeader(unit.source);
        const headerStart = item.text.indexOf(header, cursor);
        if (headerStart < 0) continue;
        const start = headerStart + header.length + 1;
        const end = start + unit.text.length;
        if (!seenSources.has(unit.source.sourceId) || containerSources.at(-1)?.sourceId !== unit.source.sourceId) {
          containerSources.push({
            sourceId: unit.source.sourceId,
            accessionNo: unit.source.accessionNo,
            form: unit.source.form,
            role: unit.source.role,
            sourceFile: unit.source.sourceFile,
            filingDate: unit.source.filingDate,
            eventTs: unit.source.eventTs,
            reportDate: unit.source.reportDate,
            start,
            end,
          });
          seenSources.add(unit.source.sourceId);
        } else {
          containerSources.at(-1)!.end = end;
        }
        cursor = end;
      }
      const index = containers.length;
      const text = item.text;
      containers.push({
        containerId: `cohort-${index + 1}`,
        cohortId: period,
        index,
        text,
        charBytes: Buffer.byteLength(text),
        estimatedTokens: estimateCohortTokens(text),
        inputSha256: "",
        sources: containerSources,
      });
    }
  }
  const packedDocuments = new Set(containers.flatMap((container) => container.sources.map((source) => source.sourceId))).size;
  const charBytes = containers.reduce((sum, container) => sum + container.charBytes, 0);
  return {
    schemaVersion: EXPECTATIONS_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    contextTokens: options.contextTokens,
    maxInputChars,
    outputTokens,
    coverage: {
      periods: periods.size,
      documents: documents.length,
      packedDocuments,
      containers: containers.length,
      charBytes,
      estimatedTokens: containers.reduce((sum, container) => sum + container.estimatedTokens, 0),
      unpacked: unpacked.length,
    },
    containers,
    unpacked,
  };
}

export function buildCohortPackWithHashes(documents: CohortSourceDocument[], options: { contextTokens: number; outputTokens?: number; generatedAt: string }, sha256: (value: string) => string): CohortPack {
  const pack = buildCohortPack(documents, options);
  for (const container of pack.containers) container.inputSha256 = sha256(`${container.containerId}\n${container.text}`);
  return pack;
}

export const COHORT_DEFAULT_INPUT_CHARS = MAX_INPUT_CHARS;
