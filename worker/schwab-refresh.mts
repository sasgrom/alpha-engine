/** Refresh the Schwab access token without reopening the browser. */
import "dotenv/config";
import { isSchwabTokenFresh, loadSchwabToken, refreshSchwabToken, saveSchwabToken, schwabSmokeQuotes } from "./lib/schwab";

const clientId = process.env.SCHWAB_CLIENT_ID;
const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET in this PowerShell session first.");
  process.exit(1);
}
const current = loadSchwabToken();
if (isSchwabTokenFresh(current)) {
  console.log(`[schwab] access token is still fresh until ${current.expiresAt}; no refresh needed`);
  const smoke = await schwabSmokeQuotes(current.access_token);
  console.log(`[schwab] quotes HTTP ${smoke.status}`);
  process.exit(smoke.status === 200 ? 0 : 1);
}
try {
  const refreshed = await refreshSchwabToken(current.refresh_token, clientId, clientSecret);
  const saved = saveSchwabToken(refreshed);
  const smoke = await schwabSmokeQuotes(saved.access_token);
  console.log(`[schwab] token refreshed · expires ${saved.expiresAt} · quotes HTTP ${smoke.status}`);
  if (smoke.status !== 200) process.exit(1);
} catch (error) {
  console.error(`[schwab] refresh failed: ${String(error).slice(0, 400)}`);
  console.error("Run worker/schwab-callback.mts for a fresh browser authorization if the refresh token expired or was revoked.");
  process.exit(1);
}
