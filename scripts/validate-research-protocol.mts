/** Validate the preregistered option hypothesis battery and its freeze hash. */
import { readFileSync } from "node:fs";
import { protocolHash, validateResearchProtocol } from "../api/services/research-protocol";

const file = "research/option-hypotheses-protocol.json";
const text = readFileSync(file, "utf8");
const expected = readFileSync("research/option-hypotheses-protocol.sha256", "utf8").split(/\s+/)[0];
const actual = protocolHash(text);
const errors = validateResearchProtocol(JSON.parse(text));
if (expected !== actual) errors.push(`freeze hash mismatch: expected ${expected}, got ${actual}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Research protocol valid: 19 hypotheses · SHA256 ${actual}`);
process.exit(0);
