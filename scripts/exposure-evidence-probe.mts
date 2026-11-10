/** Probe fresh SEC companyfacts for exposure evidence before changing canonical mappings. */
import path from "node:path";
import { companyFacts, loadEdgarUniverse } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const PILOTS = ["DAL", "RCL", "CVX", "COP", "PFE"] as const;
const PATTERN = /OilAndGas|CrudeOil|NaturalGas|Fuel|EnergyRelated|ForeignCurrency|GeographicAreasRevenue|ForeignOperations|InternationalRevenue|Domicile|LongTermDebt|DebtInstrument|InterestExpense|InterestRate|Maturities|FixedRate|VariableRate|FloatingRate/i;
interface Candidate { concept: string; taxonomy: string; units: string[]; recentRecords: number; latest: { end: string; filed?: string; form?: string; val?: number; start?: string } | null }
const universe = loadEdgarUniverse("research-universe-50.json");
const prog = startProgress("exposure-evidence-probe", "fresh SEC companyfacts · no mapping changes");
const output: Record<string, Candidate[]> = {};
for (const [index, ticker] of PILOTS.entries()) {
  const company = universe.find((item) => item.ticker === ticker);
  if (!company) throw new Error(`Missing pilot ${ticker}`);
  const payload = await companyFacts(company.cik);
  const candidates: Candidate[] = [];
  for (const [taxonomy, concepts] of Object.entries<any>(payload.facts ?? {})) {
    for (const [concept, body] of Object.entries<any>(concepts)) {
      if (!PATTERN.test(concept)) continue;
      const records = Object.values<any>(body.units ?? {}).flat().filter((record: any) => record.end >= "2023-01-01");
      if (!records.length) continue;
      records.sort((a: any, b: any) => b.end.localeCompare(a.end) || String(b.filed ?? "").localeCompare(String(a.filed ?? "")));
      const latest = records[0];
      candidates.push({ concept, taxonomy, units: Object.keys(body.units ?? {}), recentRecords: records.length, latest: { end: latest.end, filed: latest.filed, form: latest.form, val: latest.val, start: latest.start } });
    }
  }
  candidates.sort((a, b) => (b.latest?.end ?? "").localeCompare(a.latest?.end ?? "") || a.concept.localeCompare(b.concept));
  output[ticker] = candidates;
  prog.item(index + 1, PILOTS.length, `${ticker} · ${candidates.length} candidate concepts`);
}
writeJsonAtomic(path.resolve("public/reports/exposure-evidence-probe.json"), { schemaVersion: 1, generatedAt: new Date().toISOString(), candidates: output }, true);
for (const ticker of PILOTS) {
  console.log(`\n${ticker}`);
  for (const candidate of output[ticker].slice(0, 35)) console.log(`${candidate.latest?.end} · ${candidate.concept} · ${candidate.units.join("/")} · ${candidate.latest?.form} · ${candidate.latest?.val}`);
}
prog.done("probe public/reports/exposure-evidence-probe.json");
