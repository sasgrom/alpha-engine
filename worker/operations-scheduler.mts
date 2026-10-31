/** Alpha Engine's single home scheduler: cron, dependency chains and UI commands. */
import "dotenv/config";
import { OperationsScheduler } from "./lib/operations-scheduler";

const scheduler = new OperationsScheduler();
process.on("SIGINT", () => { scheduler.stop(); process.exit(0); });
process.on("SIGTERM", () => { scheduler.stop(); process.exit(0); });
await scheduler.start();
