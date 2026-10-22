/**
 * Local Workers Console (4p) — LOCAL-ONLY tRPC router for the home machine.
 * Enabled solely by LOCAL_WORKER_UI=1 in .env; on prod every procedure is
 * FORBIDDEN (spawning processes is a home-console power, never a cloud one —
 * billing-honesty lineage: machine-changing actions are owner-admin only).
 *
 * Capabilities:
 *  - run/kill worker processes (spawn tsx, stdout+stderr → worker/.runs/<id>.log);
 *  - run registry persisted to worker/.runs/registry.json (survives restarts);
 *  - scheduler status via schtasks /Query (win32; other OS → unsupported);
 *  - probe: one raw upstream request, shown verbatim (see 429 with eyes).
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery } from "../middleware";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RUNS_DIR = path.join(ROOT, "worker", ".runs");
const REGISTRY = path.join(RUNS_DIR, "registry.json");

export const WORKERS = {
  gdelt: { file: "worker/gdelt.mts", label: "GDELT live (hourly)" },
  "gdelt-backfill": { file: "worker/gdelt-backfill.mts", label: "GDELT backfill" },
  stocktwits: { file: "worker/stocktwits.mts", label: "Stocktwits live (hourly)" },
} as const;
export type WorkerName = keyof typeof WORKERS;

export interface RunRecord {
  id: string;
  worker: WorkerName;
  args: string[];
  startedAt: string;
  endedAt: string | null;
  status: "running" | "done" | "error" | "killed";
  exitCode: number | null;
  accepted: number | null; // parsed from the "ingested: X new, Y dupes" line
  dupes: number | null;
  logFile: string;
}

const live = new Map<string, ChildProcess>();

function requireLocal() {
  if (process.env.LOCAL_WORKER_UI !== "1") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Workers console is local-only (set LOCAL_WORKER_UI=1 in the home .env)" });
  }
}

function loadRegistry(): RunRecord[] {
  try {
    return JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch {
    return [];
  }
}
function saveRegistry(rows: RunRecord[]) {
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(REGISTRY, JSON.stringify(rows.slice(-300), null, 1));
}

/** Parse the worker's final report line into stats (pure, unit-tested). */
export function parseIngestReport(line: string): { accepted: number; dupes: number } | null {
  const m = line.match(/ingested:\s*(\d+)\s*new,\s*(\d+)\s*dupes/);
  return m ? { accepted: Number(m[1]), dupes: Number(m[2]) } : null;
}

/** Parse `schtasks /Query /FO CSV` output (pure, unit-tested). */
export function parseSchtasksCsv(csv: string): { taskName: string; nextRun: string; lastRun: string; lastResult: string }[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(/","?/).map((h) => h.replace(/^"|"$/g, ""));
  const col = (name: string) => header.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));
  const [cTask, cNext, cLast, cRes] = [col("TaskName"), col("Next Run Time"), col("Last Run Time"), col("Last Result")];
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(/","?/).map((c) => c.replace(/^"|"$/g, ""));
    if (!cells[cTask]) continue;
    out.push({
      taskName: cells[cTask].replace(/^\\/, ""),
      nextRun: cells[cNext] ?? "",
      lastRun: cells[cLast] ?? "",
      lastResult: cells[cRes] ?? "",
    });
  }
  return out;
}

export const workersLocalRouter = createRouter({
  enabled: adminQuery.query(() => ({ enabled: process.env.LOCAL_WORKER_UI === "1" })),

  runs: adminQuery.input(z.object({ limit: z.number().min(1).max(100).default(30) })).query(({ input }) => {
    requireLocal();
    return loadRegistry().slice(-input.limit).reverse();
  }),

  run: adminQuery
    .input(
      z.object({
        worker: z.enum(["gdelt", "gdelt-backfill", "stocktwits"]),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        only: z.string().max(8).optional(),
      })
    )
    .mutation(({ input }) => {
      requireLocal();
      if ([...live.values()].length >= 1) {
        throw new TRPCError({ code: "CONFLICT", message: "a worker is already running — wait or kill it first" });
      }
      const def = WORKERS[input.worker];
      const args = ["tsx", def.file];
      if (input.from) args.push("--from", input.from);
      if (input.to) args.push("--to", input.to);
      if (input.only) args.push("--only", input.only.toUpperCase());
      const id = `${Date.now()}-${input.worker}`;
      const rec: RunRecord = {
        id, worker: input.worker, args: args.slice(2), startedAt: new Date().toISOString(),
        endedAt: null, status: "running", exitCode: null, accepted: null, dupes: null,
        logFile: path.join(RUNS_DIR, `${id}.log`),
      };
      mkdirSync(RUNS_DIR, { recursive: true });
      writeFileSync(rec.logFile, `$ npx ${args.join(" ")}\n`);
      const child = spawn("npx", args, { cwd: ROOT, shell: true, env: process.env });
      live.set(id, child);
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        appendFileSync(rec.logFile, text);
        const stats = parseIngestReport(text);
        if (stats) {
          rec.accepted = stats.accepted;
          rec.dupes = stats.dupes;
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("close", (code) => {
        live.delete(id);
        rec.endedAt = new Date().toISOString();
        rec.exitCode = code;
        rec.status = code === 0 ? "done" : rec.status === "killed" ? "killed" : "error";
        const reg = loadRegistry();
        const i = reg.findIndex((r) => r.id === id);
        if (i >= 0) reg[i] = rec;
        saveRegistry(i >= 0 ? reg : [...reg, rec]);
      });
      const reg = loadRegistry();
      saveRegistry([...reg, rec]);
      return { id };
    }),

  kill: adminQuery.input(z.object({ id: z.string() })).mutation(({ input }) => {
    requireLocal();
    const child = live.get(input.id);
    if (!child) return { killed: false };
    child.kill();
    const reg = loadRegistry();
    const rec = reg.find((r) => r.id === input.id);
    if (rec) {
      rec.status = "killed";
      rec.endedAt = new Date().toISOString();
      saveRegistry(reg);
    }
    return { killed: true };
  }),

  logTail: adminQuery
    .input(z.object({ id: z.string(), lines: z.number().min(1).max(500).default(120) }))
    .query(({ input }) => {
      requireLocal();
      const file = path.join(RUNS_DIR, `${input.id}.log`);
      // path traversal guard: id comes from the client
      if (!/^[\w.-]+$/.test(input.id) || !existsSync(file)) return { lines: [] };
      const all = readFileSync(file, "utf8").split(/\r?\n/);
      return { lines: all.slice(-input.lines) };
    }),

  scheduler: adminQuery.query(async () => {
    requireLocal();
    if (process.platform !== "win32") return { supported: false as const, tasks: [] };
    const csv = await new Promise<string>((resolve, reject) => {
      execFile("schtasks", ["/Query", "/TN", "AlphaEngine-Stocktwits", "/V", "/FO", "CSV"], { maxBuffer: 1024 * 1024 }, (e, stdout) =>
        e ? reject(e) : resolve(stdout)
      );
    }).catch(() => "");
    const csv2 = await new Promise<string>((resolve, reject) => {
      execFile("schtasks", ["/Query", "/TN", "AlphaEngine-GDELT", "/V", "/FO", "CSV"], { maxBuffer: 1024 * 1024 }, (e, stdout) =>
        e ? reject(e) : resolve(stdout)
      );
    }).catch(() => "");
    return { supported: true as const, tasks: [...parseSchtasksCsv(csv), ...parseSchtasksCsv(csv2)] };
  }),

  probe: adminQuery.input(z.object({ query: z.string().default('"Microsoft"') })).query(async ({ input }) => {
    requireLocal();
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(input.query)}&mode=ToneChart&format=json&timespan=1h`;
    try {
      const res = await fetch(url, { headers: { "user-agent": "alpha-engine-research/1.0" } });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text.slice(0, 800) };
    } catch (e: any) {
      return { ok: false, status: 0, body: String(e?.cause?.code ?? e?.message ?? e) };
    }
  }),
});
