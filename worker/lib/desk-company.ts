/**
 * Turns one company's standard-fundamentals document (research standard, schema 2) into the compact statements file
 * the desk Company page reads. Pure: no file or database access here.
 *
 * Every figure is shown as the company first reported it, with the filing date and the XBRL tag it came from; when a
 * later filing printed a different figure for the same quarter, the latest one is carried beside it.
 */
import {
  DESK_COMPANY_SCHEMA_VERSION, type DeskCompanyStatements, type DeskStatementCell, type DeskStatementKind, type DeskStatementName,
  type DeskStatementQuarter, type DeskStatementRow,
} from "../../contracts/desk-company";

export interface StandardField { code: string; statement: string; kind: string; meaning: string }
export interface StandardQuarter { end: string; start?: string; fy?: number | null; fq?: number | null; filed?: string | null; form?: string | null }
/** [filing date, value, index into `sources`] */
export type StandardVersion = [string, number, number?];
export interface StandardCompanyDoc {
  schemaVersion: number;
  cik: number;
  ticker: string;
  name: string;
  quarters: StandardQuarter[];
  sources: string[];
  fields: Record<string, Array<[number, StandardVersion[]]>>;
}

const STATEMENTS: DeskStatementName[] = ["income", "balance", "cashflow"];
const KINDS: DeskStatementKind[] = ["flow", "instant", "shares", "perShare"];
const OWN_FORMS = new Set(["10-Q", "10-K", "10-QT", "10-KT", "10-Q/A", "10-K/A"]);

/**
 * "t:Revenues" -> "Revenues"; "y:Tag" (differenced from year-to-date figures) and "x:Tag" (scope rule) -> "Tag";
 * "d0:opex" and other derivations -> "derived".
 */
export function sourceLabel(source: string | undefined): string {
  if (!source) return "derived";
  const [prefix, name] = source.includes(":") ? [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)] : ["", source];
  return (prefix === "t" || prefix === "y" || prefix === "x") && name ? name : "derived";
}

function cell(versions: StandardVersion[], sources: string[]): DeskStatementCell | null {
  const filed = versions.filter((v) => typeof v[0] === "string" && Number.isFinite(v[1])).sort((a, b) => a[0].localeCompare(b[0]));
  if (!filed.length) return null;
  const first = filed[0], last = filed[filed.length - 1];
  const out: DeskStatementCell = { value: first[1], filed: first[0], source: sourceLabel(typeof first[2] === "number" ? sources[first[2]] : undefined) };
  if (last[1] !== first[1]) out.restated = { value: last[1], filed: last[0] };
  return out;
}

export function buildDeskCompanyStatements(params: {
  doc: StandardCompanyDoc;
  fields: StandardField[];
  standard: string;
  standardGeneratedAt: string;
  builtAt: string;
  /** How many of the newest quarters to keep. */
  quarters?: number;
}): DeskCompanyStatements {
  const { doc, fields, standard, standardGeneratedAt, builtAt } = params;
  const keep = params.quarters ?? 20;
  if (doc.schemaVersion !== 2) throw new Error(`Standard fundamentals schema ${String(doc.schemaVersion)} is not the expected 2 (company ${doc.cik})`);
  // The newest quarters that the company itself reported (comparison-only quarters at the start of a history are left out).
  const own = doc.quarters.map((q, index) => ({ q, index })).filter(({ q }) => q.form != null && OWN_FORMS.has(q.form));
  const chosen = own.slice(-keep);
  const position = new Map(chosen.map(({ index }, column) => [index, column]));
  const quarters: DeskStatementQuarter[] = chosen.map(({ q }) => ({ end: q.end, fy: q.fy ?? null, fq: q.fq ?? null, form: q.form ?? null, filed: q.filed ?? null }));
  const statements: Record<DeskStatementName, DeskStatementRow[]> = { income: [], balance: [], cashflow: [] };
  for (const field of fields) {
    if (!STATEMENTS.includes(field.statement as DeskStatementName) || !KINDS.includes(field.kind as DeskStatementKind)) continue;
    const cells: Array<DeskStatementCell | null> = chosen.map(() => null);
    for (const [quarterIndex, versions] of doc.fields[field.code] ?? []) {
      const column = position.get(quarterIndex);
      if (column !== undefined) cells[column] = cell(versions, doc.sources);
    }
    if (cells.every((value) => value === null)) continue;
    statements[field.statement as DeskStatementName].push({ code: field.code, label: field.meaning, kind: field.kind as DeskStatementKind, cells });
  }
  return { schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: doc.cik, ticker: doc.ticker, name: doc.name, standard, standardGeneratedAt, builtAt, quarters, statements };
}
