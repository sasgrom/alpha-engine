# Schwab Local OAuth Callback

Use this for the local Market Data Production app. No account or order endpoints are used.

## One-time setup

1. Create the self-signed callback certificate:

```powershell
pwsh worker/schwab-new-cert.ps1
```

2. In the same PowerShell session, set credentials without writing them to `.env` or Git:

```powershell
$env:SCHWAB_CLIENT_ID = "paste-client-id-here"
$env:SCHWAB_CLIENT_SECRET = "paste-client-secret-here"
```

3. Start the callback server:

```powershell
npx tsx worker/schwab-callback.mts
```

4. The script prints the authorization URL. Open it in the browser, approve the brokerage account and wait for the callback. The page should report success and the server should stop itself.

The callback is HTTPS on `127.0.0.1:8182`. Because the development certificate is self-signed, the browser may show a certificate warning. Use this only for local development, not as a public callback or a reason to disable certificate validation globally.

The token is written atomically to `D:\research\alpha-engine\schwab\token.json`. No credentials are logged or saved in the repository.

## Restart / token refresh

Set the same two environment variables in the new PowerShell session, then run:

```powershell
npx tsx worker/schwab-refresh.mts
```

The refresh script uses the saved refresh token, updates the access token and runs the AAPL quotes smoke test. A fresh browser authorization is required only when the refresh token is expired, revoked or cannot be renewed.

## Troubleshooting

- `ERR_CONNECTION_REFUSED`: run `worker/schwab-callback.mts` first, then reopen the authorization URL.
- `400 invalid_grant`: use a new authorization code and keep the callback exactly `https://127.0.0.1:8182`.
- `401 invalid_client`: check Client ID, Client Secret and `Ready For Use` status.
- `Missing authorization code`: return to the printed authorization URL and complete account approval.
- `quotes HTTP 401`: run `worker/schwab-refresh.mts` to refresh the access token.
