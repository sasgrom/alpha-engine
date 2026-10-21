import { harvestFilingDocuments } from "./api/services/documents";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

// one recent AAPL 8-K (small, has an EX-99.1 press-release exhibit)
const log = async (l: string, m: string) => console.log(`[${l}] ${m}`);
const r = await harvestFilingDocuments(320193, "0000320193-25-000079", "8-K", "aapl-20251030.htm", log as any);
console.log("result:", JSON.stringify(r));
const rows: any = await getDb().execute(sql`SELECT docName, docType, role, sizeBytes, textLength, fetchStatus, location FROM documents WHERE accessionNo='0000320193-25-000079'`);
rows[0].forEach((x: any) => console.log(` ${x.role} | ${x.docType} | ${x.docName} | raw ${x.sizeBytes}B | text ${x.textLength}ch | ${x.fetchStatus}/${x.location}`));
process.exit(0);
