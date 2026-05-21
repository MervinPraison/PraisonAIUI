# Standalone vs Integrated

This page summarises the expected install and runtime shape for PraisonAIUI in both modes.

## Install Matrix

| Mode | Package install | Runtime dependency | Behaviour |
| --- | --- | --- | --- |
| Standalone UI | `pip install praisonaiui` | Optional SDK packages absent | Uses built-in local managers and fallbacks |
| Integrated (PraisonAI) | `pip install praisonaiui praisonai praisonaiagents` | SDK and wrapper available | Uses injected backends and SDK-aware managers |

## Practical Differences

- **Session/data handling**: standalone uses UI datastore fallback; integrated aligns with SDK-backed stores.
- **Feature backends**: standalone keeps in-memory/mock behaviour; integrated can route through injected factories.
- **Lifecycle hooks**: integrated mode can subscribe to SDK hooks (handoff, MCP lifecycle, tracing/eval stores).

## Recommendation

Use standalone mode for local UI-only workflows. Use integrated mode when you need shared runtime state with PraisonAI agents, tools, tracing, approvals, and schedules.
