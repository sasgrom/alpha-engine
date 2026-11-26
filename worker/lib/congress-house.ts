export interface HouseFiling {
  docId: string;
  year: number;
  member: string;
  firstName: string;
  lastName: string;
  state: string | null;
  district: string | null;
  filingType: string;
  filedDate: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (_, decimal, hex, named) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return ENTITIES[String(named).toLowerCase()] ?? "";
  });
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

export function isoDate(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(Date.parse(`${value.trim()}T00:00:00Z`))) return value.trim();
    throw new Error(`Invalid House filing date: ${value.slice(0, 40)}`);
  }
  const [, month, day, year] = match;
  const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${result}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== result) throw new Error(`Invalid House filing date: ${value}`);
  return result;
}

export function parseHouseIndex(xml: string, expectedYear: number): HouseFiling[] {
  const blocks = [...xml.matchAll(/<(?:[\w.-]+:)?Member(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?Member>/gi)].map(match => match[0]);
  if (!blocks.length) throw new Error("House index contains no Member records");
  const filings = blocks.map(block => {
    const docId = tag(block, "DocID");
    const year = Number(tag(block, "Year") || expectedYear);
    const firstName = tag(block, "FirstName") || tag(block, "First");
    const lastName = tag(block, "LastName") || tag(block, "Last");
    const stateDst = tag(block, "StateDst").toUpperCase();
    const stateMatch = stateDst.match(/^([A-Z]{2})(.*)$/);
    const filingType = tag(block, "FilingType").toUpperCase();
    const filedDate = tag(block, "FilingDate");
    if (!/^\d+$/.test(docId)) throw new Error(`Invalid House DocID: ${docId.slice(0, 40)}`);
    if (year !== expectedYear) throw new Error(`House index year ${year} does not match ${expectedYear}`);
    if (!filingType) throw new Error(`House ${docId} has no filing type`);
    if (!filedDate && ["P", "T"].includes(filingType)) throw new Error(`House PTR ${docId} has no filing date`);
    return {
      docId,
      year,
      member: `${firstName} ${lastName}`.trim() || tag(block, "Name"),
      firstName,
      lastName,
      state: tag(block, "State") || stateMatch?.[1] || null,
      district: tag(block, "District") || stateMatch?.[2] || null,
      filingType,
      filedDate: filedDate ? isoDate(filedDate) : null,
    };
  });
  const unique = new Map<string, HouseFiling>();
  for (const filing of filings) {
    const previous = unique.get(filing.docId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(filing)) throw new Error(`House ${expectedYear} has conflicting records for DocID ${filing.docId}`);
    unique.set(filing.docId, filing);
  }
  return [...unique.values()];
}

export const houseIndexUrl = (year: number) => `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;
export const housePtrUrl = (year: number, docId: string) => `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf`;
