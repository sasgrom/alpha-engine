import { assertOperationalServerEvidence, runOperationalBackfill, type OperationalPushKind } from "./lib/prod-push";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

async function main() {
  try {
    const kind = option("--kind") as OperationalPushKind | undefined;
    if (!kind || !["pricesDaily", "macroPoints", "reportFile", "signals", "digests"].includes(kind)) throw new Error("--kind pricesDaily|macroPoints|reportFile|signals|digests is required");
    const from = option("--from");
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from must be YYYY-MM-DD");
    const result = await runOperationalBackfill({ kind, from, name: option("--name"), reviewed: args.includes("--reviewed") });
    const serverEvidence = assertOperationalServerEvidence(result);
    console.log(`PROD_PUSH_OK ${JSON.stringify({ kind, from: from ?? null, serverEvidence })}`);
  } catch (error) {
    console.error(`PROD_PUSH_FAILED ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
