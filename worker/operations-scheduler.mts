/** Alpha Engine's single home scheduler: cron, dependency chains and UI commands. */
import "dotenv/config";
import { acquireSchedulerLock, OperationsScheduler, releaseSchedulerLock } from "./lib/operations-scheduler";

// exactly one scheduler: a second start (the logon task, a watchdog, a person) finds the running one and leaves
const lock = acquireSchedulerLock();
if (!lock.acquired) {
  console.log(`[operations] not started: ${lock.reason}${lock.holder ? ` (pid ${lock.holder})` : ""}`);
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
