/**
 * The operations console's procedures, for the home machine only. Enabled solely by LOCAL_WORKER_UI=1 in .env;
 * anywhere else every procedure but `enabled` is FORBIDDEN (changing what the machine runs is a home-console power).
 *
 * The console never starts a process itself: a switch or schedule is written to the scheduler's settings file, and
 * Run and Stop are lines in its command file, which the one scheduler reads. The first console's own launcher
 * (spawned workers, a run registry, the task-scheduler query and the upstream probe) went with the classic view on
 * 2026-11-24.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery } from "../middleware";
import { OPERATION_JOB_MAP } from "../../contracts/operations";
import { OPERATIONS_RUNS_DIR, appendOperationCommand, loadOperationConfig, loadOperationsState, operationChain, saveOperationConfig } from "../../worker/lib/operations-scheduler";

function requireLocal() {
  if (process.env.LOCAL_WORKER_UI !== "1") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Workers console is local-only (set LOCAL_WORKER_UI=1 in the home .env)" });
  }
}

export const workersLocalRouter = createRouter({
  enabled: adminQuery.query(() => ({ enabled: process.env.LOCAL_WORKER_UI === "1" })),

  operations: adminQuery.query(() => {
    requireLocal();
    return { config: loadOperationConfig(), state: loadOperationsState() };
  }),

  setOperation: adminQuery.input(z.object({
    jobId: z.string().min(1).max(100),
    enabled: z.boolean(),
    cron: z.string().trim().min(1).max(80).nullable(),
  })).mutation(({ input }) => {
    requireLocal();
    const job = OPERATION_JOB_MAP[input.jobId];
    if (!job || !["scheduled", "paused"].includes(job.mode)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only scheduled or paused registry jobs can be edited" });
    if (job.cron !== null && !input.cron) throw new TRPCError({ code: "BAD_REQUEST", message: "This root job requires a cron expression" });
    if (job.cron === null && input.cron) throw new TRPCError({ code: "BAD_REQUEST", message: "This job is dependency-triggered and cannot have an independent cron" });
    const config = loadOperationConfig();
    config[job.id] = { enabled: input.enabled, cron: input.cron };
    saveOperationConfig(config);
    return { ok: true };
  }),

  runOperation: adminQuery.input(z.object({ jobId: z.string().min(1).max(100) })).mutation(({ input }) => {
    requireLocal();
    const chain = operationChain(input.jobId);
    if (chain.some((job) => !job.executable || ["frozen", "blocked"].includes(job.mode))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This registry entry is documentation-only, frozen or requires terminal review" });
    }
    const id = `${Date.now()}-${input.jobId}`;
    appendOperationCommand({ id, action: "run", jobId: input.jobId, requestedAt: new Date().toISOString() });
    return { id, chain: chain.map((job) => job.id) };
  }),

  killOperation: adminQuery.input(z.object({ jobId: z.string().min(1).max(100) })).mutation(({ input }) => {
    requireLocal();
    if (!OPERATION_JOB_MAP[input.jobId]) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown operation job" });
    appendOperationCommand({ id: `${Date.now()}-${input.jobId}`, action: "kill", jobId: input.jobId, requestedAt: new Date().toISOString() });
    return { ok: true };
  }),

  operationLog: adminQuery.input(z.object({ jobId: z.string().min(1).max(100), lines: z.number().min(1).max(500).default(120) })).query(({ input }) => {
    requireLocal();
    const run = loadOperationsState().lastRuns[input.jobId];
    if (!run || path.dirname(path.resolve(run.logFile)) !== path.resolve(OPERATIONS_RUNS_DIR) || !existsSync(run.logFile)) return { lines: [] };
    return { lines: readFileSync(run.logFile, "utf8").split(/\r?\n/).slice(-input.lines) };
  }),
});
