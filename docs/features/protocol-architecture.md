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
