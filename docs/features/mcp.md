---
title: MCP servers
description: Give your agents the tools of any Model Context Protocol server, declared in YAML, over Streamable HTTP, SSE or stdio, with secrets kept on the server
---

# MCP servers

The **MCP** page (`builtin.mcp`) connects the app to Model Context Protocol
servers so agents can use their tools. Declare servers once in the config;
they connect when the app starts. Users can add more from the page only where
you allow it. Install the client once: `pip install "aiui[mcp]"`.

## Declare servers

```yaml
mcp:
  servers:
    github:
      url: https://api.githubcopilot.com/mcp/
      headers:
        Authorization: Bearer ${GITHUB_TOKEN}
    files:
      command: npx
      args: [-y, "@modelcontextprotocol/server-filesystem", "."]
```

Put the block in the config the app starts with (`aiui run app.py --config
aiui.yaml`) or in the data-dir `config.yaml` (`AIUI_DATA_DIR`, default
`~/.praisonaiui`). `aiui validate` checks it. Each server has a `url` or a
`command`, not both:

| Key | Meaning |
|---|---|
| `url` | Remote server (Streamable HTTP or SSE) |
| `command`, `args` | Local server started as a subprocess (stdio) |
| `env` | stdio: extra environment variables for the subprocess |
| `headers` | Remote: HTTP headers, for example `Authorization` |
| `transport` | `streamable-http`, `sse` or `stdio` (`type` works too). Usually not needed, see below |

`${NAME}` in `url`, `args`, `env` and `headers` reads the environment variable
`NAME`, so tokens stay out of the file. A list with a `name` per server
(`servers: [{name: github, url: ...}]`) works too; names must be unique.

The servers connect in the background at startup, all at once, so a slow
server never delays the app. One that fails shows its error on the page, with
a **Connect** button to try again. They disconnect when the app stops.

## Transports

| Server | What the app uses |
|---|---|
| `command` | stdio |
| `url` | Streamable HTTP; if the server does not answer it, SSE |
| `url` whose path ends in `/sse` | SSE |
| `transport: sse` or `transport: streamable-http` | Exactly that one, no fallback |

## What users may add

By default users can reconnect the declared servers but add nothing new. Open
it up with `allow`:

```yaml
mcp:
  allow:
    urls: ["*.example.com", "https://tools.partner.io/mcp/"]
    commands: [uvx]
```

| `allow.urls` entry | Admits |
|---|---|
| `mcp.example.com` | That host on its default port, `http` or `https` |
| `*.example.com` | Any subdomain of `example.com` |
| `https://h.example.com/mcp/` | That scheme and host, paths under `/mcp/` |
| `https://h.example.com:8443` | That port |
| `*` | Any public host |

A wildcard (`*`, `*.example.com`) never reaches a private, loopback or
link-local address, so users cannot reach your internal network or a cloud
metadata endpoint through the app. To allow an internal server, name its host:
`http://localhost:9000`.

`allow.commands` lists the executables users may start, matched exactly:
`npx` does not admit `/tmp/npx`. A user-added stdio server cannot set `env`.
Allowing `npx` or `uvx` lets users run any package they name, so list them
only for people you trust; `*` admits any command (the older
`PRAISONAIUI_ALLOW_REMOTE_MCP_STDIO=true` does the same). A user cannot reuse
a declared server's name for another target.

## Turn it off

`mcp: {enabled: false}`: nothing connects at startup and the page cannot add
servers. To remove the page and its routes: `extensions: {disabled: [builtin.mcp]}`.

## Secrets stay on the server

- `GET /api/mcp/servers` and the connect response show header and env names
  with `***` values, drop user and password from URLs, and mask query values
  (`?api_key=***`).
- Header and env values, every `${NAME}` value, and any `Bearer` token are
  redacted from the app's logs, tracebacks included.

## API

Every route needs the same credentials as the rest of the API in each auth mode.

| Route | Does |
|---|---|
| `GET /api/mcp/servers` | Servers with `status`, `transport`, `tools`, `last_error`, `source` (`config` or `user`) and masked `connection_data`; plus `enabled` and `allow` |
| `POST /api/mcp/connect` | `{name}` connects a declared server. `{name, url, headers?, transport?}` or `{name, command, args?}` adds one that `allow` admits (403 otherwise, 409 for a declared name) |
| `POST /api/mcp/disconnect/{name}` | Disconnects a server |

From Python, `aiui.on_mcp_connect` and `aiui.on_mcp_disconnect` run when a
server's state changes. App code may call
`praisonaiui.features.mcp.connect_mcp_server({...})` directly; the `allow`
lists apply to users, not to your code.
