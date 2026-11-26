import { acceptanceEt } from "./event-calendar";

export interface CorporateEndEvidence {
  kind: "Form 15" | "Form 25" | "merger 8-K";
  accessionNo: string;
  filingDate: string;
  acceptedEt: string | null;
  items: string | null;
}

export function corporateEndEvidence(pages: any[]): CorporateEndEvidence[] {
  const byAccession = new Map<string, CorporateEndEvidence>();
  for (const page of pages) {
    const blocks = [page?.filings?.recent ?? page];
    for (const block of blocks) {
      for (let index = 0; index < (block?.accessionNumber?.length ?? 0); index++) {
        const form = String(block.form?.[index] ?? "").toUpperCase();
        const items = String(block.items?.[index] ?? "").trim() || null;
        const kind = /^15(?:-|\/|$)/.test(form) ? "Form 15" as const
          : /^25(?:-|\/|$)/.test(form) ? "Form 25" as const
          : /^8-K(?:\/A)?$/.test(form) && items && /(?:^|,)\s*(?:2\.01|5\.01)(?:,|$)/.test(items) ? "merger 8-K" as const : null;
        if (!kind) continue;
        const accessionNo = String(block.accessionNumber[index]);
        byAccession.set(`${kind}:${accessionNo}`, { kind, accessionNo, filingDate: String(block.filingDate?.[index] ?? ""), acceptedEt: block.acceptanceDateTime?.[index] ? acceptanceEt(String(block.acceptanceDateTime[index])) : null, items });
      }
    }
  }
  return [...byAccession.values()].sort((a, b) => b.filingDate.localeCompare(a.filingDate) || a.accessionNo.localeCompare(b.accessionNo));
}
