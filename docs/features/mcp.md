---
title: MCP servers
description: Give your agents the tools of any Model Context Protocol server over Streamable HTTP, SSE or stdio, with secrets kept on the server
---

# MCP servers

The **MCP** page (`builtin.mcp`) connects the app to Model Context Protocol
servers so agents can use their tools. Install the client once:
`pip install "aiui[mcp]"`.

## Connect a server

On the page, **Connect server** takes a name and either a URL (remote server)
or a command (local server started as a subprocess). The same over the API:

```bash
curl -X POST localhost:8000/api/mcp/connect -H 'Content-Type: application/json' \
  -d '{"name": "github", "url": "https://api.githubcopilot.com/mcp/",
       "headers": {"Authorization": "Bearer <token>"}}'
```

## Transports

| Server | What the app uses |
|---|---|
| `command` (+ `args`, `env`) | stdio |
| `url` | Streamable HTTP; if the server does not answer it, SSE |
| `url` whose path ends in `/sse` | SSE |
| `"transport": "sse"` or `"transport": "streamable-http"` (`type` works too) | Exactly that one, no fallback |

## Secrets stay on the server

- `GET /api/mcp/servers` and the connect response show header and env names
  with `***` values, drop user and password from URLs, and mask query values
  (`?api_key=***`).
- Header and env values are redacted from the app's logs, tracebacks
  included. So is any `Bearer` token.

## API

Every route needs the same credentials as the rest of the API in each auth mode.

| Route | Does |
|---|---|
| `GET /api/mcp/servers` | Servers with `status`, `transport`, `tools`, `last_error` and masked `connection_data` |
| `POST /api/mcp/connect` | `{name, url, headers?, transport?}` or `{name, command, args?, env?}` |
| `POST /api/mcp/disconnect/{name}` | Disconnects a server |

stdio from the page is accepted from the same machine, with an API key, or
with `PRAISONAIUI_ALLOW_REMOTE_MCP_STDIO=true`.

From Python, `aiui.on_mcp_connect` and `aiui.on_mcp_disconnect` run when a
server's state changes.
