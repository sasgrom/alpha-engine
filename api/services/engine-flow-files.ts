/**
 * Reads the engine-flow files (index and one file per company) built on the home machine by the lab's
 * tools/flow/build-flow.mts. They live on the D: archive and are reached through the junction worker/.runs/engine-flow
 * (or ENGINE_FLOW_ROOT). Parsed files are kept while their modification time and size are unchanged; the cache is
 * bounded. A missing file in a reachable folder is null: the page says the files are not built. An unreachable folder is
 * an error, never an empty result: the D: drive may be disconnected, and that must not read as "nothing built".
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ENGINE_FLOW_SCHEMA_VERSION } from "@contracts/engine-flow";

const MAX_CACHED = 6;
const cache = new Map<string, { mtimeMs: number; size: number; value: unknown }>();

export function engineFlowRoot(): string {
  return process.env.ENGINE_FLOW_ROOT ? path.resolve(process.env.ENGINE_FLOW_ROOT) : path.resolve(process.cwd(), "worker/.runs/engine-flow");
}

export function readEngineFlowFile<T>(relative: string, root: string = engineFlowRoot()): T | null {
  if (!existsSync(root)) throw new Error("The engine-flow folder is not reachable: it lives on the D: archive (worker/.runs/engine-flow is a junction to it). Reconnect the drive, or create the junction and build the files.");
  const file = path.join(root, relative);
  if (!existsSync(file)) return null;
  const { mtimeMs, size } = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
    cache.delete(file);
    cache.set(file, hit);
    return hit.value as T;
  }
  const value = JSON.parse(readFileSync(file, "utf8")) as T & { schemaVersion?: number };
  if (value.schemaVersion !== ENGINE_FLOW_SCHEMA_VERSION) throw new Error(`Engine-flow file ${relative} has schema ${String(value.schemaVersion)}, not the expected ${ENGINE_FLOW_SCHEMA_VERSION}; rebuild it`);
  cache.set(file, { mtimeMs, size, value });
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return value;
}
