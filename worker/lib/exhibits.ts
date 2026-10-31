import type { FilingDocItem } from "./edgar";
import type { ExpectationResponse } from "./expectations";

export function selectSubstantiveExhibits(docs: FilingDocItem[], primaryDoc: string | null): FilingDocItem[] {
  const textual = docs.filter((doc) => /\.(?:htm|txt)$/i.test(doc.name) && !/^index/i.test(doc.name) && doc.name !== primaryDoc && doc.size > 2000);
  const ex99 = textual.filter((doc) => /ex(?:hibit)?[-_a-z0-9]*99/i.test(doc.name));
  if (ex99.length) return ex99.sort((a, b) => b.size - a.size);
  const largest = textual.sort((a, b) => b.size - a.size)[0];
  return largest && largest.size > 20_000 ? [largest] : [];
}

export function exhibitCacheName(accessionNo: string, docName: string): string {
  const base = accessionNo.replace(/-/g, "");
  const safe = docName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^\.+|\.+$/g, "");
  if (!safe || safe === "." || safe === "..") throw new Error(`Unsafe exhibit name ${docName}`);
  return `${base}.ex-${safe}`;
}

export function mergeGuidanceStatus(values: (ExpectationResponse["guidanceStatus"] | null)[]): ExpectationResponse["guidanceStatus"] | null {
  if (values.includes("found")) return "found";
  if (values.includes("deferred_to_call")) return "deferred_to_call";
  if (values.includes("explicitly_not_provided")) return "explicitly_not_provided";
  if (values.includes("not_found")) return "not_found";
  return null;
}
