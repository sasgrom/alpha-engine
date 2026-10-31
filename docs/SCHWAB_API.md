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

## Unattended refresh and history collection

The Operations registry schedules `worker/schwab-refresh.mts` every two days at 02:00 local time. Each successful refresh rotates and saves the local tokens, so the approximately seven-day refresh-token window stays alive during normal operation. The REST collector runs separately every day and can also refresh an expiring access token when credentials are available.

A PowerShell `$env:` assignment exists only in that terminal and is not inherited by Windows Task Scheduler. For unattended operation on the private home machine, set the same credentials once in the Windows user environment of the account that runs the task:

```powershell
[Environment]::SetEnvironmentVariable("SCHWAB_CLIENT_ID", "paste-client-id-here", "User")
[Environment]::SetEnvironmentVariable("SCHWAB_CLIENT_SECRET", "paste-client-secret-here", "User")
```

These values stay in the local user profile and never enter Git or browser code. User-scoped environment variables are configuration, not an encrypted password vault; use this only on the private home account. After setting them, sign out/in or restart Windows once so the task process inherits the new environment. Do not place secrets in the scheduled task action or command line.

The daily collector and the keepalive job share `D:\research\alpha-engine\schwab\token.json`. Browser authorization should be unnecessary unless the refresh token is revoked, the app credentials/permissions change, or the machine remains offline beyond the refresh window. The collector also writes normalized snapshots to both `public/reports` and an existing `dist/public/reports`, so a production rebuild is not required for new Schwab data. A build is required only for application code changes.

## Oversized option chains

A full-chain HTTP 502 containing `TooBigBody` or `Body buffer overflow` triggers one bounded fallback: at most 60 monthly chain windows covering five years. Every raw window is stored separately under `chains/YYYY-MM-DD/chunks/<ticker>/` and hashed into merged provenance. The normalized manifest records the chunk count. Any failed window leaves the ticker partial; there is no infinite retry and no silent partial-chain success.

## Troubleshooting

- `ERR_CONNECTION_REFUSED`: run `worker/schwab-callback.mts` first, then reopen the authorization URL.
- `400 invalid_grant`: use a new authorization code and keep the callback exactly `https://127.0.0.1:8182`.
- `401 invalid_client`: check Client ID, Client Secret and `Ready For Use` status.
- `Missing authorization code`: return to the printed authorization URL and complete account approval.
- `quotes HTTP 401`: run `worker/schwab-refresh.mts` to refresh the access token.
