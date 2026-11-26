export class OfficialSiteClient {
  private readonly cookies = new Map<string, string>();
  private lastRequest = 0;
  requests = 0;

  constructor(private readonly site: string, private readonly fetcher: typeof fetch = fetch, private readonly minIntervalMs = 1000) {}

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    let current = url;
    let method = init.method ?? "GET";
    let body = init.body;
    for (let redirects = 0; redirects < 6; redirects++) {
      const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastRequest));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      const headers = new Headers(init.headers);
      headers.set("User-Agent", "alpha-engine-public-research/1.0");
      const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      if (cookie) headers.set("Cookie", cookie);
      let response: Response;
      try {
        response = await this.fetcher(current, { ...init, method, body, headers, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(60_000) });
      } catch (error) {
        const name = error instanceof Error ? error.name : "Error";
        const code = (error as { cause?: { code?: string } })?.cause?.code;
        throw new Error(`${this.site} request ${name}${code ? ` (${code})` : ""}`);
      }
      this.lastRequest = Date.now();
      this.requests++;
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";", 1)[0];
        const separator = pair.indexOf("=");
        if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) throw new Error(`${this.site} redirect has no location`);
      current = new URL(location, current).href;
      if ([301, 302, 303].includes(response.status)) {
        method = "GET";
        body = undefined;
      }
    }
    throw new Error(`${this.site} exceeded five redirects`);
  }

  async body(url: string, init: RequestInit = {}): Promise<Buffer> {
    const response = await this.request(url, init);
    if (!response.ok) throw new Error(`${this.site} HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

export function csrfToken(html: string): string {
  const match = html.match(/<input[^>]+name=["']csrfmiddlewaretoken["'][^>]*>/i);
  const value = match?.[0].match(/value=["']([^"']+)["']/i)?.[1];
  if (!value) throw new Error("Senate agreement has no CSRF token");
  return value;
}
