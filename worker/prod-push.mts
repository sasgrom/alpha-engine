import { runOperationalBackfill, type OperationalPushKind } from "./lib/prod-push";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const kind = option("--kind") as OperationalPushKind | undefined;
if (!kind || !["pricesDaily", "macroPoints", "reportFile"].includes(kind)) throw new Error("--kind pricesDaily|macroPoints|reportFile is required");
const from = option("--from");
if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from must be YYYY-MM-DD");
const result = await runOperationalBackfill({ kind, from, name: option("--name"), reviewed: args.includes("--reviewed") });
console.log(JSON.stringify({ kind, from: from ?? null, result }, null, 2));
