import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// An undefined CSS variable makes an SVG stroke "none" and a fill black, so a chart silently loses its line.
// This guard fails when desk code uses a --d-* colour token that no stylesheet or inline style defines.
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : [];
  });
}

describe("desk colour tokens", () => {
  it("defines every --d-* variable the desk uses", () => {
    const defined = new Set<string>();
    for (const file of files("src", /\.css$/)) {
      for (const match of readFileSync(file, "utf8").matchAll(/(--d-[\w-]+)\s*:/g)) defined.add(match[1]);
    }
    const sources = files("src/desk", /\.(tsx?|css)$/).filter(file => !file.endsWith(".test.tsx"));
    for (const file of sources) {
      for (const match of readFileSync(file, "utf8").matchAll(/["'](--d-[\w-]+)["']\s*:/g)) defined.add(match[1]);
    }
    const missing: string[] = [];
    for (const file of sources) {
      for (const match of readFileSync(file, "utf8").matchAll(/var\((--d-[\w-]+)/g)) {
        if (!defined.has(match[1])) missing.push(`${match[1]} in ${file}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
