/** Alpha Engine's single home scheduler: cron, dependency chains and UI commands. */
import "dotenv/config";
import { acquireSchedulerLock, OperationsScheduler, releaseSchedulerLock } from "./lib/operations-scheduler";

// exactly one scheduler: a second start (the logon task, a watchdog, a person) finds the running one and leaves
const lock = acquireSchedulerLock();
if (!lock.acquired) {
  // the line is flushed before leaving: process.exit() drops output still queued for a pipe (npx and tsx run this
  // through pipes), and the watchdog's every-15-minute checks should leave a trace in the log
  await new Promise<void>((done) => process.stdout.write(`[operations] not started: ${lock.reason}${lock.holder ? ` (pid ${lock.holder})` : ""} at ${new Date().toISOString()}\n`, () => done()));
  process.exit(0);
}
if (lock.reason !== "free") console.log(`[operations] scheduler lock ${lock.reason}${lock.holder ? ` (previous pid ${lock.holder})` : ""}`);

const scheduler = new OperationsScheduler();
const stop = () => { scheduler.stop(); releaseSchedulerLock(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", () => releaseSchedulerLock());
// a long-running service: an unexpected error is written to the log and the scheduler keeps its cron and queue
process.on("uncaughtException", (error) => console.error(`[operations] uncaught error: ${error?.stack ?? String(error)}`));
process.on("unhandledRejection", (reason) => console.error(`[operations] unhandled rejection: ${String(reason)}`));
await scheduler.start();
