/**
 * Where a scheduled refresh has published a research standard. A refresh writes a pointer file naming the build
 * folder that passed its gates; a builder that is not told a folder follows the pointer. Before the first refresh
 * there is no pointer and the build accepted by hand (the fallback) is used.
 */
import { existsSync, readFileSync } from "node:fs";

export function publishedStandardDir(pointerFile: string, fallback: string): string {
  if (!existsSync(pointerFile)) return fallback;
  const pointer = JSON.parse(readFileSync(pointerFile, "utf8")) as { dir?: unknown };
  if (typeof pointer.dir !== "string" || !pointer.dir.trim()) throw new Error(`${pointerFile} names no build folder`);
  if (!existsSync(pointer.dir)) throw new Error(`${pointerFile} names ${pointer.dir}, which is not there (is the D: drive away?)`);
  return pointer.dir;
}
