import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { protocolHash, validateResearchProtocol } from "./research-protocol";

const path = "research/option-hypotheses-protocol.json";
const text = readFileSync(path, "utf8");
const protocol = JSON.parse(text);

describe("preregistered option hypothesis protocol", () => {
  it("validates the frozen protocol and its checksum", () => {
    expect(validateResearchProtocol(protocol)).toEqual([]);
    const sidecar = readFileSync("research/option-hypotheses-protocol.sha256", "utf8").split(/\s+/)[0];
    expect(sidecar).toBe(protocolHash(text));
    expect(protocol.hypotheses).toHaveLength(20);
    expect(protocol.run_policy.oos_used_for_tuning).toBe(false);
  });

  it("rejects duplicate hypotheses and out-of-sample tuning", () => {
    const duplicate = structuredClone(protocol);
    duplicate.hypotheses[1].id = duplicate.hypotheses[0].id;
    expect(validateResearchProtocol(duplicate).some((e) => e.includes("unique"))).toBe(true);
    const tuning = structuredClone(protocol);
    tuning.run_policy.oos_used_for_tuning = true;
    expect(validateResearchProtocol(tuning).some((e) => e.includes("oos_used_for_tuning"))).toBe(true);
  });

  it("rejects overlapping windows and unknown sources", () => {
    const copy = structuredClone(protocol);
    copy.windows.validation.start = "2023-01-01";
    copy.hypotheses[0].data_sources = ["unknown-source"];
    const errors = validateResearchProtocol(copy);
    expect(errors.some((e) => e.includes("discovery must precede validation"))).toBe(true);
    expect(errors.some((e) => e.includes("unknown-source"))).toBe(true);
  });
});
