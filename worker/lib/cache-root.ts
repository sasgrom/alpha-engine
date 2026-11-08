import path from "node:path";

export const CODE_ROOT = path.resolve(import.meta.dirname, "../..");
export const CACHE_ROOT = path.resolve(process.env.ALPHA_CACHE_ROOT ?? path.resolve("worker/cache"));
export const RUNS_ROOT = path.resolve(process.env.ALPHA_RUNS_ROOT ?? path.resolve("worker/.runs"));

export function form4CacheRoot(): string {
  return path.join(CACHE_ROOT, "edgar-form4");
}

export function form4QaRunsRoot(): string {
  return path.join(RUNS_ROOT, "form4-qa");
}
