/**
 * Whether scheduled jobs push their operational outputs to production.
 * Owner's decision of 2026-11-13: "no pushes to prod, it was just a temp dev online". Nothing is pushed unless the
 * owner sets OPERATIONAL_PUSH=1 for the scheduler (an explicit opt-in if a production site returns). Kept apart from
 * prod-push.ts so that the desk's health check can read it without loading the push code.
 */
export function operationalPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPERATIONAL_PUSH === "1";
}
