import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { r1000PanelGatesPass } from "../worker/lib/r1000-current-panel";

const labRoot = path.resolve("../alpha-engine-lab");
const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const schwabRoot = path.resolve(arg("--root") ?? "D:/research/alpha-engine/schwab-r1000");
const evidenceRoot = "D:/research/alpha-engine";
const env = {
  ...process.env,
  R1000_SCREEN: `${evidenceRoot}/engine/r1000-jump-screen/20261127T050053Z/jumps-screen.json`,
  R1000_WHOLE_SERIES: `${evidenceRoot}/engine/r1000-whole-series/20261127T074129Z/whole-series.json`,
  R1000_ADDITIONAL_EXCLUSIONS: `${evidenceRoot}/engine/r1000-identity-segments/20261127T085353Z/identity-exclusions.json`,
  R1000_VALIDATED_SPLITS: `${evidenceRoot}/engine/r1000-identity-segments/20261127T085353Z/validated-splits.json`,
  R1000_RECOVERED_YAHOO: `${evidenceRoot}/prices/yahoo/r1000-recovered-20261127T073256Z/recovery.json;${evidenceRoot}/prices/yahoo/r1000-recovered-20261127T081532Z/recovery.json`,
  R1000_IDENTITY_SEGMENTS: `${evidenceRoot}/engine/r1000-identity-segments/20261127T085353Z/identity-segments.json`,
  R1000_FABLE1_JOIN: `${evidenceRoot}/engine/r1000-fable1-join/20261128T030114Z/fable1-matches.json`,
  R1000_UNPRICE_CIKS: "821130",
  R1000_SCHWAB_ROOT: schwabRoot,
};
const result = spawnSync("python", ["src/research/r1000/build_panel.py"], { cwd: labRoot, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`K35 panel builder failed (${result.status}): ${result.stdout}\n${result.stderr}`);
const summary = JSON.parse(result.stdout.trim());
const panel = summary.output as string;
const manifest = JSON.parse(readFileSync(path.join(panel, "manifest.json"), "utf8"));
const gates = JSON.parse(readFileSync(path.join(panel, "gates.json"), "utf8"));
if (!r1000PanelGatesPass(gates)) throw new Error(`K35 panel gates failed; pointer not moved: ${panel}`);
const pointer = path.join(panel, "..", "current.json");
writeJsonAtomic(pointer, { schemaVersion: 1, updatedAt: new Date().toISOString(), panel, counts: manifest.counts,
  gates: { overlap: gates.overlap.pass, membership: gates.membership.pass, stooqContradictions: gates.stooqContradictions.pass,
    identity: gates.identity.pass, calendar: gates.calendar.pass, chain: gates.chain.pass,
    splits: gates.splits.pass, schwabInvalidBars: gates.schwabInvalidBars.pass }, productionWrite: false, databaseWrite: false }, true);
console.log(JSON.stringify({ panel, pointer, counts: manifest.counts }, null, 1));
