/**
 * Verify stored Alpha Vantage EARNINGS against stored SEC-derived figures. No requests and no database access.
 * Usage: npx tsx scripts/check-alpha-vantage-eps.mts [--ticker AAPL] [--limit N]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkCompany, type AdjustedFigure, type AvQuarter, type CompanyCheck, type GaapFigure, type ReleaseFiling, type SplitEvent } from "../worker/lib/alpha-vantage-eps-check";
import { classifyAnswer } from "../worker/lib/alpha-vantage-earnings";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const earningsRoot = path.resolve(arg("--earnings-root") ?? "D:/research/alpha-engine/estimates/alphavantage/earnings");
const adjustedFile = path.resolve(arg("--adjusted") ?? "D:/research/alpha-engine/engine/adjusted-eps/a8/figures.jsonl");
const fundamentalsRoot = path.resolve(arg("--fundamentals") ?? "D:/research/alpha-engine/fundamentals/standard/v3.1/company");
const eventsRoot = path.resolve(arg("--events") ?? "D:/research/alpha-engine/engine/events");
const pricesRoot = path.resolve(arg("--prices") ?? "D:/research/alpha-engine/prices/std/daily");
const sessionsFile = path.resolve("D:/research/alpha-engine/prices/std/sessions.json");
const sessions = (JSON.parse(readFileSync(sessionsFile, "utf8")) as { sessions: string[] }).sessions;
const outputRoot = path.resolve(arg("--out") ?? "D:/research/alpha-engine/estimates/alphavantage/checks");
for (const root of [earningsRoot, outputRoot]) if (!/^d:/i.test(realpathSync(path.parse(root).root))) throw new Error("Alpha Vantage inputs and outputs must resolve to D:");
if (!existsSync(path.join(earningsRoot, "manifest.json"))) throw new Error("Stored Alpha Vantage manifest is missing");
const only = arg("--ticker")?.toUpperCase();
const limit = arg("--limit") === null ? Number.POSITIVE_INFINITY : Number(arg("--limit"));
if (!(limit > 0)) throw new Error("--limit must be positive");
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const evidence = (file: string) => ({ file, bytes: readFileSync(file).length, sha256: sha256(file) });
const lines = (file: string) => readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const manifestFile = path.join(earningsRoot, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { tickers: Record<string, { cik: number; ticker: string; files: { file: string; sha256: string }[] }> };
const selected = Object.values(manifest.tickers).filter(row => row.files.length && (!only || row.ticker === only)).sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, limit);
if (only && !selected.length) throw new Error(`No stored Alpha Vantage answer for ${only}`);
const selectedCiks = new Set(selected.map(row => row.cik));

const adjusted = new Map<number, AdjustedFigure[]>();
for (const row of lines(adjustedFile) as any[]) {
  const cik = Number(row.cik);
  if (!selectedCiks.has(cik) || !row.quarter || !Number.isFinite(Number(row.quarter.value))) continue;
  const figure: AdjustedFigure = {
    value: Number(row.quarter.value),
    grade: String(row.quarter.grade ?? "unknown"),
    acceptedEt: String(row.acceptedEt),
    accession: String(row.accession),
    source: { periodEnd: String(row.fiscalPeriodEnd), accession: String(row.accession), acceptedEt: String(row.acceptedEt), file: row.quarter.file ?? null, tableIndex: row.quarter.tableIndex ?? null, rowIndex: row.quarter.rowIndex ?? null, laterValues: row.quarter.laterValues ?? [] },
  };
  adjusted.set(cik, [...adjusted.get(cik) ?? [], figure]);
}

const releases = new Map<number, ReleaseFiling[]>();
const eventFiles = readdirSync(eventsRoot).filter(file => /^filings-.*\.jsonl$/.test(file)).sort();
for (const name of eventFiles) {
  for (const row of lines(path.join(eventsRoot, name)) as any[]) {
    const cik = Number(row.cik);
    if (!selectedCiks.has(cik) || row.isEarningsRelease !== true || typeof row.acceptedEt !== "string" || !row.acceptedEt) continue;
    const value = { acceptedEt: row.acceptedEt, accessionNo: String(row.accessionNo ?? row.accession ?? "") };
    releases.set(cik, [...releases.get(cik) ?? [], value]);
  }
}
for (const [cik, rows] of releases) releases.set(cik, [...new Map(rows.map(row => [row.accessionNo, row])).values()]);

function gaapFor(cik: number): { figures: GaapFigure[]; input: ReturnType<typeof evidence> | null } {
  const file = path.join(fundamentalsRoot, `${cik}.json`);
  if (!existsSync(file)) return { figures: [], input: null };
  const document = JSON.parse(readFileSync(file, "utf8")) as { quarters: { end: string }[]; fields: { epsDil?: [number, [string, number, number?][]][] } };
  const figures: GaapFigure[] = [];
  for (const [quarterIndex, observations] of document.fields.epsDil ?? []) {
    const end = document.quarters[quarterIndex]?.end;
    if (!end || !observations.length) continue;
    const ordered = [...observations].sort((a, b) => a[0].localeCompare(b[0]));
    const [filed, value, sourceIndex] = ordered[0];
    if (!Number.isFinite(Number(value))) continue;
    figures.push({ value: Number(value), filed, source: { periodEnd: end, filed, sourceIndex: sourceIndex ?? null, observations: ordered } });
  }
  return { figures, input: evidence(file) };
}
function splitsFor(cik: number): { splits: SplitEvent[]; input: ReturnType<typeof evidence> | null } {
  const file = path.join(pricesRoot, `${cik}.csv`);
  if (!existsSync(file)) return { splits: [], input: null };
  const [header, ...rows] = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const columns = header.split(",");
  const dateIndex = columns.indexOf("date"), splitIndex = columns.indexOf("splitRatio");
  if (dateIndex < 0 || splitIndex < 0) throw new Error(`Standard prices ${cik} have no date/splitRatio columns`);
  const splits = rows.map(row => row.split(",")).filter(cells => cells[splitIndex]).map(cells => ({ date: cells[dateIndex], ratio: Number(cells[splitIndex]) })).filter(row => Number.isFinite(row.ratio) && row.ratio > 0);
  return { splits, input: evidence(file) };
}

const companies: (CompanyCheck & { latestAlphaVantageFile: string })[] = [];
const errors: { ticker: string; cik: number; error: string }[] = [];
const inputs = new Map<string, ReturnType<typeof evidence>>();
inputs.set(manifestFile, evidence(manifestFile));
inputs.set(adjustedFile, evidence(adjustedFile));
inputs.set(sessionsFile, evidence(sessionsFile));
for (const name of eventFiles) inputs.set(path.join(eventsRoot, name), evidence(path.join(eventsRoot, name)));
for (const entry of selected) {
  try {
    const latest = entry.files.at(-1)!;
    const file = path.join(earningsRoot, latest.file);
    const raw = readFileSync(file);
    if (createHash("sha256").update(raw).digest("hex") !== latest.sha256) throw new Error("Latest stored Alpha Vantage file does not match its manifest hash");
    const answer = classifyAnswer(JSON.parse(raw.toString("utf8")));
    if (answer.kind !== "data") throw new Error(`Latest stored answer is ${answer.kind}`);
    const av: AvQuarter[] = answer.quarters.map(row => ({ periodEnd: row.fiscalDateEnding, reportedDate: row.reportedDate, reportedEPS: row.reportedEPS, reportTime: row.reportTime, source: { file: latest.file, sha256: latest.sha256 } }));
    const gaap = gaapFor(entry.cik), split = splitsFor(entry.cik);
    if (gaap.input) inputs.set(gaap.input.file, gaap.input);
    if (split.input) inputs.set(split.input.file, split.input);
    inputs.set(file, evidence(file));
    companies.push({ ...checkCompany({ cik: entry.cik, ticker: entry.ticker, alphaVantage: av, adjusted: adjusted.get(entry.cik) ?? [], gaap: gaap.figures, releases: releases.get(entry.cik) ?? [], splits: split.splits, sessions }), latestAlphaVantageFile: latest.file });
  } catch (error) {
    errors.push({ ticker: entry.ticker, cik: entry.cik, error: String(error).slice(0, 500) });
  }
}

const comparisons = companies.flatMap(company => company.comparisons);
const dates = companies.flatMap(company => company.dateChecks);
const series = (name: "adjusted" | "gaap") => {
  const rows = comparisons.filter(row => row.series === name), exact = rows.filter(row => row.matchType === "exact");
  const best = (items: typeof rows) => items.length ? items.filter(row => row.bestMatch).length / items.length : null;
  return { comparable: rows.length, exactComparable: exact.length, nearComparable: rows.length - exact.length, exactBestBasisAgreementShare: best(exact), originalAgreementShare: rows.length ? rows.filter(row => row.originalMatch).length / rows.length : null, restatedAgreementShare: rows.length ? rows.filter(row => row.restatedMatch).length / rows.length : null, bestBasisAgreementShare: best(rows), disagreements: rows.filter(row => !row.bestMatch).length };
};
const oneSidedRows = companies.flatMap(company => company.oneSided), exactOneSidedRows = companies.flatMap(company => company.oneSidedExact);
const oneSidedSummary = (rows: typeof oneSidedRows) => ({
  alphaVantage: rows.filter(row => row.side === "alphaVantage").length,
  ours: rows.filter(row => row.side === "ours").length,
  reasons: Object.fromEntries([...new Set(rows.map(row => row.reason))].sort().map(reason => [reason, rows.filter(row => row.reason === reason).length])),
});
const dateBands = ["pre-market", "market-hours", "post-market", "no release"] as const;
const offsetKey = (value: number | null) => value === null ? "no release" : [-2, -1, 0, 1, 2].includes(value) ? String(value) : "other";
const dateOffsetDistribution = Object.fromEntries(dateBands.map(band => [band, Object.fromEntries(["-2", "-1", "0", "1", "2", "other", "no release"].map(offset => [offset, dates.filter(row => (row.releaseTimeBand ?? "no release") === band && offsetKey(row.dateOffsetDays) === offset).length]))]));
const nonMatchingDates = dates.filter(row => !row.dateMatch), conventionalDates = nonMatchingDates.filter(row => row.nextSessionPostCloseConvention);
const summary = {
  tickers: selected.length,
  checked: companies.length,
  errors: errors.length,
  adjusted: series("adjusted"),
  gaap: series("gaap"),
  dates: {
    quarters: dates.length,
    sameNewYorkDateShare: dates.length ? dates.filter(row => row.dateMatch).length / dates.length : null,
    reportTimeGradable: dates.filter(row => row.timeMatch !== null).length,
    reportTimeAgreementShare: dates.some(row => row.timeMatch !== null) ? dates.filter(row => row.timeMatch === true).length / dates.filter(row => row.timeMatch !== null).length : null,
    offsetDefinition: "AV reportedDate minus nearest our-release New York date, in calendar days; bands use acceptance time",
    offsetDistribution: dateOffsetDistribution,
    nextSessionPostCloseConvention: conventionalDates.length,
    unexplainedNonMatchingDates: nonMatchingDates.length - conventionalDates.length,
    unexplainedShareOfNonMatching: nonMatchingDates.length ? (nonMatchingDates.length - conventionalDates.length) / nonMatchingDates.length : null,
  },
  disagreements: companies.reduce((sum, company) => sum + company.disagreements.length, 0),
  oneSided: oneSidedSummary(oneSidedRows),
  oneSidedExact: oneSidedSummary(exactOneSidedRows),
  basis: Object.fromEntries([...new Set(companies.map(company => company.basis.inferred))].map(kind => [kind, companies.filter(company => company.basis.inferred === kind).length])),
};
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
mkdirSync(outputRoot, { recursive: true });
const dateExamples = companies.flatMap(company => company.dateDisagreements.map(row => ({ cik: company.cik, ticker: company.ticker, ...row }))).slice(0, 20);
const output = { schemaVersion: 2, generatedAt: new Date().toISOString(), method: { periodMatch: "exact plus one-to-one nearest first within 10 calendar days per series; no fiscal labels", agreement: "absolute <= $0.01 or relative <= 1% of our figure", originalBasis: "stored SEC-derived figure", restatedBasis: "figure divided by positive standard-price splitRatio events after its acceptance/filing date", inferredBasisRule: "split-affected adjusted figures preferred; >=80% and strictly above the other basis, otherwise mixed/indistinguishable", dateZone: "America/New_York", preMarket: "before 09:30 New York", postMarket: "16:00 or later New York", nextSession: "standard session calendar", alphaVantageSnapshots: "latest hash-verified stored answer per ticker" }, summary, dateExamples, inputs: [...inputs.values()], errors, companies };
const jsonFile = path.join(outputRoot, `${stamp}.json`);
const markdownFile = path.join(outputRoot, `${stamp}.md`);
writeAtomic(jsonFile, JSON.stringify(output, null, 1) + "\n");
const share = (value: number | null) => value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
const markdown = [
  "# Alpha Vantage EPS verification", "", `Generated ${output.generatedAt}. Stored files only; no Alpha Vantage request or database write.`, "",
  `- Tickers checked: ${companies.length}/${selected.length}; errors: ${errors.length}`,
  `- Adjusted comparable: ${summary.adjusted.comparable} (exact ${summary.adjusted.exactComparable}, near ${summary.adjusted.nearComparable}); original ${share(summary.adjusted.originalAgreementShare)}; restated ${share(summary.adjusted.restatedAgreementShare)}; best basis ${share(summary.adjusted.bestBasisAgreementShare)}; exact-only best ${share(summary.adjusted.exactBestBasisAgreementShare)}.`,
  `- GAAP comparable: ${summary.gaap.comparable} (exact ${summary.gaap.exactComparable}, near ${summary.gaap.nearComparable}); original ${share(summary.gaap.originalAgreementShare)}; restated ${share(summary.gaap.restatedAgreementShare)}; best basis ${share(summary.gaap.bestBasisAgreementShare)}; exact-only best ${share(summary.gaap.exactBestBasisAgreementShare)}.`,
  `- Same New York release date: ${share(summary.dates.sameNewYorkDateShare)}; report-time agreement on ${summary.dates.reportTimeGradable} gradable quarters: ${share(summary.dates.reportTimeAgreementShare)}. Next-session post-close convention explains ${summary.dates.nextSessionPostCloseConvention} mismatches; ${summary.dates.unexplainedNonMatchingDates} remain (${share(summary.dates.unexplainedShareOfNonMatching)} of non-matches). Offset/band counts and 20 sourced examples are in JSON.`,
  `- Disagreements: ${summary.disagreements}; near-matched one-sided AV/ours: ${summary.oneSided.alphaVantage}/${summary.oneSided.ours}; exact-only ${summary.oneSidedExact.alphaVantage}/${summary.oneSidedExact.ours}. Reasons and every source are in the JSON.`, "",
  "| Ticker | Adjusted comparable | Adjusted best | GAAP comparable | GAAP best | Inferred AV basis | Disagreements | One-sided |",
  "|---|---:|---:|---:|---:|---|---:|---:|",
  ...companies.map(company => {
    const adjustedRows = company.comparisons.filter(row => row.series === "adjusted"), gaapRows = company.comparisons.filter(row => row.series === "gaap");
    const best = (rows: typeof comparisons) => rows.length ? share(rows.filter(row => row.bestMatch).length / rows.length) : "n/a";
    return `| ${company.ticker} | ${adjustedRows.length} | ${best(adjustedRows)} | ${gaapRows.length} | ${best(gaapRows)} | ${company.basis.inferred} | ${company.disagreements.length} | ${company.oneSided.length} |`;
  }), "",
  errors.length ? `## Errors\n\n${errors.map(row => `- ${row.ticker} (${row.cik}): ${row.error}`).join("\n")}` : "No company-level input errors.",
];
writeAtomic(markdownFile, markdown.join("\n") + "\n");
console.log(JSON.stringify({ jsonFile, markdownFile, summary }, null, 1));

function writeAtomic(file: string, body: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, body, { flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
