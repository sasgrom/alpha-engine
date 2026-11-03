# Alpha Bridge MCP

Alpha Bridge is a local, stdio-only MCP channel between Kimi Code and other agent sessions. It does not open a socket, call production, execute Git/shell commands or expose arbitrary filesystem paths.

## 1. Operations

| Tool | Purpose | Limits |
|---|---|---|
| `read_handoff` | Read the newest shared messages | 1–50 messages |
| `append_message` | Append one credential-free message | Authors: `kimi-code`, `web-agent`, `owner`; 1–4000 characters |
| `report_status` | Read bridge, Git-ref and daily-health evidence | No Git status or shell execution |

The shared channel is `docs/ALPHA_BRIDGE.jsonl`, capped at the latest 100 messages. Writes are serialized with a bounded lock and committed atomically with a temporary-file rename. Corrupt JSONL fails closed instead of being overwritten.

`report_status` reads only fixed files: bridge JSONL, `.git/HEAD`, `refs/heads/main`, `refs/remotes/origin/main`, optional packed refs and `public/reports/daily-operations.json`. It does not calculate the working-tree diff. `refsMatch` only means the two commit IDs match, not that the tree is clean.

## 2. Activate in Kimi Code

The project config is `.kimi-code/mcp.json`:

```json
{
  "mcpServers": {
    "alpha-bridge": {
      "command": "npx",
      "args": ["tsx", "worker/alpha-bridge-mcp.mts"],
      "enabled": true,
      "startupTimeoutMs": 10000,
      "toolTimeoutMs": 10000
    }
  }
}
```

After `git pull`:

1. Review the command and `worker/alpha-bridge-mcp.mts` plus `worker/lib/alpha-bridge*.ts`.
2. Open a **new Kimi Code session**. A server added mid-session is registered only in later sessions.
3. Trust the workspace only after reviewing the stdio launch target.
4. Run `/mcp` to inspect the connection. Use **Show Logs** if it fails.

Project-level stdio MCP configuration executes `npx` at session start. Do not copy this configuration to another repository without reviewing the server and the working directory.

## 3. Use the channel

Example instruction to Kimi Code:

```text
Use alpha-bridge.append_message with:
from = "kimi-code"
message = "F-01/F-02 targeted tests passed. Next: full suite and build."
```

Read the response:

```text
Use alpha-bridge.read_handoff with limit = 5.
```

Check operational evidence:

```text
Use alpha-bridge.report_status.
```

The other agent reads `docs/ALPHA_BRIDGE.jsonl` from the repository. A message becomes visible to other sessions only after Kimi Code commits and pushes it. This is a reviewed Git-backed channel, not a production message bus and not a direct-to-production collector.

## 4. Security contract

- No shell commands, network listener, arbitrary paths or dynamic command arguments.
- No orders, accounts, balances, positions or brokerage activity.
- No credentials, tokens, passwords, authorization codes or private keys in messages. Typical credential markers are rejected.
- No production apply, deployment or automatic commits by the MCP server itself.
- Maximum 100 retained messages and 4000 characters per message.
- Protocol and storage errors return JSON-RPC errors without echoing the rejected secret input.

## 5. Verification

Unit tests cover bounded writes, retention, corrupt history, secret rejection, all three tool calls, unknown methods and fixed status evidence. A real stdio smoke test also completed `initialize → append_message → read_handoff → report_status` using isolated temporary storage.
