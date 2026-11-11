import { parse, type DefaultTreeAdapterTypes } from "parse5";

type P5Node = DefaultTreeAdapterTypes.Node;
type P5Element = DefaultTreeAdapterTypes.Element;

const isElement = (node: P5Node): node is P5Element => "tagName" in node;
const childNodes = (node: P5Node): P5Node[] => "childNodes" in node ? node.childNodes : [];

function findAll(node: P5Node, tagName: string): P5Element[] {
  const output: P5Element[] = [];
  for (const child of childNodes(node)) {
    if (isElement(child)) {
      if (child.tagName === tagName) output.push(child);
      output.push(...findAll(child, tagName));
    }
  }
  return output;
}

function findFirst(node: P5Node, tagName: string): P5Element | null {
  return findAll(node, tagName)[0] ?? null;
}

function nodeText(node: P5Node, skipSuperscripts = false): string {
  if ("value" in node) return node.value;
  if (isElement(node) && skipSuperscripts && node.tagName === "sup") return "";
  return childNodes(node).map((child) => nodeText(child, skipSuperscripts)).join(" ");
}

function previousElementSibling(node: P5Node): P5Element | null {
  const parent = node.parentNode;
  if (!parent) return null;
  const siblings = parent.childNodes;
  for (let index = siblings.indexOf(node) - 1; index >= 0; index--) if (isElement(siblings[index])) return siblings[index];
  return null;
}

function closestTable(node: P5Node): P5Element | null {
  let current = node.parentNode;
  while (current) {
    if (isElement(current) && current.tagName === "table") return current;
    current = current.parentNode;
  }
  return null;
}

function tableRows(table: P5Element): P5Element[] {
  return findAll(table, "tr").filter((row) => closestTable(row) === table);
}

function rowCells(row: P5Element): P5Element[] {
  return childNodes(row).filter((cell): cell is P5Element => isElement(cell) && (cell.tagName === "td" || cell.tagName === "th"));
}

function span(cell: P5Element, name: "colspan" | "rowspan"): number {
  const value = Number(cell.attrs.find((attribute) => attribute.name === name)?.value ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export type StatementKind = "income" | "balance" | "cashflow";

export interface GridCell {
  text: string;
  footnotes: string[];
  header: boolean;
}

export interface RawTable {
  sourceFile: string;
  sourceSha256: string;
  tableIndex: number;
  grid: GridCell[][];
  context: string;
  title: string;
  unitMultiplier: number;
  shareMultiplier: number;
}

export interface StatementColumn {
  months: number;
  periodEnd: string;
  headerRow: number;
  startCol: number;
  endCol: number;
  confidence: "full_date" | "quarter_label" | "year_label" | "expected_period";
}

export interface StatementCandidate {
  kind: StatementKind;
  score: number;
  tables: RawTable[];
  columns: StatementColumn[];
}

export interface PrintedValue {
  value: number | null;
  raw: string;
  sourceCol: number;
  percent: boolean;
  footnotes: string[];
}

export interface StatementRow {
  label: string;
  headingPath: string[];
  footnotes: string[];
  sourceFile: string;
  sourceSha256: string;
  tableIndex: number;
  rowIndex: number;
  values: PrintedValue[];
  alignable: boolean;
  kind: "data" | "heading";
}

export const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
export const normalizeLabel = (value: string) => normalizeText(value).replace(/(?:\s*(?:\(\d+\)|\([a-z]\)))+$/i, "").trim();
export const canonicalLabel = (value: string) => normalizeLabel(value).toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();

function cellContent(cell: P5Element): GridCell {
  const footnotes = findAll(cell, "sup").map((node) => normalizeText(nodeText(node))).filter(Boolean);
  const text = normalizeText(nodeText(cell, true));
  return { text: parsePrintedNumber(text) ? text : normalizeLabel(text), footnotes, header: cell.tagName === "th" };
}

function tableGrid(table: P5Element): GridCell[][] {
  const grid: GridCell[][] = [];
  const pending = new Map<number, { cell: GridCell; remaining: number }>();
  for (const row of tableRows(table)) {
    const output: GridCell[] = [];
    let col = 0;
    for (const source of rowCells(row)) {
      const cell = cellContent(source);
      const colSpan = span(source, "colspan");
      const rowSpan = span(source, "rowspan");
      for (let offset = 0; offset < colSpan; offset++) {
        while (pending.has(col)) {
          output[col] = pending.get(col)!.cell;
          col++;
        }
        output[col] = cell;
        if (rowSpan > 1) pending.set(col, { cell, remaining: rowSpan - 1 });
        col++;
      }
    }
    while (pending.has(col)) {
      output[col] = pending.get(col)!.cell;
      col++;
    }
    grid.push(output);
    for (const [index, value] of pending) {
      value.remaining--;
      if (value.remaining <= 0) pending.delete(index);
    }
  }
  return grid;
}

function tableContext(table: P5Element): string {
  const parts: string[] = [];
  let current: P5Node | null = table;
  for (let depth = 0; depth < 4 && current && parts.length < 5; depth++) {
    let node = previousElementSibling(current);
    while (node && parts.length < 5) {
      if (node.tagName !== "table" && !findFirst(node, "table")) {
        const text = normalizeText(nodeText(node));
        if (text) parts.unshift(text.slice(-400));
      }
      node = previousElementSibling(node);
    }
    current = current.parentNode;
  }
  return parts.join(" | ");
}

function tableTitle(table: P5Element, grid: GridCell[][], context: string): string {
  const captionNode = findFirst(table, "caption");
  const caption = captionNode ? normalizeText(nodeText(captionNode)) : "";
  if (caption) return caption;
  const firstRows = grid.slice(0, 8).flatMap((row) => [...new Set(row.map((cell) => cell.text).filter(Boolean))]).filter(Boolean);
  const titlePattern = /(?:income statement|statements? of (?:income|operations|earnings|cash flows?|financial position)|balance sheets?|cash flows?|results of operations|financial highlights|key metrics|summary financial results|contents|non-gaap|constant currency|reconciliation)/i;
  const local = firstRows.find((text) => titlePattern.test(text));
  if (local) return local;
  const preceding = [...context.split(" | ")].reverse().find((text) => titlePattern.test(text));
  return preceding ?? firstRows[0] ?? context.split(" | ").at(-1) ?? "";
}

function multiplier(text: string, fallback = 1): number {
  const match = text.match(/(?:in|amounts in|reported in)\s+(thousands|millions|billions)/i);
  if (!match) return fallback;
  return match[1].toLowerCase() === "thousands" ? 1e3 : match[1].toLowerCase() === "millions" ? 1e6 : 1e9;
}

function unitMultipliers(context: string, title: string, grid: GridCell[][]): { unitMultiplier: number; shareMultiplier: number } {
  const text = `${context} ${title} ${grid.slice(0, 8).flatMap((row) => row.map((cell) => cell.text)).join(" ")}`;
  const unitMultiplier = multiplier(text);
  const shareText = text.match(/(?:number of )?shares[^.]{0,100}?\b(thousands|millions|billions)\b/i);
  const shareMultiplier = shareText ? multiplier(`in ${shareText[1]}`) : unitMultiplier;
  return { unitMultiplier, shareMultiplier };
}

export function parseExhibitHtml(html: string, sourceFile: string, sourceSha256: string): RawTable[] {
  const document = parse(html);
  return findAll(document, "table").map((table, tableIndex) => {
    const grid = tableGrid(table);
    const context = tableContext(table);
    const title = tableTitle(table, grid, context);
    return { sourceFile, sourceSha256, tableIndex, grid, context, title, ...unitMultipliers(context, title, grid) };
  }).filter((table) => table.grid.some((row) => row.some((cell) => cell.text)));
}

function rowTexts(table: RawTable): string[] {
  return table.grid.map((row) => [...new Set(row.map((cell) => cell.text).filter(Boolean))].join(" ")).filter(Boolean);
}

function statementScore(table: RawTable): { kind: StatementKind; score: number } | null {
  const title = table.title;
  const local = `${title} ${rowTexts(table).slice(0, 8).join(" ")}`;
  if (/non-gaap|adjusted|reconciliation|segment|outlook|guidance|constant currency|highlights|contents|key metrics|summary financial|average balance/i.test(local)) return null;
  const labels = rowTexts(table).join(" | ");
  const incomeTitle = /income statement|statements? of (?:income|operations|earnings)|results of operations/i.test(title);
  const balanceTitle = /balance sheets?|statements? of financial position/i.test(title);
  const cashflowTitle = /statements? of cash flows?|cash flow statements?/i.test(title);
  const incomeRows = [/revenue|net sales/i, /operating income|income from operations|earnings\/?\(loss\) from operations|noninterest expense/i, /net income|net loss/i, /earnings per share|loss per share|diluted/i].filter((pattern) => pattern.test(labels)).length;
  const balanceRows = [/total assets/i, /total liabilities/i, /shareholders['’] equity|stockholders['’] equity/i].filter((pattern) => pattern.test(labels)).length;
  const cashflowRows = [/cash.*operating activities/i, /cash.*(?:investing|financing) activities/i, /cash.*end of (?:the )?period/i].filter((pattern) => pattern.test(labels)).length;
  if (cashflowTitle || cashflowRows >= 2) return { kind: "cashflow", score: (cashflowTitle ? 10 : 0) + cashflowRows };
  if (balanceTitle || balanceRows >= 2) return { kind: "balance", score: (balanceTitle ? 10 : 0) + balanceRows };
  if (incomeTitle || incomeRows >= 2) return { kind: "income", score: (incomeTitle ? 10 : 0) + incomeRows };
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const isoDate = (year: number, month: number, day: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function addMonths(date: string, months: number): string {
  const source = new Date(`${date}T00:00:00Z`);
  const day = source.getUTCDate();
  source.setUTCDate(1);
  source.setUTCMonth(source.getUTCMonth() + months);
  const last = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate();
  source.setUTCDate(Math.min(day, last));
  return source.toISOString().slice(0, 10);
}

export function fullDates(text: string): string[] {
  const dates: string[] = [];
  for (const match of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) dates.push(isoDate(Number(match[1]), Number(match[2]), Number(match[3])));
  for (const match of text.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2}|\d{2})\b/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) dates.push(isoDate(Number(match[3].length === 2 ? `20${match[3]}` : match[3]), month, day));
  }
  const monthNames = Object.keys(MONTHS).join("|");
  for (const match of text.matchAll(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d{2})\\b`, "gi"))) dates.push(isoDate(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2])));
  return dates;
}

function partialMonthDay(text: string): { month: number; day: number } | null {
  const monthNames = Object.keys(MONTHS).join("|");
  const match = text.match(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*$`, "i"));
  return match ? { month: MONTHS[match[1].toLowerCase()], day: Number(match[2]) } : null;
}

function shiftFiscalPeriod(date: string, months: number): string {
  const shifted = addMonths(date, months);
  const source = new Date(`${date}T00:00:00Z`);
  const target = new Date(`${shifted}T00:00:00Z`);
  const sourceLastDay = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate();
  if (source.getUTCDate() === sourceLastDay) {
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return isoDate(target.getUTCFullYear(), target.getUTCMonth() + 1, lastDay);
  }
  if (months % 12 === 0) return addDays(date, months / 12 * 364);
  return addDays(shifted, source.getUTCDay() - target.getUTCDay());
}

export function durationMonths(text: string, context = ""): number | null {
  const value = text.toLowerCase().replace(/-/g, " ");
  if (/change|growth|constant currency|non-gaap|adjusted/.test(value)) return null;
  if (/year to date|\bytd\b/.test(value)) {
    const normalizedContext = context.toLowerCase();
    if (/fourth[- ]quarter/.test(normalizedContext)) return 12;
    if (/third[- ]quarter/.test(normalizedContext)) return 9;
    if (/second[- ]quarter/.test(normalizedContext)) return 6;
    if (/first[- ]quarter/.test(normalizedContext)) return 3;
    return null;
  }
  const weeks = value.match(/\b(\d+)\s+weeks?\b/);
  if (weeks) {
    const months = ({ 12: 3, 13: 3, 16: 4, 17: 4, 24: 6, 26: 6, 36: 9, 39: 9, 52: 12, 53: 12 } as Record<number, number>)[Number(weeks[1])];
    if (months) return months;
  }
  if (/thirteen\s+weeks/.test(value)) return 3;
  if (/twenty[- ]six\s+weeks/.test(value)) return 6;
  if (/twenty[- ]four\s+weeks/.test(value)) return 6;
  if (/thirty[- ]six\s+weeks/.test(value)) return 9;
  if (/thirty[- ]nine\s+weeks/.test(value)) return 9;
  if (/fifty[- ]two\s+weeks/.test(value)) return 12;
  if (/twelve\s+months|12\s*months|year\s+ended|years\s+ended|full[- ]year|^\s*fiscal\s+year(?:\s+(?:fy\s*)?(?:20\d{2}|\d{2}))?\s*$|\b12m\b/.test(value)) return 12;
  if (/nine\s+months|9\s*months|\b9m\b/.test(value)) return 9;
  if (/six\s+months|6\s*months|\b6m\b/.test(value)) return 6;
  if (/three\s+months|3\s*months|quarters?\s+ended|quarterly|first[- ]quarter|second[- ]quarter|third[- ]quarter|fourth[- ]quarter|\b[1-4](?:st|nd|rd|th)\s+qtr\.?\b|\bq[1-4]\b|\b20\d{2}\s*q[1-4]\b|\b3m\b/.test(value)) return 3;
  return null;
}

interface HeaderCell { text: string; start: number; end: number }

export function headerCells(row: GridCell[]): HeaderCell[] {
  const cells: HeaderCell[] = [];
  for (let index = 0; index < row.length; index++) {
    if (!row[index].text) continue;
    const previous = cells.at(-1);
    if (previous && row[index] === row[previous.start]) previous.end = index;
    else cells.push({ text: row[index].text, start: index, end: index });
  }
  return cells;
}

const excludedHeader = (text: string) => /percent\s+change|%\s*change|growth|constant currency|non-gaap|adjusted|\bvs\.?\b|\byoy\b|\bqoq\b|year[- ]over[- ]year|^\s*(?:(?:[1-4]q)?\d{2}(?:\d{2})?\s+)?change\s*:?\s*$/i.test(text);

export function ignoredValueColumns(table: RawTable): { start: number; end: number }[] {
  return table.grid.slice(0, 14).flatMap((row) => headerCells(row).filter((cell) => excludedHeader(cell.text)).map((cell) => ({ start: cell.start, end: cell.end })));
}

function quarterFromContext(context: string): number | null {
  const value = context.toLowerCase();
  if (/first[- ]quarter/.test(value)) return 1;
  if (/second[- ]quarter/.test(value)) return 2;
  if (/third[- ]quarter/.test(value)) return 3;
  if (/fourth[- ]quarter/.test(value)) return 4;
  return null;
}

function ordinalHeaderYear(table: RawTable, ordinal: { start: number; end: number; row: number }, text: string): number | null {
  const explicitYear = text.match(/\b(20\d{2})\b/);
  if (explicitYear) return Number(explicitYear[1]);
  const ordinalCells = headerCells(table.grid[ordinal.row]).filter((cell) => /\b(?:[1-4](?:st|nd|rd|th)\s+qtr\.?|q[1-4]|20\d{2}\s+q[1-4])\b/i.test(cell.text));
  const ordinalIndex = ordinalCells.findIndex((cell) => cell.start === ordinal.start && cell.end === ordinal.end);
  const rows: number[] = [];
  for (let row = ordinal.row - 1; row >= Math.max(0, ordinal.row - 3); row--) rows.push(row);
  for (let row = ordinal.row + 1; row < Math.min(table.grid.length, ordinal.row + 4); row++) rows.push(row);
  for (const row of rows) {
    const years = headerCells(table.grid[row]).filter((cell) => /^\s*(?:fy\s*)?(20\d{2})\*?\s*$/i.test(cell.text));
    const overlapping = years.find((cell) => cell.start <= ordinal.end && cell.end >= ordinal.start);
    if (overlapping) return Number(overlapping.text.trim().replace("*", "").slice(-4));
    if (ordinalIndex >= 0 && years.length === ordinalCells.length && years[ordinalIndex]) return Number(years[ordinalIndex].text.trim().replace("*", "").slice(-4));
  }
  return null;
}

function ordinalRelativeQuarter(cell: { quarter: number; year: number }, expectedQuarter: number, expectedYear: number): number {
  return (cell.year - expectedYear) * 4 + cell.quarter - expectedQuarter
    - (expectedQuarter === 1 && cell.quarter === 4 && cell.year === expectedYear ? 4 : 0);
}

function bestOrdinalQuarter(cells: { start: number; end: number; row: number; quarter: number; year: number }[], expectedPeriodEnd: string): number {
  const expectedYear = Number(expectedPeriodEnd.slice(0, 4));
  let best = { quarter: 1, difference: Number.POSITIVE_INFINITY, startCol: Number.POSITIVE_INFINITY };
  for (let quarter = 1; quarter <= 4; quarter++) {
    for (const cell of cells) {
      const relative = ordinalRelativeQuarter(cell, quarter, expectedYear);
      const difference = Math.abs(daysBetween(shiftFiscalPeriod(expectedPeriodEnd, relative * 3), expectedPeriodEnd));
      if (difference < best.difference || (difference === best.difference && cell.start < best.startCol)) best = { quarter, difference, startCol: cell.start };
    }
  }
  return best.quarter;
}

export function detectPeriodColumns(table: RawTable, kind: StatementKind, expectedPeriodEnd: string | null): StatementColumn[] {
  const durations: (number | null)[] = [];
  const candidates: StatementColumn[] = [];
  const yearCandidates: StatementColumn[] = [];
  const yearLabels: { year: number; months: number; headerRow: number; start: number; end: number }[] = [];
  const annualTitleMonths = /\bannual\b/i.test(table.title) ? 12 : null;
  const partials: { month: number; day: number; months: number; start: number; end: number; row: number }[] = [];
  const quarterCells: { text: string; start: number; end: number; row: number; quarter: number; year: number }[] = [];
  const ordinalCells: { start: number; end: number; row: number; quarter: number; year: number }[] = [];
  for (let rowIndex = 0; rowIndex < Math.min(14, table.grid.length); rowIndex++) {
    const cells = headerCells(table.grid[rowIndex]);
    const previousCells = rowIndex > 0 ? headerCells(table.grid[rowIndex - 1]) : [];
    const previousHeaderText = previousCells.map((cell) => cell.text).join(" ");
    let periodHeaderRow = rowIndex - 1;
    while (periodHeaderRow >= Math.max(0, rowIndex - 3) && headerCells(table.grid[periodHeaderRow]).length === 0) periodHeaderRow--;
    const periodHeaderText = periodHeaderRow >= 0 ? headerCells(table.grid[periodHeaderRow]).map((cell) => cell.text).join(" ") : "";
    const previousPeriodHeader = durationMonths(periodHeaderText, table.context) !== null || fullDates(periodHeaderText).length > 0 || /\b(?:[1-4]q(?:'|’)?(?:20\d{2}|\d{2})|q[1-4]|20\d{2}\s+q[1-4]|[1-4](?:st|nd|rd|th)\s+qtr\.?|first[- ]quarter|second[- ]quarter|third[- ]quarter|fourth[- ]quarter)\b/i.test(periodHeaderText);
    const rowLabel = rowLabelIndex(table.grid[rowIndex]);
    const hasQuarterHeader = cells.some((cell) => /\b(?:[1-4]q(?:'|’)?(?:20\d{2}|\d{2})|q[1-4]|20\d{2}\s+q[1-4]|[1-4](?:st|nd|rd|th)\s+qtr\.?)\b/i.test(cell.text));
    const yearHeaderRow = hasQuarterHeader || previousPeriodHeader || rowLabel < 0 || /^\s*\(?\s*(?:unaudited\b|in\s+(?:thousands|millions|billions)\b|amounts\s+in\b|dollars\s+in\b|fiscal\s+year\b|annual\b|percent\b)/i.test(table.grid[rowIndex][rowLabel]?.text ?? "");
    const rowDuration = durationMonths(`${previousHeaderText} ${cells.map((cell) => cell.text).join(" ")}`, table.context) ?? annualTitleMonths;
    for (const cell of cells) {
      const previousCell = previousCells.find((candidate) => candidate.start === cell.start || (candidate.start <= cell.start && candidate.end >= cell.start));
      const durationText = `${previousCell?.text ?? ""} ${cell.text}`;
      const months = durationMonths(durationText, table.context) ?? rowDuration;
      if (months !== null) for (let col = cell.start; col <= cell.end; col++) durations[col] = months;
      if (excludedHeader(cell.text)) continue;
      for (const quarter of cell.text.matchAll(/\b([1-4])q(?:'|’)?(20\d{2}|\d{2})\b/gi)) {
        const year = Number(quarter[2].length === 2 ? `20${quarter[2]}` : quarter[2]);
        quarterCells.push({ text: cell.text, start: cell.start, end: cell.end, row: rowIndex, quarter: Number(quarter[1]), year });
      }
      for (const ordinal of cell.text.matchAll(/\b([1-4])(?:st|nd|rd|th)\s+qtr\.?\b/gi)) {
        const year = ordinalHeaderYear(table, { start: cell.start, end: cell.end, row: rowIndex }, cell.text);
        if (year !== null) ordinalCells.push({ start: cell.start, end: cell.end, row: rowIndex, quarter: Number(ordinal[1]), year });
      }
      for (const ordinal of cell.text.matchAll(/\bQ([1-4])\b/gi)) {
        const year = ordinalHeaderYear(table, { start: cell.start, end: cell.end, row: rowIndex }, cell.text);
        if (year !== null) ordinalCells.push({ start: cell.start, end: cell.end, row: rowIndex, quarter: Number(ordinal[1]), year });
      }
      if (/^(?:ytd|year to date)$/i.test(cell.text.trim()) && expectedPeriodEnd) {
        const months = durationMonths(cell.text, table.context);
        if (months !== null) candidates.push({ months, periodEnd: expectedPeriodEnd, headerRow: rowIndex, startCol: cell.start, endCol: cell.end, confidence: "expected_period" });
      }
      const periodMonths = kind === "balance" ? 0 : durationMonths(durationText, table.context) ?? durations[cell.start] ?? rowDuration;
      const partial = partialMonthDay(cell.text);
      if (partial && periodMonths !== null) partials.push({ ...partial, months: periodMonths, start: cell.start, end: cell.end, row: rowIndex });
      const dates = fullDates(cell.text);
      for (const periodEnd of dates) {
        if (periodMonths !== null) candidates.push({ months: periodMonths, periodEnd, headerRow: rowIndex, startCol: cell.start, endCol: cell.end, confidence: "full_date" });
      }
      if (dates.length || /\b[1-4]q/i.test(cell.text) || partial) continue;
      const yearLabel = cell.text.trim().match(/^(?:fy\s*)?(20\d{2}|\d{2})\*?$/i);
      if (yearHeaderRow && periodMonths !== null && expectedPeriodEnd && yearLabel && (yearLabel[1].length === 4 || /^fy/i.test(cell.text.trim()))) {
        const year = Number(yearLabel[1].length === 2 ? `20${yearLabel[1]}` : yearLabel[1]);
        yearLabels.push({ year, months: periodMonths, headerRow: rowIndex, start: cell.start, end: cell.end });
      }
    }
  }
  for (const partial of partials) {
    for (let row = partial.row + 1; row < Math.min(table.grid.length, partial.row + 3); row++) {
      const year = headerCells(table.grid[row]).find((cell) => cell.start === partial.start && /^\s*(20\d{2})\s*$/.test(cell.text));
      if (year) {
        candidates.push({ months: partial.months, periodEnd: isoDate(Number(year.text.trim()), partial.month, partial.day), headerRow: row, startCol: partial.start, endCol: partial.end, confidence: "full_date" });
        break;
      }
    }
  }
  if (expectedPeriodEnd && yearLabels.length) {
    const expectedYear = Number(expectedPeriodEnd.slice(0, 4));
    const fiscalYearBeforeCalendarYear = Number(expectedPeriodEnd.slice(5, 7)) <= 2 ? expectedYear - 1 : expectedYear;
    const years = new Set(yearLabels.map((label) => label.year));
    const anchorYear = years.has(expectedYear) ? expectedYear : years.has(fiscalYearBeforeCalendarYear) ? fiscalYearBeforeCalendarYear : expectedYear;
    for (const label of yearLabels) {
      const periodEnd = shiftFiscalPeriod(expectedPeriodEnd, 12 * (label.year - anchorYear));
      yearCandidates.push({ months: label.months, periodEnd, headerRow: label.headerRow, startCol: label.start, endCol: label.end, confidence: "year_label" });
    }
  }
  candidates.push(...yearCandidates.filter((year) => !(ordinalCells.length && year.months === 3) && !partials.some((partial) => partial.start === year.startCol && partial.end === year.endCol && partial.months === year.months)));
  if (expectedPeriodEnd && quarterCells.length) {
    const expectedYear = Number(expectedPeriodEnd.slice(0, 4));
    const base = quarterCells.filter((cell) => cell.year === expectedYear).sort((a, b) => b.quarter - a.quarter)[0];
    if (base) {
      for (const cell of quarterCells) {
        const months = durationMonths(cell.text, table.context) ?? durations[cell.start] ?? (kind === "balance" ? 0 : 3);
        if (kind !== "balance" && months === null) continue;
        const relative = (cell.year - base.year) * 4 + cell.quarter - base.quarter;
        candidates.push({ months: kind === "balance" ? 0 : months!, periodEnd: shiftFiscalPeriod(expectedPeriodEnd, relative * 3), headerRow: cell.row, startCol: cell.start, endCol: cell.end, confidence: "quarter_label" });
      }
    }
  }
  if (expectedPeriodEnd && ordinalCells.length) {
    const expectedYear = Number(expectedPeriodEnd.slice(0, 4));
    const expectedQuarter = quarterFromContext(table.context) ?? bestOrdinalQuarter(ordinalCells, expectedPeriodEnd);
    for (const cell of ordinalCells) {
      const relative = ordinalRelativeQuarter(cell, expectedQuarter, expectedYear);
      const periodEnd = shiftFiscalPeriod(expectedPeriodEnd, relative * 3);
      if (periodEnd > addDays(expectedPeriodEnd, 7)) continue;
      candidates.push({ months: kind === "balance" ? 0 : 3, periodEnd, headerRow: cell.row, startCol: cell.start, endCol: cell.end, confidence: "quarter_label" });
    }
  }
  const unique = new Map<string, StatementColumn>();
  for (const candidate of candidates) {
    const key = candidate.confidence === "expected_period" ? `${candidate.startCol}|${candidate.endCol}|${candidate.months}|${candidate.periodEnd}` : `${candidate.months}|${candidate.periodEnd}`;
    const existing = unique.get(key);
    if (!existing || candidate.startCol < existing.startCol || (candidate.startCol === existing.startCol && candidate.headerRow < existing.headerRow)) unique.set(key, candidate);
  }
  return [...unique.values()].sort((a, b) => a.startCol - b.startCol || a.months - b.months || a.periodEnd.localeCompare(b.periodEnd));
}

export function findStatementCandidates(tables: RawTable[], expectedPeriodEnd: string | null): StatementCandidate[] {
  return tables.flatMap((table) => {
    const classification = statementScore(table);
    if (!classification) return [];
    return [{ ...classification, tables: [table], columns: detectPeriodColumns(table, classification.kind, expectedPeriodEnd) }];
  });
}

const columnSignature = (columns: StatementColumn[]) => columns.map((column) => `${column.months}:${column.periodEnd}`).join("|");

export function joinStatementCandidates(candidates: StatementCandidate[]): StatementCandidate[] {
  const output: StatementCandidate[] = [];
  for (const candidate of candidates) {
    const previous = output.at(-1);
    const continuationText = candidate.tables[0] ? `${candidate.tables[0].title} ${rowTexts(candidate.tables[0]).slice(0, 3).join(" ")}` : "";
    const explicitContinuation = /continued|continuation/i.test(continuationText);
    const cashflowContinuation = candidate.kind === "cashflow" && candidate.columns.length === 0 && /financing activities/i.test(continuationText);
    const headerContinuation = previous && previous.columns.length === 0 && candidate.columns.length > 0 && previous.tables.every((table) => table.grid.length <= 8);
    const dataContinuation = previous && previous.columns.length > 0 && candidate.columns.length === 0;
    const compatibleColumns = !previous?.columns.length || !candidate.columns.length || columnSignature(previous.columns) === columnSignature(candidate.columns);
    if (previous && previous.kind === candidate.kind && previous.tables[0].sourceFile === candidate.tables[0].sourceFile && (explicitContinuation || cashflowContinuation || headerContinuation || dataContinuation) && compatibleColumns) {
      previous.tables.push(...candidate.tables);
      previous.score = Math.max(previous.score, candidate.score);
      if (!previous.columns.length) previous.columns = candidate.columns;
    } else output.push({ ...candidate, tables: [...candidate.tables] });
  }
  return output;
}

export interface ParsedNumber {
  value: number | null;
  raw: string;
  sourceCol: number;
  negative: boolean;
  percent: boolean;
}

export function parsePrintedNumber(input: string): Omit<ParsedNumber, "sourceCol"> | null {
  let text = normalizeText(input).replace(/[−–]/g, "-").replace(/[—]/g, "-");
  if (!text) return null;
  if (/^[-–—]$/.test(text)) return { value: null, raw: text, negative: false, percent: false };
  const percent = /%/.test(text);
  const negative = /^\s*\(.*\)\s*$/.test(text) || /^\s*\(/.test(text) || /\)\s*$/.test(text) || /^-/.test(text);
  const cleaned = text.replace(/[$,%()]/g, "").replace(/\s/g, "").replace(/^[+-]/, "");
  if (!/^\d+(?:,\d{3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, raw: text, negative, percent };
}

function rowLabelIndex(row: GridCell[]): number {
  return row.findIndex((cell) => cell.text && !parsePrintedNumber(cell.text) && !/^[$()%]+$/.test(cell.text) && !/^\([a-z]\)$/i.test(cell.text));
}

export function extractCandidateRows(candidate: StatementCandidate): StatementRow[] {
  const output: StatementRow[] = [];
  let headings: string[] = [];
  const expectedPeriodEnd = candidate.columns.map((column) => column.periodEnd).sort().at(-1) ?? null;
  for (const table of candidate.tables) {
    const ownColumns = detectPeriodColumns(table, candidate.kind, expectedPeriodEnd);
    const lastHeader = Math.max(-1, ...ownColumns.map((column) => column.headerRow));
    const ignored = ignoredValueColumns(table);
    for (let rowIndex = lastHeader + 1; rowIndex < table.grid.length; rowIndex++) {
      const row = table.grid[rowIndex];
      const labelIndex = rowLabelIndex(row);
      if (labelIndex < 0) continue;
      const label = row[labelIndex].text;
      if (!label || /^(?:in|amounts in)\s+(?:thousands|millions|billions)\b/i.test(label) || canonicalLabel(label) === canonicalLabel(table.title)) continue;
      const entries: ParsedNumber[] = [];
      let pendingNegative = false;
      let pendingPercent = false;
      for (let col = labelIndex + 1; col < row.length; col++) {
        if (col > labelIndex + 1 && row[col] === row[col - 1]) continue;
        const text = row[col].text;
        if (!text || /^\([a-z]\)$/i.test(text)) continue;
        if (/^[$()%]+$/.test(text)) {
          if (text.includes(")") && entries.length) {
            const previous = entries.at(-1)!;
            previous.negative = true;
            if (previous.value !== null) previous.value = -Math.abs(previous.value);
            previous.raw = `${previous.raw}${text}`;
          }
          if (text.includes("(")) pendingNegative = true;
          if (text.includes("%")) {
            if (entries.length) entries.at(-1)!.percent = true;
            else pendingPercent = true;
          }
          continue;
        }
        const parsed = parsePrintedNumber(text);
        if (!parsed) continue;
        if (pendingNegative) {
          parsed.negative = true;
          if (parsed.value !== null) parsed.value = -Math.abs(parsed.value);
          parsed.raw = `(${parsed.raw})`;
        }
        if (pendingPercent) parsed.percent = true;
        entries.push({ ...parsed, sourceCol: col });
        pendingNegative = false;
        pendingPercent = false;
      }
      const percentRow = /%|\bpercent(?:age)?\b|\bmargin\b|\bratio\b|\breturn on\b|\byield\b|\bgrowth\b|\b(?:tax|interest|discount|inflation|effective)\s+(?:\w+\s+){0,2}rate\b/i.test(label);
      const values = entries.filter((entry) => percentRow || (!entry.percent && !ignored.some((range) => entry.sourceCol >= range.start && entry.sourceCol <= range.end)));
      const footnotes = row.flatMap((cell) => cell.footnotes);
      if (!values.length) {
        const parentHeadings = headings;
        headings = [...headings.slice(-2), label];
        output.push({ label, headingPath: parentHeadings, footnotes, sourceFile: table.sourceFile, sourceSha256: table.sourceSha256, tableIndex: table.tableIndex, rowIndex, values: [], alignable: false, kind: "heading" });
        continue;
      }
      output.push({ label, headingPath: [...headings], footnotes, sourceFile: table.sourceFile, sourceSha256: table.sourceSha256, tableIndex: table.tableIndex, rowIndex, values: values.map((entry) => ({ value: entry.value, raw: entry.raw, sourceCol: entry.sourceCol, percent: entry.percent, footnotes: [] })), alignable: values.length === candidate.columns.length, kind: "data" });
    }
  }
  return output;
}

export function rowUnit(row: StatementRow, table: RawTable): { multiplier: number; perShare: boolean; shares: boolean; percent: boolean } {
  const context = `${row.headingPath.join(" ")} ${row.label}`;
  const percent = /%|\bpercent(?:age)?\b|\bmargin\b|\bratio\b|\breturn on\b|\byield\b|\bgrowth\b|\b(?:tax|interest|discount|inflation|effective)\s+(?:\w+\s+){0,2}rate\b/i.test(context);
  const shares = !percent && /shares used|weighted[- ]average(?: number of)? shares|share counts|shares outstanding/i.test(context);
  const perShare = !percent && !shares && /per (?:common )?share|earnings per share|loss per share/i.test(context);
  return { multiplier: perShare ? 1 : shares ? table.shareMultiplier : percent ? 1 : table.unitMultiplier, perShare, shares, percent };
}

export function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

export function isCurrentPeriod(column: StatementColumn, currentPeriodEnd: string | null): boolean {
  return currentPeriodEnd !== null && Math.abs(daysBetween(column.periodEnd, currentPeriodEnd)) <= 3;
}

export function previousDate(date: string, days: number): string {
  return addDays(date, -days);
}
