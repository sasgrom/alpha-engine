import { existsSync, readFileSync, realpathSync } from "node:fs";
import unzipper from "unzipper";
import type { QuarantineEntry } from "./data-health";

interface ArchivePair {
  date: string;
  before: number;
  after: number;
  ratio: number;
}
export interface ArchiveStep extends ArchivePair {
  previousDate: string;
  previousRatio: number;
  step: number;
}
export function archiveSteps(pairs: ArchivePair[]): ArchiveStep[] {
  const sorted = [...pairs].sort((a, b) => a.date.localeCompare(b.date));
  return sorted
    .slice(1)
    .map((row, index) => ({
      ...row,
      previousDate: sorted[index].date,
      previousRatio: sorted[index].ratio,
      step: row.ratio / sorted[index].ratio - 1,
    }));
}

function bars(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map(line => {
      const p = line.split(",");
      return {
        date: `${p[2].slice(0, 4)}-${p[2].slice(4, 6)}-${p[2].slice(6, 8)}`,
        close: Number(p[7]),
      };
    })
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close > 0);
}
function compare(
  beforeRows: { date: string; close: number }[],
  afterRows: { date: string; close: number }[]
): ArchivePair[] {
  const before = new Map(beforeRows.map(row => [row.date, row.close]));
  return afterRows
    .flatMap(row =>
      before.has(row.date)
        ? [
            {
              date: row.date,
              before: before.get(row.date)!,
              after: row.close,
              ratio: row.close / before.get(row.date)!,
            },
          ]
        : []
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function acceptedPriceHistory(): Promise<{
  entries: QuarantineEntry[];
  summary: {
    pgSteps: number;
    bnySteps: number;
    highLow: number;
    acceptanceFiles: string[];
  };
}> {
  const oldDumpSummaryPath =
    "research/engine/price-load-stooq-2026-10-27.summary.json";
  const oldDump = JSON.parse(readFileSync(oldDumpSummaryPath, "utf8"));
  if (
    !Array.isArray(oldDump.quality?.highLow) ||
    oldDump.quality.highLow.length !== 22
  )
    throw new Error(
      "Expected the 22 reviewed high-below-low rows in the 2026-10-27 summary"
    );
  const historical = oldDump.quality.highLow.map(
    (row: any): QuarantineEntry => ({
      source: "stooq-2026-10-26-dump",
      key: `${row.ticker}|${row.date}`,
      check: "bars",
      severity: "quarantine",
      since: oldDump.generatedAt,
      evidence: {
        ...row,
        reason: "high_below_low",
        archiveSummary: oldDumpSummaryPath,
        archiveSha256: oldDump.archive.sha256,
        currentArchive: "2026-11-10",
      },
    })
  );
  const oldZip = realpathSync("D:/stooq data 102726/d_us_txt.zip");
  if (!existsSync(oldZip))
    throw new Error("The accepted Stooq archive is unavailable");
  const archive = await unzipper.Open.file(oldZip);
  const entries: QuarantineEntry[] = [];
  for (const [ticker, oldPath, newPath, acceptancePath] of [
    [
      "PG",
      "data/daily/us/nyse stocks/2/pg.us.txt",
      "D:/stooq data 111126/data/daily/us/nyse stocks/2/pg.us.txt",
      "research/engine/price-load-stooq-2026-11-10.pg-accepted.summary.json",
    ],
    [
      "BNY",
      "data/daily/us/nyse stocks/1/bny.us.txt",
      "D:/stooq data 111126/data/daily/us/nyse stocks/1/bny.us.txt",
      "research/engine/price-load-stooq-2026-11-10.bny-accepted.summary.json",
    ],
  ] as const) {
    const acceptance = JSON.parse(readFileSync(acceptancePath, "utf8"));
    const held = acceptance.held.find((row: any) => row.ticker === ticker);
    if (
      !held?.acceptedByOwner ||
      !acceptance.mode.acceptedByOwner.includes(ticker)
    )
      throw new Error(`Missing owner acceptance for ${ticker}`);
    const source = archive.files.find((file: any) => file.path === oldPath);
    if (!source)
      throw new Error(`Missing ${ticker} in the accepted old Stooq archive`);
    const oldBars = bars((await source.buffer()).toString("utf8"));
    const newBars = bars(readFileSync(realpathSync(newPath), "utf8"));
    const steps = archiveSteps(compare(oldBars, newBars)).filter(row =>
      ticker === "PG"
        ? row.step > 0.15
        : row.date >= "1989-01-01" && row.date <= "1995-12-31" && row.step > 0.1
    );
    for (const row of steps)
      entries.push({
        source: "stooq-archive-review",
        key: `${ticker}|${row.date}`,
        check: "two_sources_one_story",
        severity: "info",
        since: acceptance.generatedAt,
        evidence: {
          ...row,
          reviewed: true,
          acceptedByOwner: true,
          acceptanceFile: acceptancePath,
          acceptanceGeneratedAt: acceptance.generatedAt,
          oldArchiveSha256: oldDump.archive.sha256,
          newArchiveSha256: acceptance.archive.usedFilesSha256,
        },
      });
  }
  const pgSteps = entries.filter(row => row.key.startsWith("PG|")).length;
  const bnySteps = entries.filter(row => row.key.startsWith("BNY|")).length;
  if (pgSteps !== 1 || bnySteps !== 8)
    throw new Error(
      `Unexpected accepted step counts: PG=${pgSteps}, BNY=${bnySteps}`
    );
  return {
    entries: [...historical, ...entries],
    summary: {
      pgSteps,
      bnySteps,
      highLow: historical.length,
      acceptanceFiles: [
        oldDumpSummaryPath,
        "research/engine/price-load-stooq-2026-11-10.pg-accepted.summary.json",
        "research/engine/price-load-stooq-2026-11-10.bny-accepted.summary.json",
      ],
    },
  };
}
