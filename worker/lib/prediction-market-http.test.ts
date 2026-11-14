import { describe, expect, it, vi } from "vitest";
import { AuthRequiredError, publicHttp } from "./prediction-market-http";

const URL = "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXFED";

describe("keyless public HTTP", () => {
  it("stops on an authentication requirement and does not acquire a key", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    const http = publicHttp({ fetchImpl: fetchImpl as typeof fetch, sleep: async () => {} });
    await expect(http.get(URL)).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(http.get(URL)).rejects.toBeInstanceOf(AuthRequiredError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const options = fetchImpl.mock.calls[0] as unknown as [unknown, { headers: Record<string, string> }];
    expect(options[1].headers).not.toHaveProperty("Authorization");
  });

  it("also stops when a response body says a key is required", async () => {
    const http = publicHttp({ fetchImpl: async () => Response.json({ error: "API key required" }), sleep: async () => {} });
    await expect(http.get(URL)).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("uses bounded retries and respects Retry-After", async () => {
    const waits: number[] = [];
    let calls = 0;
    const http = publicHttp({
      fetchImpl: async () => ++calls < 3 ? new Response("{}", { status: 429, headers: { "Retry-After": "1" } }) : Response.json({ markets: [] }),
      sleep: async ms => { waits.push(ms); },
    });
    expect(await http.get(URL)).toEqual({ markets: [] });
    expect(calls).toBe(3);
    expect(http.retries).toBe(2);
    expect(waits).toEqual([1000, 1000]);
  });

  it("fails after two retries and returns null only for a missing resource", async () => {
    let calls = 0;
    const http = publicHttp({ fetchImpl: async () => { calls++; return new Response("{}", { status: 500 }); }, sleep: async () => {} });
    await expect(http.get(URL)).rejects.toThrow("HTTP 500");
    expect(calls).toBe(3);
    const missing = publicHttp({ fetchImpl: async () => new Response("{}", { status: 404 }), sleep: async () => {} });
    expect(await missing.get(URL)).toBeNull();
  });

  it("refuses non-public or credentialed endpoints", async () => {
    const http = publicHttp({ fetchImpl: async () => Response.json({}), sleep: async () => {} });
    await expect(http.get("http://api.elections.kalshi.com/trade-api/v2/markets")).rejects.toThrow("public prediction-market endpoint");
    await expect(http.get("https://user:pass@api.elections.kalshi.com/trade-api/v2/markets")).rejects.toThrow("public prediction-market endpoint");
  });
});
