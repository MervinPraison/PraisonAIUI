# Deployment Guide

Production deployment guide for AIUI — covering Docker, environment variables, configuration, and security.

## Quick Start (Docker)

### Build the Image

```bash
cd /path/to/PraisonAIUI
docker build -t aiui:latest .
```

### Run with Default Settings

```bash
docker run -d \
  --name aiui \
  -p 8082:8082 \
  -e OPENAI_API_KEY=sk-... \
  aiui:latest
```

### Run with Custom Data Directory

```bash
docker run -d \
  --name aiui \
  -p 8082:8082 \
  -v /path/to/data:/data \
  -e AIUI_DATA_DIR=/data \
  -e OPENAI_API_KEY=sk-... \
  aiui:latest
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  aiui:
    build: .
    ports:
      - "8082:8082"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - AIUI_DATA_DIR=/data
      - AUTH_ENFORCE=true
    volumes:
      - aiui-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8082/health/live"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  aiui-data:
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AIUI_DATA_DIR` | `~/.praisonaiui` | Data directory for config, sessions, logs, and feature data (see below) |
| `AIUI_PORT` | `8082` | Server port (Docker only) |
| `AIUI_HOST` | `0.0.0.0` | Server bind address (Docker only) |
| `AUTH_ENFORCE` | `false` | Enforce Bearer token auth on every route except the public surface (see below) |
| `AIUI_ALLOWED_ORIGINS` | — | Comma-separated origins allowed to call the server from another site (CORS and cross-site requests); `*` allows any |
| `AIUI_ALLOWED_HOSTS` | — | Comma-separated host names the server answers to when reached on a loopback or private address (`.example.com` also matches subdomains); `*` turns the check off |
| `AIUI_KNOWLEDGE_ROOTS` | — | Folders (`os.pathsep`-separated) that `POST /api/knowledge/add-file` may read, in addition to the chat attachments folder; any other `file_path` is refused with 400 |
| `AIUI_MAX_BODY_MB` | `25` | Largest request body in MiB; a bigger one gets 413 before it is read. `0` turns this cap off. Paths that need no credentials (login, sign-up, protocol negotiation) always take at most 64 KiB |
| `AIUI_PUBLIC_STATIC_DIR` | — | `1` serves every file in a `static_dir` without credentials (see [Auth Enforcement](#auth-enforcement)); by default only code, styles, fonts, images and the HTML shell are public |
| `OPENAI_API_KEY` | — | OpenAI API key for LLM provider |

### Feature data and the data directory

When `AIUI_DATA_DIR` or `PRAISONAI_HOME` is set (`PRAISONAI_HOME` wins when both are),
feature data lives under that directory, so two servers with different data
directories never see each other's data:

| Data | With a data directory | Without one (default install) | Explicit override |
|------|-----------------------|-------------------------------|-------------------|
| Recorded runs (Overview, Replay, Runs) | `<data dir>/traces` | `~/.praison/traces` | `PRAISONAI_TRACES_DIR`, then `PRAISON_HOME/traces` |
| Memory | `<data dir>/memory` | `~/.praisonai/memory` and `./.praisonai/memory` | — |
| Knowledge store | `<data dir>/knowledge` | `./.praisonai` | — |
| Training sessions | `<data dir>/train` | `~/.praison/train` | `PRAISON_TRAIN_DIR` |
| MCP server list | `<data dir>/mcp.json` | `~/.praisonai/mcp.json` | — |
| Video projects | `<data dir>/projects` | `~/.praisonai/projects` | `PRAISONAI_PROJECTS_DIR`, `set_video_engine(projects_dir=)` |

Setting `AIUI_DATA_DIR` to its default, `~/.praisonaiui`, counts as not set.

The PraisonAI CLI always records runs to `~/.praison/traces`. A server with a data
directory does not show those runs unless you also set
`PRAISONAI_TRACES_DIR=~/.praison/traces`.

### Auth Enforcement

When `AUTH_ENFORCE=true`, every route requires a valid Bearer token in the `Authorization` header: `/api/*`, and also `/sessions`, `/run`, `/cancel`, `/agents/{id}/runs`, `/teams/*`, `/v1/*` (OpenAI-compatible), `/agui` and any route a plugin adds. Only the public surface answers without one (deny by default):

```bash
# Without AUTH_ENFORCE (default): open access
curl http://localhost:8082/api/config

# With AUTH_ENFORCE=true: requires auth
curl -H "Authorization: Bearer <api-key>" http://localhost:8082/api/config
```

**Public paths** (always accessible without auth):
- `/health`, `/health/live`, `/health/ready`, `/api/health` — health checks
- `/api/auth/login`, `/login` — login endpoints
- `/api/protocol`, `/api/protocol/negotiate` — protocol discovery
- the HTML page for a browser navigation (`/`, `/chat`, …; under `style: app`
  `/sessions` and `/agents` too, but only as the page, never their JSON)
- static code: `/assets/*`, `/plugins/*`, `/_aiui/externals/*`, `/_plugins/*`,
  `/icon.svg`, `/manifest.json`, `/sw.js`, `/custom.js`, `/ui-config.json`
- OAuth sign-in: `GET /api/auth/oauth/{provider}` and its `/callback` (they
  only redirect)

**A `static_dir` folder** (`create_app(static_dir=...)`, `aiui run --config`)
is not public as a whole. Its code, styles, fonts and images
(`.js .mjs .css .map .woff .woff2 .ttf .otf .eot .svg .png .jpg .jpeg .gif .webp .avif .ico`)
answer without credentials. So do its HTML pages, but under `AUTH_ENFORCE` and
`require_auth` they are served as the app shell only: the page's inlined
markdown and `<noscript>` copy are removed. Markdown, JSON (a search index) and
any other file need credentials, under `AUTH_ENFORCE`, `require_auth` and
URL-token mode alike. The docs app sends the stored access token with every
request it makes (pages, manifests, search). A reader who has not signed in
sees the sign-in prompt, and after entering the token reads the site as on an
open server. Page titles and descriptions stay visible: `/docs-nav.json` lists
them for the sidebar. To keep the folder public in front of a private API, set
`AIUI_PUBLIC_STATIC_DIR=1`.

A built docs site served by `aiui serve` takes a password, open pages and
reader groups from `content.docs.auth` instead ([docs sign-in](docs-auth.md)).

WebSocket handshakes are gated too (all of them). Browsers cannot send an
`Authorization` header on a WebSocket, so the UI first exchanges its key for a
single-use ticket (`POST /api/auth/ws-ticket`, valid 60 s) and connects with
`?ticket=`. Clients that cannot do that may still send `?token=<key>`; it is
redacted from the server's access log.

The other auth modes gate WebSockets as well: URL-token mode
(`AIUI_REQUIRE_TOKEN=1`) accepts its session cookie, a Bearer header, `?token=`
or a ticket; `create_app(require_auth=True)` / YAML `auth.requireAuth` checks
session tokens on every route and socket except the public surface above.

### Self-registration under `requireAuth`

A token from `POST /register` passes the `requireAuth` check, so registration is
closed by default. `POST /register` is accepted only:

- for the **first user**: while no account exists (and no login, password,
  header or OAuth callback is registered), the first registration creates it;
- from a **signed-in user** (`Authorization: Bearer <session token>`), to add
  an account;
- for **anyone** when the config opts in:

```yaml
auth:
  requireAuth: true
  allowSignup: true   # open sign-up: any visitor can register and sign in
```

(`create_app(config={"auth": {"requireAuth": True, "allowSignup": True}})` from
Python.) Otherwise it returns `403 {"error": "Registration is closed"}`.
Accounts live in memory, so after a restart the first-user window is open
again until someone registers; create the admin in your app at startup
(`praisonaiui.auth.register_user("admin", password)`) to close it. Under
`AUTH_ENFORCE` and URL-token mode `/register` already needs the API key or URL
token, as before; with no auth mode it stays open.

### Sessions

Signing in (`POST /login`, `POST /register`, OAuth) returns a session token in
the JSON body and also sets it as an httpOnly cookie. The token is signed
(HMAC-SHA256), not held in server memory, so a session survives a restart and
works on every worker that shares the secret. With no config the first sign-in
generates one into `<data dir>/auth_secret` (mode 0600, never logged). For
several hosts set the same secret everywhere:
`export AIUI_AUTH_SECRET=$(aiui auth create-secret)`.

```yaml
auth:
  sessionLifetime: 14d   # default; 12h, 90m or seconds. Env AIUI_SESSION_LIFETIME wins
  cookie:                # all optional
    name: aiui_session
    sameSite: lax        # lax, strict or none (none adds Secure)
    path: /              # default: the app's root path
    secure: true         # default: on https (or X-Forwarded-Proto: https)
```

- **Sliding.** Under `requireAuth` the cookie signs in HTTP and WebSockets, and
  a request past half its lifetime gets a fresh one: active users stay signed
  in, idle ones are signed out after `sessionLifetime`. A Bearer token lasts
  `sessionLifetime` from sign-in. `SameSite` and the cross-site guard keep other
  sites from riding the cookie.
- **Sign-out.** `POST /logout` revokes the Bearer token and the cookie and
  deletes the cookie. Revoked token ids stay in `<data dir>/auth_revoked.jsonl`
  until they would have expired, so every worker on that data directory honours
  them. `Session.clear_tokens()` (in `@aiui.on_logout`) signs the user out on
  every device.
- **Rotation.** `AIUI_AUTH_SECRET=new,old`: the first secret signs, all verify.
  Drop `old` after `sessionLifetime`. A single new secret (or deleting
  `auth_secret`) signs everyone out.

Trade-off: hosts that do not share the data directory verify sessions but do
not see each other's sign-outs, so a signed-out token stays valid there until
it expires. Keep `sessionLifetime` short in that setup, or rotate the secret.

### OAuth sign-in

With a provider configured (`AIUI_OAUTH_<PROVIDER>_CLIENT_ID` and
`_CLIENT_SECRET`), a browser starts sign-in at
`/api/auth/oauth/<provider>?return_url=/chat`. Both that route and the callback
are public in every auth mode. `return_url` must be a path on this server
(starting with a single `/`). Anything else, such as an absolute URL or
`//host`, returns to `/`. The callback sends the browser to
`<return_url>#token=<session token>`. The token is in the URL fragment, which
browsers never send to a server, a log or a `Referer`. The dashboard stores it
and removes it from the address bar. A client that sends
`Accept: application/json` gets `{"user", "token"}` instead. OAuth tokens are
session tokens, so they sign in under `require_auth` / `auth.requireAuth`.

## Configuration

### Config File Location

The config file is located at `AIUI_DATA_DIR/config.yaml` (default: `~/.praisonaiui/config.yaml`).

### Config Structure

```yaml
schemaVersion: 2

# Site customization
site:
  title: "My Custom UI"  # Appears in HTML <title> and UI header

# Server settings
server:
  host: "127.0.0.1"
  port: 8003

# AI Provider
provider:
  name: "openai"
  model: "gpt-4o-mini"

# Gateway settings
gateway:
  host: "127.0.0.1"
  port: 8765

# Agents (managed via /api/agents)
agents: {}

# Skills (managed via /api/skills)
skills:
  enabled: []
  custom: {}

# Channels (managed via /api/channels)
channels: {}
```

### Site Title Customization

The site title is configurable via `site.title` in config.yaml:

```yaml
site:
  title: "AIUI"  # Default
```

This affects:
- HTML `<title>` tag
- Dashboard header
- `/ui-config.json` response

## Health Monitoring

### Health Endpoint

```bash
# Fast liveness probe (<500ms) - use for load balancers and K8s livenessProbe
curl http://localhost:8082/health/live
# Returns: {"status": "ok", "timestamp": "2024-..."}

# Readiness probe with parallel feature checks - use for K8s readinessProbe
curl http://localhost:8082/health/ready

# Deep diagnostics (parallel feature checks, deep by default)
curl http://localhost:8082/health
# Pass ?deep=false for an immediate liveness response
```

### Kubernetes Probes

Use the fast liveness endpoint for probes to avoid timeouts:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8082
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 1
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8082
  initialDelaySeconds: 5
  periodSeconds: 10
```

### Docker HEALTHCHECK

The Dockerfile includes a built-in health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${AIUI_PORT}/health/live || exit 1
```

### CLI Health Commands

```bash
# Quick health check
aiui health-check --server http://localhost:8082

# Detailed per-feature health  
aiui health-check --server http://localhost:8082 --detailed

# Full diagnostic (7 checks)
aiui doctor --server http://localhost:8082
```

## Security

### Auth Modes

AIUI supports multiple authentication modes:

| Mode | Description |
|------|-------------|
| `none` | No authentication (default) |
| `api_key` | API key in `X-API-Key` header or `api_key` query param |
| `session` | Session token in `Authorization: Bearer <token>` header |
| `password` | Username/password login |

### API Key Management

```bash
# Create an API key on a running server (or POST /api/auth/keys)
aiui auth create-key --name "my-app" --server http://localhost:8082

# Use the key
curl -H "X-API-Key: <key>" http://localhost:8082/api/config
```

### Cross-site requests

By default the server only serves its own pages: responses carry no CORS
headers, and a page on another site can neither open a WebSocket to it nor
send it a state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`, including
`text/plain` "simple" requests that skip the CORS preflight). The check uses
the browser's `Sec-Fetch-Site` header, so it works behind a reverse proxy that
rewrites `Host`; without that header the `Origin` is compared with `Host` and
`X-Forwarded-Host`. Requests with neither header (curl, SDK clients) are not
affected. A local dev server (Vite on another port) talking to a local server
is allowed.

To let another site call the server (an embedded widget, a separate frontend),
list its origin:

```bash
AIUI_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
# AIUI_ALLOWED_ORIGINS=*   # the old allow-everything behaviour
```

### Host names (DNS rebinding)

A server reached on a loopback or private address (`127.0.0.1`, `192.168.x.x`,
a Docker bridge) only answers requests whose `Host` is an IP address,
`localhost` / `*.localhost`, a `*.local` name, the machine's own hostname, or a
name listed in `AIUI_ALLOWED_HOSTS`. Anything else gets `400 Host not allowed`
(a WebSocket is closed with code 1008). This stops DNS rebinding, where a
website points its own domain at `127.0.0.1` so that the browser treats it as
same-origin with your local server.

If a reverse proxy on the same machine forwards a public name to the server
(nginx → `127.0.0.1:8082` with `proxy_set_header Host $host`), list that name:

```bash
AIUI_ALLOWED_HOSTS=aiui.example.com          # or .example.com for subdomains
# AIUI_ALLOWED_HOSTS=*   # turn the check off
```

A server reached directly on a public IP address is not checked.

### Network Considerations

- **Internal networks**: Use `AUTH_ENFORCE=false` if behind a trusted reverse proxy
- **Public exposure**: Always set `AUTH_ENFORCE=true` and use HTTPS
- **Load balancers**: Health check path is `/health/live` (fast, exempt from auth)

## Managed Hosting

### Required Endpoints

Hosting platforms should expose these endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/health/live` | Fast liveness probe (returns `{"status": "ok"}`) |
| `/health/ready` | Readiness probe (parallel feature checks) |
| `/health` | Deep health (parallel feature checks; `?deep=false` for liveness) |
| `/api/protocol` | Protocol version and capabilities |
| `/api/protocol/negotiate` | Capability negotiation |
| `/api/features` | List of registered features |

### Protocol Discovery

```bash
# Get protocol version
curl http://localhost:8082/api/protocol
# Returns: {"version": "1.0", "capabilities": [...]}

# List features
curl http://localhost:8082/api/features
# Returns: {"features": [{"name": "chat", ...}, ...]}
```

### Minimum Viable Deployment

For a minimal AIUI deployment:

1. **Required**: `OPENAI_API_KEY` environment variable
2. **Recommended**: Persistent volume for `AIUI_DATA_DIR`
3. **Optional**: `AUTH_ENFORCE=true` for multi-tenant environments

```bash
docker run -d \
  -p 8082:8082 \
  -e OPENAI_API_KEY=sk-... \
  -v aiui-data:/root/.praisonaiui \
  aiui:latest
```
