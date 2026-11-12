import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeJsonAtomic } from "../worker/lib/json-file";

const report = JSON.parse(
  readFileSync("public/reports/data-health.json", "utf8")
);
const quarantine = JSON.parse(
  readFileSync("research/engine/quarantine.json", "utf8")
);
const markdown = readFileSync("public/reports/data-health.md", "utf8");
const byId = new Map(report.checks.map((row: any) => [row.id, row]));
const expectation = byId.get("expectation_evidence") as any;
const gaps = byId.get("gaps") as any;
const snapshot = byId.get("snapshot_health") as any;
const splits = byId.get("splits_from_quotes") as any;
const nonAdditive = byId.get("non_additive") as any;
const checks = [
  {
    name: "ten_checks",
    pass: report.checks.length === 10,
    actual: report.checks.length,
  },
  {
    name: "runtime_under_15_minutes",
    pass: report.elapsedMs < 900000,
    actual: report.elapsedMs,
  },
  {
    name: "complete",
    pass: report.status === "complete",
    actual: report.status,
  },
  {
    name: "entry_count",
    pass:
      quarantine.entries.length === report.summary.findings &&
      quarantine.entries.length === quarantine.summary.findings,
    actual: quarantine.entries.length,
  },
  {
    name: "23_gap_series",
    pass:
      gaps.findings >= 23 &&
      gaps.chtr.actual === 25 &&
      JSON.stringify(gaps.chtr.first) ===
        JSON.stringify([
          "2009-12-07",
          "2009-12-21",
          "2009-12-22",
          "2009-12-23",
          "2009-12-28",
        ]),
    actual: { series: gaps.findings, chtr: gaps.chtr },
  },
  {
    name: "aapl_derived_fixed",
    pass: nonAdditive.examined.includes("AAPL derived quarters after K08: 0"),
    actual: nonAdditive.examined,
  },
  {
    name: "tmus_txn",
    pass:
      quarantine.entries.some((row: any) => row.key === "1283699|2006-09-30") &&
      quarantine.entries.some(
        (row: any) => row.key === "97476|0001140361-10-029984"
      ),
    actual: "present",
  },
  {
    name: "accepted_pg_bny",
    pass:
      quarantine.entries.filter(
        (row: any) => row.key === "PG|1987-10-19" && row.severity === "info"
      ).length === 1 &&
      quarantine.entries.filter(
        (row: any) => row.key.startsWith("BNY|") && row.severity === "info"
      ).length === 8,
    actual: "PG 1, BNY 8",
  },
  {
    name: "old_high_low_22",
    pass:
      quarantine.entries.filter(
        (row: any) => row.source === "stooq-2026-10-26-dump"
      ).length === 22,
    actual: quarantine.entries.filter(
      (row: any) => row.source === "stooq-2026-10-26-dump"
    ).length,
  },
  {
    name: "required_quote_splits",
    pass:
      splits.splitTable.some(
        (row: any) => row.key === "AAPL|2020-08-31" && row.evidence.ratio === 4
      ) &&
      splits.splitTable.some(
        (row: any) => row.key === "NVDA|2024-06-10" && row.evidence.ratio === 10
      ),
    actual: "AAPL 4, NVDA 10",
  },
  {
    name: "expectation_evidence",
    pass:
      expectation.companies.reduce(
        (sum: number, row: any) => sum + row.rejectedStatements,
        0
      ) === 6787 && expectation.examples.length > 0,
    actual: expectation.companies.reduce(
      (sum: number, row: any) => sum + row.rejectedStatements,
      0
    ),
  },
  {
    name: "all_option_snapshots",
    pass: snapshot.examined.includes("610034"),
    actual: snapshot.examined,
  },
  {
    name: "strike_sample",
    pass:
      snapshot.strikeSample.dates.length >= 80 &&
      snapshot.strikeSample.pass + snapshot.strikeSample.failed ===
        snapshot.strikeSample.checks,
    actual: {
      dates: snapshot.strikeSample.dates.length,
      checks: snapshot.strikeSample.checks,
      pass: snapshot.strikeSample.pass,
      failed: snapshot.strikeSample.failed,
    },
  },
  {
    name: "markdown_required_evidence",
    pass: [
      "PG|1987-10-19",
      "BNY|1992-01-17",
      "AAPL|2020-08-31",
      "NVDA|2024-06-10",
      "1283699|2006-09-30",
      "97476|0001140361-10-029984",
    ].every(value => markdown.includes(value)),
    actual: "required strings",
  },
];
const files = [
  "public/reports/data-health.json",
  "public/reports/data-health.md",
  "research/engine/quarantine.json",
];
const hashes = files.map(file => ({
  file,
  sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  bytes: readFileSync(file).length,
}));
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: checks.every(row => row.pass) ? "pass" : "failed",
  checks,
  files: hashes,
  productionWrite: false,
  databaseWrite: false,
};
writeJsonAtomic("research/engine/data-health-verification.json", result, true);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "pass") process.exitCode = 1;
