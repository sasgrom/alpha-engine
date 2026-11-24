import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type MacroInputHashes = Record<string, string>;
export type CurrentMacroInputHashes = Record<string, string | null>;

export function hashMacroInputs(inputs: Record<string, string>): MacroInputHashes {
  return Object.fromEntries(Object.entries(inputs).map(([key, file]) => [key, createHash("sha256").update(readFileSync(file)).digest("hex")]));
}

export function currentMacroInputHashes(inputs: Record<string, string>): CurrentMacroInputHashes {
  return Object.fromEntries(Object.entries(inputs).map(([key, file]) => {
    try {
      return [key, createHash("sha256").update(readFileSync(file)).digest("hex")];
    } catch {
      return [key, null];
    }
  }));
}
