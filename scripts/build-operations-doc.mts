/** Generate the operator runbook from the same registry used by the scheduler and UI. */
import { writeFileSync } from "node:fs";
import { OPERATION_JOBS, OPERATION_MODULES } from "../contracts/operations";
import { validateOperationRegistry } from "../worker/lib/operations-scheduler";

const issues = validateOperationRegistry();
if (issues.length) throw new Error(issues.join("\n"));
const lines: string[] = [
  "# Alpha Engine Operations Runbook",
  "",
  "Generated from `contracts/operations.ts`. The scheduler, UI and this document share the same job registry.",
  "",
  "## 1. Normal home run stack",
  "",
  "Use exactly **one** web server on port 3000. The scheduler is a separate process. MySQL and Ollama are independent services.",
  "",
];
for (const module of OPERATION_MODULES) {
  lines.push(`### ${module.name}`, "", module.purpose, "", `- **When:** ${module.when}`, `- **Input:** ${module.input}`, `- **Output:** ${module.output}`, "", "```powershell", module.normalCommand, "```", "");
}
lines.push(
  "## 2. Install the single cron engine",
  "",
  "Run from `C:\\dev\\alpha-engine` after `git pull` and `npm install --no-audit --no-fund`:",
  "",
  "```powershell",
  "powershell -ExecutionPolicy Bypass -File worker\\operations-scheduler-install.ps1 -DisableLegacyTasks",
  "schtasks /Run /TN AlphaEngine-Operations-Scheduler",
  "```",
  "",
  "The installer creates one `ONLOGON` task. `-DisableLegacyTasks` disables old Stocktwits, GDELT and Digest tasks when present and skips tasks that do not exist, so reruns are idempotent. GDELT remains frozen. To inspect or stop the scheduler:",
  "",
  "```powershell",
  "schtasks /Query /TN AlphaEngine-Operations-Scheduler /V /FO LIST",
  "schtasks /End /TN AlphaEngine-Operations-Scheduler",
  "```",
  "",
  "For an interactive diagnostic run instead of the Windows task:",
  "",
  "```powershell",
  "npx tsx worker/operations-scheduler.mts",
  "```",
  "",
  "The scheduler reads cron configuration and UI commands every 15 seconds. It runs one job at a time. Dependency children start only after successful parents. A failed parent blocks its children. A missed cron slot is caught up once after a scheduler outage; a brand-new job starts at its next future slot. Cron uses the home machine's local timezone.",
  "",
  "Persistent files, all ignored by Git:",
  "",
  "- `worker/.runs/operations-config.json` — enabled flags and cron expressions.",
  "- `worker/.runs/operations-state.json` — heartbeat, queue, next runs and last-run status.",
  "- `worker/.runs/operations-commands.jsonl` — local owner-only UI command queue.",
  "- `worker/.runs/<run-id>.log` — stdout/stderr for each job.",
  "",
  "Cloud cannot spawn jobs. Every mutation requires the owner admin role and `LOCAL_WORKER_UI=1` on the home server. If `INGEST_URL` is absent, the scheduler supplies the local ingest URL; it never supplies a production URL.",
  "",
  "## 3. Operating modes",
  "",
  "- **Scheduled:** enabled by default; cron roots and dependency children form the normal pipeline.",
  "- **Paused:** fully configured but disabled until the owner enables the job in the UI.",
  "- **Manual:** run only on demand; research and dry-run jobs never acquire an automatic cron.",
  "- **Review gate:** documentation-only apply or unfinished work; not UI-runnable.",
  "- **Frozen:** no requests or execution; currently GDELT.",
  "",
  "## 4. Registry summary",
  "",
  "| Job | Mode | Cron / trigger | Destination |",
  "|---|---|---|---|",
  ...OPERATION_JOBS.map((job) => `| ${job.name} | ${job.mode} | ${job.cron ?? (job.dependsOn.length ? `after ${job.dependsOn.join(" + ")}` : "manual")} | ${job.destination.replaceAll("|", "\\|")} |`),
  "",
  "## 5. Complete job documentation",
  "",
);
for (const [index, job] of OPERATION_JOBS.entries()) {
  lines.push(
    `### ${index + 1}. ${job.name}`,
    "",
    `- **ID:** \`${job.id}\``,
    `- **Mode:** ${job.mode}; **enabled by default:** ${job.defaultEnabled ? "yes" : "no"}`,
    `- **Cron:** ${job.cron ?? "none"}`,
    `- **Dependencies:** ${job.dependsOn.length ? job.dependsOn.map((id) => `\`${id}\``).join(", ") : "none"}`,
    `- **Purpose:** ${job.purpose}`,
    `- **Input:** ${job.input}`,
    `- **Output:** ${job.output}`,
    `- **Destination:** ${job.destination}`,
    `- **Requirements:** ${job.requirements.join(", ") || "offline computation only"}`,
    `- **Operational note:** ${job.notes}`,
    "",
    "```powershell",
    job.command,
    "```",
    "",
  );
}
lines.push(
  "## 6. Daily review checklist",
  "",
  "1. Open `/workers`: scheduler heartbeat is online, no unexpected current/queued job, and next run is plausible.",
  "2. Open Activity for failed jobs; inspect the log rather than blindly rerunning the whole universe.",
  "3. Check `/market-data` coverage, manifest errors and duplicate OSI counts after the Schwab chain.",
  "4. Check Analytics and Expectations freshness after report builders and the production UI rebuild.",
  "5. Run dry-review jobs before any production transfer. Apply commands remain in the terminal and are never cron jobs.",
  "6. Do not start both dev and production web servers. Do not start a second scheduler or re-enable legacy overlapping tasks.",
  "",
);
writeFileSync("docs/OPERATIONS.md", `${lines.join("\n").trimEnd()}\n`);
console.log(`[operations] documented ${OPERATION_JOBS.length} jobs and ${OPERATION_MODULES.length} modules`);
