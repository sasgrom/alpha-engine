import { exportForm4ServingArtifact } from "./lib/form4-export";
import { form4QaRunsRoot } from "./lib/cache-root";

const defaultQaRoot = process.env.ALPHA_RUNS_ROOT ? form4QaRunsRoot() : process.platform === "win32" ? "D:/alpha-engine/worker/.runs/form4-qa" : form4QaRunsRoot();

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

try {
  const result = exportForm4ServingArtifact({
    root: arg("--root") ?? undefined,
    qaRoot: arg("--qa-root") ?? defaultQaRoot,
    universeFile: arg("--universe") ?? "worker/research-universe-50.json",
    out: arg("--out") ?? "public/reports/insider-form4.json",
    fullOut: arg("--full-out") ?? "worker/.runs/insider-form4-full.json",
    previousBenchmarkFile: arg("--previous-benchmark") ?? undefined,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Form 4 export failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
