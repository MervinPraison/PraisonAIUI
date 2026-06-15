# PraisonAI package integration

How **PraisonAIUI** (`aiui`) connects to **`praisonai-package`** — the agent runtime, gateway, and CLI. For generic UI hosting see [Agent UI host](agent-ui-host.md).

## Division of labour

| Layer | Repo | Role |
|-------|------|------|
| Agent runtime | `praisonai-agents` | `Agent`, tools, memory, streaming |
| Gateway, jobs, CLI | `praisonai` | WebSocket `/ws`, `/api/v1/runs`, `praisonai claw` |
| Dashboard UI | **PraisonAIUI** | `dashboard.js`, `@aiui.page`, layout protocol |
| Work tracking | `praisonai-platform` | Issues API (optional board data source) |

Canonical app: `praisonai-package` → `src/praisonai/praisonai/claw/default_app.py`.

## Deployment shapes

### 1. Single process — `praisonai claw` (recommended)

```bash
praisonai claw   # → aiui run claw/default_app.py, default :8082
```

```text
Browser → create_app() (same process)
        → PraisonAISessionDataStore (sessions)
        → PraisonAIProvider (@aiui.reply / agents)
        → Built-in dashboard views
```

Use when: local dev, full dashboard, agents registered in Python.

### 2. Unified — `AIUIGateway`

```python
from praisonaiui.integration import AIUIGateway
gateway = AIUIGateway(port=8080)
gateway.register_agent(agent)
await gateway.start()   # create_app() + WebSocket /ws
```

Use when: you need **WebSocket gateway protocol** and dashboard on **one port**.

### 3. Split — gateway + UI

| Service | Default port | Endpoints |
|---------|--------------|-----------|
| `praisonai gateway start` | 8765 | `ws://…/ws`, `/health`, `/info` |
| `praisonai claw` or `aiui run` | 8082 | Dashboard, `/run` SSE, `/api/*` |

Use when: gateway runs headless; UI is a separate process. Point chat at gateway via provider config or run `AIUIGateway` instead.

## Wiring checklist

```python
import praisonaiui as aiui
from praisonai.ui._aiui_datastore import PraisonAISessionDataStore

aiui.set_datastore(PraisonAISessionDataStore())
aiui.set_style("dashboard")
aiui.set_pages(["chat", "agents", "sessions", "config"])
aiui.set_dashboard(modules=["jobs"], sidebar=True, page_header=True)

# Optional: point jobs UI at package jobs server paths
aiui.set_jobs_api(api_base="/api/v1/runs", backend="praisonai")
```

Or via host bootstrap:

```python
from praisonai.integration.host_app import configure_host, create_host_app

configure_host(pages=[...], modules=["jobs"], agents=[...])
app = create_host_app()
```

## API surface

### Chat and agents (dashboard)

| Endpoint | Purpose |
|----------|---------|
| `POST /run` | Stream agent run (SSE) |
| `GET /sessions`, `POST /sessions` | Session CRUD |
| `GET /agents`, `/api/agents/definitions` | Agent list / CRUD |
| `GET /api/health` | Sidebar health slot |

### Async jobs — two paths

| Backend | Base path | When |
|---------|-----------|------|
| **aiui** `JobsFeature` | `/api/jobs` | Default; in-process job store |
| **praisonai** jobs server | `/api/v1/runs` | Standalone `praisonai jobs` / FastAPI router |

Configure the dashboard jobs view:

```python
aiui.set_jobs_api(api_base="/api/jobs", backend="aiui")       # default
aiui.set_jobs_api(api_base="/api/v1/runs", backend="praisonai")
```

`/ui-config.json` exposes `jobs: { apiBase, backend }` for `jobs.js`.

**Response shapes:** both return `{ jobs, total }`. Praison uses `job_id`; aiui uses `id`. The jobs view normalises either field.

| Action | aiui | praisonai |
|--------|------|-----------|
| List | `GET /api/jobs` | `GET /api/v1/runs` |
| Detail | `GET /api/jobs/{id}` | `GET /api/v1/runs/{id}` |
| Cancel | `POST /api/jobs/{id}/cancel` | `POST /api/v1/runs/{id}/cancel` |
| Stream | `GET /api/jobs/{id}/stream` | `GET /api/v1/runs/{id}/stream` |
| Delete | `DELETE /api/jobs/{id}` | Not on package router |

### REST invoke (automation)

| Path | Use |
|------|-----|
| `POST /api/v1/agents/{id}/invoke` | Sync invoke (n8n, scripts) — **package** `agent_invoke.py` |
| `POST /run` | Streaming chat — **dashboard** chat page |

Same agents if registered on both surfaces; different protocols.

### Discovery (package serve)

| Endpoint | Purpose |
|----------|---------|
| `GET /__praisonai__/discovery` | Serve-mode capability discovery |
| `GET /health`, `GET /info` | Gateway liveness and metadata |
| `GET /api/gateway/status` | aiui gateway feature status |

See **Feature Explorer** page in dashboard for live probes.

## Parallel UI protocols (not dashboard replacements)

Under `praisonaiagents/ui/`:

| Protocol | Purpose |
|----------|---------|
| **A2A** | Agent cards, `/.well-known/agent.json`, external agent hosts |
| **AG-UI** | CopilotKit-style event stream (`POST /agui`) |
| **A2UI** | Declarative surfaces in chat/canvas |

Dashboard shell remains the ops console for `praisonai claw`. Use A2A/AG-UI/A2UI when embedding in other products.

## Two plugin systems

| System | Location | Purpose |
|--------|----------|---------|
| **Agent plugins** | `~/.praisonai/plugins/` | Python agent extensions (`praisonaiagents.plugins`) |
| **Dashboard plugins** | `~/.praisonai/dashboard-plugins/` | JS tabs + `manifest.json` for aiui shell |

Do not mix folders. Agent plugins extend runtime; dashboard plugins extend UI tabs only.

## Optional modules

```python
aiui.set_dashboard(modules=["jobs", "auth", "api"])
```

Loads `jobs.js`, `auth.js`, `api.js` into the plugin chain and maps them in `BUILTIN_VIEWS`. Enable only what your deployment exposes.

## Board / work tracking

Neither repo ships Hermes-style Kanban. Options:

1. **`aiui.board()`** — columns from `@aiui.page` handler (jobs by status, custom data).
2. **`praisonai-platform` issues** — map issue `status` → board columns (see `examples/python/platform-board/`). Set `PRAISONAI_PLATFORM_URL` and `PRAISONAI_PLATFORM_WORKSPACE_ID` (default workspace `default`); issues are fetched from `GET /api/v1/workspaces/{workspace_id}/issues`.
3. **`dashboard-plugins`** — rich JS via `registerView` + `sdk.createBoard`.

Advanced board UX (drag-drop, WebSocket sync) is **deferred** — use polling via `sdk.createBoard({ pollMs })` or a custom plugin.

## Smoke checklist

After `praisonai claw` or `aiui run` with package bridges:

- [ ] `GET /api/health` → sidebar footer shows healthy
- [ ] Chat page sends message, streams reply
- [ ] Sessions page lists `~/.praisonai/sessions/` data
- [ ] Agents page CRUD (if agents registered)
- [ ] Jobs page (if `modules` includes `jobs` and jobs API configured)
- [ ] Explorer probes `/health`, `/ui-config.json`, `/api/dashboard/plugins`
- [ ] Auth/API pages (if `modules` includes `auth` / `api`)

## Related

- [Agent UI host](agent-ui-host.md) — extension API, opt-in matrix
- [Backend integration](backend-integration.md) — L1 backend injection
- [Standalone vs integrated](standalone-vs-integrated.md) — SDK gaps and fallbacks
- [PraisonAIUI repository](https://github.com/MervinPraison/PraisonAIUI)
- [`integration.py`](../../src/praisonaiui/integration.py) — `AIUIGateway`
- [`examples/python/praisonai-claw-board/`](../../examples/python/praisonai-claw-board/app.py) — board from jobs
- [`examples/python/platform-board/`](../../examples/python/platform-board/app.py) — board from platform issues
