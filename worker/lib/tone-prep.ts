import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { derivePlaintext, extractScorableText, isEightKForm, isThinContent, mdaWindows } from "./edgar";
import type { ManifestEntry } from "../edgar-fetch.mts";

export const THIN_SKIP = "thin content (cover/TOC/XBRL header)";
export const CACHE_SKIP = "cache file unreadable";

export type TonePreparation =
  | { ok: true; windows: string[]; chars: number; plainChars: number; scorableChars: number }
  | { ok: false; reason: typeof THIN_SKIP | typeof CACHE_SKIP };

/** CPU-only preparation shared by scoring and the read-only audit. */
export function prepareToneFiling(companyCacheDir: string, m: ManifestEntry): TonePreparation {
  const base = m.accessionNo.replace(/-/g, "");
  const exPath = path.join(companyCacheDir, `${base}.ex.htm`);
  const file = isEightKForm(m.form) && m.exFile && existsSync(exPath)
    ? exPath
    : path.join(companyCacheDir, `${base}.htm`);
  let plain: string;
  try {
    plain = derivePlaintext(readFileSync(file, "utf8"));
  } catch {
    return { ok: false, reason: CACHE_SKIP };
  }
  const scorable = extractScorableText(plain, m.form);
  if (isThinContent(scorable)) return { ok: false, reason: THIN_SKIP };
  const windows = mdaWindows(scorable);
  return {
    ok: true,
    windows,
    chars: windows.reduce((sum, w) => sum + w.length, 0),
    plainChars: plain.length,
    scorableChars: scorable.length,
  };
}
