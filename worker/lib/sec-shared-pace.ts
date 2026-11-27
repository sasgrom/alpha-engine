import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface SharedPaceState {
  nextSlotAt: number;
  coolDownUntil: number;
}

export interface SecPaceTelemetry {
  job: string;
  pid: number;
  requests: number;
  totalWaitMs: number;
  status429: number;
  status403: number;
  status5xx: number;
  fallbacks: number;
  coolDowns: number;
}

export interface SharedPaceOptions {
  root?: string;
  budget?: number;
  job?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  lockTimeoutMs?: number;
  retryDelayMs?: number;
  telemetry?: boolean;
  log?: (message: string) => void;
}

export interface SharedSecPace {
  schedule(): Promise<number>;
  recordResponse(
    status: number,
    body?: string,
    retryAfterSeconds?: number
  ): Promise<void>;
  telemetry(): SecPaceTelemetry;
  close(): void;
}

function writeStateAtomic(file: string, state: SharedPaceState): void {
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temporary, JSON.stringify(state));
  renameSync(temporary, file);
}

function readState(file: string): SharedPaceState {
  if (!existsSync(file)) return { nextSlotAt: 0, coolDownUntil: 0 };
  const raw = readFileSync(file, "utf8");
  if (!raw) throw new Error("Empty SEC pace state");
  const value = JSON.parse(raw);
  return {
    nextSlotAt: Number(value.nextSlotAt) || 0,
    coolDownUntil: Number(value.coolDownUntil) || 0,
  };
}

/** Create one machine-wide SEC scheduler. Network requests never hold the state lock. */
export function createSharedSecPace(
  options: SharedPaceOptions = {}
): SharedSecPace {
  const root = path.resolve(options.root ?? "worker/.runs/sec-pace");
  const stateFile = path.join(root, "state.json");
  const lockDirectory = path.join(root, "lock");
  const budget = Math.min(
    Math.max(
      (options.budget ?? Number(process.env.SEC_MACHINE_RPS ?? 8)) || 8,
      1
    ),
    9
  );
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    (async ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const lockTimeoutMs = options.lockTimeoutMs ?? 2000;
  const retryDelayMs = options.retryDelayMs ?? 10;
  const job =
    options.job ??
    process.env.SEC_JOB ??
    path.basename(process.argv[1] ?? "unknown");
  const counts: SecPaceTelemetry = {
    job,
    pid: process.pid,
    requests: 0,
    totalWaitMs: 0,
    status429: 0,
    status403: 0,
    status5xx: 0,
    fallbacks: 0,
    coolDowns: 0,
  };
  let fallbackNext = 0;
  let fallbackLogged = false;
  let closed = false;

  const telemetryFile = () =>
    path.join(root, `${new Date(now()).toISOString().slice(0, 10)}.jsonl`);
  const appendTelemetry = () => {
    if (options.telemetry === false) return;
    mkdirSync(root, { recursive: true });
    appendFileSync(
      telemetryFile(),
      `${JSON.stringify({ at: new Date(now()).toISOString(), ...counts })}\n`
    );
  };
  const interval = setInterval(appendTelemetry, 60_000);
  interval.unref();

  async function underLock<T>(operation: () => T): Promise<T> {
    const started = now();
    while (true) {
      try {
        mkdirSync(lockDirectory, { recursive: false });
        try {
          return operation();
        } finally {
          rmdirSync(lockDirectory);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          try {
            if (now() - statSync(lockDirectory).mtimeMs > 2000)
              rmdirSync(lockDirectory);
          } catch {
            // Another process may have released the lock between stat and removal.
          }
        }
        if (now() - started >= lockTimeoutMs) throw error;
        await sleep(
          Math.min(retryDelayMs, Math.max(1, lockTimeoutMs - (now() - started)))
        );
      }
    }
  }

  async function schedule(): Promise<number> {
    try {
      mkdirSync(root, { recursive: true });
      const slot = await underLock(() => {
        const state = readState(stateFile);
        const start = Math.max(now(), state.nextSlotAt, state.coolDownUntil);
        writeStateAtomic(stateFile, {
          ...state,
          nextSlotAt: start + 1000 / budget + 1,
        });
        return start;
      });
      const wait = Math.max(0, slot - now());
      counts.totalWaitMs += wait;
      if (wait) await sleep(wait);
      return slot;
    } catch (error) {
      counts.fallbacks++;
      if (!fallbackLogged) {
        options.log?.(
          `Shared SEC pace unavailable; falling back to 2 requests/s for this process: ${String(error).slice(0, 200)}`
        );
        fallbackLogged = true;
      }
      const slot = Math.max(now(), fallbackNext);
      fallbackNext = slot + 500;
      const wait = Math.max(0, slot - now());
      counts.totalWaitMs += wait;
      if (wait) await sleep(wait);
      return slot;
    }
  }

  async function recordResponse(
    status: number,
    body = "",
    retryAfterSeconds = 0
  ): Promise<void> {
    counts.requests++;
    if (status === 429) counts.status429++;
    if (status === 403) counts.status403++;
    if (status >= 500) counts.status5xx++;
    const rateLimited =
      status === 429 ||
      (status === 403 && /(?:rate|exceed|too many)/i.test(body));
    if (!rateLimited) return;
    const waitSeconds = Math.max(600, retryAfterSeconds);
    const until = now() + waitSeconds * 1000;
    try {
      await underLock(() => {
        const state = readState(stateFile);
        const coolDownUntil = Math.max(state.coolDownUntil, until);
        writeStateAtomic(stateFile, {
          coolDownUntil,
          nextSlotAt: Math.max(state.nextSlotAt, coolDownUntil),
        });
      });
      counts.coolDowns++;
    } catch {
      counts.fallbacks++;
      fallbackNext = Math.max(fallbackNext, until);
      if (!fallbackLogged) {
        options.log?.(
          "Shared SEC cool-down state unavailable; applying it to this process"
        );
        fallbackLogged = true;
      }
    }
  }

  return {
    schedule,
    recordResponse,
    telemetry: () => ({ ...counts }),
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      appendTelemetry();
    },
  };
}
