export const EXPECTED_TICKER_REMEDIATION = [
  { cik: 12927, before: "BA-PA", after: "BA" },
  { cik: 886982, before: "GS-PD", after: "GS" },
  { cik: 927628, before: "COF-PN", after: "COF" },
  { cik: 753308, before: "NEE-PW", after: "NEE" },
  { cik: 1375365, before: "SMCIP", after: "SMCI" },
  { cik: 1506307, before: "EP-PC", after: "KMI" },
] as const;

export interface TickerMismatch {
  cik: number;
  ticker: string;
}

export function assertExactRemediationScope(mismatches: TickerMismatch[]): void {
  const actual = [...mismatches].sort((a, b) => a.cik - b.cik).map((row) => `${row.cik}:${row.ticker}`);
  const expected = [...EXPECTED_TICKER_REMEDIATION].sort((a, b) => a.cik - b.cik).map((row) => `${row.cik}:${row.before}`);
  if (mismatches.length !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Ticker mismatch scope changed; expected exactly ${expected.join(", ")}, received ${actual.join(", ") || "none"}`);
  }
}

export function assertOnlyExpectedTickerFieldsChanged(before: any[], after: any[]): number[] {
  if (before.length !== after.length) throw new Error(`Companies row count changed during remediation: ${before.length} -> ${after.length}`);
  const beforeByCik = new Map(before.map((row) => [Number(row.cik), row]));
  const changed: number[] = [];
  for (const row of after) {
    const cik = Number(row.cik);
    const original = beforeByCik.get(cik);
    if (!original) throw new Error(`Unexpected new companies row: ${cik}`);
    const { ticker: beforeTicker, ...beforeRest } = original;
    const { ticker: afterTicker, ...afterRest } = row;
    if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) throw new Error(`Non-ticker field changed for CIK ${cik}`);
    if (beforeTicker !== afterTicker) changed.push(cik);
    beforeByCik.delete(cik);
  }
  if (beforeByCik.size) throw new Error(`Companies rows missing after remediation: ${[...beforeByCik.keys()].join(", ")}`);
  changed.sort((a, b) => a - b);
  const expected = EXPECTED_TICKER_REMEDIATION.map((row) => row.cik).sort((a, b) => a - b);
  if (JSON.stringify(changed) !== JSON.stringify(expected)) throw new Error(`Changed ticker IDs differ from the approved six: ${changed.join(", ")}`);
  return changed;
}
