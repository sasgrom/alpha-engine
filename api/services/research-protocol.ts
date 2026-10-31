import { createHash } from "node:crypto";
import { z } from "zod";

const hypothesisZ = z.object({
  id: z.string().min(1),
  primary_metric: z.string().min(10),
  target: z.string().min(3),
  primary_horizon: z.string().min(2),
  falsifier: z.string().min(10),
  data_sources: z.array(z.string().min(1)).min(1),
});
const protocolZ = z.object({
  schema_version: z.literal("1.0"),
  protocol_id: z.string().min(1),
  protocol_type: z.literal("original_hypothesis_battery"),
  stage: z.string().min(1),
  replication_level: z.enum(["exact", "near", "conceptual", "not_testable"]),
  windows: z.object({
    discovery: z.object({ start: z.string(), end: z.string() }),
    validation: z.object({ start: z.string(), end: z.string() }),
    sealed_holdout: z.object({ start: z.string(), end: z.string() }),
  }),
  sources: z.record(z.string(), z.object({ equivalence_grade: z.enum(["A", "B", "C", "D", "E"]) }).passthrough()),
  inference_policy: z.object({ fdr_q: z.number().min(0).max(0.05) }).passthrough(),
  hypotheses: z.array(hypothesisZ).length(22),
  run_policy: z.object({ all_runs_logged: z.literal(true), failed_runs_retained: z.literal(true), oos_used_for_tuning: z.literal(false) }).passthrough(),
}).passthrough();

export function protocolHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function validateResearchProtocol(value: unknown): string[] {
  const parsed = protocolZ.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const protocol = parsed.data;
  const errors: string[] = [];
  const ids = protocol.hypotheses.map((h) => h.id);
  if (new Set(ids).size !== ids.length) errors.push("hypotheses: ids must be unique");
  const { discovery, validation, sealed_holdout } = protocol.windows;
  if (!(discovery.start <= discovery.end && discovery.end < validation.start)) errors.push("windows: discovery must precede validation without overlap");
  if (!(validation.start <= validation.end && validation.end < sealed_holdout.start)) errors.push("windows: validation must precede sealed holdout without overlap");
  for (const [i, hypothesis] of protocol.hypotheses.entries()) {
    for (const source of hypothesis.data_sources) {
      if (!(source in protocol.sources)) errors.push(`hypotheses.${i}.data_sources: unknown source ${source}`);
    }
  }
  return errors;
}
