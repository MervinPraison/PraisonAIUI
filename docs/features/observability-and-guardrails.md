---
title: Guardrails, Evals, Traces, Usage & Logs
nav_title: Observability & guardrails
description: Monitor token usage, latency telemetry, execution traces, live logs, safety guardrails and evaluation scores from built-in pages.
---

# Guardrails, Evals, Traces, Usage & Logs

Production AI apps need visibility into cost, latency, safety checks and quality regressions. PraisonAIUI includes six modular observability and safety plugins you can enable individually or all at once.

## Built-in plugins at a glance

| Plugin | Page ID | What it tracks | Key endpoints |
|---|---|---|---|
| **Usage (`builtin.usage`)** | `usage` | Token counts, model breakdown, session/agent totals and estimated costs | `GET /api/usage/summary`, `/models`, `/sessions`, `/agents`, `/timeseries`, `/costs`, `POST /api/usage/track` |
| **Traces (`builtin.traces`)** | `traces` | End-to-end execution traces and nested tool/LLM spans | `GET /api/traces`, `GET /api/traces/spans`, `GET /api/traces/{trace_id}`, `POST /api/traces/record` |
| **Telemetry (`builtin.telemetry`)** | `telemetry` | Runtime latency metrics, performance snapshots and profiling | `GET /api/telemetry`, `/metrics`, `/performance`, `/profiling`, `POST /api/telemetry/record` |
| **Logs (`builtin.logs`)** | `logs` | Live searchable server and agent log stream | `GET /api/logs`, `GET /api/logs/stream` |
| **Guardrails (`builtin.guardrails`)** | `guardrails` | Active safety rules and recorded policy violations | `GET /api/guardrails`, `/violations`, `POST /api/guardrails/register`, `DELETE /api/guardrails/{id}` |
| **Evals (`builtin.eval`)** | `eval` | Automated judges, evaluation runs and quality scores | `GET /api/eval`, `/judges`, `/scores`, `POST /api/eval/run` |

## Turn them on or off

```python
import praisonaiui as aiui

# Show only the observability pages your team uses
aiui.set_pages(["chat", "usage", "traces", "logs", "guardrails"])
```

To disable any non-required plugin and skip importing its backend module (R2/R4), list it under `extensions.disabled:` in `aiui.yaml` (e.g. `builtin.eval`, `builtin.telemetry`).
