import { afterEach, describe, expect, it, vi } from "vitest";
import { isSchwabTokenFresh, schwabAuthorizeUrl, schwabBasicAuth, schwabGet, schwabTraderGet, SCHWAB_CALLBACK_URL } from "./schwab";

afterEach(() => vi.unstubAllGlobals());

describe("Schwab OAuth helpers", () => {
  it("builds an authorize URL with an exact encoded callback", () => {
    const url = schwabAuthorizeUrl("client-id");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain(`redirect_uri=${encodeURIComponent(SCHWAB_CALLBACK_URL)}`);
    expect(url).toContain("127.0.0.1%3A8182");
  });

  it("builds basic auth without changing the credentials", () => {
    expect(schwabBasicAuth("id", "secret")).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(schwabBasicAuth("id", "secret")).not.toContain("secret");
  });

  it("requires a safety margin before treating an access token as fresh", () => {
    const now = Date.now();
    expect(isSchwabTokenFresh({ createdAt: "", access_token: "", refresh_token: "", expires_in: 1800, token_type: "Bearer", expiresAt: new Date(now + 120_000).toISOString() })).toBe(true);
    expect(isSchwabTokenFresh({ createdAt: "", access_token: "", refresh_token: "", expires_in: 1800, token_type: "Bearer", expiresAt: new Date(now - 1000).toISOString() })).toBe(false);
  });

  it("keeps market-data and Trader User Preference on their respective services", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);
    await schwabGet("quotes?symbols=AAPL", "fake-market-token");
    await schwabTraderGet("userPreference", "fake-trader-token");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.schwabapi.com/marketdata/v1/quotes?symbols=AAPL");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.schwabapi.com/trader/v1/userPreference");
  });
});
