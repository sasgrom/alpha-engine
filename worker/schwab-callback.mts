/** One-shot local HTTPS OAuth callback for Schwab. No credentials are logged. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { exchangeSchwabCode, saveSchwabToken, schwabAuthorizeUrl, schwabSmokeQuotes } from "./lib/schwab";

const clientId = process.env.SCHWAB_CLIENT_ID;
const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET in this PowerShell session first.");
  process.exit(1);
}
const pfx = readFileSync("worker/cache/schwab/callback.pfx");
const server = createServer({ pfx, passphrase: process.env.SCHWAB_CALLBACK_PASSPHRASE ?? "alpha-callback" }, async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "https://127.0.0.1:8182");
    if (url.pathname !== "/") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Missing authorization code. Return to the Schwab authorization URL and approve access.");
      return;
    }
    const token = await exchangeSchwabCode(code, clientId, clientSecret);
    const saved = saveSchwabToken(token);
    const smoke = await schwabSmokeQuotes(saved.access_token);
    res.writeHead(smoke.status === 200 ? 200 : 502, { "content-type": "text/plain; charset=utf-8" });
    res.end(smoke.status === 200
      ? "Schwab authorization complete. Token saved and AAPL quote works. You can close this window."
      : `Token saved, but AAPL quote returned HTTP ${smoke.status}. You can close this window.`);
    console.log(`[schwab] token saved · expires ${saved.expiresAt} · quotes HTTP ${smoke.status}`);
    server.close();
  } catch (error) {
    console.error(`[schwab] ${String(error).slice(0, 400)}`);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Token exchange failed. Check Client ID, Client Secret and authorization code, then retry.");
  }
});
server.listen(8182, "127.0.0.1", () => {
  console.log(`[schwab] Open this URL in your browser:\n${schwabAuthorizeUrl(clientId)}`);
});
setTimeout(() => {
  console.error("[schwab] Callback timeout after 15 minutes. Restart the script to retry.");
  process.exit(2);
}, 15 * 60_000).unref();
