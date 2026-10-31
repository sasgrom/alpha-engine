export type LlmSourceStatus = "extracted" | "empty" | "unparsed" | "request_failed";

/** Transport failures abort a batch; content/schema failures are isolated per source. */
export function nextLlmFailureStreak(status: LlmSourceStatus, current: number): number {
  return status === "request_failed" ? current + 1 : 0;
}
export function shouldAbortLlmBatch(consecutiveRequestFailures: number): boolean {
  return consecutiveRequestFailures >= 2;
}
