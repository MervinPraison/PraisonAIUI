# PraisonAI package integration

How **PraisonAIUI** connects to **`praisonai-package`**. See also [Agent UI host](agent-ui-host.md).

## Deployment shapes

| Mode | Command | Ports |
|------|---------|-------|
| Single process | `praisonai claw` | :8082 |
| Unified gateway | `AIUIGateway.start()` | HTTP + `/ws` same port |
| Split | `praisonai gateway start` + `praisonai claw` | :8765 + :8082 |

## Wiring

```python
from praisonai.integration.host_app import configure_host, create_host_app

configure_host(pages=[...], modules=["jobs"], agents=[...])
app = create_host_app()
```

Or manually:

```python
import praisonaiui as aiui
from praisonai.ui._aiui_datastore import PraisonAISessionDataStore

aiui.set_datastore(PraisonAISessionDataStore())
aiui.set_style("dashboard")
aiui.set_dashboard(modules=["jobs"])
aiui.set_jobs_api(api_base="/api/v1/runs", backend="praisonai")  # package jobs server
```

## Jobs API duality

| Backend | Path | Config |
|---------|------|--------|
| aiui JobsFeature | `/api/jobs` | `set_jobs_backend("aiui")` (default) |
| praisonai jobs | `/api/v1/runs` | `set_jobs_backend("praisonai")` |

`/ui-config.json` → `jobs: { apiBase, backend }` — read by `jobs.js`.

## REST invoke vs chat

| Endpoint | Use |
|----------|-----|
| `POST /run` | Dashboard chat (SSE) |
| `POST /api/v1/agents/{id}/invoke` | Automation / n8n (package) |

## Parallel UI protocols

A2A, AG-UI, A2UI under `praisonaiagents/ui/` — embed paths, not dashboard replacements.

## Two plugin systems

| Folder | Purpose |
|--------|---------|
| `~/.praisonai/plugins/` | Agent runtime plugins |
| `~/.praisonai/dashboard-plugins/` | Dashboard UI tabs (aiui) |

## Discovery endpoints

| URL | Purpose |
|-----|---------|
| `/__praisonai__/discovery` | Serve-mode discovery |
| `/info`, `/health` | Gateway metadata |
| `/api/dashboard/plugins` | Dashboard plugin manifests |

## Smoke checklist

- [ ] `/api/health` — sidebar footer
- [ ] Chat streams via `/run`
- [ ] Sessions from datastore bridge
- [ ] Jobs page with `modules=["jobs"]`
- [ ] Explorer probes discovery URLs

## Examples

- [`examples/python/praisonai-claw-board/`](../../examples/python/praisonai-claw-board/app.py)
- [`examples/python/platform-board/`](../../examples/python/platform-board/app.py)

## Deferred

Board DnD / WebSocket sync — use `sdk.createBoard({ pollMs })` or custom dashboard plugin.
