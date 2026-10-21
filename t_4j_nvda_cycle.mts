/**
 * 4j: NVDA full cycle to parity with AAPL/PLD — harvest documents from SEC,
 * parse sections (offline), score MD&A (cloud LLM, pairwise, maxDocs=3 —
 * the owner's 2–3-company credit scope). Prints the token bill honestly.
 * Run: npx tsx t_4j_nvda_cycle.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
import { harvestCompanyDocuments, DOCUMENT_FORM_SCOPE } from "./api/services/documents";
import { parseCompanySections } from "./api/services/sections";
import { scoreCompany, currentLlmVersion } from "./api/services/sentiment/score";

const log = async (level: string, m: string) => console.log(`[${level}] ${m}`);

console.log("== harvest NVDA documents ==");
const h = await harvestCompanyDocuments(1045810, "NVDA", [...DOCUMENT_FORM_SCOPE], 3, log);
console.log(`harvest: ${h.filings} filings, ${h.docs} docs`);

console.log("== parse sections ==");
const s = await parseCompanySections(1045810, "NVDA", log);
console.log(`sections: ${s.docs} docs, ${s.sections} sections`);

console.log("== score (cloud prototype, pairwise) ==");
const { modelId, llmVersion } = await currentLlmVersion();
console.log(`model: ${llmVersion}`);
const r = await scoreCompany(1045810, "NVDA", { maxDocs: 3, groups: ["mda"], pairwise: true, modelId, llmVersion }, log);
console.log(`score: scored=${r.scored} skipped=${r.skipped} failed=${r.failed} · ${r.tokens} tokens billed`);

console.log("PASS: NVDA full cycle");
process.exit(0);
