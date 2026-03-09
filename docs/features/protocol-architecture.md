# Protocol Architecture Reference

All feature modules in PraisonAIUI implement a **Protocol ABC** pattern for type-safe, swappable backends.

## Pattern

```
FeatureProtocol (ABC)              <- abstract interface
  ├── SDKFeatureManager            <- wraps praisonaiagents SDK
  └── SimpleFeatureManager         <- in-memory fallback
get_feature_manager()              <- SDK-first factory
```

## Batch 1: Full SDK Wrappers

| File | Protocol | SDK Class | Fallback | Getter |
|------|----------|-----------|----------|--------|
| `guardrails.py` | `GuardrailProtocol` | `SDKGuardrailManager` | `SimpleGuardrailManager` | `get_guardrail_manager()` |
| `tracing.py` | `TracingProtocol` | `SDKTracingManager` | `SimpleTracingManager` | `get_tracing_manager()` |
| `eval.py` | `EvalProtocol` | `SDKEvalManager` | `SimpleEvalManager` | `get_eval_manager()` |
| `approvals.py` | `ApprovalProtocol` | `SDKApprovalManager` | `SimpleApprovalManager` | `get_approval_manager()` |

## Batch 2: SDK Wrappers + Refactored Stores

| File | Protocol | SDK Class | Fallback | Getter |
|------|----------|-----------|----------|--------|
| `security.py` | `SecurityProtocol` | `SDKSecurityManager` | `SimpleSecurityManager` | `get_security_manager()` |
| `telemetry.py` | `TelemetryProtocol` | `SDKTelemetryManager` | `SimpleTelemetryManager` | `get_telemetry_manager()` |
| `jobs.py` | `JobStoreProtocol` | `SDKJobStore` | `SimpleJobStore` | `get_job_store()` |
| `agents.py` | `AgentRegistryProtocol` | `SDKAgentRegistry` | `SimpleAgentRegistry` | `get_agent_registry()` |

## Batch 3: Formalized ABCs

| File | Protocol | Notes |
|------|----------|-------|
| `sessions_ext.py` | `SessionProtocol` | Formalized existing SDK-first pattern |
| `schedules.py` | `ScheduleProtocol` | Formalized existing SDK-first pattern |
| `channels.py` | `ChannelProtocol` | SDK gap: no channel management API |
| `usage.py` | `UsageProtocol` | SDK gap: no token/cost tracking API |
| `logs.py` | `LogProtocol` | UI-only by design |
| `auth.py` | `AuthProtocol` | SDK gap: no auth API |
| `config_runtime.py` | `ConfigProtocol` | UI-only by design |
| `nodes.py` | `NodeProtocol` | SDK gap: no node/cluster API |

## Pre-existing

| File | Protocol | Notes |
|------|----------|-------|
| `memory.py` | `MemoryProtocol` | P0 fix: SDK-first default |
| `skills.py` | `BaseFeatureProtocol` | P1 fix: `get_tool_catalog()` |

## SDK Gaps

Features where `praisonaiagents` SDK lacks backend support:

| Feature | Gap | Recommendation |
|---------|-----|----------------|
| **Usage** | No token/cost tracking API | Add `UsageTracker` to `praisonaiagents.telemetry` |
| **Auth** | No authentication module | Add `praisonaiagents.auth` with key/session persistence |
| **Nodes** | No node/cluster management | Add `praisonaiagents.nodes` for node discovery |
| **Channels** | No channel management API | Add `praisonaiagents.channels` with `ChannelStore` |
| **Config** | No runtime config persistence | Add `praisonaiagents.config` with file-backed store |

---

## Building & Extending — Key Rules

### Agent Registration API

> [!CAUTION]
> The old `create_agent()` function and `_agent_definitions` dict were **removed**. All agent registration now goes through the Protocol ABC.

```python
# ✅ Correct — use the registry singleton
from praisonaiui.features.agents import get_agent_registry

registry = get_agent_registry()

# Create
registry.create({
    "name": "MyAgent",
    "description": "Does X",
    "instructions": "You are ...",
    "model": "gpt-4o-mini",
    "icon": "🤖",
})

# List & check
existing = registry.list_all()  # returns list of dicts
agent = registry.get("agent-id-here")

# Update / Delete
registry.update("agent-id", {"model": "gpt-4o"})
registry.delete("agent-id")
```

### Frontend Manifest Requirement

> [!IMPORTANT]
> The React frontend **always** fetches 3 JSON files before rendering, regardless of style:
> - `/ui-config.json` — must return `{"style": "dashboard"}` (or `"chat"`, `"agents"`, etc.)
> - `/docs-nav.json` — sidebar nav (can be `{"items": []}` for non-docs modes)
> - `/route-manifest.json` — URL routing (can be `{}` for non-docs modes)
>
> If any of these 404, the user sees **"Failed to load manifests"** and the dashboard never renders.

In `server.py`, `create_app()` provides dynamic fallback handlers for these. If you are running
via `AIUIGateway`, these handlers are included automatically. If writing a custom server, ensure
these routes exist.

### Style System

The `style` field in `/ui-config.json` controls which React component renders:

| Style | Component | Use Case |
|-------|-----------|----------|
| `"docs"` | Three-column docs layout | Documentation sites |
| `"dashboard"` | Full sidebar + pages | Feature management dashboard |
| `"chat"` | Chat-focused interface | Chat-only applications |
| `"agents"` | Agent selector + chat | Multi-agent interfaces |
| `"playground"` | Split-pane playground | Agent experimentation |
| `"custom"` | Flexible layout | Custom configurations |

Set via Python: `aiui.set_style("dashboard")`

### Feature Protocol — How to Add a New Feature

Every feature follows the same 4-step pattern:

1. **Define the Protocol ABC** — abstract methods for the capability
2. **Implement `SimpleXxxManager`** — in-memory fallback, zero dependencies
3. **Implement `SDKXxxManager`** — wraps `praisonaiagents` SDK (if available)
4. **Provide `get_xxx_manager()`** — factory function, SDK-first with fallback

```python
# Minimal feature skeleton
from abc import ABC, abstractmethod

class MyProtocol(ABC):
    @abstractmethod
    def do_thing(self, data): ...

class SimpleMyManager(MyProtocol):
    def do_thing(self, data):
        return {"status": "ok", "data": data}

_manager = None

def get_my_manager() -> MyProtocol:
    global _manager
    if _manager is None:
        try:
            # Try SDK-first
            from praisonaiagents.my_module import MySDKClass
            _manager = SDKMyManager()
        except ImportError:
            _manager = SimpleMyManager()
    return _manager
```

### Data Persistence

- **Sessions**: JSON files in `~/.praisonaiui/sessions/{session_id}.json`
- **Agents**: In-memory by default; `SimpleAgentRegistry` persists to data file if `set_data_file()` called
- **Schedules**: `FileScheduleStore` from `praisonaiagents` SDK persists to disk
- **Config**: Runtime config via `/api/config_runtime`, not persisted by default

### Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| `ImportError: _agent_definitions` | Use `get_agent_registry()` instead |
| "Failed to load manifests" in browser | Ensure `/ui-config.json` route exists and returns valid JSON with `style` field |
| Port already in use | `lsof -ti :PORT \| xargs kill -9` before starting |
| Chat returns no response | Check `OPENAI_API_KEY` is set in the running process |
| `praisonai_agents: false` in `/health` | Install `praisonaiagents` package |
| Features show 0 count | Features auto-register on import; check `server.py` initializes them |
