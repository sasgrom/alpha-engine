export function accessionMatches(source: { accessionNo: string }, accessionNo: string | null): boolean {
  return accessionNo === null || source.accessionNo === accessionNo;
}

export function assertAccessionTasks(tasks: unknown[], accessionNo: string | null): void {
  if (accessionNo && tasks.length === 0) throw new Error(`No cohort sources found for accession ${accessionNo}`);
}

export function shouldResumeCohortEntry(entry: { status: string }, retryFallback: boolean): boolean {
  if (entry.status === "request_failed" || entry.status === "unparsed") return false;
  if (retryFallback && (entry.status === "fallback" || entry.status === "fallback_unverified")) return false;
  return true;
}
