# Alpha Live Bridge

Alpha Live replaces Git-synchronized commands with the live Kimi web REST + WebSocket channel. A command is an isolated session with a bounded prompt; `turn.ended` supplies the terminal evidence.

## 1. Architecture

```text
Captain instruction
  → POST /api/v1/sessions
  → POST /api/v1/sessions/{id}/prompts
  → subscribe /api/v1/ws
  → turn.ended
  → GET /api/v1/sessions/{id}/messages
```

`worker/lib/alpha-live.ts` implements session creation, prompt submission, turn waiting and transcript reads. `worker/alpha-live-execute.mts` executes a direct instruction or the oldest pending local command. Git is not a command transport; `ALPHA_COMMANDS.jsonl` remains optional audit evidence only.

## 2. Start Kimi web locally

For a loopback-only test:

```powershell
kimi web --host 127.0.0.1 --port 58627 --no-open
```

For access from another machine through Tailscale:

```powershell
kimi web --host <TAILSCALE_IP> --port 58627 --no-open
```

Use only a private Tailscale address, never a public IP. The startup banner includes a bearer token; store it only in a local secret store and never in Git, screenshots or chat.

To run Kimi web at every logon without an open terminal, create one Windows task:

```powershell
schtasks /Create /TN AlphaEngine-Kimi-Web /SC ONLOGON /TR "powershell.exe -WindowStyle Hidden -Command \"kimi web --host <TAILSCALE_IP> --port 58627 --no-open\"" /F
schtasks /Run /TN AlphaEngine-Kimi-Web
```

Use `127.0.0.1` instead of `<TAILSCALE_IP>` when remote access is unnecessary.

## 3. Configure the executor

Loopback example:

```powershell
$env:ALPHA_KIMI_WEB_URL = "http://127.0.0.1:58627"
$env:ALPHA_KIMI_WEB_TOKEN = "<local-token>"
```

Tailscale example:

```powershell
$env:ALPHA_KIMI_WEB_URL = "http://<TAILSCALE_IP>:58627"
$env:ALPHA_KIMI_WEB_ALLOW_PRIVATE_HTTP = "1"
$env:ALPHA_KIMI_WEB_TOKEN = "<local-token>"
```

Private HTTP requires explicit `ALPHA_KIMI_WEB_ALLOW_PRIVATE_HTTP=1`. Without it, only HTTPS and loopback HTTP are accepted. Do not expose this endpoint publicly and do not use `--dangerous-bypass-auth`.

## 4. Execute a live command

```powershell
npx tsx worker/alpha-live-execute.mts --id hello-live --instruction "Say hello world. Do not change files or production state. Return a short greeting."
```

Expected flow:

- unauthenticated `/api/v1/healthz` liveness check;
- authenticated session creation with `cwd = C:\dev\alpha-engine`;
- bounded prompt submission;
- WebSocket subscription to `turn.ended`;
- transcript read-back.

For pending command files, omit `--instruction` and let the script take the oldest pending local command. Do not run `alpha-live-execute` concurrently with `alpha-bridge-agent` for the same command ID.

## 5. Security and limits

- Bearer token is required for session and prompt APIs and for the WebSocket subprotocol.
- The token never appears in source, logs or response summaries.
- One session and one turn per live instruction, with a ten-minute default timeout.
- No Git, shell prompt interpolation or direct production transport.
- Existing owner deny rules still apply to code, collectors, credentials, migrations, GDELT and history-changing actions.
- REST and WebSocket contracts are experimental; the live `/openapi.json` and `/asyncapi.json` from the running server take precedence when they differ from older documentation.

## 6. Verification

Mock integration tests cover session creation, prompt content and authorization, `turn.ended`, transcript reading, liveness, token requirements and private HTTP opt-in. No live model invocation was performed in this workspace.
