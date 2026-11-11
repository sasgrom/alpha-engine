import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ token: { access_token: "a1", refresh_token: "r1", expires_in: 1800, token_type: "Bearer", createdAt: "", expiresAt: "" }, fresh: true, responses: [] as { status: number; body: string }[], calls: [] as string[], refreshed: 0 }));

vi.mock("./schwab", () => ({
  loadSchwabToken: () => ({ ...state.token }),
  isSchwabTokenFresh: () => state.fresh,
  refreshSchwabToken: async () => { state.refreshed++; state.fresh = true; return { access_token: "a2", refresh_token: "r1", expires_in: 1800, token_type: "Bearer" }; },
  saveSchwabToken: (token: any) => ({ ...token, createdAt: "", expiresAt: "" }),
  schwabGet: async (pathname: string, access: string) => { state.calls.push(`${access} ${pathname}`); return state.responses.shift() ?? { status: 200, body: "{}" }; },
  schwabTraderGet: async (pathname: string, access: string) => { state.calls.push(`trader ${access} ${pathname}`); return { status: 200, body: "{}" }; },
}));

import { createSchwabSession } from "./schwab-paced";

describe("paced Schwab session", () => {
  beforeEach(() => {
    state.fresh = true;
    state.responses = [];
    state.calls = [];
    state.refreshed = 0;
  });

  it("spaces consecutive requests by the minimum interval", async () => {
    const waits: number[] = [];
    const session = createSchwabSession({ minIntervalMs: 1000, sleep: async (ms) => { waits.push(ms); } });
    await session.get("quotes?symbols=AAPL");
    await session.get("quotes?symbols=MSFT");
    expect(state.calls).toEqual(["a1 quotes?symbols=AAPL", "a1 quotes?symbols=MSFT"]);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(900);
  });

  it("waits and retries on HTTP 429, then reports other failures with their status", async () => {
    const waits: number[] = [];
    state.responses = [{ status: 429, body: "slow down" }, { status: 200, body: "{\"ok\":true}" }, { status: 401, body: "expired" }];
    const session = createSchwabSession({ minIntervalMs: 0, retryAfterMs: 5, sleep: async (ms) => { waits.push(ms); } });
    await expect(session.get("chains?symbol=AAPL")).resolves.toBe("{\"ok\":true}");
    expect(waits).toContain(5);
    await expect(session.get("chains?symbol=MSFT")).rejects.toMatchObject({ httpStatus: 401 });
  });

  it("refreshes an expiring token before the request instead of failing mid-run", async () => {
    process.env.SCHWAB_CLIENT_ID = "id";
    process.env.SCHWAB_CLIENT_SECRET = "secret";
    state.fresh = false;
    const session = createSchwabSession({ minIntervalMs: 0, sleep: async () => {} });
    await session.get("pricehistory?symbol=SPY");
    expect(state.refreshed).toBe(1);
    expect(state.calls).toEqual(["a2 pricehistory?symbol=SPY"]);
  });

  it("fails before any request when the token cannot be renewed", async () => {
    delete process.env.SCHWAB_CLIENT_ID;
    state.fresh = false;
    await expect(createSchwabSession().prepare()).rejects.toThrow(/Access token expired/);
    expect(state.calls).toEqual([]);
  });
});
