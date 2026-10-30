import type { ManifestEntry } from "../edgar-fetch.mts";

/** Latest primary 10-K, 10-Q and exhibit-bearing 8-K per company for a bounded smoke run. */
export function selectLatestFilings(entries: ManifestEntry[]): ManifestEntry[] {
  const selected: ManifestEntry[] = [];
  for (const form of ["10-K", "10-Q", "8-K"] as const) {
    const candidates = entries.filter((entry) => entry.fetched && entry.form === form && (form !== "8-K" || entry.exhibitFiles?.length || entry.exFile));
    const latest = candidates.sort((a, b) => `${a.filingDate} ${a.eventTs} ${a.accessionNo}`.localeCompare(`${b.filingDate} ${b.eventTs} ${b.accessionNo}`)).at(-1);
    if (latest) selected.push(latest);
  }
  return selected;
}
