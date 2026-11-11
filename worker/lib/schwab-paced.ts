/**
 * One Schwab market-data session for long runs: requests are spaced to stay below the provider's limit of
 * 120 requests a minute, HTTP 429 waits and retries twice, and the access token (30 minutes) is renewed from the
 * token file or refreshed when it is about to expire, so a run longer than one token stays valid.
 * Token values never leave this module and are never logged.
 */
import { isSchwabTokenFresh, loadSchwabToken, refreshSchwabToken, saveSchwabToken, schwabGet, schwabTraderGet, type SchwabTokenFile } from "./schwab";

export interface SchwabSession {
  /** Renew the token now, so a missing credential or an expired refresh token fails before any work starts. */
  prepare(): Promise<void>;
  get(pathname: string, service?: "market" | "trader"): Promise<string>;
}

export interface SchwabSessionOptions {
  minIntervalMs?: number;
  retryAfterMs?: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export const SCHWAB_MIN_REQUEST_INTERVAL_MS = 550;
const TOKEN_MARGIN_SECONDS = 300;

export function createSchwabSession(options: SchwabSessionOptions = {}): SchwabSession {
  const minInterval = options.minIntervalMs ?? SCHWAB_MIN_REQUEST_INTERVAL_MS;
  const retryAfter = options.retryAfterMs ?? 30_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let token: SchwabTokenFile | null = null;
  let lastRequestAt = 0;

  async function accessToken(): Promise<string> {
    if (token && isSchwabTokenFresh(token, TOKEN_MARGIN_SECONDS)) return token.access_token;
    const latest = loadSchwabToken();                       // another job may have refreshed the shared token file
    if (isSchwabTokenFresh(latest, TOKEN_MARGIN_SECONDS)) {
      token = latest;
      return token.access_token;
    }
    const clientId = process.env.SCHWAB_CLIENT_ID, clientSecret = process.env.SCHWAB_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Access token expired. Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET, then run worker/schwab-refresh.mts");
    token = saveSchwabToken(await refreshSchwabToken(latest.refresh_token, clientId, clientSecret));
    options.log?.("access token refreshed");
    return token.access_token;
  }

  return {
    async prepare() {
      await accessToken();
    },
    async get(pathname, service = "market") {
      for (let attempt = 0; ; attempt++) {
        const wait = lastRequestAt + minInterval - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
        const access = await accessToken();
        const result = service === "trader" ? await schwabTraderGet(pathname, access) : await schwabGet(pathname, access);
        if (result.status === 429 && attempt < 2) {
          options.log?.(`HTTP 429 for ${pathname.split("?")[0]}; waiting ${Math.round(retryAfter / 1000)} s`);
          await sleep(retryAfter);
          continue;
        }
        if (result.status !== 200) {
          const error = new Error(`HTTP ${result.status}: ${result.body.slice(0, 180)}`) as Error & { httpStatus?: number };
          error.httpStatus = result.status;
          throw error;
        }
        return result.body;
      }
    },
  };
}
