---
title: Connect your editor
description: One-click setup of this app's MCP server in Cursor, VS Code, Claude, Codex and 18 more clients
---

# Connect your editor

The **Connect** page (`builtin.connect`, app shell) puts the app's MCP server
in the editors and agents people already use: Cursor, VS Code, Claude Code,
Claude Desktop, Codex, Gemini CLI, Devin Desktop (Windsurf), Zed, Kiro, TRAE,
Antigravity, JetBrains Junie, Cline, Continue, OpenCode, Goose, Amp, LM
Studio, Raycast, Copilot CLI, ChatGPT, and any other MCP client.

## Turn it on

| Setup | What the page connects to |
|---|---|
| Zero config: `pip install praisonai-mcp` | The local PraisonAI MCP server over stdio (`praisonai-mcp serve`) |
| One line: `AIUI_MCP_URL=https://host/mcp` | A running HTTP MCP server, for example your agents behind `serve_agents([...])` |
| Neither | The page says how to install `praisonai-mcp` |

**(planned)** The page itself ships in the next PR; this one adds its two
routes. The page needs `style: app`. It has no view in the default `dashboard`
style. Turn it off with `extensions: {disabled: [builtin.connect]}`.

## What the page does

- **A client rail** grouped by Editors, Terminal and Other. Clients installed
  on this machine come first. A dot marks the ones that already have the
  PraisonAI entry.
- **One-click install** for every client with a deep link: Cursor, VS Code,
  VS Code Insiders, Kiro, TRAE, LM Studio and Raycast; for a remote server,
  also Goose and the claude.ai connector. After a click the page waits
  2 seconds for the window to lose focus. If nothing takes the link, it
  offers **Try again** and the client's download page.
- **`praisonai connect <client>`**, with a copy button. The command writes
  the client's config itself, shows a diff, keeps a backup and checks the
  server with a real MCP handshake. There is also the client's own command
  and the manual snippet, with the config file path.
- **A scope picker.** It splits your agents (`ask_*`) from the other tools,
  using a real `tools/list`, and rewrites the link, the commands and the
  snippet. The scope travels as a server argument (`--tools`), so it holds
  in every client, deep links included. The page warns when a client's tool
  cap is exceeded (TRAE takes 40, VS Code 128).
- **Connected clients.** The server records each MCP `clientInfo` it sees.
  Each row says what to do next:
  - **Connected**, with sessions and when it was last used.
  - **Configured, not used yet**: restart the client.
  - **Plain-text key in its config**: reconnect so the key becomes an env
    reference.

  **Fix it** opens that client.
- **`?client=<id>`** (or `?ide=<id>`) preselects a client, so a README can
  link straight to its setup.
- **Cloud-hosted clients** (claude.ai connectors, ChatGPT) are marked: they
  connect from the vendor's cloud and need a public https URL, not
  `localhost`.

## API

Both routes are owned by `builtin.connect` (`features/connect.py`) and sit
behind the host's auth in every mode (R8).

| Route | Returns |
|---|---|
| `GET /api/connect?tools=a,b` | `available`, `server`, `scopable`, `scope`, `clients` (`praisonai_mcp.connect.export_catalog`), `status` (per client: `status`, `last_active`, `plaintext_secrets`; no local paths), `connections` |
| `GET /api/connect/tools` | `ok`, `tools` (names), `count`, `server`, `error`, from one MCP handshake, cached for 5 minutes |

The client list comes from PraisonAI (`praisonai_mcp.connect`), the same code
behind `praisonai connect`, so the CLI, the docs and this page show the same
clients.

**(planned)** OAuth for servers exposed over HTTP, following the MCP
authorization spec, with a consent page and Revoke on this page.
