import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { evaluateGolden, type GoldenDocument } from "../worker/lib/flash-golden";
import type { ValueRecord } from "../worker/lib/flash-pipeline";

const golden = JSON.parse(readFileSync("docs/engine/tasks/K03-golden.json", "utf8")) as { documents: GoldenDocument[] };
const wanted = new Set(golden.documents.map((document) => `${document.cik}|${document.accessionNo}`));
const file = process.argv.includes("--file") ? process.argv[process.argv.indexOf("--file") + 1] : "D:/research/alpha-engine/engine/flash/values.jsonl";
const rows: ValueRecord[] = [];
const input = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as ValueRecord;
  if (wanted.has(`${row.cik}|${row.releaseAccession}`)) rows.push(row);
}
const result = evaluateGolden(rows, golden.documents);
console.log(JSON.stringify(result, null, 2));
if (result.failed.length || result.total !== 113 || result.passed !== 113) process.exitCode = 1;
