/**
 * AI provider: the platform's OpenAI-compatible gateway (see the
 * website-ai skill).
 *  - key/URL are SERVER-ONLY (KIMI_AGENTGW_* from .env, injected by the
 *    platform);
 *  - the model is NEVER hard-coded — it comes from listModels()
 *    (api/ai-client.ts);
 *  - lazy initialization: env may be unloaded at import time (standalone
 *    scripts without `-r dotenv/config`);
 *  - every LLM call is billed to the site owner — scoring idempotency
 *    (uq_score_idem) doubles as billing protection.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/** env with a .env fallback load (Node >= 20.12), same as api/ai-client.ts. */
function readEnv(key: string): string {
  let value = process.env[key];
  if (!value) {
    try {
      process.loadEnvFile();
    } catch {
      // no .env — we fail below with a clear error
    }
    value = process.env[key];
  }
  if (!value) {
    throw new Error(`${key} is not injected: the site is not provisioned (publish/reopen the site once)`);
  }
  return value;
}

let cached: ReturnType<typeof createOpenAICompatible> | null = null;

/** The gateway provider; created once per process. */
export function kimiGw(): ReturnType<typeof createOpenAICompatible> {
  if (!cached) {
    cached = createOpenAICompatible({
      name: "kimi-gw",
      baseURL: readEnv("KIMI_AGENTGW_BASE_URL"),
      apiKey: readEnv("KIMI_AGENTGW_API_KEY"),
      includeUsage: true, // usage in the response — we store usageTokens in sentiment_scores
      supportsStructuredOutputs: true, // generateObject sends json_schema, not json_object
    });
  }
  return cached;
}
