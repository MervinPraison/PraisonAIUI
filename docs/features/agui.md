---
nav_title: AG-UI Protocol
---

# AG-UI Protocol

PraisonAIUI exposes an [AG-UI](https://docs.ag-ui.com/) SSE endpoint (`POST /agui`) so CopilotKit and any AG-UI-compatible frontend can stream runs directly from your PraisonAI agents.

## Requirements

The AG-UI encoder and runner come from `praisonaiagents`:

```bash
pip install "aiui[praisonai]"
```

When `praisonaiagents` is not installed (or no agent is available), `POST /agui` returns HTTP `503` and `GET /agui/status` reports `"status": "unavailable"`.

## Registering an Agent

Register an agent in your `app.py` (or configure one via the Agents page or PraisonAI gateway):

```python
import praisonaiui as aiui
from praisonaiagents import Agent

assistant = Agent(
    name="assistant",
    instructions="You are a helpful assistant.",
)
aiui.register_agent("assistant", assistant)
```

`POST /agui` resolves the target agent in this order:

1. Explicitly registered agents (`aiui.register_agent(name, agent)`) matching `agent_name` in the JSON body or `?agent=<name>` query parameter (falls back to the registered agent when omitted).
2. Active `AIUIGateway` agents when running with `--backend praisonai`.
3. Existing provider agents, or lazily constructed agents from the Agents CRUD store when `praisonaiagents` is installed.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/agui` | Stream an AG-UI run (`text/event-stream`). Validates the body as `RunAgentInput` (`400` on invalid payload, `503` when no agent or `praisonaiagents` is available). |
| `OPTIONS` | `/agui` | CORS preflight for browser AG-UI clients. |
| `GET` | `/agui/status` | Check availability: `{"status": "available" \| "unavailable", "agent_registered": bool}`. |

### Example Request

```bash
curl -N -X POST http://127.0.0.1:8000/agui \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "thread-1",
    "runId": "run-1",
    "messages": [{"id": "m1", "role": "user", "content": "Summarize today'\''s status"}]
  }'
```

Select a specific agent with `"agent_name": "researcher"` in the JSON body or `?agent=researcher` on the URL.

## Disabling AG-UI

AG-UI is shipped as the built-in plugin `builtin.agui`. To disable it:

```yaml
extensions:
  disabled:
    - builtin.agui
```

## See Also

- [Protocols Overview](protocols.md)
- [Workflows & OpenAI API](workflows-and-openai-api.md)
- [Features REST API](../api/features-api.md#ag-ui)
