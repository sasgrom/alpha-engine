/**
 * The text of a cached earnings-release exhibit for the desk Company page. Only a file that the company's own built
 * filings list names for that filing is ever opened (worker/cache/edgar/<cik>/<file>, the SEC's public document as
 * cached by the release calendar), and only its text leaves the server. A file that cannot be read (the archive drive
 * is away) is null: the page then points to the SEC's copy.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DeskCompanyFilings, DeskDocumentText } from "@contracts/desk-company";
import { EXHIBIT_FILE, htmlToParagraphs } from "../../worker/lib/desk-company";
import { readDeskCompanyFile } from "./desk-company-files";

/** Larger exhibits are not parsed for the page (a release is a few hundred kilobytes). */
const MAX_BYTES = 12 * 1024 * 1024;

export function edgarCacheRoot(): string {
  return path.resolve(process.cwd(), "worker/cache/edgar");
}

export function readDeskDocumentText(input: { cik: number; accession: string; file: string }, roots: { files?: string; cache?: string } = {}): DeskDocumentText | null {
  if (!EXHIBIT_FILE.test(input.file)) return null;
  const filings = readDeskCompanyFile<DeskCompanyFilings>(`filings/${input.cik}.json`, roots.files);
  const filing = filings?.filings.find((row) => row.accession === input.accession);
  if (!filing || !filing.exhibits.includes(input.file)) return null;
  const file = path.join(roots.cache ?? edgarCacheRoot(), String(input.cik), input.file);
  try {
    if (!existsSync(file) || statSync(file).size > MAX_BYTES) return null;
    return { accession: input.accession, file: input.file, ...htmlToParagraphs(readFileSync(file, "utf8")) };
  } catch {
    return null;
  }
}
