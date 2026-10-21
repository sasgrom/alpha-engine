import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
import { harvestFilingDocuments } from "./api/services/documents";
// clean previous test rows, retest with correct primaryDoc
await getDb().execute(sql`DELETE FROM documents WHERE accessionNo='0000320193-25-000079'`);
const log = async () => {};
const r = await harvestFilingDocuments(320193, "0000320193-25-000079", "10-K", "aapl-20250927.htm", log as any);
console.log("result:", JSON.stringify(r));
const rows: any = await getDb().execute(sql`SELECT role, docName, textLength, fetchStatus FROM documents WHERE accessionNo='0000320193-25-000079' ORDER BY role, docName`);
rows[0].forEach((x: any) => console.log(` ${x.role} | ${x.docName} | ${x.textLength}ch | ${x.fetchStatus}`));
process.exit(0);
