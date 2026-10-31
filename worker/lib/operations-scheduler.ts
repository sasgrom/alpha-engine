import { spawn, execFile, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import { OPERATION_JOBS, OPERATION_JOB_MAP, type OperationJob } from "../../contracts/operations";

export const OPERATIONS_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const OPERATIONS_RUNS_DIR = path.join(OPERATIONS_ROOT, "worker", ".runs");
export const OPERATIONS_CONFIG_FILE = path.join(OPERATIONS_RUNS_DIR, "operations-config.json");
export const OPERATIONS_STATE_FILE = path.join(OPERATIONS_RUNS_DIR, "operations-state.json");
export const OPERATIONS_COMMAND_FILE = path.join(OPERATIONS_RUNS_DIR, "operations-commands.jsonl");
const DEPENDENCY_FRESH_MS = 48 * 3600_000;

export interface OperationConfigRow { enabled: boolean; cron: string | null }
export type OperationConfig = Record<string, OperationConfigRow>;
export type OperationRunStatus = "running" | "done" | "error" | "killed";
export interface OperationRun {
  runId: string;
  jobId: string;
  status: OperationRunStatus;
  trigger: "cron" | "dependency" | "manual";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  logFile: string;
  error: string | null;
}
export interface OperationsState {
  schemaVersion: 1;
  schedulerStartedAt: string | null;
  heartbeatAt: string | null;
  current: OperationRun | null;
  queue: { jobId: string; trigger: OperationRun["trigger"] }[];
  nextRuns: Record<string, string | null>;
  configuredCrons: Record<string, string | null>;
  commandOffset: number;
  lastRuns: Record<string, OperationRun>;
}
export interface OperationCommand { id: string; action: "run" | "kill"; jobId: string; requestedAt: string }

const nowIso = () => new Date().toISOString();
const emptyState = (): OperationsState => ({ schemaVersion: 1, schedulerStartedAt: null, heartbeatAt: null, current: null, queue: [], nextRuns: {}, configuredCrons: {}, commandOffset: 0, lastRuns: {} });
const atomicText = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, file); }
  finally { rmSync(tmp, { force: true }); }
};
const atomicJson = (file: string, value: unknown) => atomicText(file, `${JSON.stringify(value, null, 2)}\n`);

export function defaultOperationConfig(): OperationConfig {
  return Object.fromEntries(OPERATION_JOBS.map((job) => [job.id, { enabled: job.defaultEnabled, cron: job.cron }]));
}

export function loadOperationConfig(file = OPERATIONS_CONFIG_FILE): OperationConfig {
  const defaults = defaultOperationConfig();
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, Partial<OperationConfigRow>>;
    for (const job of OPERATION_JOBS) {
      const row = saved[job.id];
      if (!row) continue;
      const cron = job.cron === null ? null : typeof row.cron === "string" ? row.cron : job.cron;
      if (cron) new Cron(cron);
      defaults[job.id] = { enabled: typeof row.enabled === "boolean" ? row.enabled : job.defaultEnabled, cron };
    }
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  return defaults;
}

export function saveOperationConfig(config: OperationConfig, file = OPERATIONS_CONFIG_FILE): void {
  for (const job of OPERATION_JOBS) {
    const row = config[job.id];
    if (!row) throw new Error(`Missing operation config: ${job.id}`);
    if (row.cron) new Cron(row.cron);
  }
  atomicJson(file, config);
}

export function loadOperationsState(file = OPERATIONS_STATE_FILE): OperationsState {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as OperationsState;
    return parsed.schemaVersion === 1 ? { ...emptyState(), ...parsed } : emptyState();
  } catch { return emptyState(); }
}
export function saveOperationsState(state: OperationsState, file = OPERATIONS_STATE_FILE): void {
  state.heartbeatAt = nowIso();
  atomicJson(file, state);
}

export function operationChain(jobId: string): OperationJob[] {
  const out: OperationJob[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Operation dependency cycle at ${id}`);
    const job = OPERATION_JOB_MAP[id];
    if (!job) throw new Error(`Unknown operation job: ${id}`);
    visiting.add(id);
    for (const parent of job.dependsOn) visit(parent);
    visiting.delete(id);
    visited.add(id);
    out.push(job);
  };
  visit(jobId);
  return out;
}

export function validateOperationRegistry(): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const job of OPERATION_JOBS) {
    if (ids.has(job.id)) issues.push(`Duplicate job id: ${job.id}`);
    ids.add(job.id);
    if (job.cron) {
      try { new Cron(job.cron); } catch { issues.push(`Invalid cron: ${job.id}`); }
    }
    for (const parent of job.dependsOn) if (!OPERATION_JOB_MAP[parent]) issues.push(`Missing parent: ${job.id} -> ${parent}`);
    if (["frozen", "blocked"].includes(job.mode) && job.executable) issues.push(`Unsafe executable mode: ${job.id}`);
    try { operationChain(job.id); } catch (error) { issues.push(String(error)); }
  }
  return issues;
}

export function appendOperationCommand(command: OperationCommand, file = OPERATIONS_COMMAND_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(command)}\n`);
}

export function dependenciesReady(job: OperationJob, state: OperationsState, now: number): boolean {
  if (!job.dependsOn.length) return false;
  const parents = job.dependsOn.map((id) => state.lastRuns[id]);
  if (parents.some((run) => !run || run.status !== "done" || !run.endedAt || now - Date.parse(run.endedAt) > DEPENDENCY_FRESH_MS)) return false;
  const oldestParent = Math.min(...parents.map((run) => Date.parse(run.endedAt!)));
  const previous = state.lastRuns[job.id];
  return !previous?.endedAt || Date.parse(previous.endedAt) < oldestParent;
}

async function preflight(job: OperationJob, state: OperationsState): Promise<void> {
  for (const parent of job.dependsOn) {
    if (state.lastRuns[parent]?.status !== "done") throw new Error(`Dependency ${parent} did not complete successfully; run the chain from that parent`);
  }
  if (job.requirements.includes("server")) {
    const response = await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!response) throw new Error("Local server is unavailable on port 3000; start exactly one dev or production server");
  }
  if (job.requirements.includes("gpu")) {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!response?.ok) throw new Error("Local Ollama is unavailable on port 11434; start it before enabling GPU jobs");
  }
}

export class OperationsScheduler {
  private state: OperationsState;
  private config: OperationConfig;
  private child: ChildProcess | null = null;
  private commandOffset: number;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor() {
    this.state = loadOperationsState();
    this.config = loadOperationConfig();
    this.commandOffset = this.state.commandOffset ?? 0;
  }

  async start(): Promise<void> {
    const issues = validateOperationRegistry();
    if (issues.length) throw new Error(issues.join("\n"));
    if (this.state.current) {
      const interrupted = this.state.current;
      interrupted.status = "error";
      interrupted.endedAt = nowIso();
      interrupted.error = "Scheduler restarted while this job was running; inspect the log before rerunning";
      this.state.lastRuns[interrupted.jobId] = interrupted;
      this.state.current = null;
    }
    this.state.schedulerStartedAt = nowIso();
    this.reconcileSchedules(new Date());
    saveOperationsState(this.state);
    console.log(`[operations] scheduler started · ${OPERATION_JOBS.length} registered jobs · one execution lane`);
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 15_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private reconcileSchedules(now: Date): void {
    for (const job of OPERATION_JOBS) {
      const row = this.config[job.id];
      if (!row.enabled || !row.cron) {
        this.state.nextRuns[job.id] = null;
        this.state.configuredCrons[job.id] = row.cron;
        continue;
      }
      const changed = this.state.configuredCrons[job.id] !== row.cron;
      if (changed || !this.state.nextRuns[job.id]) {
        const previous = this.state.lastRuns[job.id]?.endedAt;
        const base = previous ? new Date(previous) : now;
        this.state.nextRuns[job.id] = new Cron(row.cron).nextRun(base)?.toISOString() ?? null;
        this.state.configuredCrons[job.id] = row.cron;
      }
    }
  }

  private enqueue(jobId: string, trigger: OperationRun["trigger"]): void {
    if (this.state.current?.jobId === jobId || this.state.queue.some((row) => row.jobId === jobId)) return;
    this.state.queue.push({ jobId, trigger });
  }

  private readCommands(): void {
    if (!existsSync(OPERATIONS_COMMAND_FILE)) return;
    const size = statSync(OPERATIONS_COMMAND_FILE).size;
    if (size < this.commandOffset) this.commandOffset = 0;
    if (size === this.commandOffset) return;
    const text = readFileSync(OPERATIONS_COMMAND_FILE, "utf8").slice(this.commandOffset);
    this.commandOffset = size;
    this.state.commandOffset = size;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const command = JSON.parse(line) as OperationCommand;
        if (command.action === "run") {
          for (const job of operationChain(command.jobId)) this.enqueue(job.id, "manual");
        } else if (command.action === "kill" && this.state.current?.jobId === command.jobId) {
          this.killCurrent();
        }
      } catch (error) { console.error(`[operations] command rejected: ${String(error).slice(0, 240)}`); }
    }
  }

  private killCurrent(): void {
    const current = this.state.current;
    if (!current || !this.child) return;
    current.error = "Kill requested by the owner";
    if (process.platform === "win32" && this.child.pid) execFile("taskkill", ["/pid", String(this.child.pid), "/T", "/F"]);
    else this.child.kill();
  }

  private async runNext(): Promise<void> {
    if (this.state.current || !this.state.queue.length) return;
    const next = this.state.queue.shift()!;
    const job = OPERATION_JOB_MAP[next.jobId];
    if (!job?.executable || ["frozen", "blocked"].includes(job.mode)) return;
    const runId = `${Date.now()}-${job.id}`;
    const run: OperationRun = {
      runId, jobId: job.id, status: "running", trigger: next.trigger, startedAt: nowIso(), endedAt: null,
      exitCode: null, logFile: path.join(OPERATIONS_RUNS_DIR, `${runId}.log`), error: null,
    };
    this.state.current = run;
    this.state.lastRuns[job.id] = run;
    saveOperationsState(this.state);
    mkdirSync(OPERATIONS_RUNS_DIR, { recursive: true });
    writeFileSync(run.logFile, `$ ${job.command}\n`);
    try { await preflight(job, this.state); }
    catch (error) {
      run.status = "error";
      run.endedAt = nowIso();
      run.error = error instanceof Error ? error.message : String(error);
      appendFileSync(run.logFile, `PREFLIGHT FAILED: ${run.error}\n`);
      this.state.current = null;
      saveOperationsState(this.state);
      return;
    }
    const child = spawn(job.executable, job.args, {
      cwd: OPERATIONS_ROOT,
      shell: true,
      windowsHide: true,
      env: { ...process.env, INGEST_URL: process.env.INGEST_URL ?? "http://127.0.0.1:3000/api/worker/ingest" },
    });
    this.child = child;
    const onData = (chunk: Buffer) => appendFileSync(run.logFile, chunk.toString());
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => {
      run.error = error.message;
      appendFileSync(run.logFile, `PROCESS ERROR: ${error.message}\n`);
    });
    child.on("close", (code) => {
      this.child = null;
      run.endedAt = nowIso();
      run.exitCode = code;
      run.status = code === 0 ? "done" : run.error?.includes("Kill requested") ? "killed" : "error";
      if (run.status === "error" && !run.error) run.error = `Process exited with code ${code ?? "unknown"}`;
      this.state.current = null;
      saveOperationsState(this.state);
      if (run.status === "done") {
        const now = Date.now();
        for (const candidate of OPERATION_JOBS) {
          if (!this.config[candidate.id].enabled || !candidate.dependsOn.includes(job.id)) continue;
          if (dependenciesReady(candidate, this.state, now)) this.enqueue(candidate.id, "dependency");
        }
        saveOperationsState(this.state);
      }
    });
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.config = loadOperationConfig();
      this.reconcileSchedules(new Date());
      this.readCommands();
      const now = Date.now();
      for (const job of OPERATION_JOBS) {
        const row = this.config[job.id];
        if (!row.enabled || !row.cron) continue;
        const due = this.state.nextRuns[job.id];
        if (due && Date.parse(due) <= now) {
          this.enqueue(job.id, "cron");
          this.state.nextRuns[job.id] = new Cron(row.cron).nextRun(new Date(now))?.toISOString() ?? null;
        }
      }
      saveOperationsState(this.state);
      await this.runNext();
    } catch (error) {
      console.error(`[operations] tick failed: ${String(error).slice(0, 300)}`);
      saveOperationsState(this.state);
    } finally {
      this.busy = false;
    }
  }
}
