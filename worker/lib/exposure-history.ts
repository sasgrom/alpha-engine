import type { ExposureFiling, ExposureMeasureKind } from "./exposure-aggregation";
import type { XbrlFact } from "./xbrl-exposure";

export interface ExposureHistoryRow {
  cik: number;
  ticker: string;
  accessionNo: string;
  form: string;
  filingDate: string;
  availableAt: string;
  measure: ExposureMeasureKind;
  value: number;
  unit: "USD" | "ratio";
  periodStart: string | null;
  periodEnd: string;
  note: string | null;
  sourceUrl: string;
  sourceHash: string;
  facts: XbrlFact[];
}

export function exposureHistoryRows(filing: ExposureFiling, sourceUrl: string, sourceHash: string): ExposureHistoryRow[] {
  return filing.measures.map(measure => {
    assertHistoryAvailability({ ticker: filing.ticker, accessionNo: filing.accessionNo, filingDate: filing.filingDate, availableAt: measure.availableAt });
    return {
      cik: filing.cik,
      ticker: filing.ticker,
      accessionNo: filing.accessionNo,
      form: filing.form,
      filingDate: filing.filingDate,
      availableAt: filing.filingDate,
      measure: measure.kind,
      value: measure.value,
      unit: measure.unit,
      periodStart: measure.periodStart,
      periodEnd: measure.periodEnd,
      note: measure.note ?? null,
      sourceUrl,
      sourceHash,
      facts: measure.facts,
    };
  });
}

export function assertHistoryAvailability(row: Pick<ExposureHistoryRow, "availableAt" | "filingDate" | "ticker" | "accessionNo">): void {
  if (row.availableAt < row.filingDate) throw new Error(`Availability precedes filing: ${row.ticker} ${row.accessionNo}`);
}

export function parseExposureHistory(jsonl: string): ExposureFiling[] {
  const filings = new Map<string, ExposureFiling>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as ExposureHistoryRow;
    assertHistoryAvailability(row);
    const key = `${row.cik}|${row.accessionNo}`;
    let filing = filings.get(key);
    if (!filing) {
      filing = { cik: row.cik, ticker: row.ticker, accessionNo: row.accessionNo, form: row.form, filingDate: row.filingDate, sourceUrl: row.sourceUrl, sourceHash: row.sourceHash, measures: [], missing: [] };
      filings.set(key, filing);
    }
    if (filing.sourceHash !== row.sourceHash || filing.filingDate !== row.filingDate) throw new Error(`Conflicting filing identity: ${row.ticker} ${row.accessionNo}`);
    if (filing.measures.some(measure => measure.kind === row.measure)) throw new Error(`Duplicate exposure measure: ${row.ticker} ${row.accessionNo} ${row.measure}`);
    filing.measures.push({ kind: row.measure, value: row.value, unit: row.unit, periodStart: row.periodStart, periodEnd: row.periodEnd, availableAt: row.availableAt, facts: row.facts, ...(row.note ? { note: row.note } : {}) });
  }
  return [...filings.values()].sort((a, b) => a.ticker.localeCompare(b.ticker) || a.filingDate.localeCompare(b.filingDate) || a.accessionNo.localeCompare(b.accessionNo));
}
