/** Filing pipelines process each CIK once; a current ticker wins over a _PRE alias. */
export function dedupeExpectationUniverse<T extends { cik: number; ticker: string }>(companies: T[]): T[] {
  const byCik = new Map<number, T>();
  for (const company of companies) {
    const previous = byCik.get(company.cik);
    if (!previous || (previous.ticker.endsWith("_PRE") && !company.ticker.endsWith("_PRE"))) byCik.set(company.cik, company);
  }
  return [...byCik.values()];
}
