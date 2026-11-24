/**
 * A company's filing list with what the nightly cache did not keep: the time the SEC accepted each filing and an
 * 8-K's item codes. Both are in the same submissions pages the plain list (listFilings in edgar.ts) is read from, so
 * this costs no extra request. edgar.ts itself is left as it is: the release calendar's code fingerprint includes it.
 */
import { EDGAR_FORMS, secGet, type EdgarFiling } from "./edgar";
import { acceptanceEt } from "./event-calendar";

const SEC_DATA_BASE = "https://data.sec.gov";

export interface DetailedEdgarFiling extends EdgarFiling {
  /** New York wall clock "YYYY-MM-DDTHH:MM:SS" of the SEC's acceptance; null when the SEC gives none. */
  acceptedEt: string | null;
  /** An 8-K's item codes as the SEC lists them ("2.02,9.01"); null when it lists none. */
  items: string | null;
}

/** The rows of one submissions block (the recent block or an archived page), limited to the wanted forms. */
export function detailedRowsFromBlock(block: any, forms: Set<string> = EDGAR_FORMS): DetailedEdgarFiling[] {
  const count = block?.accessionNumber?.length ?? 0;
  const rows: DetailedEdgarFiling[] = [];
  for (let index = 0; index < count; index++) {
    const form = String(block.form?.[index] ?? "");
    if (!forms.has(form)) continue;
    const filingDate = String(block.filingDate?.[index] ?? "");
    const raw = block.acceptanceDateTime?.[index];
    const items = typeof block.items?.[index] === "string" && block.items[index].trim() ? String(block.items[index]).trim() : null;
    // eventTs stays what the plain list writes (the 14-digit form verbatim, else midnight of the filing date), so a
    // manifest entry does not depend on which of the two lists made it; the time of day is in acceptedEt.
    const digits = typeof raw === "string" ? raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/) : null;
    rows.push({
      accessionNo: String(block.accessionNumber[index]),
      form,
      filingDate,
      reportDate: String(block.reportDate?.[index] ?? ""),
      primaryDoc: String(block.primaryDocument?.[index] ?? ""),
      eventTs: digits ? `${digits[1]}-${digits[2]}-${digits[3]} ${digits[4]}:${digits[5]}:${digits[6]}` : `${filingDate} 00:00:00`,
      acceptedEt: acceptanceEt(raw),
      items,
    });
  }
  return rows;
}

/** Full filing history of a company: the recent block and every archived page, one row per accession. */
export async function listFilingsDetailed(cik: number, forms: Set<string> = EDGAR_FORMS): Promise<DetailedEdgarFiling[]> {
  const padded = String(cik).padStart(10, "0");
  const submissions = await (await secGet(`${SEC_DATA_BASE}/submissions/CIK${padded}.json`)).json() as any;
  const all = detailedRowsFromBlock(submissions?.filings?.recent, forms);
  for (const file of submissions?.filings?.files ?? []) {
    const page = await (await secGet(`${SEC_DATA_BASE}/submissions/${file.name}`)).json() as any;
    all.push(...detailedRowsFromBlock(page, forms));
  }
  const seen = new Set<string>();
  return all.filter((row) => (seen.has(row.accessionNo) ? false : (seen.add(row.accessionNo), true)));
}

/**
 * Copies the acceptance time and the items onto a manifest entry that lacks them. Returns true when the entry changed.
 * A value already stored is never replaced: the entry records what the SEC said when it was first read.
 */
export function fillFilingDetails(entry: { acceptedEt?: string | null; items?: string | null }, listed: { acceptedEt?: string | null; items?: string | null }): boolean {
  let changed = false;
  if (entry.acceptedEt === undefined && listed.acceptedEt !== undefined) { entry.acceptedEt = listed.acceptedEt; changed = true; }
  if (entry.items === undefined && listed.items !== undefined) { entry.items = listed.items; changed = true; }
  return changed;
}
