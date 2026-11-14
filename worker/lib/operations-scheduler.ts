import { spawn, execFile, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { renameWithRetry } from "./json-file";
import path from "node:path";
import { Cron } from "croner";
import { OPERATION_JOBS, OPERATION_JOB_MAP, type OperationJob } from "../../contracts/operations";
import { pushOperationalJobOutput, shouldPushOperationalJob } from "./prod-push";

/**
 * The repository root: two folders above this module when it runs from source (tsx). Bundled into the server
 * (dist/boot.js) the module's folder no longer says where the repository is (two folders above dist/ is C:\dev, where
 * the Operations page wrote a stray operations-config.json on 2026-11-03); the server runs from the repository root.
 */
export function repositoryRoot(moduleDir: string = import.meta.dirname, cwd: string = process.cwd()): string {
  const fromModule = path.resolve(moduleDir, "..", "..");
  return existsSync(path.join(fromModule, "worker", "lib")) ? fromModule : cwd;
}
export const OPERATIONS_ROOT = repositoryRoot();
export const OPERATIONS_RUNS_DIR = path.join(OPERATIONS_ROOT, "worker", ".runs");
export const OPERATIONS_CONFIG_FILE = path.join(OPERATIONS_RUNS_DIR, "operations-config.json");
export const OPERATIONS_STATE_FILE = path.join(OPERATIONS_RUNS_DIR, "operations-state.json");
export const OPERATIONS_COMMAND_FILE = path.join(OPERATIONS_RUNS_DIR, "operations-commands.jsonl");
export const OPERATIONS_LOCK_FILE = path.join(OPERATIONS_RUNS_DIR, "operations-scheduler.lock");
const DEPENDENCY_FRESH_MS = 48 * 3600_000;
/** A scheduler saves its state (and heartbeat) every 15 seconds; ten silent minutes mean it is gone or hung. */
const HEARTBEAT_STALE_MS = 10 * 60_000;

export interface OperationConfigRow { enabled: boolean; cron: string | null }
export type OperationConfig = Record<string, OperationConfigRow>;
export type OperationRunStatus = "running" | "done" | "error" | "killed";
export interface OperationRun {
  runId: string;
  jobId: string;
  /** Overall result: an operational production push that fails makes it "error" (honestly reported). */
  status: OperationRunStatus;
  trigger: "cron" | "dependency" | "manual";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  logFile: string;
  error: string | null;
  /** The job's own (local) result, before any production push; dependents follow this one. */
  localStatus?: OperationRunStatus;
  /** The operational production push after the job, when the job has one. */
  push?: { status: "ok" | "failed"; at: string; error?: string };
}

/** The job's own work finished: dependents may run even when its production push failed. */
export function succeededLocally(run: OperationRun | null | undefined): boolean {
  return !!run && (run.status === "done" || run.localStatus === "done");
}

/** A schedule is one cron expression, or several separated by ";" (for example after the close and a morning catch-up). */
export function cronParts(expression: string): string[] {
  return expression.split(";").map((part) => part.trim()).filter(Boolean);
}
export function validateCron(expression: string): void {
  const parts = cronParts(expression);
  if (!parts.length) throw new Error(`Empty cron expression: "${expression}"`);
  for (const part of parts) new Cron(part);
}
/** The earliest next run of any of the schedule's expressions, after the given moment (local time zone). */
export function nextCronRun(expression: string, after: Date): Date | null {
  let best: Date | null = null;
  for (const part of cronParts(expression)) {
    const next = new Cron(part).nextRun(after);
    if (next && (!best || next < best)) best = next;
  }
  return best;
}

/** Due jobs share one execution lane: each job is pending at most once, and stale slots advance to the next future slot. */
export function queueDueOperations(state: OperationsState, config: OperationConfig, now: Date, jobs: OperationJob[] = OPERATION_JOBS): void {
  const timestamp = now.getTime();
  for (const job of jobs) {
    const row = config[job.id];
    if (!row?.enabled || !row.cron) continue;
    const due = state.nextRuns[job.id];
    if (!due || Date.parse(due) > timestamp) continue;
    if (state.current?.jobId !== job.id && !state.queue.some(entry => entry.jobId === job.id)) state.queue.push({ jobId: job.id, trigger: "cron" });
    state.nextRuns[job.id] = nextCronRun(row.cron, now)?.toISOString() ?? null;
  }
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
  // a reader holding the state file for a moment must not end the scheduler (it did on 2026-11-11, 13:42)
  try { writeFileSync(tmp, text); renameWithRetry(tmp, file); }
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
      if (cron) validateCron(cron);
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
    if (row.cron) validateCron(row.cron);
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
      try { validateCron(job.cron); } catch { issues.push(`Invalid cron: ${job.id}`); }
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

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export interface SchedulerLockResult { acquired: boolean; holder?: number; reason: string }
/**
 * Exactly one scheduler: the lock file names the running scheduler's process. A start finds that process alive with a
 * fresh heartbeat and leaves (so a watchdog may start the task as often as it likes); a lock whose process is gone, or
 * whose scheduler has been silent for ten minutes, is taken over. A scheduler from before the lock (no lock file but a
 * heartbeat under two minutes old) is also respected. Two starts racing for a free lock: the last writer keeps it.
 */
export function acquireSchedulerLock(options: { file?: string; stateFile?: string; now?: number; pid?: number; settleMs?: number; alive?: (pid: number) => boolean } = {}): SchedulerLockResult {
  const { file = OPERATIONS_LOCK_FILE, stateFile = OPERATIONS_STATE_FILE, now = Date.now(), pid = process.pid, settleMs = 300, alive = processAlive } = options;
  mkdirSync(path.dirname(file), { recursive: true });
  const heartbeat = Date.parse(loadOperationsState(stateFile).heartbeatAt ?? "") || 0;
  const body = JSON.stringify({ pid, startedAt: new Date(now).toISOString() });
  let holder: number | null = null;
  let reason = "free";
  if (existsSync(file)) {
    try { holder = Number(JSON.parse(readFileSync(file, "utf8")).pid) || null; } catch { holder = null; }
    if (holder === pid) return { acquired: true, holder, reason: "own" };
    if (holder && alive(holder) && now - heartbeat < HEARTBEAT_STALE_MS) return { acquired: false, holder, reason: "running" };
    reason = holder ? (alive(holder) ? "taken over from a silent scheduler" : "taken over from a stopped scheduler") : "unreadable lock replaced";
  } else if (now - heartbeat < 2 * 60_000) {
    return { acquired: false, reason: "a scheduler without a lock file is running" };
  }
  writeFileSync(file, body);
  if (settleMs > 0) sleepMs(settleMs);
  try {
    if (Number(JSON.parse(readFileSync(file, "utf8")).pid) !== pid) return { acquired: false, reason: "another start took the lock" };
  } catch { return { acquired: false, reason: "lock unreadable after writing" }; }
  return { acquired: true, holder: holder ?? undefined, reason };
}

export function releaseSchedulerLock(file = OPERATIONS_LOCK_FILE, pid = process.pid): void {
  try { if (Number(JSON.parse(readFileSync(file, "utf8")).pid) === pid) rmSync(file, { force: true }); } catch { /* already gone */ }
}

export function dependenciesReady(job: OperationJob, state: OperationsState, now: number): boolean {
  if (!job.dependsOn.length) return false;
  const parents = job.dependsOn.map((id) => state.lastRuns[id]);
  if (parents.some((run) => !succeededLocally(run) || !run.endedAt || now - Date.parse(run.endedAt) > DEPENDENCY_FRESH_MS)) return false;
  const oldestParent = Math.min(...parents.map((run) => Date.parse(run.endedAt!)));
  const previous = state.lastRuns[job.id];
  return !previous?.endedAt || Date.parse(previous.endedAt) < oldestParent;
}

async function preflight(job: OperationJob, state: OperationsState): Promise<void> {
  for (const parent of job.dependsOn) {
    if (!succeededLocally(state.lastRuns[parent])) throw new Error(`Dependency ${parent} did not complete successfully; run the chain from that parent`);
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
    // jobs taken out of the registry leave no schedule behind
    for (const id of Object.keys(this.state.nextRuns)) if (!OPERATION_JOB_MAP[id]) delete this.state.nextRuns[id];
    for (const id of Object.keys(this.state.configuredCrons)) if (!OPERATION_JOB_MAP[id]) delete this.state.configuredCrons[id];
    for (const job of OPERATION_JOBS) {
      const row = this.config[job.id];
      if (!row.enabled || !row.cron) {
        this.state.nextRuns[job.id] = null;
        this.state.configuredCrons[job.id] = row.cron;
        continue;
      }
      const changed = this.state.configuredCrons[job.id] !== row.cron;
      if (changed || !this.state.nextRuns[job.id]) {
        // a changed schedule starts from now; an unchanged one continues from its last run, so a run missed while the
        // scheduler was down (or the computer asleep) is made up at the next tick
        const previous = this.state.lastRuns[job.id]?.endedAt;
        const base = previous && !changed ? new Date(previous) : now;
        this.state.nextRuns[job.id] = nextCronRun(row.cron, base)?.toISOString() ?? null;
        this.state.configuredCrons[job.id] = row.cron;
      }
    }
  }

  /** State is saved from timers and child-process events: a failure there is logged, never the end of the scheduler. */
  private save(): void {
    try { saveOperationsState(this.state); } catch (error) { console.error(`[operations] state not saved: ${String(error).slice(0, 300)}`); }
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
    const log = (text: string) => { try { appendFileSync(run.logFile, text); } catch { /* a locked log file must not end the run */ } };
    const onData = (chunk: Buffer) => log(chunk.toString());
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => {
      run.error = error.message;
      log(`PROCESS ERROR: ${error.message}\n`);
    });
    child.on("close", async (code) => {
      try {
        this.child = null;
        run.exitCode = code;
        run.status = code === 0 ? "done" : run.error?.includes("Kill requested") ? "killed" : "error";
        if (run.status === "error" && !run.error) run.error = `Process exited with code ${code ?? "unknown"}`;
        run.localStatus = run.status;
        if (shouldPushOperationalJob(job.id, run.status, run.trigger)) {
          try {
            const pushed = await pushOperationalJobOutput(job.id);
            run.push = { status: "ok", at: nowIso() };
            log(`[operations] operational push completed: ${JSON.stringify(pushed)}\n`);
          } catch (error) {
            // reported honestly as the run's error; the local result stands and its dependents still run
            run.status = "error";
            run.error = `Operational push failed: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`;
            run.push = { status: "failed", at: nowIso(), error: run.error };
            log(`${run.error}\n`);
          }
        }
      } catch (error) {
        run.status = "error";
        run.error = `Scheduler failure after the job: ${String(error).slice(0, 240)}`;
        log(`${run.error}\n`);
      }
      run.endedAt = nowIso();
      this.state.current = null;
      this.save();
      if (run.localStatus === "done") {
        try {
          const now = Date.now();
          for (const candidate of OPERATION_JOBS) {
            if (!this.config[candidate.id].enabled || !candidate.dependsOn.includes(job.id)) continue;
            if (dependenciesReady(candidate, this.state, now)) this.enqueue(candidate.id, "dependency");
          }
        } catch (error) { console.error(`[operations] dependents of ${job.id} not queued: ${String(error).slice(0, 300)}`); }
        this.save();
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
      const now = new Date();
      queueDueOperations(this.state, this.config, now);
      saveOperationsState(this.state);
      await this.runNext();
    } catch (error) {
      console.error(`[operations] tick failed: ${String(error).slice(0, 300)}`);
      this.save();
    } finally {
      this.busy = false;
    }
  }
}
