# Feature Protocols

PraisonAIUI uses a **protocol-driven architecture** to wire features into the server. Every feature module implements the `BaseFeatureProtocol` ABC, which auto-registers API routes, CLI commands, and health checks.

## Architecture

```mermaid
graph TD
    A["create_app()"] --> B["auto_register_defaults()"]
    B --> C["Feature Registry"]
    C --> D["API Routes mounted"]
    C --> E["CLI commands registered"]
    C --> F["Health checks wired"]
    
    subgraph "10 Built-in Features"
        F1["Approvals"]
        F2["Channels"]
        F3["Schedules"]
        F4["Memory"]
        F5["Nodes"]
        F6["Sessions Ext"]
        F7["Skills"]
        F8["Hooks"]
        F9["Workflows"]
        F10["Config Runtime"]
    end
    
    C --> F1 & F2 & F3 & F4 & F5 & F6 & F7 & F8 & F9 & F10
```

## Quick Start

### List All Features

```bash
# CLI
aiui features list --server http://127.0.0.1:8000

# API
curl http://127.0.0.1:8000/api/features
```

### Python — Create a Custom Feature

```python
from praisonaiui.features._base import BaseFeatureProtocol
from starlette.routing import Route
from starlette.requests import Request
from starlette.responses import JSONResponse

class MyFeature(BaseFeatureProtocol):
    feature_name = "my_feature"
    feature_description = "Does something cool"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self):
        return [Route("/api/my-feature", self._handler, methods=["GET"])]

    async def _handler(self, request: Request) -> JSONResponse:
        return JSONResponse({"hello": "world"})

# Register it
from praisonaiui.features import register_feature
register_feature(MyFeature())
```

## BaseFeatureProtocol API

Every feature module must implement:

| Method | Return | Required | Description |
|--------|--------|----------|-------------|
| `name` | `str` | ✓ | Unique feature identifier |
| `description` | `str` | ✓ | Human-readable description |
| `routes()` | `List[Route]` | ✓ | Starlette routes to mount |
| `cli_commands()` | `List[dict]` | ○ | CLI command metadata |
| `health()` | `dict` | ○ | Health check (default: `{"status": "ok"}`) |
| `info()` | `dict` | ○ | Metadata for `/api/features` listing |

### `cli_commands()` Format

```python
def cli_commands(self):
    return [{
        "name": "my-feature",        # Typer subcommand group name
        "help": "My feature things",  # Group help text
        "commands": {
            "list": {"help": "List items", "handler": self._cli_list},
            "add":  {"help": "Add item",  "handler": self._cli_add},
        },
    }]
```

## Registry Functions

```python
from praisonaiui.features import (
    register_feature,        # Register a feature instance
    get_features,            # Get all registered features (dict)
    get_feature,             # Get a single feature by name
    auto_register_defaults,  # Register all 10 built-in features
)
```

## Built-in Features Reference

### 1. Approvals

Manage tool-execution approval requests.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/approvals` | GET | List approvals (filter: `?status=pending\|resolved\|all`) |
| `/api/approvals` | POST | Create approval request |
| `/api/approvals/{id}` | GET | Get single approval |
| `/api/approvals/{id}/resolve` | POST | Approve/deny |
| `/api/approvals/config` | GET | Get approval config |

**CLI:** `aiui approval list`, `aiui approval pending`, `aiui approval resolve <id>`

### 2. Channels

Multi-platform messaging channel management (Discord, Slack, Telegram, WhatsApp, etc.).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/channels` | GET | List all channels (enriched with gateway status) |
| `/api/channels` | POST | Add a channel |
| `/api/channels/platforms` | GET | List supported platforms |
| `/api/channels/{id}` | GET | Get channel details |
| `/api/channels/{id}` | PUT | Update channel |
| `/api/channels/{id}` | DELETE | Remove channel |
| `/api/channels/{id}/toggle` | POST | Enable/disable |
| `/api/channels/{id}/status` | GET | Live status (gateway-enriched) |

**CLI:** `aiui channel list`, `aiui channel status`, `aiui channel platforms`

### 3. Schedules

Manage scheduled jobs (cron, interval, one-shot).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/schedules` | GET | List all jobs |
| `/api/schedules` | POST | Add a job |
| `/api/schedules/{id}` | GET | Get job details |
| `/api/schedules/{id}` | DELETE | Remove job |
| `/api/schedules/{id}/toggle` | POST | Enable/disable |
| `/api/schedules/{id}/run` | POST | Trigger immediately |

**CLI:** `aiui schedule list`, `aiui schedule add <name> <msg>`, `aiui schedule remove <id>`, `aiui schedule status`

### 4. Memory

Agent memory management (short-term, long-term, entity).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory` | GET | List memories (filter: `?type=short\|long\|entity\|all`) |
| `/api/memory` | POST | Add memory entry |
| `/api/memory/search` | POST | Search memories |
| `/api/memory/{id}` | GET | Get single memory |
| `/api/memory/{id}` | DELETE | Delete memory |
| `/api/memory` | DELETE | Clear memories (filter: `?type=all`) |

**CLI:** `aiui memory list`, `aiui memory add <text>`, `aiui memory search <query>`, `aiui memory clear`, `aiui memory status`

### 5. Nodes

Execution node registration, agent bindings, and instance presence.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nodes` | GET | List all nodes |
| `/api/nodes` | POST | Register a node |
| `/api/nodes/{id}` | GET | Get node details |
| `/api/nodes/{id}` | PUT | Update node |
| `/api/nodes/{id}` | DELETE | Remove node |
| `/api/nodes/{id}/status` | GET | Node status (gateway-enriched) |
| `/api/nodes/{id}/agents` | GET/PUT | Get/set agent bindings |
| `/api/instances` | GET | List connected instances |
| `/api/instances/heartbeat` | POST | Record presence heartbeat |

**CLI:** `aiui node list`, `aiui node status`, `aiui node instances`

### 6. Extended Sessions

Advanced session management (state, context, labels, usage).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions/{id}/state` | GET | Get session state |
| `/api/sessions/{id}/state` | POST | Save session state |
| `/api/sessions/{id}/context` | POST | Build context |
| `/api/sessions/{id}/compact` | POST | Compact session |
| `/api/sessions/{id}/reset` | POST | Reset session |
| `/api/sessions/{id}/labels` | GET/POST | Get/set labels |
| `/api/sessions/{id}/usage` | GET | Get usage stats |

### 7. Skills

Agent skill registration and discovery.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/skills` | GET | List skills |
| `/api/skills` | POST | Register skill |
| `/api/skills/discover` | POST | Discover available skills |
| `/api/skills/{id}` | GET | Get skill details |
| `/api/skills/{id}/status` | GET | Get skill status |
| `/api/skills/{id}` | DELETE | Remove skill |

**CLI:** `aiui skills list`, `aiui skills status`, `aiui skills discover`

### 8. Hooks

Pre/post operation hooks for tool calls, agent runs, etc.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/hooks` | GET | List hooks |
| `/api/hooks` | POST | Register hook |
| `/api/hooks/log` | GET | View execution log |
| `/api/hooks/{id}` | GET | Get hook details |
| `/api/hooks/{id}` | DELETE | Remove hook |
| `/api/hooks/{id}/trigger` | POST | Trigger manually |

**CLI:** `aiui hooks list`, `aiui hooks trigger <id>`, `aiui hooks log`

### 9. Workflows

Multi-step workflow orchestration (Pipeline, Route, Parallel, Loop).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workflows` | GET | List workflows |
| `/api/workflows` | POST | Create workflow |
| `/api/workflows/runs` | GET | List all runs |
| `/api/workflows/runs/{id}` | GET | Get run details |
| `/api/workflows/{id}` | GET | Get workflow |
| `/api/workflows/{id}` | DELETE | Delete workflow |
| `/api/workflows/{id}/run` | POST | Execute workflow |
| `/api/workflows/{id}/status` | GET | Workflow status |

**CLI:** `aiui workflows list`, `aiui workflows run <id>`, `aiui workflows status`, `aiui workflows runs`

### 10. Config Runtime

Live runtime configuration without server restart.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config/runtime` | GET | Get all config |
| `/api/config/runtime` | PATCH | Merge config values |
| `/api/config/runtime` | PUT | Replace all config |
| `/api/config/runtime/history` | GET | Change history |
| `/api/config/runtime/{key}` | GET | Get single key |
| `/api/config/runtime/{key}` | PUT | Set single key |
| `/api/config/runtime/{key}` | DELETE | Delete key |

**CLI:** `aiui config get [key]`, `aiui config set <key> <value>`, `aiui config list`, `aiui config history`

## Route Ordering

> **Important:** When defining routes with parametric paths (e.g., `/{id}`), always place literal paths (e.g., `/log`, `/runs`) **before** the parametric route. Starlette matches routes in order, and a parametric route will capture literal segments as parameter values.

```python
# ✓ Correct — literal before parametric
Route("/api/hooks/log", self._log, methods=["GET"]),
Route("/api/hooks/{hook_id}", self._get, methods=["GET"]),

# ✗ Wrong — "log" captured as hook_id
Route("/api/hooks/{hook_id}", self._get, methods=["GET"]),
Route("/api/hooks/log", self._log, methods=["GET"]),
```

## Integration Example

```python
"""Custom analytics feature — tracks page views."""
from praisonaiui.features._base import BaseFeatureProtocol
from starlette.routing import Route
from starlette.requests import Request
from starlette.responses import JSONResponse

_views = {}

class AnalyticsFeature(BaseFeatureProtocol):
    feature_name = "analytics"
    feature_description = "Page view tracking"

    @property
    def name(self): return self.feature_name

    @property
    def description(self): return self.feature_description

    def routes(self):
        return [
            Route("/api/analytics", self._list, methods=["GET"]),
            Route("/api/analytics/track", self._track, methods=["POST"]),
        ]

    async def _list(self, request):
        return JSONResponse({"views": _views, "total": sum(_views.values())})

    async def _track(self, request):
        body = await request.json()
        page = body.get("page", "/")
        _views[page] = _views.get(page, 0) + 1
        return JSONResponse({"page": page, "count": _views[page]})

    def cli_commands(self):
        return [{"name": "analytics", "help": "View analytics",
                 "commands": {"stats": {"help": "Show stats", "handler": self._cli_stats}}}]

    def _cli_stats(self):
        return f"Total views: {sum(_views.values())}"

# Register on import
from praisonaiui.features import register_feature
register_feature(AnalyticsFeature())
```
