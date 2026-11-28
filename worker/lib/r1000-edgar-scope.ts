export const R1000_EDGAR_FROM = "2019-01-01";
export const R1000_EDGAR_FORMS = ["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"] as const;

export interface R1000ScopeFiling {
  accessionNo: string;
  form: string;
  filingDate: string;
  primaryDoc: string;
}

export interface R1000ScopeDocument {
  name: string;
  size: number;
}

export function r1000ScopeFilings<T extends R1000ScopeFiling>(filings: T[], from = R1000_EDGAR_FROM): T[] {
  return filings.filter(row => (R1000_EDGAR_FORMS as readonly string[]).includes(row.form) && row.filingDate >= from);
}

export function r1000ScopeDocumentSizes(filings: R1000ScopeFiling[], documentsByAccession: ReadonlyMap<string, R1000ScopeDocument[]>) {
  const byForm: Record<string, { filings: number; primaryBytes: number; optionalExhibitBytes: number }> = {};
  const missingPrimaryDocuments: string[] = [];
  let primaryBytes = 0, optionalExhibitBytes = 0;
  for (const form of R1000_EDGAR_FORMS) byForm[form] = { filings: 0, primaryBytes: 0, optionalExhibitBytes: 0 };
  for (const filing of filings) {
    const documents = documentsByAccession.get(filing.accessionNo) ?? [];
    const primary = documents.find(row => row.name === filing.primaryDoc) ?? documents.filter(row => /\.(?:htm|txt)$/i.test(row.name) && !/^index/i.test(row.name)).sort((a, b) => b.size - a.size)[0];
    if (!primary) missingPrimaryDocuments.push(filing.accessionNo);
    const primarySize = primary?.size ?? 0;
    const exhibit = /^8-K(?:\/A)?$/.test(filing.form) ? documents.filter(row => /\.(?:htm|txt)$/i.test(row.name) && !/^index/i.test(row.name) && row.name !== primary?.name).sort((a, b) => b.size - a.size)[0] : undefined;
    const exhibitSize = exhibit?.size ?? 0;
    primaryBytes += primarySize;
    optionalExhibitBytes += exhibitSize;
    byForm[filing.form].filings++;
    byForm[filing.form].primaryBytes += primarySize;
    byForm[filing.form].optionalExhibitBytes += exhibitSize;
  }
  return { filings: filings.length, primaryBytes, optionalExhibitBytes, missingPrimaryDocuments, byForm };
}
