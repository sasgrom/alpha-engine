export class AuthRequiredError extends Error {
  constructor(message = "A prediction-market endpoint requires a key; collection stops") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

const HOSTS = new Set(["api.elections.kalshi.com", "external-api.kalshi.com", "gamma-api.polymarket.com", "clob.polymarket.com"]);
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface PublicHttp {
  get(url: string): Promise<any>;
  readonly requests: number;
  readonly retries: number;
}

export function publicHttp(options: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; gapMs?: number; timeoutMs?: number } = {}): PublicHttp {
  const fetchImpl = options.fetchImpl ?? fetch, sleep = options.sleep ?? pause, gapMs = options.gapMs ?? 250, timeoutMs = options.timeoutMs ?? 40_000;
  let previous = 0, queue = Promise.resolve(), requests = 0, retries = 0, blocked = false;
  async function request(url: string): Promise<any> {
    const target = new URL(url);
    if (target.protocol !== "https:" || !HOSTS.has(target.hostname) || target.username || target.password) throw new Error(`A public prediction-market endpoint is required: ${target.origin}`);
    const wait = Math.max(0, gapMs - (Date.now() - previous));
    if (wait) await sleep(wait);
    for (let attempt = 0; attempt < 3; attempt++) {
      previous = Date.now();
      let response: Response;
      try {
        requests++;
        response = await fetchImpl(target, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (research client)" }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        if (attempt === 2) throw error;
        retries++;
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new AuthRequiredError();
      if (response.status === 404) return null;
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2) throw new Error(`Public endpoint answered HTTP ${response.status}`);
        retries++;
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(response.status === 429 ? Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt : 2000 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new Error(`Public endpoint answered HTTP ${response.status}`);
      const body: any = await response.json();
      const error = JSON.stringify(body?.error ?? "");
      if (/authentication|api[ _-]?key|unauthorized|missing.*token|token.*required/i.test(error)) throw new AuthRequiredError();
      return body;
    }
    throw new Error("Unreachable public request state");
  }
  return {
    get(url: string) {
      const next = queue.then(() => {
        if (blocked) throw new AuthRequiredError();
        return request(url).catch(error => {
          if (error instanceof AuthRequiredError) blocked = true;
          throw error;
        });
      });
      queue = next.catch(() => {});
      return next;
    },
    get requests() { return requests; },
    get retries() { return retries; },
  };
}
