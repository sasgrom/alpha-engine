import { readFileSync } from "node:fs";
import { writeJsonAtomic } from "./json-file";

export const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
export const SCHWAB_MARKET_URL = "https://api.schwabapi.com/marketdata/v1";
export const SCHWAB_CALLBACK_URL = "https://127.0.0.1:8182";
export const SCHWAB_TOKEN_FILE = process.platform === "win32"
  ? "D:\\research\\alpha-engine\\schwab\\token.json"
  : "worker/cache/schwab/token.json";

export function schwabAuthorizeUrl(clientId: string): string {
  return `https://api.schwabapi.com/v1/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(SCHWAB_CALLBACK_URL)}`;
}

export function schwabBasicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}
export interface SchwabTokenFile extends TokenResponse {
  createdAt: string;
  expiresAt: string;
}

async function postToken(form: Record<string, string>, clientId: string, clientSecret: string): Promise<TokenResponse> {
  const response = await fetch(SCHWAB_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: schwabBasicAuth(clientId, clientSecret),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Schwab token HTTP ${response.status}: ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as TokenResponse;
  if (!parsed.access_token || !parsed.refresh_token || !Number.isFinite(parsed.expires_in)) throw new Error("Schwab token response is incomplete");
  return parsed;
}

export function exchangeSchwabCode(code: string, clientId: string, clientSecret: string): Promise<TokenResponse> {
  return postToken({ grant_type: "authorization_code", code, redirect_uri: SCHWAB_CALLBACK_URL }, clientId, clientSecret);
}
export function refreshSchwabToken(refreshToken: string, clientId: string, clientSecret: string): Promise<TokenResponse> {
  return postToken({ grant_type: "refresh_token", refresh_token: refreshToken }, clientId, clientSecret);
}

export function saveSchwabToken(token: TokenResponse): SchwabTokenFile {
  const now = new Date();
  const file: SchwabTokenFile = {
    ...token,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
  };
  writeJsonAtomic(SCHWAB_TOKEN_FILE, file, true);
  return file;
}
export function loadSchwabToken(): SchwabTokenFile {
  return JSON.parse(readFileSync(SCHWAB_TOKEN_FILE, "utf8")) as SchwabTokenFile;
}
export function isSchwabTokenFresh(token: SchwabTokenFile, marginSeconds = 60): boolean {
  return Date.parse(token.expiresAt) > Date.now() + marginSeconds * 1000;
}

export async function schwabSmokeQuotes(accessToken: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${SCHWAB_MARKET_URL}/quotes?symbols=AAPL`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  return { status: response.status, body: body.slice(0, 1000) };
}
