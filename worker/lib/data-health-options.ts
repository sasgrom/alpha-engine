import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { sql } from "drizzle-orm";
import { dateSql, splitBySymbol } from "./dolthub-export";
import { impliedSpot, parseDoltRow } from "./dolthub-features";
import {
  optionHealthFindings,
  quoteSplitFindings,
  type QuoteSpot,
  type QuarantineEntry,
} from "./data-health";
import { writeJsonAtomic } from "./json-file";

export interface OptionAnalysisResult {
  entries: QuarantineEntry[];
  splits: QuarantineEntry[];
  stats: Record<string, number>;
  strikeSample: {
    basis: string;
    dates: string[];
    rows: any[];
    pass: number;
    failed: number;
  };
}

interface OptionBatch {
  ticker: string;
  year: number;
  file: string;
  status: string;
  snapshots: number;
}
interface OptionManifest {
  schemaVersion: number;
  generatedAt: string;
  batches: OptionBatch[];
}

export async function analyzeOptionHealth(
  db: any
): Promise<OptionAnalysisResult> {
  const root = realpathSync("D:/research/alpha-engine/options-iv-features");
  const manifest = JSON.parse(
    requireJson(path.join(root, "manifest.json"))
  ) as OptionManifest;
  if (manifest.schemaVersion !== 3)
    throw new Error(
      `Expected option feature schema 3, found ${manifest.schemaVersion}`
    );
  const batches = manifest.batches
    .filter(batch => batch.status === "done")
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.year - b.year);
  if (!batches.length) throw new Error("No completed option feature batches");
  const tickers = [...new Set(batches.map(batch => batch.ticker))].sort();
  const quoteRows: QuoteSpot[] = [];
  const findings: QuarantineEntry[] = [];
  const spotByKey = new Map<string, number>();
  const tradeDates = new Set<string>();
  let snapshots = 0,
    buckets = 0,
    missingSchwabClose = 0;
  for (const [tickerIndex, ticker] of tickers.entries()) {
    const priceTicker = ticker.replace(/\./g, "-");
    const [bars]: any = await db.execute(
      sql`SELECT date, close FROM prices WHERE ticker=${priceTicker} AND source='schwab-hist' AND close > 0 ORDER BY date`
    );
    const closes = new Map<string, number>(
      bars.map((row: any): [string, number] => [
        String(row.date).slice(0, 10),
        Number(row.close),
      ])
    );
    for (const batch of batches.filter(
      candidate => candidate.ticker === ticker
    )) {
      const file = path.join(root, batch.ticker, `${batch.year}.jsonl`);
      const lines = createInterface({
        input: createReadStream(file),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (!line) continue;
        const feature = JSON.parse(line);
        const date = String(feature.tradeDate);
        const spot =
          feature.spot === null || feature.spot === undefined
            ? null
            : Number(feature.spot);
        snapshots++;
        tradeDates.add(date);
        if (spot !== null) spotByKey.set(`${ticker}|${date}`, spot);
        findings.push(
          ...optionHealthFindings({
            ticker,
            date,
            spot,
            spotSource: feature.spotSource ?? null,
            atmIv: 0.1,
          })
        );
        const close = closes.get(date);
        if (spot !== null && close)
          quoteRows.push({ ticker, date, spot, schwabClose: close });
        else if (!close) missingSchwabClose++;
        for (const bucket of feature.buckets ?? []) {
          buckets++;
          findings.push(
            ...optionHealthFindings({
              ticker,
              date,
              spot: 1,
              spotSource: "put-call parity",
              atmIv:
                bucket.atmIv === null || bucket.atmIv === undefined
                  ? null
                  : Number(bucket.atmIv),
            })
          );
        }
      }
    }
    if ((tickerIndex + 1) % 50 === 0 || tickerIndex === tickers.length - 1)
      console.log(
        `[data-health options ${tickerIndex + 1}/${tickers.length}] snapshots=${snapshots} findings=${findings.length}`
      );
  }
  const splitResult = quoteSplitFindings(quoteRows);
  const monthFirst = new Map<string, string>();
  for (const date of [...tradeDates].sort()) {
    const month = date.slice(0, 7);
    if (!monthFirst.has(month)) monthFirst.set(month, date);
  }
  const latest = [...tradeDates].sort().at(-1)!;
  const sampleDates = [...new Set([...monthFirst.values(), latest])].sort();
  const doltRoot = realpathSync("D:/research/dolt/options");
  if (!existsSync(path.join(doltRoot, ".dolt")))
    throw new Error("Dolt clone is unavailable");
  execFileSync("dolt", ["version"], { cwd: doltRoot, encoding: "utf8" });
  const strikeRows: any[] = [];
  const strikeFindings: QuarantineEntry[] = [];
  for (const [index, date] of sampleDates.entries()) {
    const groups = splitBySymbol(
      execFileSync("dolt", ["sql", "-q", dateSql(date, tickers), "-r", "csv"], {
        cwd: doltRoot,
        encoding: "utf8",
        maxBuffer: 1024 ** 3,
      })
    );
    for (const [ticker, lines] of groups) {
      const info = impliedSpot(lines.map(parseDoltRow));
      const featureSpot = spotByKey.get(`${ticker}|${date}`) ?? null;
      if (!info || info.strike === undefined || featureSpot === null) {
        strikeFindings.push(
          ...optionHealthFindings({
            ticker,
            date,
            spot: featureSpot,
            spotSource: featureSpot === null ? null : "put-call parity",
            atmIv: 0.1,
            atmStrike: null,
          })
        );
        strikeRows.push({
          ticker,
          date,
          pass: false,
          reason: "strike_not_computable",
          featureSpot,
        });
        continue;
      }
      const issues = optionHealthFindings({
        ticker,
        date,
        spot: info.price,
        spotSource: "put-call parity",
        atmIv: 0.1,
        atmStrike: info.strike,
      });
      strikeFindings.push(...issues);
      strikeRows.push({
        ticker,
        date,
        paritySpot: info.price,
        featureSpot,
        atmStrike: info.strike,
        relativeDifference: Math.abs(info.strike / info.price - 1),
        pass: issues.length === 0,
      });
    }
    if ((index + 1) % 12 === 0 || index === sampleDates.length - 1)
      console.log(
        `[data-health strike ${index + 1}/${sampleDates.length}] ${date}`
      );
  }
  const splits = splitResult.splits;
  return {
    entries: [
      ...findings,
      ...splitResult.findings,
      ...strikeFindings,
      ...splits,
    ],
    splits,
    stats: {
      snapshots,
      buckets,
      quotePairs: quoteRows.length,
      splitEvents: splits.length,
      splitFindings: splitResult.findings.length,
      missingSchwabClose,
      strikeDates: sampleDates.length,
      strikeChecks: strikeRows.length,
    },
    strikeSample: {
      basis:
        "First option trading day of each month plus the latest date; spot and IV checked on every snapshot",
      dates: sampleDates,
      rows: strikeRows,
      pass: strikeRows.filter(row => row.pass).length,
      failed: strikeRows.filter(row => !row.pass).length,
    },
  };
}

function requireJson(file: string): string {
  return readFileSync(file, "utf8");
}

const optionCheckpointFile = "worker/.runs/data-health-options.checkpoint.json";

async function optionCheckpointInputs(db: any) {
  const manifest = JSON.parse(
    readFileSync(
      "D:/research/alpha-engine/options-iv-features/manifest.json",
      "utf8"
    )
  ) as OptionManifest;
  const [rows]: any = await db.execute(
    sql`SELECT MAX(date) latestDate FROM prices WHERE source='schwab-hist' AND cik=0`
  );
  return {
    featureManifestGeneratedAt: manifest.generatedAt,
    latestSchwabDate: rows[0]?.latestDate
      ? String(rows[0].latestDate).slice(0, 10)
      : null,
  };
}

export async function writeOptionCheckpoint(
  db: any,
  result: OptionAnalysisResult
): Promise<void> {
  writeJsonAtomic(optionCheckpointFile, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: await optionCheckpointInputs(db),
    result,
  });
}

export async function readOptionCheckpoint(
  db: any
): Promise<OptionAnalysisResult | null> {
  if (!existsSync(optionCheckpointFile)) return null;
  try {
    const checkpoint = JSON.parse(readFileSync(optionCheckpointFile, "utf8"));
    if (
      checkpoint.schemaVersion !== 1 ||
      !checkpoint.result?.entries ||
      !checkpoint.result?.strikeSample
    )
      return null;
    const current = await optionCheckpointInputs(db);
    if (JSON.stringify(checkpoint.inputs) !== JSON.stringify(current))
      return null;
    return checkpoint.result as OptionAnalysisResult;
  } catch {
    return null;
  }
}
