# Standalone vs Integrated

This page summarises the expected install and runtime shape for PraisonAIUI in both modes.

## Install Matrix

| Mode | Package install | Runtime dependency | Behaviour |
| --- | --- | --- | --- |
| Standalone UI | `pip install praisonaiui` | Optional SDK packages absent | Uses built-in local managers and fallbacks |
| Integrated (PraisonAI) | `pip install praisonaiui praisonai praisonaiagents` | SDK and wrapper available | Uses injected backends and SDK-aware managers |

## Backend injection (integrated mode)

When hosted via `praisonai.integration.host_app.configure_host()`, the wrapper calls `praisonaiui.backends.set_backend()` for:

| Backend key | Feature area |
| --- | --- |
| `hooks` | Hooks dashboard |
| `workflows` | Workflow runs |
| `usage_query` / `usage_sink` | Usage analytics |
| `approvals_pending` / `approvals_policies` | HITL approvals |
| `jobs_store` / `jobs_executor` | Async jobs (optional) |
| `channel_bot` | Channel bots (optional) |
| `tool_resolver` | Agent tool name resolution (optional) |

Detect integrated mode in code: `praisonaiui.backends.is_integrated_mode()`.

## Documented SDK gaps (local fallback)

These features work standalone with in-memory stores. Health responses include `sdk_gap: true`:

| Feature | Gap | Standalone behaviour |
| --- | --- | --- |
| **nodes** | No cluster API in praisonaiagents | In-memory node registry |
| **auth** | No SDK auth module | In-memory API keys / sessions |
| **channels** | Bot runtime via praisonai wrapper | In-memory channel registry; bots need `praisonai[bot]` |
| **jobs** | Mock success only when standalone and agent missing | Integrated mode fails job instead of fake success |
| **realtime** | WebRTC needs `OPENAI_API_KEY` | Mock stream standalone; degraded error when integrated without key |
| **media / code** | SDK paths optional | `status: simulated` standalone; `status: degraded` integrated on failure |

View gaps in the dashboard sidebar footer (`GET /api/health` → `sdk_gaps` array).

## Practical Differences

- **Session/data handling**: standalone uses UI datastore fallback; integrated aligns with SDK-backed stores.
- **Feature backends**: standalone keeps in-memory/mock behaviour; integrated routes through injected factories.
- **Lifecycle hooks**: integrated mode can subscribe to SDK hooks (handoff, MCP lifecycle, tracing/eval stores).

## Recommendation

Use standalone mode for local UI-only workflows. Use integrated mode when you need shared runtime state with PraisonAI agents, tools, tracing, approvals, and schedules.

See also [backend-integration.md](backend-integration.md) and [praisonai-package-integration.md](praisonai-package-integration.md).
